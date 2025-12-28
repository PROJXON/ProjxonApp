// HTTP API (payload v2) Lambda: POST /push/token
// Stores an Expo push token for the authenticated user.
//
// Env:
// - PUSH_TOKENS_TABLE (required): DynamoDB table for push tokens
//
// Table schema (recommended):
// - PK: userSub (String)
// - SK: expoPushToken (String)
// - Attributes: platform ('ios'|'android'|'web'|...), updatedAt (Number epoch ms), deviceId? (String)
//
// Auth:
// - JWT authorizer (Cognito). Reads sub from requestContext.authorizer.jwt.claims.sub
//
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function safeString(v) {
  if (typeof v !== 'string') return '';
  return String(v).trim();
}

function isLikelyExpoToken(token) {
  const t = safeString(token);
  if (!t) return false;
  // Expo tokens typically look like:
  // - ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]
  // - ExpoPushToken[xxxxxxxxxxxxxxxxxxxxxx]
  // We keep this loose on purpose; Expo may evolve formats.
  return /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/.test(t) || t.startsWith('ExponentPushToken[') || t.startsWith('ExpoPushToken[');
}

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method;
  if (method !== 'POST') {
    return { statusCode: 405, headers: { Allow: 'POST' }, body: JSON.stringify({ message: 'Method not allowed' }) };
  }

  try {
    const sub = event.requestContext?.authorizer?.jwt?.claims?.sub;
    if (!sub) return { statusCode: 401, body: JSON.stringify({ message: 'Unauthorized' }) };

    const tableName = process.env.PUSH_TOKENS_TABLE;
    if (!tableName) {
      return { statusCode: 500, body: JSON.stringify({ message: 'Server misconfigured: PUSH_TOKENS_TABLE is not set' }) };
    }

    let body = {};
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return { statusCode: 400, body: JSON.stringify({ message: 'Invalid JSON body' }) };
    }

    const expoPushToken = safeString(body.expoPushToken || body.token);
    const platform = safeString(body.platform || 'unknown').toLowerCase();
    const deviceId = safeString(body.deviceId || '');

    if (!expoPushToken) {
      return { statusCode: 400, body: JSON.stringify({ message: 'expoPushToken is required' }) };
    }
    if (!isLikelyExpoToken(expoPushToken)) {
      return { statusCode: 400, body: JSON.stringify({ message: 'expoPushToken does not look like a valid Expo push token' }) };
    }

    const nowMs = Date.now();

    await ddb.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          userSub: String(sub),
          expoPushToken,
          platform,
          ...(deviceId ? { deviceId } : {}),
          updatedAt: nowMs,
        },
      })
    );

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.warn('registerPushToken error', err);
    return { statusCode: 500, body: JSON.stringify({ message: 'Internal server error' }) };
  }
};


