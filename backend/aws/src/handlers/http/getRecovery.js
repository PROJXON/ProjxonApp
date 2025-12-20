const {
  DynamoDBClient,
  GetItemCommand,
} = require('@aws-sdk/client-dynamodb');

const ddb = new DynamoDBClient({});

exports.handler = async (event) => {
  try {
    const method = event.requestContext?.http?.method;
    if (method !== 'GET') {
      return {
        statusCode: 405,
        headers: { Allow: 'GET' },
        body: JSON.stringify({ message: 'Method not allowed' }),
      };
    }

    const sub = event.requestContext?.authorizer?.jwt?.claims?.sub;
    if (!sub) {
      return { statusCode: 401, body: JSON.stringify({ message: 'Unauthorized' }) };
    }

    const response = await ddb.send(
      new GetItemCommand({
        TableName: process.env.RECOVERY_TABLE,
        Key: { sub: { S: sub } },
        ProjectionExpression: 'ciphertext, iv, salt',
      })
    );

    if (!response.Item) {
      return { statusCode: 404, body: JSON.stringify({ message: 'No recovery data' }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ciphertext: response.Item.ciphertext.S,
        iv: response.Item.iv.S,
        salt: response.Item.salt.S,
      }),
    };
  } catch (err) {
    console.error('getRecovery error', err);
    return { statusCode: 500, body: JSON.stringify({ message: 'Internal error' }) };
  }
};