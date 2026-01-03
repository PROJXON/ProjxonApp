const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  DeleteCommand,
  UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');
const {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} = require('@aws-sdk/client-apigatewaymanagementapi');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Self-contained best-effort SQS enqueue (so this Lambda can be copy/pasted into AWS).
const DEFAULT_DELETE_ALLOWED_PREFIXES = ['uploads/public/avatars/', 'uploads/channels/', 'uploads/dm/'];
const normalizeS3Key = (k) => {
  const s = typeof k === 'string' ? String(k).trim() : '';
  if (!s) return '';
  if (/^[a-z]+:\/\//i.test(s)) return '';
  return s.replace(/^\/+/, '');
};
const uniqStrings = (arr) => {
  const out = [];
  const seen = new Set();
  for (const v of arr || []) {
    const s = typeof v === 'string' ? v.trim() : '';
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
};
const enqueueMediaDeletes = async ({ keys, reason, allowedPrefixes, context }) => {
  const queueUrl = String(process.env.MEDIA_DELETE_QUEUE_URL || '').trim();
  if (!queueUrl) return;
  const pfx = Array.isArray(allowedPrefixes) && allowedPrefixes.length ? allowedPrefixes : DEFAULT_DELETE_ALLOWED_PREFIXES;
  const safeKeys = uniqStrings((keys || []).map(normalizeS3Key))
    .filter(Boolean)
    .filter((k) => pfx.some((p) => k.startsWith(p)));
  if (!safeKeys.length) return;

  const body = JSON.stringify({
    v: 1,
    keys: safeKeys,
    reason: typeof reason === 'string' ? reason : 'unspecified',
    context: context && typeof context === 'object' ? context : undefined,
    createdAt: Date.now(),
  });

  // Prefer AWS SDK v3 if present, fall back to aws-sdk v2.
  try {
    // eslint-disable-next-line import/no-extraneous-dependencies
    const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
    const sqs = new SQSClient({});
    await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: body }));
    return;
  } catch {
    // ignore
  }
  try {
    // eslint-disable-next-line import/no-extraneous-dependencies
    const AWS = require('aws-sdk');
    const sqs = new AWS.SQS();
    await sqs.sendMessage({ QueueUrl: queueUrl, MessageBody: body }).promise();
  } catch {
    // ignore
  }
};

// Connections TTL refresh window (must match your DynamoDB TTL attribute "expiresAt")
const CONN_TTL_SECONDS = 6 * 60 * 60; // 6 hours

const safeString = (v) => {
  if (typeof v !== 'string') return '';
  return String(v).trim();
};

const normalizeMediaPaths = (input) => {
  const arr = Array.isArray(input) ? input : [];
  const out = [];
  const seen = new Set();
  for (const v of arr) {
    const s = typeof v === 'string' ? String(v).trim().replace(/^\/+/, '') : '';
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
};

// For global/channel (plaintext), attachments are embedded in the JSON envelope stored in `text`.
const extractChatMediaPathsFromText = (rawText) => {
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
    return normalizeMediaPaths(out);
  } catch {
    return [];
  }
};

const setDiff = (a, b) => {
  const A = new Set(Array.isArray(a) ? a : []);
  const B = new Set(Array.isArray(b) ? b : []);
  const removed = [];
  for (const x of A) if (!B.has(x)) removed.push(x);
  return removed;
};

const isLikelyExpoToken = (token) => {
  const t = safeString(token);
  if (!t) return false;
  return (
    /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/.test(t) ||
    t.startsWith('ExponentPushToken[') ||
    t.startsWith('ExpoPushToken[')
  );
};

const queryExpoPushTokensByUserSub = async (userSub) => {
  const table = process.env.PUSH_TOKENS_TABLE;
  if (!table) return [];
  const u = safeString(userSub);
  if (!u) return [];
  try {
    const resp = await ddb.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: 'userSub = :u',
        ExpressionAttributeValues: { ':u': u },
        ProjectionExpression: 'expoPushToken',
      })
    );
    return (resp.Items || [])
      .map((it) => (it ? it.expoPushToken : undefined))
      .filter((t) => typeof t === 'string')
      .map((t) => String(t).trim())
      .filter((t) => isLikelyExpoToken(t));
  } catch (err) {
    console.warn('queryExpoPushTokensByUserSub failed', err);
    return [];
  }
};

const sendExpoPush = async (messages) => {
  // Expo push endpoint doesn't require credentials (it validates tokens server-side).
  // Requires Node 18+ for fetch in Lambda.
  if (typeof fetch !== 'function') {
    console.warn('sendExpoPush skipped: runtime missing fetch (use Node.js 18+ / 20.x)');
    return;
  }
  const url = process.env.EXPO_PUSH_URL || 'https://exp.host/--/api/v2/push/send';
  const payload = Array.isArray(messages) ? messages : [];
  if (!payload.length) return;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.warn('expo push non-2xx', resp.status, text);
      return;
    }
    const json = await resp.json().catch(() => null);
    const data = json && (json.data || json);
    if (Array.isArray(data)) {
      for (const r of data) {
        if (r && r.status === 'error') {
          console.warn('expo push error', r?.message || r);
        }
      }
    }
  } catch (err) {
    console.warn('sendExpoPush failed', err);
  }
};

const sendDmPushNotification = async ({ recipientSub, senderDisplayName, senderSub, conversationId, kind }) => {
  try {
    const tokens = await queryExpoPushTokensByUserSub(recipientSub);
    if (!tokens.length) return;

    // Privacy-first default (Signal-like): show sender name, no message preview.
    const title = safeString(senderDisplayName) || 'New message';
    const body = 'New message';
    const convId = safeString(conversationId);
    const sSub = safeString(senderSub);
    const k = safeString(kind) || 'dm';

    const base = {
      title,
      body,
      sound: 'default',
      priority: 'high',
      channelId: 'dm',
      data: {
        kind: k,
        conversationId: convId,
        senderDisplayName: safeString(senderDisplayName),
        senderSub: sSub,
      },
    };

    // Expo accepts up to 100 messages per request.
    const batchSize = 100;
    for (let i = 0; i < tokens.length; i += batchSize) {
      const slice = tokens.slice(i, i + batchSize);
      const msgs = slice.map((to) => ({ ...base, to }));
      // eslint-disable-next-line no-await-in-loop
      await sendExpoPush(msgs);
    }
  } catch (err) {
    console.warn('sendDmPushNotification failed', err);
  }
};

