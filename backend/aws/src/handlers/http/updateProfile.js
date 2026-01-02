const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

// Self-contained best-effort SQS enqueue (so this Lambda can be copy/pasted into AWS).
const DEFAULT_DELETE_ALLOWED_PREFIXES = ['uploads/public/avatars/'];
const normalizeKey = (k) => {
  const s = typeof k === 'string' ? k.trim() : '';
  if (!s) return '';
  if (/^[a-z]+:\/\//i.test(s)) return '';
  return s.replace(/^\/+/, '');
};
const uniq = (arr) => {
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
  const safeKeys = uniq((keys || []).map(normalizeKey))
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

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function normalizeHexColor(input) {
  const s = typeof input === 'string' ? input.trim() : '';
  if (!s) return null;
  const withHash = s.startsWith('#') ? s : `#${s}`;
  // Accept both #RRGGBB and shorthand #RGB, normalize to #RRGGBB uppercase.
  if (/^#[0-9a-fA-F]{6}$/.test(withHash)) return withHash.toUpperCase();
  if (/^#[0-9a-fA-F]{3}$/.test(withHash)) {
    const r = withHash[1];
    const g = withHash[2];
    const b = withHash[3];
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return null;
}

exports.handler = async (event) => {
  try {
    const usersTable = process.env.USERS_TABLE;
    if (!usersTable) {
      return { statusCode: 500, body: JSON.stringify({ message: 'Server misconfigured: USERS_TABLE is not set' }) };
    }

    const claims = event.requestContext?.authorizer?.jwt?.claims || {};
    const sub = typeof claims.sub === 'string' ? String(claims.sub).trim() : '';
    if (!sub) return { statusCode: 401, body: JSON.stringify({ message: 'Unauthorized' }) };

    const body = JSON.parse(event.body || '{}');

    // We accept only explicit fields; omitting a field means "no change".
    // Passing null or empty string means "clear" for that field.
    const bgRaw = Object.prototype.hasOwnProperty.call(body, 'bgColor') ? body.bgColor : undefined;
    const textRaw = Object.prototype.hasOwnProperty.call(body, 'textColor') ? body.textColor : undefined;
    const imgRaw = Object.prototype.hasOwnProperty.call(body, 'imagePath') ? body.imagePath : undefined;

    // Fetch existing avatar path so we can delete the old object when changed/cleared.
    let previousAvatarImagePath = null;
    try {
      const existing = await ddb.send(
        new GetCommand({
          TableName: usersTable,
          Key: { userSub: sub },
          ProjectionExpression: 'avatarImagePath',
        })
      );
      const p = existing?.Item?.avatarImagePath;
      previousAvatarImagePath = typeof p === 'string' ? String(p).trim() : null;
    } catch {
      // best-effort; proceed
    }

    const updates = [];
    const removes = [];
    const values = { ':u': Date.now() };

    // bgColor
    if (bgRaw === null || bgRaw === '') {
      removes.push('avatarBgColor');
    } else if (typeof bgRaw === 'string') {
      const norm = normalizeHexColor(bgRaw);
      if (!norm) return { statusCode: 400, body: JSON.stringify({ message: 'bgColor must be a hex color like #RRGGBB' }) };
      updates.push('avatarBgColor = :bg');
      values[':bg'] = norm;
    }

    // textColor
    if (textRaw === null || textRaw === '') {
      removes.push('avatarTextColor');
    } else if (typeof textRaw === 'string') {
      const norm = normalizeHexColor(textRaw);
      if (!norm) {
        return { statusCode: 400, body: JSON.stringify({ message: 'textColor must be a hex color like #RRGGBB' }) };
      }
      updates.push('avatarTextColor = :tc');
      values[':tc'] = norm;
    }

    // imagePath
    let nextAvatarImagePath = undefined; // undefined => no change; '' => cleared
    if (imgRaw === null || imgRaw === '') {
      removes.push('avatarImagePath');
      nextAvatarImagePath = '';
    } else if (typeof imgRaw === 'string') {
      const path = String(imgRaw).trim();
      // Prevent arbitrary bucket reads; avatars are expected to live under one of these prefixes.
      const allowedPrefixes = ['uploads/public/avatars/'];
      const ok = !path || allowedPrefixes.some((pfx) => path.startsWith(pfx));
      if (!ok) {
        return {
          statusCode: 400,
          body: JSON.stringify({
            message: `imagePath must start with ${allowedPrefixes.join(' or ')}`,
          }),
        };
      }
      updates.push('avatarImagePath = :ip');
      values[':ip'] = path;
      nextAvatarImagePath = path;
    }

    // Nothing to do? Still touch updatedAt for consistency.
    updates.push('updatedAt = :u');

    let expr = `SET ${updates.join(', ')}`;
    if (removes.length) expr += ` REMOVE ${removes.join(', ')}`;

    await ddb.send(
      new UpdateCommand({
        TableName: usersTable,
        Key: { userSub: sub },
        UpdateExpression: expr,
        ExpressionAttributeValues: values,
      })
    );

    // Async cleanup: if avatarImagePath changed or was cleared, enqueue deletion of the previous object.
    // Best-effort: never fail the request due to SQS issues.
    try {
      const prev = typeof previousAvatarImagePath === 'string' ? previousAvatarImagePath : '';
      const next =
        nextAvatarImagePath === undefined ? prev : typeof nextAvatarImagePath === 'string' ? nextAvatarImagePath : '';
      if (prev && prev !== next && prev.startsWith('uploads/public/avatars/')) {
        await enqueueMediaDeletes({
          keys: [prev],
          reason: 'avatar_changed',
          allowedPrefixes: ['uploads/public/avatars/'],
          context: { userSub: sub },
        });
      }
    } catch (err) {
      console.warn('updateProfile: enqueue avatar delete failed (ignored)', err);
    }

    return { statusCode: 204 };
  } catch (err) {
    console.error('updateProfile error', err);
    return { statusCode: 500, body: JSON.stringify({ message: 'Internal error' }) };
  }
};


