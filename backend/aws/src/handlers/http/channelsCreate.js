// HTTP API (payload v2) Lambda: POST /channels/create
// Creates a new channel (plaintext, app-wide room).
//
// Global is special and is NOT created here (conversationId="global").
//
// Env:
// - CHANNELS_TABLE (required): PK channelId
// - CHANNEL_MEMBERS_TABLE (required): PK channelId, SK memberSub
// - CHANNELS_NAME_GSI (optional, default "byNameLower"): GSI with PK nameLower for uniqueness check
//
// Auth: JWT (Cognito). Reads sub from requestContext.authorizer.jwt.claims.sub
const crypto = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  ScanCommand,
} = require('@aws-sdk/lib-dynamodb');

// Lambda Layer import (required):
// - Layer must contain: /opt/nodejs/lib/channels.js
const channelsLib = require('../../lib/channels.js');
if (!channelsLib || typeof channelsLib.hashPassword !== 'function' || typeof channelsLib.validateChannelName !== 'function') {
  throw new Error(
    'Channels layer is missing required exports (hashPassword/validateChannelName). Publish the latest channels-lib-layer.zip and attach the updated Layer version to this Lambda.'
  );
}
const { hashPassword, validateChannelName } = channelsLib;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const safeString = (v) => (typeof v === 'string' ? String(v).trim() : '');

function publicRankSk(activeMemberCount, channelId) {
  // For DynamoDB GSI ordering: lexicographic ascending.
  // Lower rank => more members. We encode: (CAP - count) zero-padded + '#' + channelId.
  const CAP = 999_999_999_999; // supports huge counts while keeping fixed width
  const c = Math.max(0, Math.floor(Number(activeMemberCount) || 0));
  const r = Math.max(0, CAP - c);
  const left = String(r).padStart(12, '0');
  const id = safeString(channelId);
  return `${left}#${id}`;
}

const json = (statusCode, bodyObj) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(bodyObj),
});

const newId = () => {
  try {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // ignore
  }
  return crypto.randomBytes(16).toString('hex');
};

async function nameLowerExists({ channelsTable, nameLower, gsiName }) {
  if (!channelsTable || !nameLower) return false;
  const idx = safeString(gsiName) || 'byNameLower';
  try {
    const resp = await ddb.send(
      new QueryCommand({
        TableName: channelsTable,
        IndexName: idx,
        KeyConditionExpression: 'nameLower = :n',
        ExpressionAttributeValues: { ':n': nameLower },
        Limit: 1,
      })
    );
    const it = resp.Items?.[0];
    if (!it) return false;
    if (typeof it.deletedAt === 'number' && Number.isFinite(it.deletedAt) && it.deletedAt > 0) return false;
    return true;
  } catch {
    // Fallback: scan (small-scale safe)
    const resp = await ddb.send(
      new ScanCommand({
        TableName: channelsTable,
        FilterExpression: 'nameLower = :n AND attribute_not_exists(deletedAt)',
        ExpressionAttributeValues: { ':n': nameLower },
        Limit: 1,
      })
    );
    return !!resp.Items?.[0];
  }
}

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method;
  if (method !== 'POST') return json(405, { message: 'Method not allowed' });

  const callerSub = safeString(event.requestContext?.authorizer?.jwt?.claims?.sub);
  if (!callerSub) return json(401, { message: 'Unauthorized' });

  const channelsTable = safeString(process.env.CHANNELS_TABLE);
  const membersTable = safeString(process.env.CHANNEL_MEMBERS_TABLE);
  if (!channelsTable) return json(500, { message: 'CHANNELS_TABLE not configured' });
  if (!membersTable) return json(500, { message: 'CHANNEL_MEMBERS_TABLE not configured' });

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { message: 'Invalid JSON body' });
  }

  const name = safeString(body.name);
  const v = validateChannelName(name);
  if (!v.ok) return json(400, { message: v.message });
  const { name: displayName, nameLower } = v;

  const isPublic = body.isPublic !== false; // default true
  const password = safeString(body.password);
  const passwordHash = password ? hashPassword(password) : null;
  const hasPassword = !!passwordHash;

  const nowMs = Date.now();
  const channelId = newId();
  const gsiName = safeString(process.env.CHANNELS_NAME_GSI) || 'byNameLower';

  try {
    const exists = await nameLowerExists({ channelsTable, nameLower, gsiName });
    if (exists) return json(409, { message: 'Channel name already exists' });

    // Create channel row
    await ddb.send(
      new PutCommand({
        TableName: channelsTable,
        Item: {
          channelId,
          name: displayName,
          nameLower,
          isPublic: !!isPublic,
          hasPassword,
          ...(hasPassword ? { passwordHash } : {}),
          ...(isPublic
            ? {
                publicIndexPk: 'public',
                publicRankSk: publicRankSk(1, channelId),
              }
            : {}),
          createdBySub: callerSub,
          createdAt: nowMs,
          updatedAt: nowMs,
          activeMemberCount: 1,
        },
        ConditionExpression: 'attribute_not_exists(channelId)',
      })
    );

    // Creator becomes admin + active member.
    await ddb.send(
      new PutCommand({
        TableName: membersTable,
        Item: {
          channelId,
          memberSub: callerSub,
          status: 'active',
          isAdmin: true,
          joinedAt: nowMs,
          updatedAt: nowMs,
        },
      })
    );

    return json(200, {
      ok: true,
      channel: {
        channelId,
        conversationId: `ch#${channelId}`,
        name: displayName,
        nameLower,
        isPublic: !!isPublic,
        hasPassword,
        activeMemberCount: 1,
        createdAt: nowMs,
        createdBySub: callerSub,
      },
    });
  } catch (err) {
    console.error('channelsCreate error', err);
    if (String(err?.name || '').includes('ConditionalCheckFailed')) return json(409, { message: 'Channel already exists' });
    return json(500, { message: 'Internal error' });
  }
};

