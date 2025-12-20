const {
  DynamoDBClient,
  PutItemCommand,
} = require('@aws-sdk/client-dynamodb');

const ddb = new DynamoDBClient({});

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method;
  const path = event.requestContext?.http?.path;
  console.log('createRecovery call', {
    method,
    path,
    sub: event.requestContext?.authorizer?.jwt?.claims?.sub,
  });

  try {
    if (method !== 'POST') {
      return { statusCode: 405, body: 'Method not allowed' };
    }

    const body = JSON.parse(event.body || '{}');
    const { ciphertext, iv, salt } = body;
    if (!ciphertext || !iv || !salt) {
      return { statusCode: 400, body: JSON.stringify({ message: 'Missing fields' }) };
    }

    const sub = event.requestContext?.authorizer?.jwt?.claims?.sub;
    if (!sub) {
      return { statusCode: 401, body: JSON.stringify({ message: 'Unauthorized' }) };
    }

    console.log('createRecovery payload', { sub, ciphertext, iv, salt });
    await ddb.send(
      new PutItemCommand({
        TableName: process.env.RECOVERY_TABLE,
        Item: {
          sub: { S: sub },
          ciphertext: { S: ciphertext },
          iv: { S: iv },
          salt: { S: salt },
          createdAt: { S: new Date().toISOString() },
        },
      })
    );
    console.log('createRecovery stored item for', sub);
    return { statusCode: 204 };
  } catch (err) {
    console.error('createRecovery error', err);
    return { statusCode: 500, body: JSON.stringify({ message: 'Internal error' }) };
  }
};