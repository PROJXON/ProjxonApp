// HTTP API (payload v2) Lambda: POST /blocks
// Adds a user to the authenticated user's blocklist.
//
// Env:
// - BLOCKS_TABLE (required): DynamoDB table with PK blockerSub (String), SK blockedSub (String)
// - USERS_TABLE (required): Users table keyed by userSub, with GSI byUsernameLower (PK usernameLower)
//
// Body:
// - { username: string }  (case-insensitive; matches by usernameLower)
//   OR { blockedSub: string }
//
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, PutCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const safeString = (v) => {
  if (typeof v !== 'string') return '';
  return String(v).trim();
};

const lookupUserByUsernameLower = async (usersTable, usernameLower) => {
  const u = safeString(usernameLower).toLowerCase();
  if (!u) return null;
  const resp = await ddb.send(
    new QueryCommand({
      TableName: usersTable,
      IndexName: 'byUsernameLower',
      KeyConditionExpression: 'usernameLower = :u',
      ExpressionAttributeValues: { ':u': u },
      Limit: 1,
    })
  );
  const it = resp.Items?.[0];
  if (!it) return null;
  return {
    userSub: safeString(it.userSub),
    displayName: safeString(it.displayName || it.usernameLower || it.userSub),
    usernameLower: safeString(it.usernameLower || u).toLowerCase(),
  };
};

const lookupUserBySub = async (usersTable, userSub) => {
  const s = safeString(userSub);
  if (!s) return null;
  try {
    const resp = await ddb.send(
      new GetCommand({
        TableName: usersTable,
        Key: { userSub: s },
        ProjectionExpression: 'displayName, usernameLower, userSub',
      })
    );
    const it = resp?.Item;
    if (!it) return null;
    return {
      userSub: safeString(it.userSub || s),
      displayName: safeString(it.displayName || it.usernameLower || it.userSub || s),
      usernameLower: safeString(it.usernameLower || '').toLowerCase(),
    };
  } catch {
    return null;
  }
};

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method;
  if (method !== 'POST') {
    return { statusCode: 405, headers: { Allow: 'POST' }, body: JSON.stringify({ message: 'Method not allowed' }) };
  }

  try {
    const sub = event.requestContext?.authorizer?.jwt?.claims?.sub;
    if (!sub) return { statusCode: 401, body: JSON.stringify({ message: 'Unauthorized' }) };

    const blocksTable = process.env.BLOCKS_TABLE;
    if (!blocksTable) return { statusCode: 500, body: JSON.stringify({ message: 'BLOCKS_TABLE not configured' }) };

    const usersTable = process.env.USERS_TABLE;
    if (!usersTable) return { statusCode: 500, body: JSON.stringify({ message: 'USERS_TABLE not configured' }) };

    let body = {};
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return { statusCode: 400, body: JSON.stringify({ message: 'Invalid JSON body' }) };
    }

    const blockedSubRaw = safeString(body.blockedSub);
    const username = safeString(body.username);
    const usernameLower = username ? username.toLowerCase() : '';

    let blockedSub = blockedSubRaw;
    let blockedDisplayName = '';
    let blockedUsernameLower = usernameLower;

    if (!blockedSub) {
      const u = await lookupUserByUsernameLower(usersTable, usernameLower);
      if (!u) return { statusCode: 404, body: JSON.stringify({ message: 'User not found' }) };
      blockedSub = u.userSub;
      blockedDisplayName = u.displayName;
      blockedUsernameLower = u.usernameLower;
    } else {
      // If caller passed blockedSub directly, hydrate name for nicer UI.
      const u = await lookupUserBySub(usersTable, blockedSub);
      if (u) {
        blockedDisplayName = u.displayName;
        blockedUsernameLower = u.usernameLower || blockedUsernameLower;
      }
    }

    if (!blockedSub) return { statusCode: 400, body: JSON.stringify({ message: 'blockedSub or username is required' }) };
    if (String(blockedSub) === String(sub)) {
      return { statusCode: 400, body: JSON.stringify({ message: 'Cannot block yourself' }) };
    }

    const nowMs = Date.now();
    await ddb.send(
      new PutCommand({
        TableName: blocksTable,
        Item: {
          blockerSub: String(sub),
          blockedSub: String(blockedSub),
          blockedAt: nowMs,
          ...(blockedDisplayName ? { blockedDisplayName } : {}),
          ...(blockedUsernameLower ? { blockedUsernameLower } : {}),
        },
      })
    );

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    console.error('addBlock error', err);
    return { statusCode: 500, body: JSON.stringify({ message: 'Internal error' }) };
  }
};


