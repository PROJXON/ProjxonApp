// HTTP API (payload v2) Lambda: POST /account/delete
// Deletes (or best-effort cleans) the authenticated user's account data.
//
// Important:
// - This endpoint deletes app-side data (DynamoDB rows, push tokens, etc.).
// - Deleting the Cognito user itself is typically done client-side via Amplify Auth deleteUser()
//   after this endpoint succeeds (so the JWT is still valid during cleanup).
//
// Env (optional unless stated):
// - USERS_TABLE (required)
// - BLOCKS_TABLE (optional)
// - PUSH_TOKENS_TABLE (optional)
// - CONVERSATIONS_TABLE (optional)
// - UNREADS_TABLE (optional)
// - READS_TABLE (optional)
// - RECOVERY_TABLE (optional)
// - MESSAGES_TABLE (optional; only used when DELETE_ACCOUNT_SCAN_MESSAGES=true)
// - MEDIA_DELETE_QUEUE_URL (optional; enables media cleanup via SQS)
// - COGNITO_USER_POOL_ID (optional): if set and DELETE_ACCOUNT_DELETE_COGNITO=true, the Lambda will AdminDeleteUser
//
// Optional behavior toggles:
// - DELETE_ACCOUNT_SCAN_MESSAGES: "true" | "1" enables scanning MESSAGES_TABLE and deleting the user's authored messages.
//   This is safe for small/portfolio deployments but can be expensive at scale without a userSub GSI.
// - DELETE_ACCOUNT_MAX_SCAN: max scan items across scans (default 1500)
// - DELETE_ACCOUNT_DELETE_COGNITO: "true" | "1" enables Cognito AdminDeleteUser (requires IAM permission)
//
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  GetCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');
const {
  CognitoIdentityProviderClient,
  AdminDeleteUserCommand,
} = require('@aws-sdk/client-cognito-identity-provider');

// IMPORTANT:
// This handler can be deployed either as part of the repo bundle (with /lib present),
// or copy/pasted as a standalone Lambda. If /lib isn't packaged, we must not crash on import.
let enqueueMediaDeletes = async () => ({ skipped: true });
try {
  // eslint-disable-next-line global-require
  ({ enqueueMediaDeletes } = require('../../lib/mediaDeleteQueue'));
} catch {
  // Best-effort no-op when the helper isn't packaged with the Lambda deployment artifact.
  enqueueMediaDeletes = async () => ({ skipped: true });
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const cognito = new CognitoIdentityProviderClient({});

function safeString(v) {
  if (typeof v !== 'string') return '';
  return String(v).trim();
}

function parseBool(v) {
  const s = safeString(v).toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function clampInt(n, min, max, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(x)));
}

