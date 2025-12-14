// HTTP API (payload v2) Lambda: POST /ai/summary
// Env:
// - OPENAI_API_KEY
// - OPENAI_MODEL (optional, default: gpt-4o-mini)
// - AI_SUMMARY_TABLE (optional but recommended for caching/throttling)
// - SUMMARY_THROTTLE_SECONDS (optional, default: 30)
//
// NOTE: This is a demo-quality summarizer. It receives plaintext message history from the client.

const { DynamoDBClient, GetItemCommand, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const crypto = require('crypto');

const ddb = new DynamoDBClient({});

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method;
  if (method !== 'POST') {
    return { statusCode: 405, headers: { Allow: 'POST' }, body: JSON.stringify({ message: 'Method not allowed' }) };
  }

  try {
    if (!process.env.OPENAI_API_KEY) {
      return { statusCode: 500, body: JSON.stringify({ message: 'OPENAI_API_KEY not configured' }) };
    }

    const sub = event.requestContext?.authorizer?.jwt?.claims?.sub;
    if (!sub) {
      return { statusCode: 401, body: JSON.stringify({ message: 'Unauthorized' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const convoId = String(body.conversationId || '');
    const peer = body.peer ? String(body.peer) : null;
    const messages = Array.isArray(body.messages) ? body.messages : [];

    const tableName = process.env.AI_SUMMARY_TABLE;
    const throttleSeconds = Number(process.env.SUMMARY_THROTTLE_SECONDS || 30);

    const transcript = messages
      .slice(-80)
      .map((m) => {
        const u = String(m.user || 'anon');
        const t = String(m.text || '').trim();
        return t ? `${u}: ${t}` : null;
      })
      .filter(Boolean)
      .join('\n');

    const transcriptHash = crypto.createHash('sha256').update(transcript).digest('hex');

    // Cache key: (user sub, conversationId)
    // NOTE: Cache should never be allowed to take down the summary feature.
    if (tableName && convoId) {
      try {
        const now = Date.now();
        const cached = await ddb.send(
          new GetItemCommand({
            TableName: tableName,
            Key: { sub: { S: sub }, conversationId: { S: convoId } },
          })
        );
        if (cached.Item) {
          const cachedHash = cached.Item.transcriptHash?.S || '';
          const cachedSummary = cached.Item.summary?.S || '';
          const lastRequestedAt = Number(cached.Item.lastRequestedAt?.N || '0');

          // If same input, return cached summary immediately
          if (cachedSummary && cachedHash === transcriptHash) {
            return { statusCode: 200, body: JSON.stringify({ summary: cachedSummary, cached: true }) };
          }

          // Throttle: if user spams summarize, return last cached summary if present
          if (cachedSummary && throttleSeconds > 0 && now - lastRequestedAt < throttleSeconds * 1000) {
            return {
              statusCode: 200,
              body: JSON.stringify({
                summary: cachedSummary,
                cached: true,
                throttled: true,
              }),
            };
          }
        }
      } catch (err) {
        console.error('AI cache get failed (continuing without cache)', err);
      }
    }

    const system = 'You are a helpful assistant that summarizes chat conversations. Be concise and concrete.';
    const userPrompt =
      `Summarize the following chat conversation.\n` +
      `ConversationId: ${convoId}\n` +
      (peer ? `Peer: ${peer}\n` : '') +
      `\nMessages:\n${transcript}\n\n` +
      `Return:\n- A 3-6 sentence summary\n- 3-7 bullet points of key takeaways\n`;

    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.error('OpenAI error', resp.status, text);
      return { statusCode: 502, body: JSON.stringify({ message: 'AI provider error' }) };
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content;

    const summary = String(content || '');

    // Store/update cache (best-effort)
    if (tableName && convoId) {
      try {
        await ddb.send(
          new PutItemCommand({
            TableName: tableName,
            Item: {
              sub: { S: sub },
              conversationId: { S: convoId },
              transcriptHash: { S: transcriptHash },
              summary: { S: summary },
              updatedAt: { S: new Date().toISOString() },
              lastRequestedAt: { N: String(Date.now()) },
            },
          })
        );
      } catch (err) {
        console.error('AI cache put failed (continuing)', err);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ summary }),
    };
  } catch (err) {
    console.error('aiSummary error', err);
    return { statusCode: 500, body: JSON.stringify({ message: 'Internal error' }) };
  }
};


