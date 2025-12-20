const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method;
  if (method !== 'GET') {
    return { statusCode: 405, headers: { Allow: 'GET' }, body: 'Method not allowed' };
  }

  const claims = event.requestContext?.authorizer?.jwt?.claims || {};
  const preferred = claims.preferred_username; // e.g. "John"
  const email = claims.email;
  const sub = claims.sub;

  // IMPORTANT: must match what wsMessage writes as the PK in UnreadDmConversations
  const userKey = String(preferred || email || sub || '').trim().toLowerCase();
  if (!userKey) return { statusCode: 401, body: 'Unauthorized' };

  const table = process.env.UNREADS_TABLE;
  if (!table) return { statusCode: 500, body: 'UNREADS_TABLE not configured' };

  try {
    const resp = await ddb.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: '#u = :u',
        ExpressionAttributeNames: { '#u': 'user' },
        ExpressionAttributeValues: { ':u': userKey },
        ScanIndexForward: false,
        Limit: 50,
      })
    );

    const unread = (resp.Items || []).map((item) => ({
      conversationId: String(item.conversationId || ''),
      sender: String(item.sender || 'someone'),
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