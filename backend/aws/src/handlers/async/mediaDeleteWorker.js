// Compatibility: prefer AWS SDK v3 if present; otherwise fall back to aws-sdk v2 (preinstalled in Lambda).
let deleteObjectsV3 = null;
let s3V2 = null;
try {
  // eslint-disable-next-line import/no-extraneous-dependencies
  const { S3Client, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
  const s3 = new S3Client({});
  deleteObjectsV3 = async ({ bucket, keys }) => {
    const resp = await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
      })
    );
    return resp;
  };
} catch {
  try {
    // eslint-disable-next-line import/no-extraneous-dependencies
    const AWS = require('aws-sdk');
    s3V2 = new AWS.S3();
  } catch {
    // neither available
  }
}

function uniq(keys) {
  const out = [];
  const seen = new Set();
  for (const k of keys || []) {
    const s = typeof k === 'string' ? k.trim() : '';
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function parseRecord(record) {
  try {
    const raw = record && record.body ? String(record.body) : '';
    const json = raw ? JSON.parse(raw) : null;
    const keys = Array.isArray(json?.keys) ? json.keys : [];
    return {
      keys: uniq(keys).map((k) => String(k).replace(/^\/+/, '')),
      reason: typeof json?.reason === 'string' ? String(json.reason) : 'unspecified',
    };
  } catch {
    return { keys: [], reason: 'invalid_json' };
  }
}

/**
 * SQS-triggered worker to delete S3 objects (best-effort, idempotent).
 *
 * Env:
 * - MEDIA_BUCKET_NAME (required)
 */
exports.handler = async (event) => {
  const bucket = String(process.env.MEDIA_BUCKET_NAME || '').trim();
  if (!bucket) {
    console.error('mediaDeleteWorker misconfigured: MEDIA_BUCKET_NAME missing');
    // Fail the batch so messages go to DLQ (signals config issue).
    throw new Error('MEDIA_BUCKET_NAME missing');
  }

  const records = Array.isArray(event?.Records) ? event.Records : [];
  const allKeys = [];
  for (const r of records) {
    const parsed = parseRecord(r);
    if (parsed.keys.length) allKeys.push(...parsed.keys);
  }

  const keys = uniq(allKeys);
  if (!keys.length) return { ok: true, deleted: 0 };

  // S3 DeleteObjects supports up to 1000 keys per request.
  let deletedTotal = 0;
  for (let i = 0; i < keys.length; i += 1000) {
    const slice = keys.slice(i, i + 1000);
    let resp;
    if (deleteObjectsV3) {
      resp = await deleteObjectsV3({ bucket, keys: slice });
    } else if (s3V2) {
      resp = await s3V2
        .deleteObjects({
          Bucket: bucket,
          Delete: { Objects: slice.map((Key) => ({ Key })), Quiet: true },
        })
        .promise();
    } else {
      console.error('mediaDeleteWorker missing AWS SDK (neither v3 nor v2 available)');
      throw new Error('Missing AWS SDK');
    }

    deletedTotal += Array.isArray(resp?.Deleted) ? resp.Deleted.length : slice.length;
    if (resp?.Errors && resp.Errors.length) {
      // Throw to ensure retry/DLQ visibility for persistent failures.
      console.error('DeleteObjects had errors', resp.Errors);
      throw new Error(`DeleteObjects errors: ${resp.Errors.length}`);
    }
  }

  return { ok: true, deleted: deletedTotal };
};

