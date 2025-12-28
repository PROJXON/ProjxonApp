// HTTP API (payload v2) Lambda: POST /push/token/delete
// Removes an Expo push token for the authenticated user (device sign-out cleanup).
//
// Env:
// - PUSH_TOKENS_TABLE (required): DynamoDB table for push tokens
//
// Auth:
// - JWT authorizer (Cognito). Reads sub from requestContext.authorizer.jwt.claims.sub
//
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, DeleteCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function safeString(v) {
  if (typeof v !== 'string') return '';
  return String(v).trim();
}

function isLikelyExpoToken(token) {
  const t = safeString(token);
  if (!t) return false;
  return (
    /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/.test(t) ||
    t.startsWith('ExponentPushToken[') ||
    t.startsWith('ExpoPushToken[')
  );
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
    const deviceId = safeString(body.deviceId || '');

    if (expoPushToken) {
      if (!isLikelyExpoToken(expoPushToken)) {
        return { statusCode: 400, body: JSON.stringify({ message: 'expoPushToken does not look like a valid Expo push token' }) };
      }

      await ddb.send(
        new DeleteCommand({
          TableName: tableName,
          Key: { userSub: String(sub), expoPushToken },
        })
      );
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    // Fallback: if we don't have the token (some platforms can lose it), delete by deviceId.
    if (!deviceId) {
      return { statusCode: 400, body: JSON.stringify({ message: 'expoPushToken or deviceId is required' }) };
    }

    const resp = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'userSub = :u',
        ExpressionAttributeValues: {
          ':u': String(sub),
          ':d': deviceId,
        },
        ProjectionExpression: 'expoPushToken, deviceId',
        FilterExpression: 'deviceId = :d',
      })
    );

    const tokens = (resp.Items || [])
      .map((it) => (it && typeof it.expoPushToken === 'string' ? String(it.expoPushToken) : ''))
      .map((t) => t.trim())
      .filter(Boolean);

    await Promise.all(
      tokens.map((t) =>
        ddb.send(
          new DeleteCommand({
            TableName: tableName,
            Key: { userSub: String(sub), expoPushToken: t },
          })
        )
      )
    );

    return { statusCode: 200, body: JSON.stringify({ ok: true, deleted: tokens.length }) };
  } catch (err) {
    console.warn('unregisterPushToken error', err);
    return { statusCode: 500, body: JSON.stringify({ message: 'Internal server error' }) };
  }
};