const broadcast = async (mgmt, connectionIds, payloadObj) => {
  const data = Buffer.from(JSON.stringify(payloadObj));
  await Promise.all(
    (connectionIds || []).map(async (connectionId) => {
      try {
        await mgmt.send(new PostToConnectionCommand({ ConnectionId: connectionId, Data: data }));
      } catch (err) {
        const status = err?.statusCode || err?.$metadata?.httpStatusCode || 'unknown';
        if (status === 410) {
          // Stale connection: delete it
          await ddb.send(
            new DeleteCommand({
              TableName: process.env.CONNECTIONS_TABLE,
              Key: { connectionId },
            })
          );
        }
      }
    })
  );
};

const queryConnIdsByConversation = async (conversationId) => {
  const resp = await ddb.send(
    new QueryCommand({
      TableName: process.env.CONNECTIONS_TABLE,
      IndexName: 'byConversation',
      KeyConditionExpression: 'conversationId = :c',
      ExpressionAttributeValues: { ':c': conversationId },
      ProjectionExpression: 'connectionId',
    })
  );
  return (resp.Items || []).map((it) => it.connectionId).filter(Boolean);
};

// Requires Connections GSI:
// - byConversationWithUser (PK conversationId, SK connectionId) projecting userSub
const queryConnRecordsByConversationWithUser = async (conversationId) => {
  const resp = await ddb.send(
    new QueryCommand({
      TableName: process.env.CONNECTIONS_TABLE,
      IndexName: 'byConversationWithUser',
      KeyConditionExpression: 'conversationId = :c',
      ExpressionAttributeValues: { ':c': conversationId },
      ProjectionExpression: 'connectionId, userSub',
    })
  );
  return (resp.Items || [])
    .map((it) => ({ connectionId: it.connectionId, userSub: it.userSub }))
    .filter((r) => r && r.connectionId && r.userSub);
};

const queryConnIdsByUserSub = async (userSub) => {
  const resp = await ddb.send(
    new QueryCommand({
      TableName: process.env.CONNECTIONS_TABLE,
      IndexName: 'byUserSub',
      KeyConditionExpression: 'userSub = :u',
      ExpressionAttributeValues: { ':u': userSub },
      ProjectionExpression: 'connectionId',
    })
  );
  return (resp.Items || []).map((it) => it.connectionId).filter(Boolean);
};

// DM conversationId format: "dm#<minSub>#<maxSub>"
const parseDmRecipientSub = (conversationId, senderSub) => {
  if (!conversationId || conversationId === 'global') return null;
  const raw = String(conversationId).trim();
  if (!raw.startsWith('dm#')) return null;
  const parts = raw.split('#').map((p) => String(p).trim()).filter(Boolean);
  if (parts.length !== 3) return null;
  const a = parts[1];
  const b = parts[2];
  const me = String(senderSub || '').trim();
  if (!me) return null;
  if (a === me) return b;
  if (b === me) return a;
  return null;
};

// Group DM conversationId format: "gdm#<groupId>"
const parseGroupId = (conversationId) => {
  if (!conversationId || conversationId === 'global') return null;
  const raw = String(conversationId).trim();
  if (!raw.startsWith('gdm#')) return null;
  const groupId = raw.slice('gdm#'.length).trim();
  return groupId || null;
};

const getGroupMember = async (groupId, memberSub) => {
  const table = process.env.GROUP_MEMBERS_TABLE;
  const gid = safeString(groupId);
  const sub = safeString(memberSub);
  if (!table || !gid || !sub) return null;
  try {
    const resp = await ddb.send(
      new GetCommand({
        TableName: table,
        Key: { groupId: gid, memberSub: sub },
        ProjectionExpression: 'memberSub, #s, isAdmin, leftAt, bannedAt',
        ExpressionAttributeNames: { '#s': 'status' },
      })
    );
    const it = resp?.Item;
    if (!it) return null;
    return {
      status: safeString(it.status) || '',
      isAdmin: !!it.isAdmin,
      leftAt: typeof it.leftAt === 'number' ? it.leftAt : undefined,
      bannedAt: typeof it.bannedAt === 'number' ? it.bannedAt : undefined,
    };
  } catch {
    return null;
  }
};

const queryActiveGroupMemberSubs = async (groupId) => {
  const table = process.env.GROUP_MEMBERS_TABLE;
  const gid = safeString(groupId);
  if (!table || !gid) return [];
  const resp = await ddb.send(
    new QueryCommand({
      TableName: table,
      KeyConditionExpression: 'groupId = :g',
      ExpressionAttributeValues: { ':g': gid },
      ProjectionExpression: 'memberSub, #s',
      ExpressionAttributeNames: { '#s': 'status' },
      Limit: 50,
    })
  );
  return (resp.Items || [])
    .filter((it) => safeString(it?.status) === 'active')
    .map((it) => safeString(it.memberSub))
    .filter(Boolean);
};

const getConversationTitleForUser = async (userSub, conversationId) => {
  const table = process.env.CONVERSATIONS_TABLE;
  const u = safeString(userSub);
  const c = safeString(conversationId);
  if (!table || !u || !c) return null;
  try {
    const resp = await ddb.send(
      new GetCommand({
        TableName: table,
        Key: { userSub: u, conversationId: c },
        ProjectionExpression: 'peerDisplayName',
      })
    );
    const it = resp?.Item;
    const t = it && typeof it.peerDisplayName === 'string' ? String(it.peerDisplayName).trim() : '';
    return t || null;
  } catch {
    return null;
  }
};

const getUserDisplayNameBySub = async (userSub) => {
  const usersTable = process.env.USERS_TABLE;
  const sub = safeString(userSub);
  if (!usersTable || !sub) return null;
  try {
    const resp = await ddb.send(
      new GetCommand({
        TableName: usersTable,
        Key: { userSub: sub },
        ProjectionExpression: 'displayName, usernameLower, userSub',
      })
    );
    const it = resp?.Item;
    if (!it) return null;
    return String(it.displayName || it.usernameLower || it.userSub || '').trim() || null;
  } catch (err) {
    console.warn('getUserDisplayNameBySub failed', err);
    return null;
  }
};

