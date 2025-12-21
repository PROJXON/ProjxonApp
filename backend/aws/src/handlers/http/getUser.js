const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

exports.handler = async (event) => {
  try {
    const qs = event.queryStringParameters || {};
    const raw = typeof qs.username === 'string' ? String(qs.username).trim() : '';
    const subParam = typeof qs.sub === 'string' ? String(qs.sub).trim() : '';
    const usernameLower = raw.toLowerCase();
    if (!usernameLower && !subParam) {
      return { statusCode: 400, body: JSON.stringify({ message: 'username or sub is required' }) };
    }

    // Preferred path: query Users table (true case-insensitive lookup).
    // Expected Users table schema:
    // - PK: userSub (String)
    // - GSI: byUsernameLower (PK usernameLower String)
    // - Attributes: displayName, currentPublicKey
    const usersTable = process.env.USERS_TABLE;
    if (!usersTable) {
      // We intentionally avoid pulling keys from Cognito.
      // `Users.currentPublicKey` is the source of truth for encryption.
      return {
        statusCode: 500,
        body: JSON.stringify({ message: 'Server misconfigured: USERS_TABLE is not set' }),
      };
    }

    // Fast path: lookup by sub (PK)
    if (subParam) {
      const resp = await ddb.send(
        new GetCommand({
          TableName: usersTable,
          Key: { userSub: subParam },
        })
      );
      const it = resp.Item;
      if (!it) {
        return { statusCode: 404, body: JSON.stringify({ message: 'User does not exist' }) };
      }
      return {
        statusCode: 200,
        body: JSON.stringify({
          sub: String(it.userSub),
          displayName: String(it.displayName || it.usernameLower || 'anon'),
          usernameLower: String(it.usernameLower || '').trim() || undefined,
          public_key: it.currentPublicKey ? String(it.currentPublicKey) : undefined,
        }),
      };
    }

    const resp = await ddb.send(
      new QueryCommand({
        TableName: usersTable,
        IndexName: 'byUsernameLower',
        KeyConditionExpression: 'usernameLower = :u',
        ExpressionAttributeValues: { ':u': usernameLower },
        Limit: 1,
      })
    );
    const it = resp.Items?.[0];
    if (!it) {
      return { statusCode: 404, body: JSON.stringify({ message: 'User does not exist' }) };
    }
    return {
      statusCode: 200,
      body: JSON.stringify({
        sub: String(it.userSub),
        displayName: String(it.displayName || it.usernameLower || 'anon'),
        usernameLower: String(it.usernameLower || usernameLower),
        public_key: it.currentPublicKey ? String(it.currentPublicKey) : undefined,
      }),
    };
  } catch (err) {
    console.error('getUser error', err);
    return { statusCode: 500, body: JSON.stringify({ message: 'Internal error' }) };
  }
};