// For global/channel (plaintext), attachments are embedded in the JSON envelope stored in `text`.
function extractChatMediaPathsFromText(rawText) {
  const t = typeof rawText === 'string' ? String(rawText).trim() : '';
  if (!t) return [];
  try {
    const obj = JSON.parse(t);
    if (!obj || typeof obj !== 'object') return [];
    if (obj.type !== 'chat') return [];
    const out = [];
    const rawMedia = obj.media;
    const list = Array.isArray(rawMedia) ? rawMedia : rawMedia && typeof rawMedia === 'object' ? [rawMedia] : [];
    for (const m of list) {
      if (!m || typeof m !== 'object') continue;
      if (typeof m.path === 'string') out.push(String(m.path));
      if (typeof m.thumbPath === 'string') out.push(String(m.thumbPath));
    }
    return out
      .map((p) => (typeof p === 'string' ? p.trim().replace(/^\/+/, '') : ''))
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function queryAndDeleteAll({ tableName, keyName, keyValue, sortKeyName }) {
  if (!tableName) return { deleted: 0 };
  let deleted = 0;
  let lastKey = undefined;
  do {
    const resp = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: `${keyName} = :k`,
        ExpressionAttributeValues: { ':k': keyValue },
        ProjectionExpression: sortKeyName ? `${keyName}, ${sortKeyName}` : `${keyName}`,
        ExclusiveStartKey: lastKey,
        Limit: 200,
      })
    );
    const items = resp.Items || [];
    lastKey = resp.LastEvaluatedKey;
    await Promise.all(
      items.map((it) => {
        const key = sortKeyName ? { [keyName]: it[keyName], [sortKeyName]: it[sortKeyName] } : { [keyName]: it[keyName] };
        return ddb.send(new DeleteCommand({ TableName: tableName, Key: key }));
      })
    );
    deleted += items.length;
  } while (lastKey);
  return { deleted };
}

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method;
  if (method !== 'POST') {
    return { statusCode: 405, headers: { Allow: 'POST' }, body: JSON.stringify({ message: 'Method not allowed' }) };
  }

  try {
    const sub = event.requestContext?.authorizer?.jwt?.claims?.sub;
    if (!sub) return { statusCode: 401, body: JSON.stringify({ message: 'Unauthorized' }) };

    const usersTable = process.env.USERS_TABLE;
    if (!usersTable) return { statusCode: 500, body: JSON.stringify({ message: 'USERS_TABLE not configured' }) };

    const blocksTable = safeString(process.env.BLOCKS_TABLE);
    const pushTokensTable = safeString(process.env.PUSH_TOKENS_TABLE);
    const conversationsTable = safeString(process.env.CONVERSATIONS_TABLE);
    const unreadsTable = safeString(process.env.UNREADS_TABLE);
    const readsTable = safeString(process.env.READS_TABLE);
    const recoveryTable = safeString(process.env.RECOVERY_TABLE);
    const messagesTable = safeString(process.env.MESSAGES_TABLE);
    const groupMembersTable = safeString(process.env.GROUP_MEMBERS_TABLE);

    const scanMessages = parseBool(process.env.DELETE_ACCOUNT_SCAN_MESSAGES || '');
    const maxScan = clampInt(process.env.DELETE_ACCOUNT_MAX_SCAN || 1500, 200, 5000, 1500);
    const deleteCognito = parseBool(process.env.DELETE_ACCOUNT_DELETE_COGNITO || '');
    const userPoolId = safeString(process.env.COGNITO_USER_POOL_ID || '');
    const cognitoUsername =
      safeString(event.requestContext?.authorizer?.jwt?.claims?.['cognito:username'] || '') ||
      safeString(event.requestContext?.authorizer?.jwt?.claims?.username || '');

    const nowMs = Date.now();

    // Fetch user row first for best-effort cleanup (e.g., avatar object path).
    let avatarImagePath = '';
    try {
      const existing = await ddb.send(
        new GetCommand({
          TableName: usersTable,
          Key: { userSub: String(sub) },
          ProjectionExpression: 'avatarImagePath',
        })
      );
      avatarImagePath = safeString(existing?.Item?.avatarImagePath || '');
    } catch {
      // ignore
    }

    // Delete core user row
    await ddb.send(
      new DeleteCommand({
        TableName: usersTable,
        Key: { userSub: String(sub) },
      })
    );

    // Best-effort: delete avatar object (public only).
    if (avatarImagePath && avatarImagePath.startsWith('uploads/public/avatars/')) {
      enqueueMediaDeletes({
        keys: [avatarImagePath],
        reason: 'account_deleted_avatar',
        allowedPrefixes: ['uploads/public/avatars/'],
        context: { userSub: String(sub) },
      }).catch(() => undefined);
    }

    // Delete recovery blob (end-to-end recovery payload)
    if (recoveryTable) {
      try {
        await ddb.send(new DeleteCommand({ TableName: recoveryTable, Key: { sub: String(sub) } }));
      } catch {
        // ignore
      }
    }

    // Delete all Expo push tokens for this user
    const pushTokens = await queryAndDeleteAll({
      tableName: pushTokensTable,
      keyName: 'userSub',
      keyValue: String(sub),
      sortKeyName: 'expoPushToken',
    });

    // Delete conversation index entries and collect conversationIds
    const conversationIds = [];
    if (conversationsTable) {
      let lastKey = undefined;
      do {
        const resp = await ddb.send(
          new QueryCommand({
            TableName: conversationsTable,
            KeyConditionExpression: 'userSub = :u',
            ExpressionAttributeValues: { ':u': String(sub) },
            ProjectionExpression: 'userSub, conversationId',
            ExclusiveStartKey: lastKey,
            Limit: 200,
          })
        );
        const items = resp.Items || [];
        lastKey = resp.LastEvaluatedKey;
        for (const it of items) {
          const cid = safeString(it.conversationId || '');
          if (cid) conversationIds.push(cid);
        }
        await Promise.all(
          items.map((it) =>
            ddb.send(
              new DeleteCommand({
                TableName: conversationsTable,
                Key: { userSub: String(sub), conversationId: String(it.conversationId) },
              })
            )
          )
        );
      } while (lastKey);
    }

    // Best-effort: if this user is the only active admin of any group DM, transfer admin
    // to another active member before removing the user's membership (so the group isn't orphaned).
    //
    // This is especially important for account deletion, since we can't "block leaving" (Option A).
    if (groupMembersTable && conversationIds.length) {
      try {
        const groupIds = Array.from(
          new Set(
            conversationIds
              .map((cid) => safeString(cid))
              .filter((cid) => cid.startsWith('gdm#'))
              .map((cid) => cid.slice('gdm#'.length).trim())
              .filter(Boolean)
          )
        );

        const pickOldestTenured = (rows) => {
          const sorted = rows
            .slice()
            .sort((a, b) => {
              const aj = typeof a.joinedAt === 'number' ? a.joinedAt : Number.MAX_SAFE_INTEGER;
              const bj = typeof b.joinedAt === 'number' ? b.joinedAt : Number.MAX_SAFE_INTEGER;
              if (aj !== bj) return aj - bj;
              return safeString(a.memberSub).localeCompare(safeString(b.memberSub));
            });
          return sorted[0] || null;
        };

        for (const groupId of groupIds) {
          // eslint-disable-next-line no-await-in-loop
          const membersResp = await ddb.send(
            new QueryCommand({
              TableName: groupMembersTable,
              KeyConditionExpression: 'groupId = :g',
              ExpressionAttributeValues: { ':g': groupId },
              ProjectionExpression: 'memberSub, #s, isAdmin, joinedAt',
              ExpressionAttributeNames: { '#s': 'status' },
              Limit: 50,
            })
          );
          const members = Array.isArray(membersResp.Items) ? membersResp.Items : [];
          const myRow = members.find((m) => safeString(m?.memberSub) === String(sub)) || null;
          if (!myRow) continue;

          const activeMembers = members.filter((m) => safeString(m?.status) === 'active');
          const activeAdmins = activeMembers.filter((m) => !!m.isAdmin);
          const othersActive = activeMembers.filter((m) => safeString(m?.memberSub) !== String(sub));
          const othersActiveAdmins = activeAdmins.filter((m) => safeString(m?.memberSub) !== String(sub));

          if (safeString(myRow.status) === 'active' && !!myRow.isAdmin) {
            // If I'm the only active admin and there are other active members, promote someone.
            if (othersActive.length > 0 && othersActiveAdmins.length === 0) {
              const candidate = pickOldestTenured(othersActive);
              if (candidate && safeString(candidate.memberSub)) {
                // eslint-disable-next-line no-await-in-loop
                await ddb.send(
                  new UpdateCommand({
                    TableName: groupMembersTable,
                    Key: { groupId, memberSub: safeString(candidate.memberSub) },
                    UpdateExpression: 'SET isAdmin = :a, updatedAt = :u',
                    ExpressionAttributeValues: { ':a': true, ':u': nowMs },
                    ConditionExpression: 'attribute_exists(memberSub)',
                  })
                );
              }
            }
          }

          // Remove the deleted user from the group roster (treat as left, and ensure not admin).
          // eslint-disable-next-line no-await-in-loop
          await ddb
            .send(
              new UpdateCommand({
                TableName: groupMembersTable,
                Key: { groupId, memberSub: String(sub) },
                UpdateExpression: 'SET #s = :s, leftAt = :t, updatedAt = :u, isAdmin = :ia REMOVE bannedAt',
                ExpressionAttributeNames: { '#s': 'status' },
                ExpressionAttributeValues: { ':s': 'left', ':t': nowMs, ':u': nowMs, ':ia': false },
                ConditionExpression: 'attribute_exists(memberSub)',
              })
            )
            .catch(() => {});
        }
      } catch {
        // ignore best-effort group admin transfer
      }
    }

    // Delete unread entries
    const unreads = await queryAndDeleteAll({
      tableName: unreadsTable,
      keyName: 'userSub',
      keyValue: String(sub),
      sortKeyName: 'conversationId',
    });

    // Delete read receipts for this user within known conversationIds (best-effort)
    let readsDeleted = 0;
    if (readsTable && conversationIds.length) {
      await Promise.all(
        conversationIds.slice(0, 250).map(async (conversationId) => {
          try {
            const resp = await ddb.send(
              new QueryCommand({
                TableName: readsTable,
                KeyConditionExpression: 'conversationId = :c',
                ExpressionAttributeValues: { ':c': conversationId },
                ProjectionExpression: 'conversationId, #k, userSub',
                ExpressionAttributeNames: { '#k': 'key' },
                Limit: 200,
              })
            );
            const items = (resp.Items || []).filter((it) => safeString(it.userSub || '') === String(sub));
            await Promise.all(
              items.map((it) =>
                ddb.send(
                  new DeleteCommand({
                    TableName: readsTable,
                    Key: { conversationId: String(conversationId), key: String(it.key) },
                  })
                )
              )
            );
            readsDeleted += items.length;
          } catch {
            // ignore
          }
        })
      );
    }

    // Delete blocks created by this user (blockerSub = me)
    const outgoingBlocks = await queryAndDeleteAll({
      tableName: blocksTable,
      keyName: 'blockerSub',
      keyValue: String(sub),
      sortKeyName: 'blockedSub',
    });

    // Best-effort: delete blocks where other users blocked me (blockedSub = me).
    // This requires a scan unless you add a GSI for blockedSub.
    let incomingBlocksDeleted = 0;
    if (blocksTable) {
      try {
        let lastKey = undefined;
        let scanned = 0;
        do {
          const resp = await ddb.send(
            new ScanCommand({
              TableName: blocksTable,
              ProjectionExpression: 'blockerSub, blockedSub',
              FilterExpression: 'blockedSub = :me',
              ExpressionAttributeValues: { ':me': String(sub) },
              ExclusiveStartKey: lastKey,
              Limit: 50,
            })
          );
          const items = resp.Items || [];
          lastKey = resp.LastEvaluatedKey;
          scanned += items.length;
          await Promise.all(
            items.map((it) =>
              ddb.send(
                new DeleteCommand({
                  TableName: blocksTable,
                  Key: { blockerSub: String(it.blockerSub), blockedSub: String(it.blockedSub) },
                })
              )
            )
          );
          incomingBlocksDeleted += items.length;
          if (scanned >= maxScan) break;
        } while (lastKey);
      } catch {
        // ignore
      }
    }

    // Optional: scan messages table and remove content from messages authored by this user.
    let messagesDeleted = 0;
    if (scanMessages && messagesTable) {
      try {
        let lastKey = undefined;
        let scanned = 0;
        do {
          const resp = await ddb.send(
            new ScanCommand({
              TableName: messagesTable,
              ProjectionExpression: 'conversationId, createdAt, userSub, #t, mediaPaths',
              ExpressionAttributeNames: { '#t': 'text' },
              ExclusiveStartKey: lastKey,
              Limit: 50,
            })
          );
          const items = resp.Items || [];
          lastKey = resp.LastEvaluatedKey;
          scanned += items.length;

          const mine = items.filter((it) => safeString(it.userSub || '') === String(sub));
          await Promise.all(
            mine.map(async (it) => {
              const conversationId = String(it.conversationId || '');
              const createdAt = Number(it.createdAt ?? 0);
              if (!conversationId || !Number.isFinite(createdAt) || createdAt <= 0) return;

              // Best-effort attachment cleanup before we REMOVE text.
              const isDm = conversationId !== 'global';
              const mediaPaths = isDm
                ? Array.isArray(it.mediaPaths)
                  ? it.mediaPaths.map((p) => safeString(p)).filter(Boolean)
                  : []
                : extractChatMediaPathsFromText(typeof it.text === 'string' ? it.text : '');
              if (mediaPaths.length) {
                enqueueMediaDeletes({
                  keys: mediaPaths,
                  reason: 'account_deleted_message',
                  allowedPrefixes: isDm ? ['uploads/dm/'] : ['uploads/channels/'],
                  context: { conversationId, messageCreatedAt: createdAt, userSub: String(sub) },
                }).catch(() => undefined);
              }

              await ddb.send(
                new UpdateCommand({
                  TableName: messagesTable,
                  Key: { conversationId, createdAt },
                  UpdateExpression: 'SET deletedAt = :da, deletedBySub = :db, updatedAt = :ua REMOVE #t',
                  ExpressionAttributeNames: { '#t': 'text' },
                  ExpressionAttributeValues: { ':da': nowMs, ':db': String(sub), ':ua': nowMs },
                })
              );
              messagesDeleted += 1;
            })
          );

          if (scanned >= maxScan) break;
        } while (lastKey);
      } catch (err) {
        console.warn('deleteAccount: message scan failed (ignored)', err);
      }
    }

    // Optional: delete Cognito user (server-side), so web deletion can be complete too.
    // NOTE: this requires IAM permission cognito-idp:AdminDeleteUser scoped to your user pool.
    let cognitoDeleted = false;
    if (deleteCognito && userPoolId && cognitoUsername) {
      try {
        await cognito.send(
          new AdminDeleteUserCommand({
            UserPoolId: userPoolId,
            Username: cognitoUsername,
          })
        );
        cognitoDeleted = true;
      } catch (err) {
        console.warn('deleteAccount: AdminDeleteUser failed (ignored)', err);
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        ok: true,
        deletedAt: nowMs,
        // Counts are best-effort and may be partial if scanning is capped.
        stats: {
          pushTokensDeleted: pushTokens.deleted,
          conversationIndexDeleted: conversationIds.length,
          unreadsDeleted: unreads.deleted,
          readsDeleted,
          outgoingBlocksDeleted: outgoingBlocks.deleted,
          incomingBlocksDeleted,
          messagesContentDeleted: messagesDeleted,
          cognitoDeleted,
        },
      }),
    };
  } catch (err) {
    console.error('deleteAccount error', err);
    return { statusCode: 500, body: JSON.stringify({ message: 'Internal error' }) };
  }
};