const upsertConversationIndex = async ({
  ownerSub,
  conversationId,
  peerSub,
  peerDisplayName,
  lastMessageAt,
  lastSenderSub,
  lastSenderDisplayName,
}) => {
  const table = process.env.CONVERSATIONS_TABLE;
  const owner = safeString(ownerSub);
  const convId = safeString(conversationId);
  if (!table || !owner || !convId) return;

  const conversationKind = convId.startsWith('gdm#') ? 'group' : convId.startsWith('dm#') ? 'dm' : undefined;
  try {
    const setParts = ['peerDisplayName = :pd', 'lastMessageAt = :lma'];
    const removeParts = [];
    const values = {
      ':pd': safeString(peerDisplayName) || (convId.startsWith('gdm#') ? 'Group DM' : 'Direct Message'),
      ':lma': Number(lastMessageAt) || 0,
    };

    const ps = safeString(peerSub);
    if (ps) {
      setParts.push('peerSub = :ps');
      values[':ps'] = ps;
    } else {
      removeParts.push('peerSub');
    }

    const lss = safeString(lastSenderSub);
    if (lss) {
      setParts.push('lastSenderSub = :lss');
      values[':lss'] = lss;
    } else {
      removeParts.push('lastSenderSub');
    }

    const lsd = safeString(lastSenderDisplayName);
    if (lsd) {
      setParts.push('lastSenderDisplayName = :lsd');
      values[':lsd'] = lsd;
    } else {
      removeParts.push('lastSenderDisplayName');
    }

    if (conversationKind) {
      setParts.push('conversationKind = :ck');
      values[':ck'] = conversationKind;
    }

    const updateExpr = `SET ${setParts.join(', ')}${removeParts.length ? ` REMOVE ${removeParts.join(', ')}` : ''}`;
    await ddb.send(
      new UpdateCommand({
        TableName: table,
        Key: { userSub: owner, conversationId: convId },
        UpdateExpression: updateExpr,
        ExpressionAttributeValues: values,
      })
    );
  } catch (err) {
    console.warn('upsertConversationIndex failed', err);
  }
};

// BLOCKS_TABLE schema:
// - PK: blockerSub (String)
// - SK: blockedSub (String)
const hasBlock = async (blockerSub, blockedSub) => {
  const table = process.env.BLOCKS_TABLE;
  const blocker = safeString(blockerSub);
  const blocked = safeString(blockedSub);
  if (!table || !blocker || !blocked) return false;
  try {
    const resp = await ddb.send(
      new GetCommand({
        TableName: table,
        Key: { blockerSub: blocker, blockedSub: blocked },
        ProjectionExpression: 'blockedSub',
      })
    );
    return !!resp?.Item;
  } catch (err) {
    console.warn('hasBlock failed', err);
    return false;
  }
};

// For global, avoid delivering messages to users who have blocked the sender.
const filterConnIdsForGlobalSender = async (senderSub, connRecords) => {
  const table = process.env.BLOCKS_TABLE;
  if (!table) return (connRecords || []).map((r) => r.connectionId).filter(Boolean);

  const sender = safeString(senderSub);
  const recs = Array.isArray(connRecords) ? connRecords : [];

  const idsByUser = new Map();
  for (const r of recs) {
    const cid = r?.connectionId ? String(r.connectionId) : '';
    const u = r?.userSub ? String(r.userSub) : '';
    if (!cid || !u) continue;
    const arr = idsByUser.get(u) || [];
    arr.push(cid);
    idsByUser.set(u, arr);
  }
  const userSubs = Array.from(idsByUser.keys()).filter(Boolean);
  if (!userSubs.length || !sender) return recs.map((r) => r.connectionId).filter(Boolean);

  // NOTE: We intentionally use GetCommand fan-out instead of BatchGetCommand to avoid
  // any AWS SDK version mismatch issues in deployed Lambdas.
  const blockedRecipientSubs = new Set();
  await Promise.all(
    userSubs.map(async (u) => {
      try {
        const resp = await ddb.send(
          new GetCommand({
            TableName: table,
            Key: { blockerSub: String(u), blockedSub: String(sender) },
            ProjectionExpression: 'blockerSub',
          })
        );
        if (resp?.Item?.blockerSub) blockedRecipientSubs.add(String(resp.Item.blockerSub));
      } catch {
        // ignore
      }
    })
  );

  const allowedConnIds = [];
  for (const [u, cids] of idsByUser.entries()) {
    if (blockedRecipientSubs.has(u)) continue;
    allowedConnIds.push(...cids);
  }
  return allowedConnIds;
};

const markUnread = async (recipientSub, conversationId, sender) => {
  if (!process.env.UNREADS_TABLE) return;
  if (!recipientSub) return;

  await ddb.send(
    new UpdateCommand({
      TableName: process.env.UNREADS_TABLE,
      Key: { userSub: recipientSub, conversationId },
      UpdateExpression:
        'SET #k = :k, senderSub = :ss, senderDisplayName = :sd, lastMessageCreatedAt = :createdAt, messageCount = if_not_exists(messageCount, :zero) + :inc',
      ExpressionAttributeNames: { '#k': 'kind' },
      ExpressionAttributeValues: {
        ':k': 'message',
        ':ss': sender.userSub,
        ':sd': sender.displayName,
        ':createdAt': sender.createdAtMs,
        ':inc': 1,
        ':zero': 0,
      },
    })
  );
};

const clearUnread = async (readerSub, conversationId) => {
  if (!process.env.UNREADS_TABLE) return;
  if (!readerSub) return;
  if (!conversationId || conversationId === 'global') return;

  await ddb.send(
    new DeleteCommand({
      TableName: process.env.UNREADS_TABLE,
      Key: { userSub: readerSub, conversationId },
    })
  );
};

