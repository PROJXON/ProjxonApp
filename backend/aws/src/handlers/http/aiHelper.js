// HTTP API (payload v2) Lambda: POST /ai/helper
// Env:
// - OPENAI_API_KEY
// - OPENAI_MODEL (optional, default: gpt-4o-mini)
// - AI_HELPER_TABLE (optional but recommended for caching/throttling)
// - HELPER_THROTTLE_SECONDS (optional, default: 15)
//
// NOTE: This is a demo-quality assistant. It receives plaintext message history from the client.
// It should be invoked behind the same JWT authorizer as other authenticated routes.

const { DynamoDBClient, GetItemCommand, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const crypto = require('crypto');

const ddb = new DynamoDBClient({});

function safeString(v) {
  return String(v ?? '').trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampText(s, maxLen) {
  const t = safeString(s);
  if (!t) return '';
  return t.length > maxLen ? `${t.slice(0, maxLen)}…` : t;
}

function sanitizeThread(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const role = item.role === 'assistant' ? 'assistant' : item.role === 'user' ? 'user' : null;
    if (!role) continue;
    const text = clampText(item.text ?? item.content ?? '', 1200);
    if (!text) continue;
    out.push({ role, text });
    if (out.length >= 24) break; // cap total turns to keep DynamoDB + prompt bounded
  }
  return out;
}

function normalizeSuggestions(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const x of raw) {
    if (!x) continue;
    if (typeof x === 'string') out.push(x.trim());
    else if (typeof x === 'object' && x.text) out.push(String(x.text).trim());
    if (out.length >= 3) break;
  }
  return out.filter(Boolean);
}

function ensureExactlyThreeSuggestions(suggestions, instruction) {
  const base = Array.isArray(suggestions) ? suggestions.map((s) => safeString(s)).filter(Boolean).slice(0, 3) : [];
  if (base.length === 3) return base;

  const isQuestion =
    /\?\s*$/.test(String(instruction || '')) ||
    /\b(what|why|how|when|where|who|which)\b/i.test(String(instruction || ''));

  const candidatePool = isQuestion
    ? [
        'Can you clarify what you mean?',
        'What outcome do you want from this conversation?',
        'Do you want a short reply or a more detailed one?',
      ]
    : [
        'Sounds good.',
        'Got it - thanks!',
        'Can you tell me a bit more?',
      ];

  const out = base.slice();
  for (const c of candidatePool) {
    const s = safeString(c);
    if (!s) continue;
    if (out.some((x) => x.toLowerCase() === s.toLowerCase())) continue;
    out.push(s);
    if (out.length >= 3) break;
  }

  // Last-resort padding (should be rare if the model follows instructions).
  while (out.length < 3) out.push('Okay.');

  return out.slice(0, 3);
}

function wantsReplyOptions(instruction) {
  // Legacy intent toggle: before the UI toggle existed, users typed the word "response"
  // to request draft replies. We keep this as a fallback for older clients.
  return /\bresponse\b/i.test(String(instruction || ''));
}

