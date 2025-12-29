// Public, unauthenticated "profile-lite" batch endpoint for guest rendering (avatars only).
//
// IMPORTANT:
// - Returns ONLY non-sensitive fields: displayName + avatar fields
// - Does NOT return encryption keys, email, etc.
//
// Env:
// - USERS_TABLE (required)
//
// Body (JSON):
// - { subs: string[] } (max 100)

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, BatchGetCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

exports.handler = async (event) => {
  try {
    const usersTable = process.env.USERS_TABLE;
    if (!usersTable) {
      return { statusCode: 500, body: JSON.stringify({ message: 'Server misconfigured: USERS_TABLE is not set' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const subsRaw = Array.isArray(body?.subs) ? body.subs : [];
    const subs = subsRaw.map((s) => String(s || '').trim()).filter(Boolean);
    const unique = Array.from(new Set(subs)).slice(0, 100);
    if (!unique.length) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ users: [] }),
      };
    }

    const resp = await ddb.send(
      new BatchGetCommand({
        RequestItems: {
          [usersTable]: {
            Keys: unique.map((sub) => ({ userSub: sub })),
            ProjectionExpression: 'userSub, displayName, usernameLower, avatarBgColor, avatarTextColor, avatarImagePath',
          },
        },
      })
    );

    const items = (resp.Responses?.[usersTable] || []).map((it) => ({
      sub: String(it.userSub),
      displayName: String(it.displayName || it.usernameLower || 'anon'),
      avatarBgColor: it.avatarBgColor ? String(it.avatarBgColor) : undefined,
      avatarTextColor: it.avatarTextColor ? String(it.avatarTextColor) : undefined,
      avatarImagePath: it.avatarImagePath ? String(it.avatarImagePath) : undefined,
    }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ users: items }),
    };
  } catch (err) {
    console.error('getPublicUsersBatch error', err);
    return { statusCode: 500, body: JSON.stringify({ message: 'Internal error' }) };
  }
};


