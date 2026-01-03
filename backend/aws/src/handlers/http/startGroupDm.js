// HTTP API (payload v2) Lambda: POST /groups/start
// Creates or reuses an encrypted group DM (gdm#<groupId>) for a roster of users.
//
// Product rules:
// - Max 8 total members (including caller)
// - Requires each member to have Users.currentPublicKey set (encryption-ready)
// - Newly added members cannot decrypt older messages (enforced by client envelope + server access control)
// - Roster reuse only when an existing group has the exact same ACTIVE roster AND caller is ACTIVE
//
// Env:
// - USERS_TABLE (required): PK userSub; GSI byUsernameLower (PK usernameLower)
// - GROUPS_TABLE (required): PK groupId; attributes: rosterKey, groupName?, createdBySub, createdAt, updatedAt
// - GROUPS_ROSTER_GSI (optional, default "byRosterKey"): GSI on GROUPS_TABLE with PK rosterKey, SK groupId
// - GROUP_MEMBERS_TABLE (required): PK groupId, SK memberSub; attrs: status, isAdmin, joinedAt, addedBySub
// - CONVERSATIONS_TABLE (required): PK userSub, SK conversationId (string); attrs used by GET /conversations
// - UNREADS_TABLE (optional): PK userSub, SK conversationId; used to notify members "Added to group"
//
// Auth: JWT (Cognito). Reads sub from requestContext.authorizer.jwt.claims.sub
const crypto = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  PutCommand,
  BatchWriteCommand,
  BatchGetCommand,
  UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const safeString = (v) => (typeof v === 'string' ? String(v).trim() : '');
const uniq = (arr) => Array.from(new Set((Array.isArray(arr) ? arr : []).map((s) => safeString(s)).filter(Boolean)));

const json = (statusCode, bodyObj) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(bodyObj),
});

const sha256Hex = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const buildRosterKey = (memberSubsSorted) => `roster#${sha256Hex((memberSubsSorted || []).join('#'))}`;

const newGroupId = () => {
  try {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // ignore
  }
  return crypto.randomBytes(16).toString('hex');
};

async function getUserByUsernameLower(usersTable, usernameLower) {
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
  const item = resp.Items?.[0] || null;
  if (!item) return null;

  // IMPORTANT: DynamoDB GSI projection may not include `currentPublicKey`.
  // Hydrate by PK to ensure we see full user attributes.
  const sub = safeString(item.userSub);
  if (!sub) return item;
  if (safeString(item.currentPublicKey)) return item;
  try {
    const full = await getUserBySub(usersTable, sub);
    return full || item;
  } catch {
    return item;
  }
}

async function getUserBySub(usersTable, sub) {
  const s = safeString(sub);
  if (!s) return null;
  const resp = await ddb.send(new GetCommand({ TableName: usersTable, Key: { userSub: s } }));
  return resp.Item || null;
}

async function queryActiveMemberSubs(groupMembersTable, groupId) {
  const gid = safeString(groupId);
  if (!gid) return [];
  const resp = await ddb.send(
    new QueryCommand({
      TableName: groupMembersTable,
      KeyConditionExpression: 'groupId = :g',
      ExpressionAttributeValues: { ':g': gid },
      ProjectionExpression: 'memberSub, #s',
      ExpressionAttributeNames: { '#s': 'status' },
      Limit: 50,
    })
  );
  return (resp.Items || [])
    .filter((it) => String(it?.status || '') === 'active')
    .map((it) => safeString(it.memberSub))
    .filter(Boolean)
    .sort();
}

async function isActiveMember(groupMembersTable, groupId, memberSub) {
  const gid = safeString(groupId);
  const sub = safeString(memberSub);
  if (!gid || !sub) return false;
  const resp = await ddb.send(
    new GetCommand({
      TableName: groupMembersTable,
      Key: { groupId: gid, memberSub: sub },
      ProjectionExpression: 'memberSub, #s',
      ExpressionAttributeNames: { '#s': 'status' },
    })
  );
  return String(resp?.Item?.status || '') === 'active';
}

async function hydrateProfiles(usersTable, subs) {
  const unique = uniq(subs);
  if (!unique.length) return new Map();
  const resp = await ddb.send(
    new BatchGetCommand({
      RequestItems: {
        [usersTable]: {
          Keys: unique.map((s) => ({ userSub: s })),
          ProjectionExpression: 'userSub, displayName, usernameLower',
        },
      },
    })
  );
  const items = resp.Responses?.[usersTable] || [];
  return new Map(
    items.map((it) => [
      safeString(it.userSub),
      { displayName: safeString(it.displayName || it.usernameLower || it.userSub) || 'anon' },
    ])
  );
}

function buildTitleForMember({ groupName, memberSub, activeSubs, profilesBySub }) {
  const name = safeString(groupName);
  if (name) return name;
  const others = (activeSubs || []).filter((s) => s && s !== memberSub);
  const labels = others
    .map((s) => profilesBySub.get(s)?.displayName || s)
    .map((s) => safeString(s))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  if (!labels.length) return 'Group DM';
  const head = labels.slice(0, 3);
  const rest = labels.length - head.length;
  return rest > 0 ? `${head.join(', ')} +${rest}` : head.join(', ');
}

