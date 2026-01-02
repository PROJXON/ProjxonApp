// Compatibility: prefer AWS SDK v3 if present; otherwise fall back to aws-sdk v2 (preinstalled in Lambda).
let sqsV3 = null;
let sendV3 = null;
let sqsV2 = null;
try {
  // eslint-disable-next-line import/no-extraneous-dependencies
  const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
  sqsV3 = new SQSClient({});
  sendV3 = (cmd) => sqsV3.send(cmd);
  module.exports.__sdk = 'v3';
} catch {
  try {
    // eslint-disable-next-line import/no-extraneous-dependencies
    const AWS = require('aws-sdk');
    sqsV2 = new AWS.SQS();
    module.exports.__sdk = 'v2';
  } catch {
    // neither available
  }
}

const DEFAULT_ALLOWED_PREFIXES = [
  // Public avatars
  'uploads/public/avatars/',
  // Public/global/channel media
  'uploads/channels/',
  // DM media (encrypted blobs)
  'uploads/dm/',
];

function normalizeKey(k) {
  const s = typeof k === 'string' ? k.trim() : '';
  if (!s) return '';
  // Disallow full URLs or s3:// URIs; we only accept object keys.
  if (/^[a-z]+:\/\//i.test(s)) return '';
  return s.replace(/^\/+/, '');
}

function uniqStrings(arr) {
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
}

function validateKeys(keys, allowedPrefixes) {
  const pfx = Array.isArray(allowedPrefixes) && allowedPrefixes.length ? allowedPrefixes : DEFAULT_ALLOWED_PREFIXES;
  const cleaned = uniqStrings((keys || []).map(normalizeKey)).filter(Boolean);
  const ok = [];
  for (const k of cleaned) {
    if (pfx.some((a) => k.startsWith(a))) ok.push(k);
  }
  return ok;
}

/**
 * Enqueue a best-effort S3 delete job.
 *
 * Env:
 * - MEDIA_DELETE_QUEUE_URL: SQS queue URL
 */
async function enqueueMediaDeletes({ keys, reason, allowedPrefixes, context }) {
  const queueUrl = String(process.env.MEDIA_DELETE_QUEUE_URL || '').trim();
  if (!queueUrl) return { enqueued: 0, skipped: true, error: 'MEDIA_DELETE_QUEUE_URL not set' };

  const safeKeys = validateKeys(keys, allowedPrefixes);
  if (!safeKeys.length) return { enqueued: 0, skipped: true };

  const payload = {
    v: 1,
    // keys are S3 object keys (NOT URLs)
    keys: safeKeys,
    reason: typeof reason === 'string' ? reason : 'unspecified',
    // Optional debugging context (avoid sensitive data)
    context:
      context && typeof context === 'object'
        ? Object.fromEntries(
            Object.entries(context)
              .slice(0, 20)
              .map(([k, v]) => [String(k).slice(0, 60), String(v).slice(0, 240)])
          )
        : undefined,
    createdAt: Date.now(),
  };
  const body = JSON.stringify(payload);

  if (sendV3) {
    const { SendMessageCommand } = require('@aws-sdk/client-sqs');
    await sendV3(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: body }));
  } else if (sqsV2) {
    await sqsV2.sendMessage({ QueueUrl: queueUrl, MessageBody: body }).promise();
  } else {
    return { enqueued: 0, skipped: true, error: 'No AWS SDK available for SQS' };
  }

  return { enqueued: safeKeys.length };
}

module.exports = {
  enqueueMediaDeletes,
  validateKeys,
  normalizeKey,
};

