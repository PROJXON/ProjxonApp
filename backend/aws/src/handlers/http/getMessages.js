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
const { DynamoDBDocumentClient, QueryCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Expects Messages table schema: PK conversationId (String), SK createdAt (Number)
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

    const claims = event.requestContext?.authorizer?.jwt?.claims || {};
    const callerSub = typeof claims.sub === 'string' ? String(claims.sub).trim() : '';
    if (!callerSub) return { statusCode: 401, body: 'Unauthorized' };

    // Group DM access control: gdm#<groupId>
    // - active: full access
    // - left/banned: read-only history up to leftAt/bannedAt
    // - not a member: 403
    let membershipCutoffMs = null;
    if (typeof conversationId === 'string' && conversationId.startsWith('gdm#')) {
      const groupId = conversationId.slice('gdm#'.length).trim();
      if (!groupId) return { statusCode: 400, body: 'Invalid group conversationId' };
      const membersTable = process.env.GROUP_MEMBERS_TABLE;
      if (!membersTable) return { statusCode: 500, body: 'GROUP_MEMBERS_TABLE not configured' };
      const mem = await ddb.send(
        new GetCommand({
          TableName: membersTable,
          Key: { groupId, memberSub: callerSub },
          ProjectionExpression: 'memberSub, #s, leftAt, bannedAt',
          ExpressionAttributeNames: { '#s': 'status' },
        })
      );
      const it = mem?.Item;
      if (!it) return { statusCode: 403, body: 'Forbidden' };
      const status = typeof it.status === 'string' ? String(it.status) : '';
      if (status === 'left') {
        membershipCutoffMs = typeof it.leftAt === 'number' ? Number(it.leftAt) : 0;
      } else if (status === 'banned') {
        membershipCutoffMs = typeof it.bannedAt === 'number' ? Number(it.bannedAt) : 0;
      } else if (status === 'active') {
        membershipCutoffMs = null;
      } else {
        return { statusCode: 403, body: 'Forbidden' };
      }
    }

    const queryInput = {
      TableName: process.env.MESSAGES_TABLE,
      KeyConditionExpression: 'conversationId = :c',
      ExpressionAttributeValues: { ':c': conversationId },
      ScanIndexForward: false, // newest first
      Limit: limit,
    };

    // Cursor-style paging: fetch older than a given createdAt (epoch ms).
    let effectiveBefore = typeof before === 'number' && Number.isFinite(before) && before > 0 ? before : null;
    if (typeof membershipCutoffMs === 'number' && Number.isFinite(membershipCutoffMs) && membershipCutoffMs > 0) {
      // Because KeyCondition is createdAt < :b, use cutoff+1 to include messages at exactly cutoff.
      const cutoffBefore = membershipCutoffMs + 1;
      effectiveBefore = effectiveBefore != null ? Math.min(effectiveBefore, cutoffBefore) : cutoffBefore;
    }
    if (typeof effectiveBefore === 'number' && Number.isFinite(effectiveBefore) && effectiveBefore > 0) {
      queryInput.KeyConditionExpression = 'conversationId = :c AND createdAt < :b';
      queryInput.ExpressionAttributeValues[':b'] = effectiveBefore;
    }

    const resp = await ddb.send(
      new QueryCommand(queryInput)
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
        kind: typeof it.kind === 'string' ? String(it.kind) : undefined,
        systemKind: typeof it.systemKind === 'string' ? String(it.systemKind) : undefined,
        actorSub: typeof it.actorSub === 'string' ? String(it.actorSub) : undefined,
        actorUser: typeof it.actorUser === 'string' ? String(it.actorUser) : undefined,
        targetSub: typeof it.targetSub === 'string' ? String(it.targetSub) : undefined,
        targetUser: typeof it.targetUser === 'string' ? String(it.targetUser) : undefined,
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
    console.error('getMessages error', err);
    return { statusCode: 500, body: 'Internal error' };
  }
};