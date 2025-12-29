// Public, unauthenticated "profile-lite" endpoint for guest rendering (avatars only).
//
// IMPORTANT:
// - This intentionally returns ONLY non-sensitive fields required for guest UI:
//   displayName + avatar colors/image path. It does NOT return encryption keys or email.
//
// Env:
// - USERS_TABLE (required)
//
// Query:
// - sub (required)

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

exports.handler = async (event) => {
  try {
    const usersTable = process.env.USERS_TABLE;
    if (!usersTable) {
      return { statusCode: 500, body: JSON.stringify({ message: 'Server misconfigured: USERS_TABLE is not set' }) };
    }

    const qs = event.queryStringParameters || {};
    const sub = typeof qs.sub === 'string' ? String(qs.sub).trim() : '';
    if (!sub) return { statusCode: 400, body: JSON.stringify({ message: 'sub is required' }) };

    const resp = await ddb.send(
      new GetCommand({
        TableName: usersTable,
        Key: { userSub: sub },
      })
    );
    const it = resp.Item;
    if (!it) return { statusCode: 404, body: JSON.stringify({ message: 'User does not exist' }) };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      },
      body: JSON.stringify({
        sub: String(it.userSub),
        displayName: String(it.displayName || it.usernameLower || 'anon'),
        avatarBgColor: it.avatarBgColor ? String(it.avatarBgColor) : undefined,
        avatarTextColor: it.avatarTextColor ? String(it.avatarTextColor) : undefined,
        avatarImagePath: it.avatarImagePath ? String(it.avatarImagePath) : undefined,
      }),
    };
  } catch (err) {
    console.error('getPublicUser error', err);
    return { statusCode: 500, body: JSON.stringify({ message: 'Internal error' }) };
  }
};


