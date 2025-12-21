const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Connections TTL refresh window (must match your DynamoDB TTL attribute "expiresAt")
const CONN_TTL_SECONDS = 6 * 60 * 60; // 6 hours

exports.handler = async (event) => {
  try {
    const connectionId = event.requestContext.connectionId;
    const nowSec = Math.floor(Date.now() / 1000);

    // From WS authorizer context (authoritative)
    const auth = event.requestContext?.authorizer || {};
    const sub = String(auth.sub || '').trim();
    const usernameLower = String(auth.usernameLower || '').trim().toLowerCase();
    const displayName = String(auth.displayName || '').trim();

    if (!connectionId) return { statusCode: 400, body: 'Missing connectionId' };
    if (!sub) return { statusCode: 401, body: 'Unauthorized (missing sub)' };

    const expiresAt = nowSec + CONN_TTL_SECONDS;

    await ddb.send(
      new PutCommand({
        TableName: process.env.CONNECTIONS_TABLE,
        Item: {
          connectionId,
          userSub: sub,
          usernameLower: usernameLower || displayName.toLowerCase() || sub.toLowerCase(),
          displayName: displayName || usernameLower || 'anon',
          // Default to global; client will send {action:'join'} to switch rooms
          conversationId: 'global',
          expiresAt,
          connectedAt: nowSec,
        },
      })
    );

    return { statusCode: 200, body: 'Connected.' };
  } catch (err) {
    console.error('wsConnect error', err);
    return { statusCode: 500, body: 'Internal error.' };
  }
};


