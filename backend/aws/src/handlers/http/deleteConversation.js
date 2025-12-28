// HTTP API (payload v2) Lambda: POST /conversations/delete
// Removes a conversation from the authenticated user's conversation list (Option A: hide from list).
//
// Env:
// - CONVERSATIONS_TABLE (required)
// - UNREADS_TABLE (optional): if set, clears any unread entry for this conversation
//
// Auth: JWT (Cognito). Reads sub from requestContext.authorizer.jwt.claims.sub
//
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function safeString(v) {
  if (typeof v !== 'string') return '';
  return String(v).trim();
}

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method;
  if (method !== 'POST') {
    return { statusCode: 405, headers: { Allow: 'POST' }, body: JSON.stringify({ message: 'Method not allowed' }) };
  }

  try {
    const sub = event.requestContext?.authorizer?.jwt?.claims?.sub;
    if (!sub) return { statusCode: 401, body: JSON.stringify({ message: 'Unauthorized' }) };

    const table = process.env.CONVERSATIONS_TABLE;
    if (!table) return { statusCode: 500, body: JSON.stringify({ message: 'CONVERSATIONS_TABLE not configured' }) };

    let body = {};
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return { statusCode: 400, body: JSON.stringify({ message: 'Invalid JSON body' }) };
    }

    const conversationId = safeString(body.conversationId);
    if (!conversationId) return { statusCode: 400, body: JSON.stringify({ message: 'conversationId is required' }) };

    await ddb.send(
      new DeleteCommand({
        TableName: table,
        Key: { userSub: String(sub), conversationId },
      })
    );

    // Best-effort: also clear unread badge for this convo so it doesn't reappear as unread.
    const unreadTable = process.env.UNREADS_TABLE;
    if (unreadTable) {
      try {
        await ddb.send(
          new DeleteCommand({
            TableName: unreadTable,
            Key: { userSub: String(sub), conversationId },
          })
        );
      } catch {
        // ignore
      }
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('deleteConversation error', err);
    return { statusCode: 500, body: JSON.stringify({ message: 'Internal error' }) };
  }
};


