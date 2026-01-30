// HTTP API (payload v2) Lambda: GET /channels/search?q=...
// Public-safe search/list endpoint for channels.
//
// Behavior:
// - If called WITHOUT JWT (public route): returns public channels only.
// - If called WITH JWT: returns public channels + any channels the caller is an active member of (including private).
//
// Env:
// - CHANNELS_TABLE (required): PK channelId
// - CHANNEL_MEMBERS_TABLE (optional): PK channelId, SK memberSub (needed to include private member channels)
// - CHANNEL_MEMBERS_BY_MEMBER_GSI (optional, default "byMemberSub"): GSI with PK memberSub to list a user's channels
// - STATS_TABLE (optional): PK statKey. If present, response includes globalUserCount from { statKey:"app", userCount:number }.
//
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  GetCommand,
  ScanCommand,
  QueryCommand,
  BatchGetCommand,
} = require('@aws-sdk/lib-dynamodb');

// Lambda Layer import (required):
// - Layer must contain: /opt/nodejs/lib/channels.js
const channelsLib = require('../../lib/channels.js');
if (!channelsLib || typeof channelsLib.normalizeChannelKey !== 'function') {
  throw new Error(
    'Channels layer is missing required export (normalizeChannelKey). Publish the latest channels-lib-layer.zip and attach the updated Layer version to this Lambda.'
  );
}
const { normalizeChannelKey } = channelsLib;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const safeString = (v) => (typeof v === 'string' ? String(v).trim() : '');

const json = (statusCode, bodyObj) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(bodyObj),
});