async function upsertConversationIndex({
  conversationsTable,
  ownerSub,
  conversationId,
  peerDisplayName,
  lastMessageAt,
  lastSenderSub,
  lastSenderDisplayName,
  conversationKind,
  memberStatus,
}) {
  const owner = safeString(ownerSub);
  const convId = safeString(conversationId);
  if (!conversationsTable || !owner || !convId) return;
  const nowMs = Date.now();
  const setParts = [
    'peerDisplayName = :pd',
    'lastMessageAt = :lma',
    'updatedAt = :u',
    'conversationKind = :ck',
  ];
  const removeParts = [];
  const values = {
    ':pd': safeString(peerDisplayName) || (convId.startsWith('gdm#') ? 'Group DM' : 'Direct Message'),
    ':lma': Number(lastMessageAt) || 0,
    ':u': nowMs,
    ':ck': safeString(conversationKind) || (convId.startsWith('dm#') ? 'dm' : 'group'),
  };

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
  if (memberStatus) {
    setParts.push('memberStatus = :ms');
    values[':ms'] = String(memberStatus);
  }

  const updateExpr = `SET ${setParts.join(', ')}${removeParts.length ? ` REMOVE ${removeParts.join(', ')}` : ''}`;
  await ddb
    .send(
      new UpdateCommand({
        TableName: conversationsTable,
        Key: { userSub: owner, conversationId: convId },
        UpdateExpression: updateExpr,
        ExpressionAttributeValues: values,
      })
    )
    .catch(() => {});
}

