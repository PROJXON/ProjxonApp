// HTTP API (payload v2) Lambda: POST /groups/update
// Admin-only updates for group DMs (membership/admin roles + group name).
//
// Body:
// - { conversationId: "gdm#<groupId>", op: string, ... }
// Ops:
// - setName: { name?: string }
// - addMembers: { usernames: string[] }
// - removeMembers: { memberSubs?: string[], usernames?: string[] }
// - promoteAdmin: { memberSub: string }
// - demoteAdmin: { memberSub: string }
// - ban: { memberSub: string }
// - unban: { memberSub: string }
//
// Env:
// - USERS_TABLE (required): PK userSub; GSI byUsernameLower (PK usernameLower)
// - GROUPS_TABLE (required): PK groupId; attrs: rosterKey, groupName?, updatedAt
// - GROUP_MEMBERS_TABLE (required): PK groupId, SK memberSub; attrs: status, isAdmin, joinedAt, leftAt, bannedAt
// - CONVERSATIONS_TABLE (required): PK userSub, SK conversationId; attrs: peerDisplayName, lastMessageAt, memberStatus?
// - UNREADS_TABLE (optional): used for "Added to group" notification kind=added
//
// Notes:
// - This endpoint does NOT write system messages (those are E2E encrypted and should be authored by clients).
// - Max active members is enforced (8).
const crypto = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  BatchGetCommand,
  UpdateCommand,
  PutCommand,
} = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Keep group names short so they render well in headers and don't bloat system/update messages.
const MAX_GROUP_NAME_LEN = 20;

const safeString = (v) => (typeof v === 'string' ? String(v).trim() : '');
const uniq = (arr) => Array.from(new Set((Array.isArray(arr) ? arr : []).map((s) => safeString(s)).filter(Boolean)));

const normalizeGroupName = (v) => {
  if (typeof v !== 'string') return '';
  // Avoid multi-line / control whitespace names that can break UI layout.
  const s = String(v).replace(/[\r\n\t]/g, ' ').trim();
  // Collapse repeated spaces for nicer display.
  return s.replace(/ {2,}/g, ' ');
};

const json = (statusCode, bodyObj) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(bodyObj),
});

const sha256Hex = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const buildRosterKey = (memberSubsSorted) => `roster#${sha256Hex((memberSubsSorted || []).join('#'))}`;

const parseGroupConversationId = (conversationId) => {
  const c = safeString(conversationId);
  if (!c.startsWith('gdm#')) return null;
  const groupId = c.slice('gdm#'.length).trim();
  if (!groupId) return null;
  return { groupId };
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
    const full = await ddb.send(new GetCommand({ TableName: usersTable, Key: { userSub: sub } }));
    return full.Item || item;
  } catch {
    return item;
  }
}

async function getMemberRow(groupMembersTable, groupId, memberSub) {
  const resp = await ddb.send(
    new GetCommand({
      TableName: groupMembersTable,
      Key: { groupId, memberSub },
    })
  );
  return resp.Item || null;
}

async function listMembers(groupMembersTable, groupId) {
  const resp = await ddb.send(
    new QueryCommand({
      TableName: groupMembersTable,
      KeyConditionExpression: 'groupId = :g',
      ExpressionAttributeValues: { ':g': groupId },
      Limit: 50,
    })
  );
  return Array.isArray(resp.Items) ? resp.Items : [];
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
  memberStatus,
}) {
  const table = safeString(conversationsTable);
  const owner = safeString(ownerSub);
  const convId = safeString(conversationId);
  if (!table || !owner || !convId) return;
  const nowMs = Date.now();

  const setParts = [
    'peerDisplayName = :pd',
    'lastMessageAt = :lma',
    'updatedAt = :u',
    'conversationKind = :ck',
  ];
  const removeParts = [];
  const values = {
    ':pd': safeString(peerDisplayName) || 'Group DM',
    ':lma': Number(lastMessageAt) || 0,
    ':u': nowMs,
    ':ck': 'group',
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
        TableName: table,
        Key: { userSub: owner, conversationId: convId },
        UpdateExpression: updateExpr,
        ExpressionAttributeValues: values,
      })
    )
    .catch(() => {});
}

