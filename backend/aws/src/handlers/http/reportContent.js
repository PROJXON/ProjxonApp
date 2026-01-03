// HTTP API (payload v2) Lambda: POST /reports
// Stores a user-generated report (message/user) for moderation review.
//
// Why this exists:
// - Apple/Google both expect UGC apps to provide a way to report objectionable content.
// - This is intentionally "simple but real": it records reports in DynamoDB so you can review them.
// - Optional follow-up: wire an email/SNS/Slack notification from the DynamoDB stream.
//
// Env:
// - REPORTS_TABLE (required): DynamoDB table for reports
//
// Suggested schema:
// - PK: reportId (String)
// - Attributes: reporterSub, kind, conversationId?, messageCreatedAt?, reportedUserSub?, reason?, details?,
//               messagePreview?, createdAt (Number epoch ms), userAgent?, platform?
//
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const crypto = require('crypto');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function safeString(v) {
  if (typeof v !== 'string') return '';
  return String(v).trim();
}

function clamp(s, maxLen) {
  const t = safeString(s);
  if (!t) return '';
  return t.length > maxLen ? `${t.slice(0, maxLen)}…` : t;
}

function makeId() {
  // 16 bytes is plenty; store as hex for DynamoDB friendliness.
  return crypto.randomBytes(16).toString('hex');
}

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method;
  if (method !== 'POST') {
    return { statusCode: 405, headers: { Allow: 'POST' }, body: JSON.stringify({ message: 'Method not allowed' }) };
  }

  try {
    const reporterSub = event.requestContext?.authorizer?.jwt?.claims?.sub;
    if (!reporterSub) return { statusCode: 401, body: JSON.stringify({ message: 'Unauthorized' }) };

    const table = process.env.REPORTS_TABLE;
    if (!table) return { statusCode: 500, body: JSON.stringify({ message: 'REPORTS_TABLE not configured' }) };

    let body = {};
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return { statusCode: 400, body: JSON.stringify({ message: 'Invalid JSON body' }) };
    }

    const kindRaw = safeString(body.kind || '');
    const kind = kindRaw === 'user' ? 'user' : kindRaw === 'message' ? 'message' : 'message';

    const conversationId = safeString(body.conversationId || '');
    const messageCreatedAt = Number(body.messageCreatedAt ?? body.createdAt ?? 0);
    const reportedUserSub = safeString(body.reportedUserSub || body.userSub || '');
    const reason = clamp(body.reason || '', 120);
    const details = clamp(body.details || '', 900);
    const messagePreview = clamp(body.messagePreview || body.text || '', 600);

    if (kind === 'message') {
      if (!conversationId) return { statusCode: 400, body: JSON.stringify({ message: 'conversationId is required' }) };
      if (!Number.isFinite(messageCreatedAt) || messageCreatedAt <= 0) {
        return { statusCode: 400, body: JSON.stringify({ message: 'messageCreatedAt is required' }) };
      }
    }

    // At least one "target" should be present (a user or a message).
    if (kind === 'user' && !reportedUserSub && !details) {
      return { statusCode: 400, body: JSON.stringify({ message: 'reportedUserSub or details is required' }) };
    }

    const nowMs = Date.now();
    const reportId = makeId();
    const userAgent = safeString(event.headers?.['user-agent'] || event.headers?.['User-Agent'] || '');

    await ddb.send(
      new PutCommand({
        TableName: table,
        Item: {
          reportId,
          reporterSub: String(reporterSub),
          kind,
          ...(conversationId ? { conversationId } : {}),
          ...(Number.isFinite(messageCreatedAt) && messageCreatedAt > 0 ? { messageCreatedAt } : {}),
          ...(reportedUserSub ? { reportedUserSub } : {}),
          ...(reason ? { reason } : {}),
          ...(details ? { details } : {}),
          ...(messagePreview ? { messagePreview } : {}),
          ...(userAgent ? { userAgent } : {}),
          createdAt: nowMs,
          // Keep room for future fields without requiring schema changes:
          v: 1,
        },
      })
    );

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ok: true, reportId }),
    };
  } catch (err) {
    console.error('reportContent error', err);
    return { statusCode: 500, body: JSON.stringify({ message: 'Internal error' }) };
  }
};