async function markUnreadAdded({ unreadTable, recipientSub, conversationId, groupTitle, addedBySub }) {
  if (!unreadTable) return;
  const u = safeString(recipientSub);
  const convId = safeString(conversationId);
  if (!u || !convId) return;
  const nowMs = Date.now();
  await ddb
    .send(
      new UpdateCommand({
        TableName: unreadTable,
        Key: { userSub: u, conversationId: convId },
        UpdateExpression:
          'SET #k = :k, senderSub = :ss, senderDisplayName = :sd, lastMessageCreatedAt = :t, messageCount = :c',
        ExpressionAttributeNames: { '#k': 'kind' },
        ExpressionAttributeValues: {
          ':k': 'added',
          ':ss': safeString(addedBySub) || null,
          ':sd': safeString(groupTitle) || 'Added to group',
          ':t': nowMs,
          // For kind=added, store 0; client treats it as a badge anyway.
          ':c': 0,
        },
      })
    )
    .catch(() => {});
}

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method;
  if (method !== 'POST') return json(405, { message: 'Method not allowed' });

  const callerSub = safeString(event.requestContext?.authorizer?.jwt?.claims?.sub);
  if (!callerSub) return json(401, { message: 'Unauthorized' });

  const usersTable = safeString(process.env.USERS_TABLE);
  const groupsTable = safeString(process.env.GROUPS_TABLE);
  const groupMembersTable = safeString(process.env.GROUP_MEMBERS_TABLE);
  const conversationsTable = safeString(process.env.CONVERSATIONS_TABLE);
  if (!usersTable) return json(500, { message: 'USERS_TABLE not configured' });
  if (!groupsTable) return json(500, { message: 'GROUPS_TABLE not configured' });
  if (!groupMembersTable) return json(500, { message: 'GROUP_MEMBERS_TABLE not configured' });
  if (!conversationsTable) return json(500, { message: 'CONVERSATIONS_TABLE not configured' });

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { message: 'Invalid JSON body' });
  }

  const usernamesRaw = Array.isArray(body.usernames) ? body.usernames : [];
  const usernames = uniq(usernamesRaw).map((s) => s.toLowerCase());
  if (usernames.length < 2) return json(400, { message: 'usernames must include at least 2 users for a group DM' });
  if (usernames.length > 7) return json(400, { message: 'Too many members (max 8 including you)' });

  try {
    const callerUser = await getUserBySub(usersTable, callerSub);
    if (!callerUser) return json(404, { message: 'Caller not found' });
    const callerKey = safeString(callerUser.currentPublicKey);
    if (!callerKey) return json(409, { message: 'Encryption not ready (missing your public key)' });

    // Resolve members by usernameLower and ensure keys exist.
    const resolved = [];
    for (const uname of usernames) {
      // eslint-disable-next-line no-await-in-loop
      const u = await getUserByUsernameLower(usersTable, uname);
      if (!u) return json(404, { message: `User not found: ${uname}` });
      const sub = safeString(u.userSub);
      if (!sub) return json(500, { message: 'Malformed Users row (missing userSub)' });
      const pk = safeString(u.currentPublicKey);
      if (!pk) return json(409, { message: `User not ready for encrypted chats: ${uname}` });
      resolved.push({ sub, displayName: safeString(u.displayName || u.usernameLower || sub) || uname });
    }

    const memberSubs = uniq([callerSub, ...resolved.map((r) => r.sub)]).sort();
    if (memberSubs.length < 3) return json(400, { message: 'Group DM requires at least 3 distinct members (including you)' });
    if (memberSubs.length > 8) return json(400, { message: 'Too many members (max 8 including you)' });

    const rosterKey = buildRosterKey(memberSubs);
    const rosterGsi = safeString(process.env.GROUPS_ROSTER_GSI) || 'byRosterKey';

    // Try reuse: query groups by rosterKey and verify caller is active member and roster matches active membership.
    let reuseGroupId = null;
    let reuseGroupName = null;
    try {
      const resp = await ddb.send(
        new QueryCommand({
          TableName: groupsTable,
          IndexName: rosterGsi,
          KeyConditionExpression: 'rosterKey = :r',
          ExpressionAttributeValues: { ':r': rosterKey },
          Limit: 25,
        })
      );
      const candidates = (resp.Items || [])
        .map((it) => ({ groupId: safeString(it.groupId), groupName: it.groupName ? safeString(it.groupName) : undefined }))
        .filter((it) => it.groupId);

      for (const cand of candidates) {
        // eslint-disable-next-line no-await-in-loop
        const ok = await isActiveMember(groupMembersTable, cand.groupId, callerSub);
        if (!ok) continue;
        // eslint-disable-next-line no-await-in-loop
        const activeSubs = await queryActiveMemberSubs(groupMembersTable, cand.groupId);
        if (activeSubs.length === memberSubs.length && activeSubs.join('#') === memberSubs.join('#')) {
          reuseGroupId = cand.groupId;
          reuseGroupName = cand.groupName;
          break;
        }
      }
    } catch {
      // If the roster GSI isn't created yet, we won't reuse; we'll create a new group.
    }

    const nowMs = Date.now();
    if (reuseGroupId) {
      const conversationId = `gdm#${reuseGroupId}`;
      const profilesBySub = await hydrateProfiles(usersTable, memberSubs);
      const title = buildTitleForMember({
        groupName: reuseGroupName,
        memberSub: callerSub,
        activeSubs: memberSubs,
        profilesBySub,
      });
      await upsertConversationIndex({
        conversationsTable,
        ownerSub: callerSub,
        conversationId,
        peerDisplayName: title,
        lastMessageAt: 0,
        lastSenderSub: undefined,
        lastSenderDisplayName: undefined,
        conversationKind: 'group',
        memberStatus: 'active',
      });
      return json(200, { conversationId, groupId: reuseGroupId, title });
    }

    // Create new group
    const groupId = newGroupId();
    const conversationId = `gdm#${groupId}`;

    await ddb.send(
      new PutCommand({
        TableName: groupsTable,
        Item: {
          groupId,
          rosterKey,
          createdAt: nowMs,
          createdBySub: callerSub,
          updatedAt: nowMs,
        },
        ConditionExpression: 'attribute_not_exists(groupId)',
      })
    );

    // Membership rows (max 8, so BatchWrite is safe).
    const memberItems = memberSubs.map((sub) => ({
      PutRequest: {
        Item: {
          groupId,
          memberSub: sub,
          status: 'active',
          isAdmin: sub === callerSub,
          joinedAt: nowMs,
          addedBySub: callerSub,
        },
      },
    }));
    await ddb.send(new BatchWriteCommand({ RequestItems: { [groupMembersTable]: memberItems } }));

    const profilesBySub = new Map([
      [callerSub, { displayName: safeString(callerUser.displayName || callerUser.usernameLower || callerSub) || 'anon' }],
      ...resolved.map((r) => [r.sub, { displayName: safeString(r.displayName) || r.sub }]),
    ]);

    // Conversation index rows for all members with per-member roster title.
    await Promise.all(
      memberSubs.map((sub) => {
        const titleForSub = buildTitleForMember({ groupName: undefined, memberSub: sub, activeSubs: memberSubs, profilesBySub });
        return upsertConversationIndex({
          conversationsTable,
          ownerSub: sub,
          conversationId,
          peerDisplayName: titleForSub,
          lastMessageAt: nowMs,
          lastSenderSub: callerSub,
          lastSenderDisplayName: safeString(callerUser.displayName || callerUser.usernameLower || callerSub) || 'anon',
          conversationKind: 'group',
          memberStatus: 'active',
        });
      })
    );

    // Unread "Added to group" for everyone except creator.
    const unreadTable = safeString(process.env.UNREADS_TABLE);
    await Promise.all(
      memberSubs
        .filter((s) => s !== callerSub)
        .map((s) => {
          const titleForSub = buildTitleForMember({ groupName: undefined, memberSub: s, activeSubs: memberSubs, profilesBySub });
          return markUnreadAdded({ unreadTable, recipientSub: s, conversationId, groupTitle: titleForSub, addedBySub: callerSub });
        })
    );

    const callerTitle = buildTitleForMember({ groupName: undefined, memberSub: callerSub, activeSubs: memberSubs, profilesBySub });
    return json(200, { conversationId, groupId, title: callerTitle });
  } catch (err) {
    console.error('startGroupDm error', err);
    return json(500, { message: 'Internal error' });
  }
};

