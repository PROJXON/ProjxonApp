const crypto = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function urlSafeBase64(inputB64) {
  return String(inputB64 || '')
    .replace(/\+/g, '-')
    .replace(/=/g, '_')
    .replace(/\//g, '~');
}

function parseDmConversationId(convId) {
  const raw = String(convId || '').trim();
  if (!raw.startsWith('dm#')) return null;
  const parts = raw
    .split('#')
    .map((p) => String(p).trim())
    .filter(Boolean);
  if (parts.length !== 3) return null;
  return { a: parts[1], b: parts[2] };
}

function parseGroupConversationId(convId) {
  const raw = String(convId || '').trim();
  if (!raw.startsWith('gdm#')) return null;
  const groupId = raw.slice('gdm#'.length).trim();
  if (!groupId) return null;
  return { groupId };
}

function normalizePem(s) {
  let t = String(s || '').trim();
  if (!t) return '';

  // Allow base64-encoded PEM to be passed too.
  if (!t.startsWith('-----BEGIN')) {
    try {
      const decoded = Buffer.from(t, 'base64').toString('utf8');
      if (decoded && decoded.startsWith('-----BEGIN')) {
        t = decoded.trim();
      }
    } catch {
      // ignore
    }
  }

  if (!t.startsWith('-----BEGIN')) return t;
  t = t.replace(/\r/g, '');

  // If the PEM was pasted as a single line with spaces, reconstruct it.
  if (!t.includes('\n')) {
    const m = t.match(/-----BEGIN ([^-]+)-----([\s\S]+)-----END \1-----/);
    if (m) {
      const label = m[1];
      const bodyRaw = m[2] || '';
      const body = bodyRaw.replace(/\s+/g, '');
      const wrapped = (body.match(/.{1,64}/g) || []).join('\n') || body;
      return `-----BEGIN ${label}-----\n${wrapped}\n-----END ${label}-----`;
    }
  }

  return t;
}

// POST /media/dm/signed-url
// Body: { path: "uploads/dm/<conversationId>/...", ttlSeconds?: number }
//
// Env:
// - CDN_URL (required): e.g. https://d123.cloudfront.net
// - CLOUDFRONT_KEY_PAIR_ID (required)
// - CLOUDFRONT_PRIVATE_KEY_PEM (required): RSA private key PEM
exports.handler = async (event) => {
  try {
    const claims = event.requestContext?.authorizer?.jwt?.claims || {};
    const sub = typeof claims.sub === 'string' ? String(claims.sub).trim() : '';
    if (!sub) return { statusCode: 401, body: JSON.stringify({ message: 'Unauthorized' }) };

    const CDN_URL = String(process.env.CDN_URL || '').trim();
    const KEY_PAIR_ID = String(process.env.CLOUDFRONT_KEY_PAIR_ID || '').trim();
    const PRIVATE_KEY_PEM = normalizePem(process.env.CLOUDFRONT_PRIVATE_KEY_PEM);
    if (!CDN_URL) return { statusCode: 500, body: JSON.stringify({ message: 'Server misconfigured: CDN_URL missing' }) };
    if (!KEY_PAIR_ID) {
      return { statusCode: 500, body: JSON.stringify({ message: 'Server misconfigured: CLOUDFRONT_KEY_PAIR_ID missing' }) };
    }
    if (!PRIVATE_KEY_PEM) {
      return { statusCode: 500, body: JSON.stringify({ message: 'Server misconfigured: CLOUDFRONT_PRIVATE_KEY_PEM missing' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const path = typeof body.path === 'string' ? String(body.path).replace(/^\/+/, '') : '';
    if (!path.startsWith('uploads/dm/')) {
      return { statusCode: 400, body: JSON.stringify({ message: 'path must start with uploads/dm/' }) };
    }

    // Authorize:
    // - 1:1 DM conversationId format is "dm#<minSub>#<maxSub>"
    // - Group DM conversationId format is "gdm#<groupId>"
    // Media is stored under: uploads/dm/<conversationId>/...
    const rest = path.slice('uploads/dm/'.length);
    const slashIdx = rest.indexOf('/');
    const conversationId = slashIdx >= 0 ? rest.slice(0, slashIdx) : rest;
    const parsedDm = parseDmConversationId(conversationId);
    const parsedGroup = parsedDm ? null : parseGroupConversationId(conversationId);
    if (!parsedDm && !parsedGroup) {
      return { statusCode: 400, body: JSON.stringify({ message: 'Invalid conversationId in path' }) };
    }
    if (parsedDm) {
      if (sub !== parsedDm.a && sub !== parsedDm.b) {
        return { statusCode: 403, body: JSON.stringify({ message: 'Forbidden' }) };
      }
    } else if (parsedGroup) {
      const membersTable = String(process.env.GROUP_MEMBERS_TABLE || '').trim();
      if (!membersTable) {
        return { statusCode: 500, body: JSON.stringify({ message: 'Server misconfigured: GROUP_MEMBERS_TABLE missing' }) };
      }
      const mem = await ddb.send(
        new GetCommand({
          TableName: membersTable,
          Key: { groupId: parsedGroup.groupId, memberSub: sub },
          ProjectionExpression: 'memberSub, #s',
          ExpressionAttributeNames: { '#s': 'status' },
        })
      );
      if (!mem?.Item?.memberSub) {
        return { statusCode: 403, body: JSON.stringify({ message: 'Forbidden' }) };
      }
    }

    // IMPORTANT: DM conversationIds contain '#', which is a URL fragment delimiter.
    // If we build the URL naively, everything after '#' (including query params) may not be sent to CloudFront.
    // So we must ensure '#' is percent-encoded as '%23' in the pathname.
    const baseUrl = new URL(CDN_URL);
    baseUrl.pathname = `/${path}`; // Node will encode unsafe chars in pathname (including '#')
    baseUrl.hash = '';
    baseUrl.search = '';
    const resourceUrl = baseUrl.toString();

    // 5 minutes default (keep short; client can re-request)
    const ttlSeconds = Math.max(30, Math.min(60 * 10, Number(body.ttlSeconds) || 300));
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds;

    // CloudFront "canned policy" signing (RSA-SHA1):
    // Even though we don't send the Policy=... query param, the signature is computed over
    // the JSON policy document (with Resource + DateLessThan).
    const policy = JSON.stringify({
      Statement: [
        {
          Resource: resourceUrl,
          Condition: { DateLessThan: { 'AWS:EpochTime': expires } },
        },
      ],
    });
    const sign = crypto.createSign('RSA-SHA1');
    sign.update(policy, 'utf8');
    const signatureB64 = sign.sign(PRIVATE_KEY_PEM, 'base64');
    const signature = urlSafeBase64(signatureB64);

    const signedUrl = `${resourceUrl}?Expires=${expires}&Signature=${signature}&Key-Pair-Id=${encodeURIComponent(KEY_PAIR_ID)}`;
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ url: signedUrl, expires }),
    };
  } catch (err) {
    console.error('getDmSignedUrl error', err);
    return { statusCode: 500, body: JSON.stringify({ message: 'Internal error' }) };
  }
};

