// Public, unauthenticated history endpoint intended for portfolio-style "guest preview".
//
// IMPORTANT:
// - This handler ONLY allows reading the global conversation.
// - Wire it to an API Gateway route that has NO authorizer (public).
// - Keep CORS enabled for your app origin(s).
//
// Env:
// - MESSAGES_TABLE: DynamoDB table name (PK conversationId, SK createdAt)
//
// Query:
// - conversationId: must be "global" (optional; defaults to "global")
// - limit: optional (default 50, max 200)

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

exports.handler = async (event) => {
  try {
    const params = event.queryStringParameters || {};
    const limit = Math.min(parseInt(params.limit || '50', 10) || 50, 200);
    const conversationId = params.conversationId || 'global';
    const beforeRaw = params.before;
    const before =
      typeof beforeRaw === 'string' && beforeRaw.trim().length
        ? Number(beforeRaw)
        : typeof beforeRaw === 'number'
          ? Number(beforeRaw)
          : null;
    const useCursorResponse =
      String(params.cursor || '').toLowerCase() === '1' ||
      String(params.cursor || '').toLowerCase() === 'true' ||
      String(params.v || '').toLowerCase() === '2';

    if (conversationId !== 'global') {
      return {
        statusCode: 403,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ message: 'Public history only allowed for conversationId=global' }),
      };
    }

    const queryInput = {
      TableName: process.env.MESSAGES_TABLE,
      KeyConditionExpression: 'conversationId = :c',
      ExpressionAttributeValues: { ':c': conversationId },
      ScanIndexForward: false, // newest first
      Limit: limit,
    };

    // Cursor-style paging: fetch older than a given createdAt (epoch ms).
    if (typeof before === 'number' && Number.isFinite(before) && before > 0) {
      queryInput.KeyConditionExpression = 'conversationId = :c AND createdAt < :b';
      queryInput.ExpressionAttributeValues[':b'] = before;
    }

    const resp = await ddb.send(
      new QueryCommand(queryInput)
    );

    const nowSec = Math.floor(Date.now() / 1000);

    const items = (resp.Items || [])
      .filter((it) => !(typeof it.expiresAt === 'number' && it.expiresAt <= nowSec))
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

    const hasMore = !!resp.LastEvaluatedKey;
    const nextCursor =
      resp.LastEvaluatedKey && typeof resp.LastEvaluatedKey.createdAt === 'number'
        ? Number(resp.LastEvaluatedKey.createdAt)
        : items.length
          ? Number(items[items.length - 1].createdAt)
          : null;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(
        useCursorResponse
          ? { items, hasMore, nextCursor: typeof nextCursor === 'number' && Number.isFinite(nextCursor) ? nextCursor : null }
          : items
      ),
    };
  } catch (err) {
    console.error('getPublicMessages error', err);
    return { statusCode: 500, body: 'Internal error' };
  }
};