exports.handler = async (event) => {
  try {
    const { domainName, stage, connectionId } = event.requestContext;

    const mgmt = new ApiGatewayManagementApiClient({
      endpoint: `https://${domainName}/${stage}`,
      region: process.env.AWS_REGION,
    });

    let body = {};
    try {
      body = JSON.parse(event.body || '{}');
    } catch {}

    const action = body.action || 'message';
    const nowMs = Date.now();
    const nowSec = Math.floor(nowMs / 1000);
    const conversationId = String(body.conversationId || 'global');

    // Authoritative sender identity from DynamoDB (prevents spoofing)
    const conn = await ddb.send(
      new GetCommand({
        TableName: process.env.CONNECTIONS_TABLE,
        Key: { connectionId },
      })
    );

    const senderSub = conn?.Item?.userSub ? String(conn.Item.userSub) : '';
    if (!senderSub) {
      return { statusCode: 401, body: 'Unauthorized (missing connection identity).' };
    }

    const senderUsernameLower = conn?.Item?.usernameLower ? String(conn.Item.usernameLower) : '';
    const senderDisplayName = conn?.Item?.displayName ? String(conn.Item.displayName) : 'anon';

    // Refresh connection TTL on any activity
    const expiresAt = nowSec + CONN_TTL_SECONDS;

    // JOIN: update convo + refresh TTL in one write
    if (action === 'join') {
      await ddb.send(
        new UpdateCommand({
          TableName: process.env.CONNECTIONS_TABLE,
          Key: { connectionId },
          UpdateExpression: 'SET conversationId = :c, expiresAt = :e',
          ExpressionAttributeValues: { ':c': conversationId, ':e': expiresAt },
        })
      );
      return { statusCode: 200, body: 'Joined.' };
    }

    // Best-effort TTL refresh (don’t break chat if it fails)
    await ddb
      .send(
        new UpdateCommand({
          TableName: process.env.CONNECTIONS_TABLE,
          Key: { connectionId },
          UpdateExpression: 'SET expiresAt = :e',
          ExpressionAttributeValues: { ':e': expiresAt },
        })
      )
      .catch(() => {});

    // Recipients (NO scans)
    let recipientConnIds = [];
    let dmRecipientSub = null;
    let groupId = null;
    let groupMember = null;
    let groupActiveSubs = null;

    if (conversationId === 'global') {
      // Only broadcast to people who are currently "joined" to global
      // Prefer the newer index that projects userSub so we can do realtime server-side global blocking.
      // If it's not created/active yet, fall back to the legacy byConversation index.
      try {
        const connRecords = await queryConnRecordsByConversationWithUser('global');
        recipientConnIds = await filterConnIdsForGlobalSender(senderSub, connRecords);
      } catch (err) {
        console.warn('byConversationWithUser unavailable; falling back to byConversation', err);
        recipientConnIds = await queryConnIdsByConversation('global');
      }
    } else if (String(conversationId).startsWith('dm#')) {
      dmRecipientSub = parseDmRecipientSub(conversationId, senderSub);
      if (!dmRecipientSub) {
        return { statusCode: 400, body: 'Invalid DM conversationId (expected dm#minSub#maxSub).' };
      }
      const a = await queryConnIdsByUserSub(senderSub);
      const b = await queryConnIdsByUserSub(dmRecipientSub);
      recipientConnIds = Array.from(new Set([...a, ...b]));
    } else if (String(conversationId).startsWith('gdm#')) {
      groupId = parseGroupId(conversationId);
      if (!groupId) return { statusCode: 400, body: 'Invalid group conversationId (expected gdm#<groupId>).' };
      groupMember = await getGroupMember(groupId, senderSub);
      if (!groupMember) return { statusCode: 403, body: 'Forbidden.' };

      groupActiveSubs = await queryActiveGroupMemberSubs(groupId);
      if (!Array.isArray(groupActiveSubs) || groupActiveSubs.length === 0) {
        return { statusCode: 404, body: 'Group not found.' };
      }
      const activeSet = new Set(groupActiveSubs);
      if (!activeSet.has(senderSub)) {
        if (action !== 'read') return { statusCode: 403, body: 'Forbidden.' };
      }

      const connLists = await Promise.all(groupActiveSubs.map((s) => queryConnIdsByUserSub(s).catch(() => [])));
      recipientConnIds = Array.from(new Set(connLists.flat().filter(Boolean)));
    } else {
      return { statusCode: 400, body: 'Invalid conversationId.' };
    }

    // ---- SYSTEM (group-only, audit/event message) ----
    // Allows the client to request a server-validated system message (so it persists + broadcasts).
    // Most system events are admin-only, except a user may publish their own "left" event.
    if (action === 'system') {
      if (!groupId) return { statusCode: 400, body: 'system only supported for group DMs.' };
      const systemKind = safeString(body.systemKind);
      const allowed = new Set(['ban', 'unban', 'kick', 'left', 'removed', 'added', 'update']);
      if (!systemKind || !allowed.has(systemKind)) {
        return { statusCode: 400, body: 'Invalid systemKind.' };
      }

      const targetSub = safeString(body.targetSub);
      // Permission model:
      // - Admin required for ban/unban/kick/removed/added
      // - "left" is allowed for any active member, but only for themselves (targetSub === senderSub)
      const isSelfLeft = systemKind === 'left' && targetSub && targetSub === senderSub;
      if (systemKind === 'left' && !isSelfLeft) {
        return { statusCode: 400, body: 'left requires targetSub = senderSub.' };
      }
      // Auth rules:
      // - For admin-only events: require active admin.
      // - For self-left event: allow either active OR already-left member (so the client can log the event
      //   after a successful /groups/leave call without racing).
      if (isSelfLeft) {
        if (!groupMember || (groupMember.status !== 'active' && groupMember.status !== 'left')) {
          return { statusCode: 403, body: 'Forbidden.' };
        }
      } else {
        if (!groupMember || groupMember.status !== 'active' || !groupMember.isAdmin) {
          return { statusCode: 403, body: 'Admin required.' };
        }
      }

      let targetLabel = null;
      if (targetSub) {
        try {
          targetLabel = await getUserDisplayNameBySub(targetSub);
        } catch {
          targetLabel = null;
        }
      }
      const targetName = targetSub
        ? (targetLabel || `${String(targetSub).slice(0, 6)}…${String(targetSub).slice(-4)}`)
        : null;

      let systemText = safeString(body.text);
      if (!systemText) {
        if (systemKind === 'ban' && targetName) systemText = `${targetName} was banned by ${senderDisplayName || 'an admin'}`;
        else if (systemKind === 'added' && targetName) systemText = `${targetName} was added by ${senderDisplayName || 'an admin'}`;
        else if (systemKind === 'unban' && targetName) systemText = `${targetName} was unbanned by ${senderDisplayName || 'an admin'}`;
        else if (systemKind === 'kick' && targetName) systemText = `${targetName} was kicked by ${senderDisplayName || 'an admin'}`;
        else if (systemKind === 'left' && targetName) systemText = `${targetName} left the chat`;
        else if (systemKind === 'removed' && targetName) systemText = `${targetName} was removed by ${senderDisplayName || 'an admin'}`;
        else if (systemKind === 'update') {
          const updateField = safeString(body.updateField || body.field);
          const groupName = safeString(body.groupName);
          if (updateField === 'groupName') {
            systemText = groupName ? `Group name changed to ${groupName}` : 'Group name reset to default';
          } else {
            systemText = `${senderDisplayName || 'An admin'} updated the group`;
          }
        } else systemText = `${senderDisplayName || 'An admin'} updated the group`;
      }

      const systemMessageId = `sys-${nowMs}-${Math.random().toString(36).slice(2)}`;

      // Persist (optional) so late joiners can see it in history.
      if (process.env.MESSAGES_TABLE) {
        try {
          await ddb.send(
            new PutCommand({
              TableName: process.env.MESSAGES_TABLE,
              Item: {
                conversationId,
                createdAt: nowMs,
                messageId: systemMessageId,
                kind: 'system',
                systemKind,
                actorSub: senderSub,
                actorUser: senderDisplayName,
                ...(targetSub ? { targetSub } : {}),
                ...(targetName ? { targetUser: targetName } : {}),
                text: systemText,
                user: 'System',
                userLower: 'system',
              },
            })
          );
        } catch (err) {
          console.warn('system message persist failed (ignored)', err);
        }
      }

      // Realtime broadcast to active members.
      try {
        await broadcast(mgmt, recipientConnIds, {
          type: 'system',
          kind: 'system',
          systemKind,
          conversationId,
          messageId: systemMessageId,
          createdAt: nowMs,
          text: systemText,
          user: 'System',
          userLower: 'system',
          actorSub: senderSub,
          actorUser: senderDisplayName,
          ...(targetSub ? { targetSub } : {}),
          ...(targetName ? { targetUser: targetName } : {}),
        });
      } catch (err) {
        console.warn('system message broadcast failed (ignored)', err);
      }
      return { statusCode: 200, body: 'System message sent.' };
    }

    // ---- KICK (group-only, admin-only, UI eject) ----
    if (action === 'kick') {
      if (!groupId) return { statusCode: 400, body: 'kick only supported for group DMs.' };
      if (!groupMember || groupMember.status !== 'active' || !groupMember.isAdmin) {
        return { statusCode: 403, body: 'Admin required.' };
      }
      const targetSub = safeString(body.targetSub);
      if (!targetSub) return { statusCode: 400, body: 'targetSub is required.' };
      const suppressSystem = body && body.suppressSystem === true;

      if (!suppressSystem) {
        // Best-effort: broadcast a "system message" to the group chat so everyone sees the event in history/UI.
        // Kick is UI-only (no membership change), but the event itself can still be logged.
        let targetLabel = null;
        try {
          targetLabel = await getUserDisplayNameBySub(targetSub);
        } catch {
          targetLabel = null;
        }
        const targetName = targetLabel || `${String(targetSub).slice(0, 6)}…${String(targetSub).slice(-4)}`;
        const systemText = `${targetName} was kicked by ${senderDisplayName || 'an admin'}`;
        const systemMessageId = `sys-${nowMs}-${Math.random().toString(36).slice(2)}`;

        // Persist (optional) so late joiners can see it in history.
        if (process.env.MESSAGES_TABLE) {
          try {
            await ddb.send(
              new PutCommand({
                TableName: process.env.MESSAGES_TABLE,
                Item: {
                  conversationId,
                  createdAt: nowMs,
                  messageId: systemMessageId,
                  kind: 'system',
                  systemKind: 'kick',
                  actorSub: senderSub,
                  actorUser: senderDisplayName,
                  targetSub,
                  targetUser: targetName,
                  text: systemText,
                  user: 'System',
                  userLower: 'system',
                },
              })
            );
          } catch (err) {
            // Never fail the kick if logging fails.
            console.warn('kick system message persist failed (ignored)', err);
          }
        }

        // Realtime broadcast to active members.
        try {
          await broadcast(mgmt, recipientConnIds, {
            type: 'system',
            kind: 'system',
            systemKind: 'kick',
            conversationId,
            messageId: systemMessageId,
            createdAt: nowMs,
            text: systemText,
            user: 'System',
            userLower: 'system',
            actorSub: senderSub,
            actorUser: senderDisplayName,
            targetSub,
            targetUser: targetName,
          });
        } catch (err) {
          console.warn('kick system message broadcast failed (ignored)', err);
        }
      }

      const targetConns = await queryConnIdsByUserSub(targetSub).catch(() => []);
      if (Array.isArray(targetConns) && targetConns.length) {
        await broadcast(mgmt, targetConns, {
          type: 'kicked',
          conversationId,
          bySub: senderSub,
          byUser: senderDisplayName,
          createdAt: nowMs,
        });
      }
      return { statusCode: 200, body: 'Kick sent.' };
    }

    // ---- READ ----
    if (action === 'read') {
      if (conversationId === 'global') return { statusCode: 200, body: 'Ignored read for global.' };

      const messageCreatedAt = Number(body.messageCreatedAt ?? body.readUpTo);
      const readAt = typeof body.readAt === 'number' ? Math.floor(body.readAt) : nowSec;

      if (!Number.isFinite(messageCreatedAt) || messageCreatedAt <= 0) {
        return { statusCode: 400, body: 'Invalid messageCreatedAt.' };
      }

      // Broadcast read event (for online sender)
      await broadcast(mgmt, recipientConnIds, {
        type: 'read',
        conversationId,
        user: senderDisplayName,
        userLower: senderUsernameLower,
        userSub: senderSub,
        messageCreatedAt,
        readAt,
      });

      // Persist read receipt so sender sees "Seen" even if offline at time of read
      if (process.env.READS_TABLE) {
        await ddb.send(
          new PutCommand({
            TableName: process.env.READS_TABLE,
            Item: {
              conversationId,
              key: `${senderSub}#${messageCreatedAt}`,
              userSub: senderSub,
              user: senderDisplayName,
              messageCreatedAt,
              readAt,
              updatedAt: nowMs,
            },
          })
        );
      }

      // Clear unread for the reader (best-effort)
      await clearUnread(senderSub, conversationId).catch(() => {});

      // TTL-from-read: if this message has ttlSeconds and reader is not sender, set expiresAt on the message
      if (process.env.MESSAGES_TABLE) {
        const existing = await ddb.send(
          new GetCommand({
            TableName: process.env.MESSAGES_TABLE,
            Key: { conversationId, createdAt: messageCreatedAt },
          })
        );
        const msg = existing.Item;
        if (msg) {
          const msgUserLower = msg.userLower ? String(msg.userLower).trim().toLowerCase() : '';
          const senderFallbackLower = msg.user ? String(msg.user).trim().toLowerCase() : '';
          const actualSenderLower = msgUserLower || senderFallbackLower || 'anon';

          const ttlSeconds = Number(msg.ttlSeconds);
          const alreadyExpiresAt =
            typeof msg.expiresAt === 'number' && Number.isFinite(msg.expiresAt);

          if (
            actualSenderLower !== senderUsernameLower &&
            !alreadyExpiresAt &&
            Number.isFinite(ttlSeconds) &&
            ttlSeconds > 0
          ) {
            const msgExpiresAt = readAt + Math.floor(ttlSeconds);
            await ddb
              .send(
                new UpdateCommand({
                  TableName: process.env.MESSAGES_TABLE,
                  Key: { conversationId, createdAt: messageCreatedAt },
                  UpdateExpression: 'SET expiresAt = :e',
                  ConditionExpression: 'attribute_not_exists(expiresAt)',
                  ExpressionAttributeValues: { ':e': msgExpiresAt },
                })
              )
              .catch(() => {});
          }
        }
      }

      return { statusCode: 200, body: 'Read receipt processed.' };
    }

    // ---- TYPING ----
    if (action === 'typing') {
      const isTyping = body.isTyping === true;

      // Don’t send typing events back to the sender’s own connection
      const senderConnId = event.requestContext.connectionId;
      const recipientConnIdsWithoutSender = recipientConnIds.filter((id) => id !== senderConnId);

      await broadcast(mgmt, recipientConnIdsWithoutSender, {
        type: 'typing',
        conversationId,
        user: senderDisplayName,
        userLower: senderUsernameLower,
        userSub: senderSub,
        isTyping,
        createdAt: nowMs,
      });

      return { statusCode: 200, body: 'Typing event broadcasted.' };
    }

    // ---- EDIT ----
    if (action === 'edit') {
      if (conversationId === 'global') {
        // allow edits in global too, same rules (sender-only)
      }

      const messageCreatedAt = Number(body.messageCreatedAt ?? body.createdAt);
      const newText = String(body.text || '').trim();
      if (!Number.isFinite(messageCreatedAt) || messageCreatedAt <= 0) {
        return { statusCode: 400, body: 'Invalid messageCreatedAt.' };
      }
      if (!newText) {
        return { statusCode: 400, body: 'Empty edit text.' };
      }
      if (!process.env.MESSAGES_TABLE) return { statusCode: 500, body: 'Missing MESSAGES_TABLE env.' };

      // Verify sender owns the message
      const existing = await ddb.send(
        new GetCommand({
          TableName: process.env.MESSAGES_TABLE,
          Key: { conversationId, createdAt: messageCreatedAt },
        })
      );
      const msg = existing.Item;
      if (!msg) return { statusCode: 404, body: 'Message not found.' };
      if (String(msg.userSub || '') !== senderSub) return { statusCode: 403, body: 'Forbidden.' };
      if (msg.deletedAt) return { statusCode: 409, body: 'Message already deleted.' };

      // Async cleanup for attachments on edit:
      // - Global/channel: compare old/new envelopes.
      // - DM: use mediaPaths stored on the message row; allow client to provide updated mediaPaths.
      const isDm = conversationId !== 'global';
      const oldMediaPaths = isDm
        ? normalizeMediaPaths(msg.mediaPaths)
        : extractChatMediaPathsFromText(typeof msg.text === 'string' ? msg.text : '');
      const incomingMediaPaths = Object.prototype.hasOwnProperty.call(body, 'mediaPaths')
        ? normalizeMediaPaths(body.mediaPaths)
        : undefined; // undefined => keep existing
      const newMediaPaths = isDm
        ? incomingMediaPaths === undefined
          ? oldMediaPaths
          : incomingMediaPaths
        : extractChatMediaPathsFromText(newText);
      const toDelete = setDiff(oldMediaPaths, newMediaPaths);

      await ddb.send(
        new UpdateCommand({
          TableName: process.env.MESSAGES_TABLE,
          Key: { conversationId, createdAt: messageCreatedAt },
          UpdateExpression:
            isDm && incomingMediaPaths !== undefined
              ? 'SET #t = :t, mediaPaths = :mp, editedAt = :ea, updatedAt = :ua'
              : 'SET #t = :t, editedAt = :ea, updatedAt = :ua',
          ExpressionAttributeNames: { '#t': 'text' },
          ExpressionAttributeValues:
            isDm && incomingMediaPaths !== undefined
              ? { ':t': newText, ':mp': newMediaPaths, ':ea': nowMs, ':ua': nowMs }
              : { ':t': newText, ':ea': nowMs, ':ua': nowMs },
        })
      );

      if (toDelete.length) {
        enqueueMediaDeletes({
          keys: toDelete,
          reason: isDm ? 'dm_attachment_replaced' : 'attachment_replaced',
          allowedPrefixes: isDm ? ['uploads/dm/'] : ['uploads/channels/'],
          context: { conversationId, messageCreatedAt },
        }).catch((err) => console.warn('enqueueMediaDeletes(edit) failed (ignored)', err));
      }

      await broadcast(mgmt, recipientConnIds, {
        type: 'edit',
        conversationId,
        messageId: msg.messageId ? String(msg.messageId) : undefined,
        createdAt: messageCreatedAt,
        text: newText,
        editedAt: nowMs,
        userSub: senderSub,
      });

      return { statusCode: 200, body: 'Edit processed.' };
    }

    // ---- DELETE ----
    if (action === 'delete') {
      const messageCreatedAt = Number(body.messageCreatedAt ?? body.createdAt);
      if (!Number.isFinite(messageCreatedAt) || messageCreatedAt <= 0) {
        return { statusCode: 400, body: 'Invalid messageCreatedAt.' };
      }
      if (!process.env.MESSAGES_TABLE) return { statusCode: 500, body: 'Missing MESSAGES_TABLE env.' };

      // Verify sender owns the message
      const existing = await ddb.send(
        new GetCommand({
          TableName: process.env.MESSAGES_TABLE,
          Key: { conversationId, createdAt: messageCreatedAt },
        })
      );
      const msg = existing.Item;
      if (!msg) return { statusCode: 404, body: 'Message not found.' };
      if (String(msg.userSub || '') !== senderSub) return { statusCode: 403, body: 'Forbidden.' };
      if (msg.deletedAt) return { statusCode: 200, body: 'Already deleted.' };

      // Async cleanup for attachments on delete:
      // - Global/channel: parse msg.text envelope before we REMOVE it.
      // - DM: use msg.mediaPaths (stored out-of-band).
      const isDm = conversationId !== 'global';
      const mediaPaths = isDm
        ? normalizeMediaPaths(msg.mediaPaths)
        : extractChatMediaPathsFromText(typeof msg.text === 'string' ? msg.text : '');
      if (mediaPaths.length) {
        enqueueMediaDeletes({
          keys: mediaPaths,
          reason: isDm ? 'dm_message_deleted' : 'message_deleted',
          allowedPrefixes: isDm ? ['uploads/dm/'] : ['uploads/channels/'],
          context: { conversationId, messageCreatedAt },
        }).catch((err) => console.warn('enqueueMediaDeletes(delete) failed (ignored)', err));
      }

      // Preserve audit fields, but remove message contents
      await ddb.send(
        new UpdateCommand({
          TableName: process.env.MESSAGES_TABLE,
          Key: { conversationId, createdAt: messageCreatedAt },
          UpdateExpression: 'SET deletedAt = :da, deletedBySub = :db, updatedAt = :ua REMOVE #t',
          ExpressionAttributeNames: { '#t': 'text' },
          ExpressionAttributeValues: { ':da': nowMs, ':db': senderSub, ':ua': nowMs },
        })
      );

      await broadcast(mgmt, recipientConnIds, {
        type: 'delete',
        conversationId,
        messageId: msg.messageId ? String(msg.messageId) : undefined,
        createdAt: messageCreatedAt,
        deletedAt: nowMs,
        deletedBySub: senderSub,
      });

      return { statusCode: 200, body: 'Delete processed.' };
    }

    // ---- REACT ----
    if (action === 'react') {
      const messageCreatedAt = Number(body.messageCreatedAt ?? body.createdAt);
      const emoji = typeof body.emoji === 'string' ? String(body.emoji) : '';
      const opRaw = typeof body.op === 'string' ? String(body.op) : '';
      const op = opRaw === 'remove' ? 'remove' : 'add';

      if (!Number.isFinite(messageCreatedAt) || messageCreatedAt <= 0) {
        return { statusCode: 400, body: 'Invalid messageCreatedAt.' };
      }
      if (!emoji || emoji.length > 16) {
        return { statusCode: 400, body: 'Invalid emoji.' };
      }
      if (!process.env.MESSAGES_TABLE) return { statusCode: 500, body: 'Missing MESSAGES_TABLE env.' };

      const key = { conversationId, createdAt: messageCreatedAt };
      const setVal = new Set([senderSub]);
      const senderName = senderDisplayName ? String(senderDisplayName) : 'anon';

      // Enforce "single reaction per user per message":
      // - reactions is a map: emoji -> StringSet(userSub)
      // - when adding a reaction, remove userSub from ALL other emoji sets first
      const existing = await ddb.send(
        new GetCommand({
          TableName: process.env.MESSAGES_TABLE,
          Key: key,
          ProjectionExpression: 'messageId, reactions',
        })
      );
      const existingReactions = existing?.Item?.reactions && typeof existing.Item.reactions === 'object'
        ? existing.Item.reactions
        : {};

      const emojiKeys = Object.keys(existingReactions || {});
      const toRemoveFrom = [];
      for (const k of emojiKeys) {
        try {
          const set = existingReactions[k];
          const arr =
            set && typeof set === 'object' && set instanceof Set
              ? Array.from(set)
              : Array.isArray(set)
              ? set
              : [];
          if (arr.map(String).includes(senderSub) && k !== emoji) toRemoveFrom.push(k);
        } catch {
          // ignore malformed reaction set
        }
      }

      const exprNames = { '#e': emoji };
      const exprValues = { ':u': setVal, ':empty': {} };
      const deleteParts = [];

      for (let i = 0; i < toRemoveFrom.length; i++) {
        const k = toRemoveFrom[i];
        const nameKey = `#r${i}`;
        exprNames[nameKey] = k;
        deleteParts.push(`reactions.${nameKey} :u`);
      }

      // DynamoDB cannot update 'reactions' and 'reactions.<emoji>' in the same UpdateExpression
      // (paths overlap). So we do it in two steps:
      // 1) ensure reactions map exists (and also reactionUsers map for name snapshots)
      // 2) apply ADD/DELETE on reactions.<emoji> sets (and other emoji sets for single-reaction model)
      await ddb.send(
        new UpdateCommand({
          TableName: process.env.MESSAGES_TABLE,
          Key: key,
          UpdateExpression:
            'SET reactions = if_not_exists(reactions, :empty), reactionUsers = if_not_exists(reactionUsers, :emptyUsers)',
          ExpressionAttributeValues: { ':empty': {}, ':emptyUsers': {} },
        })
      );

      // DynamoDB UpdateExpression section order matters (SET, REMOVE, ADD, DELETE).
      // We SET reactionUsers.<senderSub> (username snapshot) and ADD/DELETE reactions.* sets.
      let updateExpression = '';
      // add/remove username snapshot (remove when user removes their reaction)
      exprNames['#s'] = senderSub;
      if (op === 'remove') {
        // Order must be: SET, REMOVE, ADD, DELETE
        updateExpression = 'REMOVE reactionUsers.#s DELETE reactions.#e :u';
      } else {
        updateExpression = 'SET reactionUsers.#s = :sn ADD reactions.#e :u';
        if (deleteParts.length) updateExpression += ` DELETE ${deleteParts.join(', ')}`;
      }

      await ddb.send(
        new UpdateCommand({
          TableName: process.env.MESSAGES_TABLE,
          Key: key,
          UpdateExpression: updateExpression,
          ExpressionAttributeNames: exprNames,
          ExpressionAttributeValues: op === 'remove' ? { ':u': setVal } : { ':u': setVal, ':sn': senderName },
        })
      );

      // Fetch updated reactions (full map) so clients can reconcile multiple-emoji changes.
      const updated = await ddb.send(
        new GetCommand({
          TableName: process.env.MESSAGES_TABLE,
          Key: key,
          ProjectionExpression: 'messageId, createdAt, reactions',
        })
      );
      const msg = updated.Item || {};

      const reactions = msg?.reactions && typeof msg.reactions === 'object' ? msg.reactions : {};
      const reactionPayload = {};
      for (const [k, set] of Object.entries(reactions)) {
        const arr =
          set && typeof set === 'object' && set instanceof Set
            ? Array.from(set).map(String)
            : Array.isArray(set)
            ? set.map(String)
            : [];
        if (arr.length) reactionPayload[String(k)] = { count: arr.length, userSubs: arr };
      }

      await broadcast(mgmt, recipientConnIds, {
        type: 'reaction',
        conversationId,
        messageId: msg.messageId ? String(msg.messageId) : undefined,
        createdAt: messageCreatedAt,
        reactions: reactionPayload,
        actorSub: senderSub,
        op,
      });

      return { statusCode: 200, body: 'Reaction processed.' };
    }

    // ---- MESSAGE ----
    const text = String(body.text || '').trim();
    if (!text) return { statusCode: 400, body: 'Empty message.' };
    if (!process.env.MESSAGES_TABLE) return { statusCode: 500, body: 'Missing MESSAGES_TABLE env.' };

    const isDm = String(conversationId || '').startsWith('dm#');
    const isGroup = String(conversationId || '').startsWith('gdm#');

    // Block enforcement (DM only).
    // If either party has blocked the other, do not persist or broadcast.
    // This is intentionally "silent": client will treat it like a send failure/timeout.
    if (isDm) {
      try {
        if (!dmRecipientSub) dmRecipientSub = parseDmRecipientSub(conversationId, senderSub);
        if (dmRecipientSub) {
          const [senderBlockedRecipient, recipientBlockedSender] = await Promise.all([
            hasBlock(senderSub, dmRecipientSub),
            hasBlock(dmRecipientSub, senderSub),
          ]);
          if (senderBlockedRecipient || recipientBlockedSender) {
            return { statusCode: 200, body: 'Message ignored (blocked).' };
          }
        }
      } catch {
        // ignore (fail-open)
      }
    }

    // Optional DM self-destruct duration (seconds)
    let ttlSeconds;
    if (conversationId !== 'global' && typeof body.ttlSeconds === 'number' && Number.isFinite(body.ttlSeconds)) {
      const v = Math.floor(body.ttlSeconds);
      if (v > 0 && v <= 365 * 24 * 60 * 60) ttlSeconds = v;
    }

    const clientMessageId =
      typeof body.clientMessageId === 'string' ? String(body.clientMessageId).trim() : '';
    const messageId =
      clientMessageId && clientMessageId.length <= 120
        ? clientMessageId
        : `${nowMs}-${Math.random().toString(36).slice(2)}`;

    const incomingMediaPaths = Object.prototype.hasOwnProperty.call(body, 'mediaPaths')
      ? normalizeMediaPaths(body.mediaPaths)
      : undefined;

    // Persist (store display + stable key)
    await ddb.send(
      new PutCommand({
        TableName: process.env.MESSAGES_TABLE,
        Item: {
          conversationId,
          createdAt: nowMs,
          messageId,
          text,
          user: senderDisplayName,
          userLower: senderUsernameLower,
          userSub: senderSub,
          ...(conversationId !== 'global' && incomingMediaPaths && incomingMediaPaths.length
            ? { mediaPaths: incomingMediaPaths }
            : {}),
          ...(ttlSeconds ? { ttlSeconds } : {}),
        },
      })
    );

    let groupTitleForPayload;
    if (isGroup) {
      groupTitleForPayload = (await getConversationTitleForUser(senderSub, conversationId)) || 'Group DM';
    }

    // Broadcast (send display + stable key)
    await broadcast(mgmt, recipientConnIds, {
      messageId,
      user: senderDisplayName,
      userLower: senderUsernameLower,
      userSub: senderSub,
      text,
      createdAt: nowMs,
      conversationId,
      conversationKind: isGroup ? 'group' : isDm ? 'dm' : undefined,
      ...(isGroup ? { groupTitle: groupTitleForPayload } : {}),
      ...(ttlSeconds ? { ttlSeconds } : {}),
    });

    // Persist unread so offline users see it on next login via GET /unreads
    if (conversationId !== 'global') {
      try {
        if (isDm) {
          if (!dmRecipientSub) {
            dmRecipientSub = parseDmRecipientSub(conversationId, senderSub);
          }

          const recipientName =
            (await getUserDisplayNameBySub(dmRecipientSub)) || safeString(dmRecipientSub) || 'Direct Message';
          await Promise.all([
            upsertConversationIndex({
              ownerSub: senderSub,
              conversationId,
              peerSub: dmRecipientSub,
              peerDisplayName: recipientName,
              lastMessageAt: nowMs,
              lastSenderSub: senderSub,
              lastSenderDisplayName: senderDisplayName,
            }),
            upsertConversationIndex({
              ownerSub: dmRecipientSub,
              conversationId,
              peerSub: senderSub,
              peerDisplayName: senderDisplayName,
              lastMessageAt: nowMs,
              lastSenderSub: senderSub,
              lastSenderDisplayName: senderDisplayName,
            }),
          ]);

          await markUnread(dmRecipientSub, conversationId, {
            userSub: senderSub,
            displayName: senderDisplayName,
            createdAtMs: nowMs,
          });

          const activeRecipientConns = await queryConnIdsByUserSub(dmRecipientSub).catch(() => []);
          if (!Array.isArray(activeRecipientConns) || activeRecipientConns.length === 0) {
            await sendDmPushNotification({
              recipientSub: dmRecipientSub,
              senderDisplayName,
              senderSub,
              conversationId,
              kind: 'dm',
            });
          }
        } else if (isGroup) {
          const activeSubs = Array.isArray(groupActiveSubs) ? groupActiveSubs : [];
          await Promise.all(
            activeSubs.map(async (u) => {
              const title = (await getConversationTitleForUser(u, conversationId)) || 'Group DM';
              if (process.env.CONVERSATIONS_TABLE) {
                await ddb
                  .send(
                    new UpdateCommand({
                      TableName: process.env.CONVERSATIONS_TABLE,
                      Key: { userSub: String(u), conversationId },
                      UpdateExpression: 'SET lastMessageAt = :lma, lastSenderSub = :lss, lastSenderDisplayName = :lsd',
                      ExpressionAttributeValues: { ':lma': nowMs, ':lss': senderSub, ':lsd': senderDisplayName },
                    })
                  )
                  .catch(() => {});
              }

              if (u && u !== senderSub) {
                await markUnread(u, conversationId, { userSub: senderSub, displayName: title, createdAtMs: nowMs });
                const activeConns = await queryConnIdsByUserSub(u).catch(() => []);
                if (!Array.isArray(activeConns) || activeConns.length === 0) {
                  await sendDmPushNotification({
                    recipientSub: u,
                    senderDisplayName: title,
                    senderSub,
                    conversationId,
                    kind: 'group',
                  });
                }
              }
            })
          );
        }
      } catch {
        // ignore
      }
    }

    return { statusCode: 200, body: 'Message broadcasted.' };
  } catch (err) {
    console.error('wsMessage error', err);
    return { statusCode: 500, body: 'Internal error.' };
  }
};