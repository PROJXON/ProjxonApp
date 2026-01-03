// HTTP API (payload v2) Lambda: GET /groups/get?conversationId=gdm#<groupId>
// Returns group DM metadata + member list for UI (admins, statuses).
//
// Env:
// - GROUPS_TABLE (required): PK groupId
// - GROUP_MEMBERS_TABLE (required): PK groupId, SK memberSub
// - USERS_TABLE (required): PK userSub (used to hydrate displayName/avatar for members)
//
// Auth: JWT (Cognito). Reads sub from requestContext.authorizer.jwt.claims.sub
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  BatchGetCommand,
} = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const safeString = (v) => (typeof v === 'string' ? String(v).trim() : '');

const json = (statusCode, bodyObj) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(bodyObj),
});

const parseGroupConversationId = (conversationId) => {
  const c = safeString(conversationId);
  if (!c.startsWith('gdm#')) return null;
  const groupId = c.slice('gdm#'.length).trim();
  if (!groupId) return null;
  return { groupId };
};

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method;
  if (method !== 'GET') return json(405, { message: 'Method not allowed' });

  const callerSub = safeString(event.requestContext?.authorizer?.jwt?.claims?.sub);
  if (!callerSub) return json(401, { message: 'Unauthorized' });

  const groupsTable = safeString(process.env.GROUPS_TABLE);
  const groupMembersTable = safeString(process.env.GROUP_MEMBERS_TABLE);
  const usersTable = safeString(process.env.USERS_TABLE);
  if (!groupsTable) return json(500, { message: 'GROUPS_TABLE not configured' });
  if (!groupMembersTable) return json(500, { message: 'GROUP_MEMBERS_TABLE not configured' });
  if (!usersTable) return json(500, { message: 'USERS_TABLE not configured' });

  const qs = event.queryStringParameters || {};
  const convId = safeString(qs.conversationId);
  const parsed = parseGroupConversationId(convId);
  if (!parsed) return json(400, { message: 'Invalid conversationId (expected gdm#<groupId>)' });

  try {
    const groupId = parsed.groupId;

    const [groupResp, membersResp] = await Promise.all([
      ddb.send(new GetCommand({ TableName: groupsTable, Key: { groupId } })),
      ddb.send(
        new QueryCommand({
          TableName: groupMembersTable,
          KeyConditionExpression: 'groupId = :g',
          ExpressionAttributeValues: { ':g': groupId },
          Limit: 50,
        })
      ),
    ]);

    const group = groupResp.Item;
    if (!group) return json(404, { message: 'Group not found' });

    const membersRaw = Array.isArray(membersResp.Items) ? membersResp.Items : [];
    const memberRows = membersRaw
      .map((it) => ({
        memberSub: safeString(it.memberSub),
        status: safeString(it.status) || 'active',
        isAdmin: !!it.isAdmin,
        joinedAt: typeof it.joinedAt === 'number' ? it.joinedAt : undefined,
        leftAt: typeof it.leftAt === 'number' ? it.leftAt : undefined,
        bannedAt: typeof it.bannedAt === 'number' ? it.bannedAt : undefined,
      }))
      .filter((m) => m.memberSub);

    const myMember = memberRows.find((m) => m.memberSub === callerSub) || null;
    if (!myMember) return json(403, { message: 'Forbidden' });

    // Hydrate member display fields (best-effort).
    const subs = memberRows.map((m) => m.memberSub);
    let profilesBySub = new Map();
    try {
      const resp = await ddb.send(
        new BatchGetCommand({
          RequestItems: {
            [usersTable]: {
              Keys: subs.map((s) => ({ userSub: s })),
              ProjectionExpression: 'userSub, displayName, usernameLower, avatarBgColor, avatarTextColor, avatarImagePath',
            },
          },
        })
      );
      const items = resp.Responses?.[usersTable] || [];
      profilesBySub = new Map(
        items.map((it) => [
          safeString(it.userSub),
          {
            displayName: safeString(it.displayName || it.usernameLower || it.userSub) || 'anon',
            usernameLower: it.usernameLower ? safeString(it.usernameLower) : undefined,
            avatarBgColor: it.avatarBgColor ? safeString(it.avatarBgColor) : undefined,
            avatarTextColor: it.avatarTextColor ? safeString(it.avatarTextColor) : undefined,
            avatarImagePath: it.avatarImagePath ? safeString(it.avatarImagePath) : undefined,
          },
        ])
      );
    } catch {
      // ignore
    }

    const members = memberRows.map((m) => {
      const prof = profilesBySub.get(m.memberSub) || {};
      return {
        memberSub: m.memberSub,
        status: m.status,
        isAdmin: !!m.isAdmin,
        joinedAt: m.joinedAt,
        leftAt: m.leftAt,
        bannedAt: m.bannedAt,
        displayName: prof.displayName,
        usernameLower: prof.usernameLower,
        avatarBgColor: prof.avatarBgColor,
        avatarTextColor: prof.avatarTextColor,
        avatarImagePath: prof.avatarImagePath,
      };
    });

    return json(200, {
      conversationId: convId,
      groupId,
      groupName: group.groupName ? safeString(group.groupName) : undefined,
      createdBySub: group.createdBySub ? safeString(group.createdBySub) : undefined,
      createdAt: typeof group.createdAt === 'number' ? group.createdAt : undefined,
      me: { status: myMember.status, isAdmin: !!myMember.isAdmin },
      members,
    });
  } catch (err) {
    console.error('getGroup error', err);
    return json(500, { message: 'Internal error' });
  }
};

