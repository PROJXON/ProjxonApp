// HTTP API (payload v2) Lambda: POST /channels/join
// Join a public channel by channelId (or nameLower).
//
// Notes:
// - Guests cannot join (JWT required).
// - Private channels are not joinable via this endpoint (must already be a member).
// - Passwords are join-time gates only (server validates once on join).
//
// Env:
// - CHANNELS_TABLE (required)
// - CHANNEL_MEMBERS_TABLE (required)
// - CHANNELS_NAME_GSI (optional, default "byNameLower")
//
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
} = require('@aws-sdk/lib-dynamodb');

// Lambda Layer import (required):
// - Layer must contain: /opt/nodejs/lib/channels.js
const channelsLib = require('../../lib/channels.js');
if (!channelsLib || typeof channelsLib.verifyPassword !== 'function' || typeof channelsLib.normalizeChannelKey !== 'function') {
  throw new Error(
    'Channels layer is missing required exports (verifyPassword/normalizeChannelKey). Publish the latest channels-lib-layer.zip and attach the updated Layer version to this Lambda.'
  );
}
const { verifyPassword, normalizeChannelKey } = channelsLib;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const safeString = (v) => (typeof v === 'string' ? String(v).trim() : '');
const json = (statusCode, bodyObj) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(bodyObj),
});

function publicRankSk(activeMemberCount, channelId) {
  const CAP = 999_999_999_999;
  const c = Math.max(0, Math.floor(Number(activeMemberCount) || 0));
  const r = Math.max(0, CAP - c);
  const left = String(r).padStart(12, '0');
  const id = safeString(channelId);
  return `${left}#${id}`;
}

async function getChannelByIdOrNameLower({ channelsTable, channelId, nameLower }) {
  const id = safeString(channelId);
  if (id) {
    const resp = await ddb.send(new GetCommand({ TableName: channelsTable, Key: { channelId: id } }));
    return resp.Item || null;
  }
  const n = normalizeChannelKey(nameLower);
  if (!n) return null;
  const gsi = safeString(process.env.CHANNELS_NAME_GSI) || 'byNameLower';
  try {
    const resp = await ddb.send(
      new QueryCommand({
        TableName: channelsTable,
        IndexName: gsi,
        KeyConditionExpression: 'nameLower = :n',
        ExpressionAttributeValues: { ':n': n },
        Limit: 1,
      })
    );
    return resp.Items?.[0] || null;
  } catch {
    return null;
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

  const channelId = safeString(body.channelId);
  const nameLower = safeString(body.nameLower || body.name);
  const password = safeString(body.password);

  try {
    const channel = await getChannelByIdOrNameLower({ channelsTable, channelId, nameLower });
    if (!channel) return json(404, { message: 'Channel not found' });
    if (typeof channel.deletedAt === 'number' && Number.isFinite(channel.deletedAt) && channel.deletedAt > 0) {
      return json(404, { message: 'Channel not found' });
    }
    const cid = safeString(channel.channelId);
    if (!cid) return json(500, { message: 'Malformed channel row' });

    if (!channel.isPublic) return json(403, { message: 'Channel is private' });

    const hasPassword = !!channel.hasPassword;
    if (hasPassword) {
      // Treat *any* failure here as an incorrect password.
      // This avoids leaking implementation details and also protects against older Layer versions
      // where verifyPassword might throw on unexpected formats.
      let ok = false;
      try {
        ok = verifyPassword(password, safeString(channel.passwordHash));
      } catch {
        ok = false;
      }
      if (!ok) return json(403, { message: 'Incorrect channel password' });
    }

    const nowMs = Date.now();

    const memResp = await ddb.send(
      new GetCommand({
        TableName: membersTable,
        Key: { channelId: cid, memberSub: callerSub },
      })
    );
    const existing = memResp.Item || null;
    const prevStatus = safeString(existing?.status);
    if (prevStatus === 'banned') return json(403, { message: 'You are banned from this channel' });

    const becameActive = prevStatus !== 'active';

    if (!existing) {
      await ddb.send(
        new PutCommand({
          TableName: membersTable,
          Item: {
            channelId: cid,
            memberSub: callerSub,
            status: 'active',
            isAdmin: false,
            joinedAt: nowMs,
            updatedAt: nowMs,
          },
        })
      );
    } else if (becameActive) {
      await ddb.send(
        new UpdateCommand({
          TableName: membersTable,
          Key: { channelId: cid, memberSub: callerSub },
          UpdateExpression: 'SET #s = :s, joinedAt = :j, updatedAt = :u REMOVE leftAt, bannedAt',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: { ':s': 'active', ':j': nowMs, ':u': nowMs },
        })
      );
    }

    if (becameActive) {
      await ddb
        .send(
          new UpdateCommand({
            TableName: channelsTable,
            Key: { channelId: cid },
            UpdateExpression: channel.isPublic
              ? 'SET activeMemberCount = if_not_exists(activeMemberCount, :z) + :inc, publicIndexPk = :pk, publicRankSk = :sk, updatedAt = :u'
              : 'SET activeMemberCount = if_not_exists(activeMemberCount, :z) + :inc, updatedAt = :u',
            ExpressionAttributeValues: channel.isPublic
              ? {
                  ':z': 0,
                  ':inc': 1,
                  ':u': nowMs,
                  ':pk': 'public',
                  ':sk': publicRankSk((typeof channel.activeMemberCount === 'number' ? channel.activeMemberCount : 0) + 1, cid),
                }
              : { ':z': 0, ':inc': 1, ':u': nowMs },
          })
        )
        .catch(() => {});
    }

    return json(200, {
      ok: true,
      channel: {
        channelId: cid,
        conversationId: `ch#${cid}`,
        name: safeString(channel.name),
        nameLower: safeString(channel.nameLower),
        isPublic: !!channel.isPublic,
        hasPassword: !!channel.hasPassword,
      },
      joined: becameActive,
    });
  } catch (err) {
    console.error('channelsJoin error', err);
    const name = String(err?.name || '');
    const msg = String(err?.message || '');
    const combined = `${name} ${msg}`.trim();
    // Most common cause in dev: missing DynamoDB permissions on the Lambda role
    // (AccessDeniedException / not authorized to perform dynamodb:...).
    if (/AccessDenied|not authorized|UnauthorizedOperation/i.test(combined)) {
      return json(500, { message: 'Access denied (check channelsJoin IAM policy for DynamoDB permissions)' });
    }
    // Another common cause in manual copy/paste deployments: missing ./lib/channels.js in the Lambda.
    if (/Cannot find module|MODULE_NOT_FOUND/i.test(combined)) {
      return json(500, { message: 'Missing lib/channels.js in Lambda (fix require path / add lib file)' });
    }
    return json(500, { message: 'Internal error' });
  }
};

