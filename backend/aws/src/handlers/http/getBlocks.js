// HTTP API (payload v2) Lambda: GET /blocks
// Returns the authenticated user's blocklist.
//
// Env:
// - BLOCKS_TABLE (required): DynamoDB table with PK blockerSub (String), SK blockedSub (String)
// - USERS_TABLE (optional): Users table keyed by userSub (used to hydrate displayName for older rows)
//
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method;
  if (method !== 'GET') {
    return { statusCode: 405, headers: { Allow: 'GET' }, body: JSON.stringify({ message: 'Method not allowed' }) };
  }

  try {
    const sub = event.requestContext?.authorizer?.jwt?.claims?.sub;
    if (!sub) return { statusCode: 401, body: JSON.stringify({ message: 'Unauthorized' }) };

    const table = process.env.BLOCKS_TABLE;
    if (!table) return { statusCode: 500, body: JSON.stringify({ message: 'BLOCKS_TABLE not configured' }) };

    const resp = await ddb.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: 'blockerSub = :b',
        ExpressionAttributeValues: { ':b': String(sub) },
        ScanIndexForward: false,
        Limit: 200,
      })
    );

    let blocked = (resp.Items || []).map((it) => ({
      blockedSub: String(it.blockedSub || ''),
      blockedDisplayName: it.blockedDisplayName ? String(it.blockedDisplayName) : undefined,
      blockedUsernameLower: it.blockedUsernameLower ? String(it.blockedUsernameLower) : undefined,
      blockedAt: typeof it.blockedAt === 'number' ? Number(it.blockedAt) : undefined,
    }));

    // Best-effort: hydrate displayName from Users table so UI doesn't fall back to usernameLower,
    // and so we prefer canonical casing (e.g. "aLeX") over what the blocker typed (e.g. "ALEX").
    const usersTable = process.env.USERS_TABLE;
    if (usersTable) {
      await Promise.all(
        blocked
          .filter((b) => b.blockedSub)
          .map(async (b) => {
          try {
            const u = await ddb.send(
              new GetCommand({
                TableName: usersTable,
                Key: { userSub: String(b.blockedSub) },
                ProjectionExpression: 'displayName, usernameLower, userSub',
              })
            );
            const it = u?.Item;
            if (!it) return;
            const canonicalName = String(it.displayName || it.usernameLower || it.userSub || '').trim();
            if (canonicalName) b.blockedDisplayName = canonicalName;
            const ul = String(it.usernameLower || '').trim().toLowerCase();
            if (ul && !b.blockedUsernameLower) b.blockedUsernameLower = ul;

            // Optional backfill: persist canonical displayName so future reads don't depend on Users table.
            // Ignore any failure (missing permissions, etc.).
            if (canonicalName && canonicalName !== (b.blockedDisplayName || '')) {
              // (This branch is unlikely since we just assigned it above, but keep it explicit.)
            }
            if (canonicalName && b.blockedDisplayName !== canonicalName) {
              // no-op; handled above
            }
            try {
              await ddb.send(
                new UpdateCommand({
                  TableName: table,
                  Key: { blockerSub: String(sub), blockedSub: String(b.blockedSub) },
                  UpdateExpression: 'SET blockedDisplayName = :d',
                  ExpressionAttributeValues: { ':d': canonicalName },
                })
              );
            } catch {
              // ignore
            }
          } catch {
            // ignore
          }
        })
      );
      blocked = blocked.slice();
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ blocked }),
    };
  } catch (err) {
    console.error('getBlocks error', err);
    return { statusCode: 500, body: JSON.stringify({ message: 'Internal error' }) };
  }
};