function toInt(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function normalizeQuery(q) {
  const s = safeString(q).toLowerCase();
  if (!s) return '';
  // match the stored nameLower canonical key
  return normalizeChannelKey(s);
}

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method;
  if (method !== 'GET') return json(405, { message: 'Method not allowed' });

  const channelsTable = safeString(process.env.CHANNELS_TABLE);
  if (!channelsTable) return json(500, { message: 'CHANNELS_TABLE not configured' });

  const callerSub = safeString(event.requestContext?.authorizer?.jwt?.claims?.sub);
  const membersTable = safeString(process.env.CHANNEL_MEMBERS_TABLE);
  const statsTable = safeString(process.env.STATS_TABLE);

  const qs = event.queryStringParameters || {};
  const q = normalizeQuery(qs.q);
  const limitRaw = Number(qs.limit ?? 50);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 50;

  try {
    // Best-effort global user count (for Global chip).
    let globalUserCount = null;
    if (statsTable) {
      try {
        const resp = await ddb.send(
          new GetCommand({
            TableName: statsTable,
            Key: { statKey: 'app' },
            ProjectionExpression: 'userCount',
          })
        );
        const n = resp?.Item?.userCount;
        if (typeof n === 'number' && Number.isFinite(n) && n >= 0) globalUserCount = Math.floor(n);
      } catch {
        // ignore
      }
    }

    // 1) Public channels
    // - If q is empty: use a ranked GSI (cheap + ordered).
    // - If q is present (contains search): Scan (substring match), then sort by member count.
    let publicResp;
    if (!q) {
      const publicRankGsi = safeString(process.env.CHANNELS_PUBLIC_RANK_GSI) || 'byPublicRank';
      try {
        const resp = await ddb.send(
          new QueryCommand({
            TableName: channelsTable,
            IndexName: publicRankGsi,
            KeyConditionExpression: 'publicIndexPk = :p',
            ExpressionAttributeValues: { ':p': 'public' },
            ScanIndexForward: true, // rank SK encodes highest members first
            Limit: limit,
          })
        );
        // If the index is active but older channels haven't been backfilled yet,
        // this query can return 0 items. In that case, fall back to scan so users
        // still see public channels during dev/backfill.
        if (Array.isArray(resp?.Items) && resp.Items.length > 0) publicResp = resp;
      } catch {
        // Fallback to scan if the index isn't set up yet.
      }
    }
    if (!publicResp) {
      const filterParts = ['attribute_not_exists(deletedAt)', 'isPublic = :p'];
      const values = { ':p': true };
      if (q) {
        filterParts.push('contains(nameLower, :q)');
        values[':q'] = q;
      }
      publicResp = await ddb.send(
        new ScanCommand({
          TableName: channelsTable,
          FilterExpression: filterParts.join(' AND '),
          ExpressionAttributeValues: values,
          Limit: limit,
        })
      );
    }

    // Hide password-protected channels from discovery unless the query matches exactly.
    // Rationale: password channels act like "semi-private" rooms; you should already know the exact name to try joining.
    const publicChannels = (publicResp.Items || [])
      .map((it) => ({
        channelId: safeString(it.channelId),
        name: safeString(it.name),
        nameLower: safeString(it.nameLower),
        isPublic: !!it.isPublic,
        hasPassword: !!it.hasPassword,
        activeMemberCount: typeof it.activeMemberCount === 'number' ? it.activeMemberCount : undefined,
      }))
      .filter((c) => c.channelId && c.name)
      .filter((c) => {
        if (!c.hasPassword) return true;
        // If there's no query, don't show password channels in the public list.
        if (!q) return false;
        // Only reveal password channels when the search key matches exactly.
        return String(c.nameLower || '') === String(q || '');
      });

    // 2) Private/member channels (only for authed callers)
    let memberChannels = [];
    if (callerSub && membersTable) {
      try {
        const gsi = safeString(process.env.CHANNEL_MEMBERS_BY_MEMBER_GSI) || 'byMemberSub';
        const memResp = await ddb.send(
          new QueryCommand({
            TableName: membersTable,
            IndexName: gsi,
            KeyConditionExpression: 'memberSub = :u',
            ExpressionAttributeValues: { ':u': callerSub },
            ProjectionExpression: 'channelId, #s',
            ExpressionAttributeNames: { '#s': 'status' },
            Limit: 200,
          })
        );
        const channelIds = (memResp.Items || [])
          .filter((m) => safeString(m?.status) === 'active')
          .map((m) => safeString(m?.channelId))
          .filter(Boolean);

        const unique = Array.from(new Set(channelIds)).slice(0, 100);
        if (unique.length) {
          const resp = await ddb.send(
            new BatchGetCommand({
              RequestItems: {
                [channelsTable]: {
                  Keys: unique.map((id) => ({ channelId: id })),
                },
              },
            })
          );
          const items = resp.Responses?.[channelsTable] || [];
          memberChannels = items
            .filter((it) => !(typeof it.deletedAt === 'number' && Number.isFinite(it.deletedAt) && it.deletedAt > 0))
            .filter((it) => (q ? safeString(it.nameLower).includes(q) : true))
            .map((it) => ({
              channelId: safeString(it.channelId),
              name: safeString(it.name),
              nameLower: safeString(it.nameLower),
              isPublic: !!it.isPublic,
              hasPassword: !!it.hasPassword,
              activeMemberCount: typeof it.activeMemberCount === 'number' ? it.activeMemberCount : undefined,
              isMember: true,
            }))
            .filter((c) => c.channelId && c.name);
        }
      } catch {
        // ignore; still return public channels
      }
    }

    const byId = new Map();
    for (const c of publicChannels) byId.set(c.channelId, { ...c, isMember: false });
    for (const c of memberChannels) byId.set(c.channelId, { ...byId.get(c.channelId), ...c, isMember: true });

    // Order: most members first. Ties: stable by nameLower.
    const out = Array.from(byId.values())
      .filter((c) => c && c.channelId)
      .sort((a, b) => {
        const ac = toInt(a.activeMemberCount, 0);
        const bc = toInt(b.activeMemberCount, 0);
        if (bc !== ac) return bc - ac;
        return String(a.nameLower || '').localeCompare(String(b.nameLower || ''));
      })
      .slice(0, limit);

    return json(200, { channels: out, globalUserCount });
  } catch (err) {
    console.error('channelsSearch error', err);
    return json(500, { message: 'Internal error' });
  }
};