async function markUnreadAdded({ unreadTable, recipientSub, conversationId, groupTitle, addedBySub }) {
  const table = safeString(unreadTable);
  if (!table) return;
  const u = safeString(recipientSub);
  const convId = safeString(conversationId);
  if (!u || !convId) return;
  const nowMs = Date.now();
  await ddb
    .send(
      new UpdateCommand({
        TableName: table,
        Key: { userSub: u, conversationId: convId },
        UpdateExpression:
          'SET #k = :k, senderSub = :ss, senderDisplayName = :sd, lastMessageCreatedAt = :t, messageCount = :c',
        ExpressionAttributeNames: { '#k': 'kind' },
        ExpressionAttributeValues: {
          ':k': 'added',
          ':ss': safeString(addedBySub) || null,
          ':sd': safeString(groupTitle) || 'Added to group',
          ':t': nowMs,
          ':c': 0,
        },
      })
    )
    .catch(() => {});
}

async function updateUnreadTitleIfExists({ unreadTable, recipientSub, conversationId, groupTitle }) {
  const table = safeString(unreadTable);
  if (!table) return;
  const u = safeString(recipientSub);
  const convId = safeString(conversationId);
  const title = safeString(groupTitle);
  if (!u || !convId || !title) return;
  // Only update if an unread row already exists. We do NOT want to create new unread entries on rename.
  await ddb
    .send(
      new UpdateCommand({
        TableName: table,
        Key: { userSub: u, conversationId: convId },
        UpdateExpression: 'SET senderDisplayName = :sd',
        ExpressionAttributeValues: { ':sd': title },
        ConditionExpression: 'attribute_exists(conversationId)',
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
  const unreadTable = safeString(process.env.UNREADS_TABLE);
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

  const convId = safeString(body.conversationId);
  const parsed = parseGroupConversationId(convId);
  if (!parsed) return json(400, { message: 'Invalid conversationId (expected gdm#<groupId>)' });
  const op = safeString(body.op);
  if (!op) return json(400, { message: 'op is required' });

  const groupId = parsed.groupId;
  const nowMs = Date.now();

  try {
    const callerMember = await getMemberRow(groupMembersTable, groupId, callerSub);
    if (!callerMember) return json(403, { message: 'Forbidden' });
    if (safeString(callerMember.status) !== 'active') return json(403, { message: 'Forbidden' });
    if (!callerMember.isAdmin) return json(403, { message: 'Admin required' });

    const groupResp = await ddb.send(new GetCommand({ TableName: groupsTable, Key: { groupId } }));
    const group = groupResp.Item;
    if (!group) return json(404, { message: 'Group not found' });

    const membersBefore = await listMembers(groupMembersTable, groupId);
    const activeBefore = membersBefore
      .filter((m) => safeString(m.status) === 'active')
      .map((m) => safeString(m.memberSub))
      .filter(Boolean)
      .sort();

    const requireActiveLimit = (activeCount) => {
      if (activeCount > 8) throw new Error('Too many active members');
    };

    // Track newly-active members (used for system messages + client UX).
    // Only meaningful for addMembers.
    let addedSubs = [];

    if (op === 'setName') {
      const name = normalizeGroupName(body.name);
      if (name.length > MAX_GROUP_NAME_LEN) {
        return json(400, { message: `Group name too long (max ${MAX_GROUP_NAME_LEN} characters)` });
      }
      await ddb.send(
        new UpdateCommand({
          TableName: groupsTable,
          Key: { groupId },
          UpdateExpression: name ? 'SET groupName = :n, updatedAt = :u' : 'REMOVE groupName SET updatedAt = :u',
          ExpressionAttributeValues: { ...(name ? { ':n': name } : {}), ':u': nowMs },
        })
      );
    } else if (op === 'addMembers') {
      const usernamesRaw = Array.isArray(body.usernames) ? body.usernames : [];
      const usernames = uniq(usernamesRaw).map((s) => s.toLowerCase());
      if (!usernames.length) return json(400, { message: 'usernames required' });

      const toAddSubs = [];
      for (const uname of usernames) {
        // eslint-disable-next-line no-await-in-loop
        const u = await getUserByUsernameLower(usersTable, uname);
        if (!u) return json(404, { message: `User not found: ${uname}` });
        const sub = safeString(u.userSub);
        if (!sub) return json(500, { message: 'Malformed Users row (missing userSub)' });
        const pk = safeString(u.currentPublicKey);
        if (!pk) return json(409, { message: `User not ready for encrypted chats: ${uname}` });
        toAddSubs.push(sub);
      }

      const uniqueSubs = uniq(toAddSubs);
      const nextActiveSet = new Set(activeBefore);
      for (const s of uniqueSubs) nextActiveSet.add(s);
      requireActiveLimit(nextActiveSet.size);

      for (const memberSub of uniqueSubs) {
        // eslint-disable-next-line no-await-in-loop
        const existing = await getMemberRow(groupMembersTable, groupId, memberSub);
        const status = safeString(existing?.status);
        if (status === 'banned') return json(409, { message: 'User is banned from this group' });
        if (existing) {
          await ddb.send(
            new UpdateCommand({
              TableName: groupMembersTable,
              Key: { groupId, memberSub },
              UpdateExpression: 'SET #s = :s, joinedAt = :j, addedBySub = :a, updatedAt = :u REMOVE leftAt',
              ExpressionAttributeNames: { '#s': 'status' },
              ExpressionAttributeValues: { ':s': 'active', ':j': nowMs, ':a': callerSub, ':u': nowMs },
            })
          );
        } else {
          await ddb.send(
            new PutCommand({
              TableName: groupMembersTable,
              Item: { groupId, memberSub, status: 'active', isAdmin: false, joinedAt: nowMs, addedBySub: callerSub },
            })
          );
        }
      }
      // We'll compute addedSubs after we re-fetch members at the end (authoritative).
    } else if (op === 'removeMembers') {
      const memberSubsRaw = Array.isArray(body.memberSubs) ? body.memberSubs : [];
      const usernamesRaw = Array.isArray(body.usernames) ? body.usernames : [];
      const memberSubs = uniq(memberSubsRaw);
      const usernames = uniq(usernamesRaw).map((s) => s.toLowerCase());
      const resolvedSubs = [];
      for (const uname of usernames) {
        // eslint-disable-next-line no-await-in-loop
        const u = await getUserByUsernameLower(usersTable, uname);
        if (!u) return json(404, { message: `User not found: ${uname}` });
        resolvedSubs.push(safeString(u.userSub));
      }
      const toRemove = uniq([...memberSubs, ...resolvedSubs]).filter(Boolean);
      if (!toRemove.length) return json(400, { message: 'memberSubs or usernames required' });
      for (const memberSub of toRemove) {
        if (memberSub === callerSub) continue;
        // eslint-disable-next-line no-await-in-loop
        const existing = await getMemberRow(groupMembersTable, groupId, memberSub);
        if (!existing) continue;
        await ddb.send(
          new UpdateCommand({
            TableName: groupMembersTable,
            Key: { groupId, memberSub },
            UpdateExpression: 'SET #s = :s, leftAt = :t, updatedAt = :u',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: { ':s': 'left', ':t': nowMs, ':u': nowMs },
          })
        );
      }
    } else if (op === 'promoteAdmin' || op === 'demoteAdmin') {
      const memberSub = safeString(body.memberSub);
      if (!memberSub) return json(400, { message: 'memberSub required' });
      await ddb.send(
        new UpdateCommand({
          TableName: groupMembersTable,
          Key: { groupId, memberSub },
          UpdateExpression: 'SET isAdmin = :a, updatedAt = :u',
          ExpressionAttributeValues: { ':a': op === 'promoteAdmin', ':u': nowMs },
          ConditionExpression: 'attribute_exists(memberSub)',
        })
      );
    } else if (op === 'ban' || op === 'unban') {
      const memberSub = safeString(body.memberSub);
      if (!memberSub) return json(400, { message: 'memberSub required' });
      if (memberSub === callerSub) return json(400, { message: 'Cannot ban yourself' });
      if (op === 'ban') {
        await ddb.send(
          new UpdateCommand({
            TableName: groupMembersTable,
            Key: { groupId, memberSub },
            UpdateExpression: 'SET #s = :s, bannedAt = :t, updatedAt = :u REMOVE leftAt',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: { ':s': 'banned', ':t': nowMs, ':u': nowMs },
            ConditionExpression: 'attribute_exists(memberSub)',
          })
        );
      } else {
        await ddb.send(
          new UpdateCommand({
            TableName: groupMembersTable,
            Key: { groupId, memberSub },
            UpdateExpression: 'SET #s = :s, leftAt = :t, updatedAt = :u REMOVE bannedAt',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: { ':s': 'left', ':t': nowMs, ':u': nowMs },
            ConditionExpression: 'attribute_exists(memberSub)',
          })
        );
      }
    } else {
      return json(400, { message: `Unknown op: ${op}` });
    }

    const membersAfter = await listMembers(groupMembersTable, groupId);
    const activeAfter = membersAfter
      .filter((m) => safeString(m.status) === 'active')
      .map((m) => safeString(m.memberSub))
      .filter(Boolean)
      .sort();
    if (activeAfter.length < 2) return json(409, { message: 'Group must have at least 2 active members' });
    if (activeAfter.length > 8) return json(409, { message: 'Too many active members' });

    const rosterKey = buildRosterKey(activeAfter);
    await ddb
      .send(
        new UpdateCommand({
          TableName: groupsTable,
          Key: { groupId },
          UpdateExpression: 'SET rosterKey = :r, updatedAt = :u',
          ExpressionAttributeValues: { ':r': rosterKey, ':u': nowMs },
        })
      )
      .catch(() => {});

    // Re-fetch group so we have latest groupName after setName.
    const groupAfterResp = await ddb.send(new GetCommand({ TableName: groupsTable, Key: { groupId } }));
    const groupAfter = groupAfterResp.Item || group;
    const groupNameAfter = safeString(groupAfter.groupName);
    const groupUpdatedAt = typeof groupAfter.updatedAt === 'number' ? groupAfter.updatedAt : nowMs;

    const profilesBySub = await hydrateProfiles(usersTable, activeAfter);
    const groupTitleFor = (memberSub) =>
      buildTitleForMember({ groupName: groupNameAfter || undefined, memberSub, activeSubs: activeAfter, profilesBySub });

    // Update conversation index for all members (active + left + banned).
    await Promise.all(
      membersAfter.map((m) =>
        upsertConversationIndex({
          conversationsTable,
          ownerSub: m.memberSub,
          conversationId: convId,
          peerDisplayName: groupTitleFor(m.memberSub),
          lastMessageAt: Number(groupUpdatedAt || 0) || 0,
          lastSenderSub: undefined,
          lastSenderDisplayName: undefined,
          memberStatus: safeString(m.status) || undefined,
        })
      )
    );

    // If the group name changed, keep any existing unread hint titles in sync too.
    // (This helps "unread messages from <group>" show the new name even before entering the chat.)
    if (op === 'setName' && unreadTable) {
      await Promise.all(
        membersAfter.map((m) =>
          updateUnreadTitleIfExists({
            unreadTable,
            recipientSub: m.memberSub,
            conversationId: convId,
            groupTitle: groupTitleFor(m.memberSub),
          })
        )
      );
    }

    // Unread "added" for newly active members.
    if (op === 'addMembers' && unreadTable) {
      const beforeSet = new Set(activeBefore);
      const newlyActive = activeAfter.filter((s) => !beforeSet.has(s) && s !== callerSub);
      addedSubs = newlyActive.slice();
      await Promise.all(
        newlyActive.map((s) =>
          markUnreadAdded({
            unreadTable,
            recipientSub: s,
            conversationId: convId,
            groupTitle: groupTitleFor(s),
            addedBySub: callerSub,
          })
        )
      );
    }

    return json(200, { ok: true, ...(op === 'addMembers' ? { addedSubs } : {}) });
  } catch (err) {
    console.error('groupUpdate error', err);
    if (String(err?.name || '').includes('ConditionalCheckFailed')) return json(404, { message: 'Not found' });
    if (String(err?.message || '').includes('Too many active members')) return json(409, { message: 'Too many members' });
    return json(500, { message: 'Internal error' });
  }
};

