// HTTP API (payload v2) Lambda: POST /blocks/delete
// Removes a user from the authenticated user's blocklist.
//
// Env:
// - BLOCKS_TABLE (required): DynamoDB table with PK blockerSub (String), SK blockedSub (String)
//
// Body:
// - { blockedSub: string }
//
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const safeString = (v) => {
  if (typeof v !== 'string') return '';
  return String(v).trim();
};

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method;
  if (method !== 'POST') {
    return { statusCode: 405, headers: { Allow: 'POST' }, body: JSON.stringify({ message: 'Method not allowed' }) };
  }

  try {
    const sub = event.requestContext?.authorizer?.jwt?.claims?.sub;
    if (!sub) return { statusCode: 401, body: JSON.stringify({ message: 'Unauthorized' }) };

    const table = process.env.BLOCKS_TABLE;
    if (!table) return { statusCode: 500, body: JSON.stringify({ message: 'BLOCKS_TABLE not configured' }) };

    let body = {};
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return { statusCode: 400, body: JSON.stringify({ message: 'Invalid JSON body' }) };
    }

    const blockedSub = safeString(body.blockedSub);
    if (!blockedSub) return { statusCode: 400, body: JSON.stringify({ message: 'blockedSub is required' }) };

    await ddb.send(
      new DeleteCommand({
        TableName: table,
        Key: { blockerSub: String(sub), blockedSub: String(blockedSub) },
      })
    );

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    console.error('deleteBlock error', err);
    return { statusCode: 500, body: JSON.stringify({ message: 'Internal error' }) };
  }
};


