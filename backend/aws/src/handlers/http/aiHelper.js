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

function normalizeSuggestions(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const x of raw) {
    if (!x) continue;
    if (typeof x === 'string') out.push(x.trim());
    else if (typeof x === 'object' && x.text) out.push(String(x.text).trim());
    if (out.length >= 6) break;
  }
  return out.filter(Boolean);
}

function wantsReplyOptions(instruction) {
  // Intent toggle: only generate sendable reply options when the user explicitly includes "response".
  // (This keeps general questions like "speed of a jet" from producing nonsensical reply bubbles.)
  return /\bresponse\b/i.test(String(instruction || ''));
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
    const wantReplies = wantsReplyOptions(instruction);

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

    const requestHash = crypto
      .createHash('sha256')
      .update(`${convoId}\n${peer || ''}\n${instruction}\n${transcript}`)
      .digest('hex');

    // Reuse the same key schema as aiSummary's cache table (PK=sub, SK=conversationId),
    // but avoid colliding with the summarizer's entry by using a helper-specific sort key.
    const cacheKey = `${convoId}#helper#${requestHash.slice(0, 24)}`;

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

    const system =
      'You are a helpful AI assistant for a chat app. Use the conversation context when relevant. ' +
      'If the user question is not related to the conversation, answer it normally. ' +
      'Be safe, helpful, and concise.';

    const userPrompt =
      `User request:\n${instruction}\n\n` +
      `ConversationId: ${convoId}\n` +
      (peer ? `Peer: ${peer}\n` : '') +
      `\nRecent messages (oldest → newest):\n${transcript || '(no messages provided)'}\n\n` +
      `Return STRICT JSON with this shape:\n` +
      `{\n` +
      `  "answer": "short explanation or guidance (1-6 sentences)",\n` +
      `  "suggestions": ["reply option 1", "reply option 2", "reply option 3"]\n` +
      `}\n` +
      `Rules:\n` +
      `- Always include "answer".\n` +
      `- Only include "suggestions" if the user is explicitly asking for reply drafting. Otherwise set "suggestions" to [].\n` +
      `- If the user is asking how to respond, suggestions should be short, sendable messages.\n` +
      `- If the user is asking "what did they mean", suggestions should be 2-4 clarifying replies.\n` +
      `- Keep suggestions to 3-5 items when you include them.\n` +
      `- The user request ${wantReplies ? 'DOES' : 'does NOT'} ask for reply options; follow that.\n`;

    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

    // Don't let the OpenAI call run forever (or until Lambda timeout).
    // Keep this comfortably below your configured Lambda timeout.
    const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 12000);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0.5,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    clearTimeout(timeoutId);

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.error('OpenAI error', resp.status, text);
      return { statusCode: 502, body: JSON.stringify({ message: 'AI provider error' }) };
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

    if (!wantReplies) suggestions = [];

    const result = { answer, suggestions };
    const resultJson = JSON.stringify(result);

    if (tableName) {
      try {
        await ddb.send(
          new PutItemCommand({
            TableName: tableName,
            Item: {
              sub: { S: sub },
              conversationId: { S: cacheKey },
              requestHash: { S: requestHash },
              resultJson: { S: resultJson },
              updatedAt: { S: new Date().toISOString() },
              lastRequestedAt: { N: String(Date.now()) },
            },
          })
        );
      } catch (err) {
        console.error('AI helper cache put failed (continuing)', err);
      }
    }

    return { statusCode: 200, body: resultJson };
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


