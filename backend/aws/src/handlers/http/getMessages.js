// MESSAGES_TABLE: Messages
//
// Optional block filtering (recommended):
// - If BLOCKS_TABLE is set, this endpoint will filter out messages authored by users
//   that the caller has blocked (based on JWT sub).
//
// Env:
// - MESSAGES_TABLE (required)
// - BLOCKS_TABLE (optional): PK blockerSub (String), SK blockedSub (String)

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Expects Messages table schema: PK conversationId (String), SK createdAt (Number)
exports.handler = async (event) => {
  try {
    const params = event.queryStringParameters || {};
    const limit = Math.min(parseInt(params.limit || '50', 10) || 50, 200);
    const conversationId = params.conversationId || 'global';

    const claims = event.requestContext?.authorizer?.jwt?.claims || {};
    const callerSub = typeof claims.sub === 'string' ? String(claims.sub).trim() : '';
    if (!callerSub) return { statusCode: 401, body: 'Unauthorized' };

    const resp = await ddb.send(
      new QueryCommand({
        TableName: process.env.MESSAGES_TABLE,
        KeyConditionExpression: 'conversationId = :c',
        ExpressionAttributeValues: { ':c': conversationId },
        ScanIndexForward: false, // newest first
        Limit: limit,
      })
    );

    const nowSec = Math.floor(Date.now() / 1000);

    // Optional: filter out messages from blocked users (server-side hardening).
    let blockedSubs = new Set();
    const blocksTable = process.env.BLOCKS_TABLE;
    if (blocksTable) {
      try {
        const blocksResp = await ddb.send(
          new QueryCommand({
            TableName: blocksTable,
            KeyConditionExpression: 'blockerSub = :b',
            ExpressionAttributeValues: { ':b': callerSub },
            ProjectionExpression: 'blockedSub',
            Limit: 200,
          })
        );
        blockedSubs = new Set(
          (blocksResp.Items || [])
            .map((it) => (it && typeof it.blockedSub === 'string' ? String(it.blockedSub) : ''))
            .filter(Boolean)
        );
      } catch (err) {
        console.warn('getMessages block filter skipped (query failed)', err);
      }
    }

    const items = (resp.Items || [])
      .filter((it) => !(typeof it.expiresAt === 'number' && it.expiresAt <= nowSec))
      .filter((it) => {
        const authorSub = it && typeof it.userSub === 'string' ? String(it.userSub) : '';
        if (!authorSub) return true;
        return !blockedSubs.has(authorSub);
      })
      .map((it) => ({
        conversationId: it.conversationId,
        createdAt: Number(it.createdAt),
        messageId: String(it.messageId ?? it.createdAt),
        text: typeof it.text === 'string' ? String(it.text) : '',
        user: it.user ? String(it.user) : 'anon',
        userLower: it.userLower ? String(it.userLower) : undefined,
        userSub: it.userSub ? String(it.userSub) : undefined,
        avatarBgColor: it.avatarBgColor ? String(it.avatarBgColor) : undefined,
        avatarTextColor: it.avatarTextColor ? String(it.avatarTextColor) : undefined,
        avatarImagePath: it.avatarImagePath ? String(it.avatarImagePath) : undefined,
        editedAt: typeof it.editedAt === 'number' ? it.editedAt : undefined,
        deletedAt: typeof it.deletedAt === 'number' ? it.deletedAt : undefined,
        deletedBySub: it.deletedBySub ? String(it.deletedBySub) : undefined,
        reactions: it.reactions
          ? Object.fromEntries(
              Object.entries(it.reactions).map(([emoji, setVal]) => {
                const subs =
                  setVal && typeof setVal === 'object' && setVal instanceof Set
                    ? Array.from(setVal).map(String)
                    : Array.isArray(setVal)
                    ? setVal.map(String)
                    : [];
                return [emoji, { count: subs.length, userSubs: subs }];
              })
            )
          : undefined,
        reactionUsers:
          it.reactionUsers && typeof it.reactionUsers === 'object'
            ? Object.fromEntries(
                Object.entries(it.reactionUsers).map(([sub, name]) => [String(sub), String(name)])
              )
            : undefined,
        ttlSeconds: typeof it.ttlSeconds === 'number' ? it.ttlSeconds : undefined,
        expiresAt: typeof it.expiresAt === 'number' ? it.expiresAt : undefined,
      }));

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(items),
    };
  } catch (err) {
    console.error('getMessages error', err);
    return { statusCode: 500, body: 'Internal error' };
  }
};