function sanitizeAttachments(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const a of raw) {
    if (!a || typeof a !== 'object') continue;
    const kind = a.kind === 'video' ? 'video' : a.kind === 'image' ? 'image' : null;
    if (!kind) continue;
    const thumbUrl = safeString(a.thumbUrl || '');
    // Require https URL (typically signed S3) for OpenAI to fetch.
    if (!/^https:\/\//i.test(thumbUrl)) continue;
    const thumbKey = safeString(a.thumbKey || '') || null;
    const fileName = safeString(a.fileName || '') || null;
    const size = Number.isFinite(Number(a.size)) ? Math.max(0, Math.floor(Number(a.size))) : null;
    const user = safeString(a.user || '') || null;
    const createdAt = Number.isFinite(Number(a.createdAt)) ? Math.max(0, Math.floor(Number(a.createdAt))) : null;
    out.push({ kind, thumbUrl, thumbKey, fileName, size, user, createdAt });
    if (out.length >= 3) break;
  }
  return out;
}

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method;
  if (method !== 'POST') {
    return { statusCode: 405, headers: { Allow: 'POST' }, body: JSON.stringify({ message: 'Method not allowed' }) };
  }

  try {
    // Node 18+ provides global fetch. If you're on Node 16 (or older), this will fail.
    if (typeof fetch !== 'function') {
      return {
        statusCode: 500,
        body: JSON.stringify({
          message: 'Server misconfigured: runtime missing fetch (use Node.js 18+ / 20.x)',
        }),
      };
    }

    if (!process.env.OPENAI_API_KEY) {
      return { statusCode: 500, body: JSON.stringify({ message: 'OPENAI_API_KEY not configured' }) };
    }

    const sub = event.requestContext?.authorizer?.jwt?.claims?.sub;
    if (!sub) {
      return { statusCode: 401, body: JSON.stringify({ message: 'Unauthorized' }) };
    }

    let body = {};
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return { statusCode: 400, body: JSON.stringify({ message: 'Invalid JSON body' }) };
    }
    const convoId = safeString(body.conversationId || '') || 'global';
    const peer = body.peer ? safeString(body.peer) : null;
    const instruction = safeString(body.instruction || '');
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const resetThread = Boolean(body.resetThread);
    const clientThread = sanitizeThread(body.thread);
    const attachments = sanitizeAttachments(body.attachments);
    const wantReplies =
      typeof body.wantReplies === 'boolean' ? body.wantReplies : wantsReplyOptions(instruction);

    if (!instruction) {
      return { statusCode: 400, body: JSON.stringify({ message: 'instruction is required' }) };
    }

    const tableName = process.env.AI_HELPER_TABLE;
    const throttleSeconds = Number(process.env.HELPER_THROTTLE_SECONDS || 15);

    // Keep context bounded. Client typically sends ~50.
    const transcript = messages
      .slice(-80)
      .map((m) => {
        const u = safeString(m.user || 'anon') || 'anon';
        const t = safeString(m.text || '');
        return t ? `${u}: ${t.slice(0, 500)}` : null;
      })
      .filter(Boolean)
      .join('\n');

    const attachmentsSig = attachments
      .map((a) => `${a.kind}|${a.thumbKey || ''}|${a.fileName || ''}|${a.size || ''}|${a.user || ''}|${a.createdAt || ''}`)
      .join('\n');

    const requestHash = crypto
      .createHash('sha256')
      .update(`${convoId}\n${peer || ''}\n${wantReplies ? 'wantReplies:1' : 'wantReplies:0'}\n${instruction}\n${transcript}\n${attachmentsSig}`)
      .digest('hex');

    // Reuse the same key schema as aiSummary's cache table (PK=sub, SK=conversationId),
    // but avoid colliding with the summarizer's entry by using a helper-specific sort key.
    const cacheKey = `${convoId}#helper#${requestHash.slice(0, 24)}`;

    const threadKey = `${convoId}#helperThread${peer ? `#${peer}` : ''}`;

    if (tableName) {
      try {
        const now = Date.now();
        const cached = await ddb.send(
          new GetItemCommand({
            TableName: tableName,
            Key: { sub: { S: sub }, conversationId: { S: cacheKey } },
          })
        );
        if (cached.Item) {
          const cachedJson = cached.Item.resultJson?.S || '';
          const lastRequestedAt = Number(cached.Item.lastRequestedAt?.N || '0');
          if (cachedJson && throttleSeconds > 0 && now - lastRequestedAt < throttleSeconds * 1000) {
            return { statusCode: 200, body: cachedJson };
          }
        }
      } catch (err) {
        console.error('AI helper cache get failed (continuing without cache)', err);
      }
    }

    // Load stored helper thread (if enabled) unless client is providing it (client wins).
    let thread = clientThread;
    if (resetThread) thread = [];
    if (!thread.length && tableName && !resetThread) {
      try {
        const stored = await ddb.send(
          new GetItemCommand({
            TableName: tableName,
            Key: { sub: { S: sub }, conversationId: { S: threadKey } },
          })
        );
        const storedJson = stored.Item?.threadJson?.S || '';
        if (storedJson) {
          thread = sanitizeThread(JSON.parse(storedJson));
        }
      } catch (err) {
        console.error('AI helper thread load failed (continuing without thread)', err);
      }
    }

    const system =
      'You are a helpful AI assistant for a chat app. Use the conversation context when relevant. ' +
      'If the user question is not related to the conversation, answer it normally. ' +
      'Be safe, helpful, and concise.';

    const chatContext =
      `ConversationId: ${convoId}\n` +
      (peer ? `Peer: ${peer}\n` : '') +
      `\nRecent chat messages (oldest → newest):\n${transcript || '(no messages provided)'}\n`;

    const formatInstruction =
      `User request:\n${instruction}\n\n` +
      `Return STRICT JSON with this shape:\n` +
      `{\n` +
      `  "answer": "short explanation or guidance (1-6 sentences)",\n` +
      `  "suggestions": ["reply option 1", "reply option 2", "reply option 3"]\n` +
      `}\n` +
      `Rules:\n` +
      `- Always include "answer".\n` +
      `- If the user is NOT explicitly asking for reply drafting, set "suggestions" to [].\n` +
      `- If the user IS explicitly asking for reply drafting, "suggestions" MUST be an array of EXACTLY 3 short, sendable messages.\n` +
      `- The user request ${wantReplies ? 'DOES' : 'does NOT'} ask for reply options; follow that.\n`;

    const buildOpenAiMessages = (attachmentsForPrompt) => {
      // Send a proper multi-message conversation to the model:
      // - chat transcript as stable context for every request
      // - helper thread as actual user/assistant turns
      // - final user instruction with strict JSON output rules
      return [
        { role: 'system', content: system },
        { role: 'user', content: chatContext },
        ...(attachmentsForPrompt.length
          ? [
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text:
                      'Attachment thumbnails (most recent first). These are low-res previews; use them only as context.',
                  },
                  ...attachmentsForPrompt.flatMap((a, idx) => [
                    {
                      type: 'text',
                      text: `${idx + 1}. ${a.kind === 'video' ? 'Video thumbnail' : 'Image'}${
                        a.fileName ? ` "${a.fileName}"` : ''
                      }${a.user ? ` from ${a.user}` : ''}`,
                    },
                    { type: 'image_url', image_url: { url: a.thumbUrl } },
                  ]),
                ],
              },
            ]
          : []),
        ...thread.map((t) => ({ role: t.role, content: t.text })),
        { role: 'user', content: formatInstruction },
      ];
    };

    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

    // Don't let the OpenAI call run forever (or until Lambda timeout).
    // Keep this comfortably below your configured Lambda timeout.
    const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 12000);

    const doOpenAiFetch = async (payloadStr) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
      try {
        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
          body: payloadStr,
        });
        return resp;
      } finally {
        clearTimeout(timeoutId);
      }
    };

    // If we hit a very short-lived TPM 429, a single retry (after provider reset) improves UX a lot.
    // Keep this conservative to avoid tying up Lambda concurrency.
    const maxRetries = Number(process.env.AI_HELPER_OPENAI_RETRIES || 1);
    const retryMaxMs = Number(process.env.AI_HELPER_RETRY_MAX_MS || 1500);

    let openAiMessages = buildOpenAiMessages(attachments);
    let payload = JSON.stringify({
      model,
      temperature: 0.5,
      response_format: { type: 'json_object' },
      messages: openAiMessages,
    });

    let resp = await doOpenAiFetch(payload);
    if (resp.status === 429 && maxRetries > 0) {
      // Parse retry delay from headers when present.
      // OpenAI often returns headers like:
      // - retry-after
      // - x-ratelimit-reset-tokens (seconds until reset, sometimes as a float string)
      const retryAfterHeader = resp.headers.get('retry-after');
      const resetTokensHeader = resp.headers.get('x-ratelimit-reset-tokens');
      let retryMs = 0;
      if (retryAfterHeader && Number.isFinite(Number(retryAfterHeader))) {
        retryMs = Math.floor(Number(retryAfterHeader) * 1000);
      } else if (resetTokensHeader && Number.isFinite(Number(resetTokensHeader))) {
        retryMs = Math.floor(Number(resetTokensHeader) * 1000);
      }
      retryMs = Math.min(Math.max(retryMs, 250), retryMaxMs);

      // Only wait if we have budget (avoid bumping into our own OPENAI_TIMEOUT_MS).
      if (retryMs > 0 && retryMs < OPENAI_TIMEOUT_MS - 250) {
        try {
          await sleep(retryMs);
          resp = await doOpenAiFetch(payload);
        } catch {
          // fall through to error handling
        }
      }
    }

    if (!resp.ok) {
      let text = await resp.text().catch(() => '');
      console.error('OpenAI error', resp.status, text);

      // If OpenAI can't fetch our signed thumbnail URLs (common with private buckets / expired URLs),
      // retry once WITHOUT attachments so the AI Helper still works in text-only mode.
      if (resp.status === 400 && attachments.length) {
        const looksLikeImageFetchFailure =
          /Error while downloading|invalid_image_url|failed to (fetch|download)|could not (fetch|download)/i.test(
            String(text || '')
          );
        if (looksLikeImageFetchFailure) {
          try {
            openAiMessages = buildOpenAiMessages([]);
            payload = JSON.stringify({
              model,
              temperature: 0.5,
              response_format: { type: 'json_object' },
              messages: openAiMessages,
            });
            const resp2 = await doOpenAiFetch(payload);
            if (resp2.ok) {
              const data2 = await resp2.json();
              const content2 = data2?.choices?.[0]?.message?.content;
              let answer2 = '';
              let suggestions2 = [];
              try {
                const parsed2 = JSON.parse(String(content2 || '{}'));
                answer2 = safeString(parsed2?.answer || '');
                suggestions2 = normalizeSuggestions(parsed2?.suggestions);
              } catch {
                answer2 = safeString(content2 || '');
                suggestions2 = [];
              }
              suggestions2 = wantReplies ? ensureExactlyThreeSuggestions(suggestions2, instruction) : [];

              const result2 = { answer: answer2, suggestions: suggestions2 };
              const nextThread2 = sanitizeThread([
                ...thread,
                { role: 'user', text: clampText(instruction, 1200) },
                { role: 'assistant', text: clampText(answer2 || '', 1600) },
              ]);

              const responseBody2 = JSON.stringify({
                ...result2,
                thread: nextThread2,
                // Useful for debugging/UX: tells the client we had to fall back.
                attachmentsUsed: false,
              });

              if (tableName) {
                try {
                  const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

                  await ddb.send(
                    new PutItemCommand({
                      TableName: tableName,
                      Item: {
                        sub: { S: sub },
                        conversationId: { S: threadKey },
                        threadJson: { S: JSON.stringify(nextThread2) },
                        updatedAt: { S: new Date().toISOString() },
                        expiresAt: { N: String(expiresAt) },
                      },
                    })
                  );

                  await ddb.send(
                    new PutItemCommand({
                      TableName: tableName,
                      Item: {
                        sub: { S: sub },
                        conversationId: { S: cacheKey },
                        requestHash: { S: requestHash },
                        resultJson: { S: responseBody2 },
                        updatedAt: { S: new Date().toISOString() },
                        lastRequestedAt: { N: String(Date.now()) },
                      },
                    })
                  );
                } catch (err) {
                  console.error('AI helper cache put failed (continuing)', err);
                }
              }

              return { statusCode: 200, body: responseBody2 };
            } else {
              const text2 = await resp2.text().catch(() => '');
              console.error('OpenAI error (fallback without attachments)', resp2.status, text2);
              // keep original failure details below
            }
          } catch (err) {
            console.error('AI helper fallback without attachments failed', err);
          }
        }
      }

      // Surface common upstream failures more accurately (useful for client UX and debugging).
      // NOTE: keep details behind a debug flag to avoid leaking provider internals in production.
      const debug = String(process.env.AI_HELPER_DEBUG_ERRORS || '').toLowerCase() === 'true';
      const baseBody = {
        message:
          resp.status === 429
            ? 'AI rate limit reached (try again soon)'
            : resp.status === 400
              ? 'AI request rejected (bad request)'
              : 'AI provider error',
        providerStatus: resp.status,
      };
      const body = debug ? { ...baseBody, providerBody: text.slice(0, 4000) } : baseBody;

      // Pass through rate-limit to allow client to handle retries/backoff.
      if (resp.status === 429) {
        const retryAfter = resp.headers.get('retry-after') || '';
        const headers = retryAfter ? { 'Retry-After': retryAfter } : undefined;
        return { statusCode: 429, headers, body: JSON.stringify(body) };
      }

      // Most other upstream failures present to clients as 502.
      return { statusCode: 502, body: JSON.stringify(body) };
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content;

    let answer = '';
    let suggestions = [];
    try {
      const parsed = JSON.parse(String(content || '{}'));
      answer = safeString(parsed?.answer || '');
      suggestions = normalizeSuggestions(parsed?.suggestions);
    } catch {
      // Best-effort fallback
      answer = safeString(content || '');
      suggestions = [];
    }

    suggestions = wantReplies ? ensureExactlyThreeSuggestions(suggestions, instruction) : [];

    const result = { answer, suggestions };

    // Return thread for clients that want to keep local state in sync.
    const nextThread = sanitizeThread([
      ...thread,
      { role: 'user', text: clampText(instruction, 1200) },
      { role: 'assistant', text: clampText(answer || '', 1600) },
    ]);

    const responseBody = JSON.stringify({ ...result, thread: nextThread });

    if (tableName) {
      try {
        // Store helper thread state (best-effort). Keep it separate from the per-request cache key.
        const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60; // 7 days (TTL if enabled)

        await ddb.send(
          new PutItemCommand({
            TableName: tableName,
            Item: {
              sub: { S: sub },
              conversationId: { S: threadKey },
              threadJson: { S: JSON.stringify(nextThread) },
              updatedAt: { S: new Date().toISOString() },
              expiresAt: { N: String(expiresAt) },
            },
          })
        );

        // Cache the full response body (includes `thread`) so throttled responses keep client state in sync.
        await ddb.send(
          new PutItemCommand({
            TableName: tableName,
            Item: {
              sub: { S: sub },
              conversationId: { S: cacheKey },
              requestHash: { S: requestHash },
              resultJson: { S: responseBody },
              updatedAt: { S: new Date().toISOString() },
              lastRequestedAt: { N: String(Date.now()) },
            },
          })
        );
      } catch (err) {
        console.error('AI helper cache put failed (continuing)', err);
      }
    }

    return { statusCode: 200, body: responseBody };
  } catch (err) {
    const name = err?.name || 'Error';
    const message = err?.message || '';
    console.error('aiHelper error', name, message, err);
    if (name === 'AbortError') {
      return { statusCode: 504, body: JSON.stringify({ message: 'AI provider timeout' }) };
    }
    return { statusCode: 500, body: JSON.stringify({ message: 'Internal error' }) };
  }
};


