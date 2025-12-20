// HTTP API (payload v2) Lambda: GET /reads?conversationId=...
// Returns read receipts for a conversation so clients can render "Seen" after reconnects.
//
// Env:
// - READS_TABLE (required): DynamoDB table with PK conversationId (String), SK key (String)
//   Recommended SK format: `${user}#${messageCreatedAt}`

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method;
  if (method !== 'GET') {
    return { statusCode: 405, headers: { Allow: 'GET' }, body: JSON.stringify({ message: 'Method not allowed' }) };
  }

  try {
    const sub = event.requestContext?.authorizer?.jwt?.claims?.sub;
    if (!sub) return { statusCode: 401, body: JSON.stringify({ message: 'Unauthorized' }) };

    const table = process.env.READS_TABLE;
    if (!table) return { statusCode: 500, body: JSON.stringify({ message: 'READS_TABLE not configured' }) };

    const params = event.queryStringParameters || {};
    const conversationId = String(params.conversationId || '');
    if (!conversationId) return { statusCode: 400, body: JSON.stringify({ message: 'Missing conversationId' }) };

    const resp = await ddb.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: 'conversationId = :c',
        ExpressionAttributeValues: { ':c': conversationId },
        ScanIndexForward: false,
        Limit: 200,
      })
    );

    const reads = (resp.Items || []).map((it) => ({
      conversationId: it.conversationId,
      user: String(it.user || 'anon'),
      messageCreatedAt: Number(it.messageCreatedAt || it.readUpTo || 0),
      readAt: typeof it.readAt === 'number' ? it.readAt : undefined,
      updatedAt: typeof it.updatedAt === 'number' ? it.updatedAt : undefined,
    }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ reads }),
    };
  } catch (err) {
    console.error('getReads error', err);
    return { statusCode: 500, body: JSON.stringify({ message: 'Internal error' }) };
  }
};


