// HTTP API (payload v2) Lambda: POST /groups/leave
// Marks the caller as left for a group DM. Conversation remains in their chats list (read-only).
//
// Env:
// - GROUP_MEMBERS_TABLE (required): PK groupId, SK memberSub; attrs include status, leftAt, updatedAt
// - CONVERSATIONS_TABLE (optional): if set, updates memberStatus='left' (for client UI hints)
// - UNREADS_TABLE (optional): if set, clears unread entry for this conversation
//
// Auth: JWT (Cognito). Reads sub from requestContext.authorizer.jwt.claims.sub
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const safeString = (v) => (typeof v === 'string' ? String(v).trim() : '');
const json = (statusCode, bodyObj) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(bodyObj),
});

const parseGroupConversationId = (conversationId) => {
  const c = safeString(conversationId);
  if (!c.startsWith('gdm#')) return null;
  const groupId = c.slice('gdm#'.length).trim();
  if (!groupId) return null;
  return { groupId };
};

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method;
  if (method !== 'POST') return json(405, { message: 'Method not allowed' });

  const callerSub = safeString(event.requestContext?.authorizer?.jwt?.claims?.sub);
  if (!callerSub) return json(401, { message: 'Unauthorized' });

  const groupMembersTable = safeString(process.env.GROUP_MEMBERS_TABLE);
  if (!groupMembersTable) return json(500, { message: 'GROUP_MEMBERS_TABLE not configured' });

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { message: 'Invalid JSON body' });
  }

  const convId = safeString(body.conversationId);
  const parsed = parseGroupConversationId(convId);
  if (!parsed) return json(400, { message: 'Invalid conversationId (expected gdm#<groupId>)' });

  const nowMs = Date.now();
  const groupId = parsed.groupId;

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: groupMembersTable,
        Key: { groupId, memberSub: callerSub },
        UpdateExpression: 'SET #s = :s, leftAt = :t, updatedAt = :u',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':s': 'left', ':t': nowMs, ':u': nowMs },
        ConditionExpression: 'attribute_exists(memberSub)',
      })
    );

    const conversationsTable = safeString(process.env.CONVERSATIONS_TABLE);
    if (conversationsTable) {
      await ddb
        .send(
          new UpdateCommand({
            TableName: conversationsTable,
            Key: { userSub: callerSub, conversationId: convId },
            UpdateExpression: 'SET memberStatus = :ms, updatedAt = :u',
            ExpressionAttributeValues: { ':ms': 'left', ':u': nowMs },
          })
        )
        .catch(() => {});
    }

    const unreadTable = safeString(process.env.UNREADS_TABLE);
    if (unreadTable) {
      await ddb
        .send(
          new DeleteCommand({
            TableName: unreadTable,
            Key: { userSub: callerSub, conversationId: convId },
          })
        )
        .catch(() => {});
    }

    return json(200, { ok: true });
  } catch (err) {
    console.error('leaveGroup error', err);
    if (String(err?.name || '').includes('ConditionalCheckFailed')) return json(403, { message: 'Forbidden' });
    return json(500, { message: 'Internal error' });
  }
};

