const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method;
  if (method !== 'GET') {
    return { statusCode: 405, headers: { Allow: 'GET' }, body: 'Method not allowed' };
  }

  const claims = event.requestContext?.authorizer?.jwt?.claims || {};
  const sub = String(claims.sub || '').trim();
  // IMPORTANT: must match what wsMessage writes as the PK in UnreadDmConversations
  if (!sub) return { statusCode: 401, body: 'Unauthorized' };

  const table = process.env.UNREADS_TABLE;
  if (!table) return { statusCode: 500, body: 'UNREADS_TABLE not configured' };

  try {
    const resp = await ddb.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: 'userSub = :u',
        ExpressionAttributeValues: { ':u': sub },
        ScanIndexForward: false,
        Limit: 50,
      })
    );

    const unread = (resp.Items || []).map((item) => ({
      conversationId: String(item.conversationId || ''),
      // Optional: kind can be "message" (default) or "added" for group DMs.
      kind: item.kind ? String(item.kind) : undefined,
      senderSub: item.senderSub ? String(item.senderSub) : undefined,
      senderDisplayName: item.senderDisplayName ? String(item.senderDisplayName) : undefined,
      messageCount: Number(item.messageCount ?? 0),
      lastMessageCreatedAt: Number(item.lastMessageCreatedAt ?? 0),
    }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ unread }),
    };
  } catch (err) {
    console.error('getUnreadDms error', err);
    return { statusCode: 500, body: 'Internal error' };
  }
};