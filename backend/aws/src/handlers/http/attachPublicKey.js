const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const publicKey = body.publicKey?.trim();
    if (!publicKey) {
      return { statusCode: 400, body: JSON.stringify({ message: 'publicKey is required' }) };
    }

    const claims = event.requestContext?.authorizer?.jwt?.claims || {};
    const sub = claims?.sub;
    if (!sub) {
      return { statusCode: 401, body: JSON.stringify({ message: 'Unauthorized' }) };
    }

    // Store in Users table (source of truth).
    // Schema expectation:
    // - PK: userSub (String)
    // - Attributes: currentPublicKey (String), updatedAt (Number)
    const usersTable = process.env.USERS_TABLE;
    if (!usersTable) {
      return {
        statusCode: 500,
        body: JSON.stringify({ message: 'Server misconfigured: USERS_TABLE is not set' }),
      };
    }

    const nowMs = Date.now();
    const preferred = typeof claims.preferred_username === 'string' ? claims.preferred_username : '';
    const email = typeof claims.email === 'string' ? claims.email : '';
    const displayName = String(preferred || email || sub).trim();
    const usernameLower = displayName.toLowerCase();
    const emailLower = email ? email.trim().toLowerCase() : '';

    await ddb.send(
      new UpdateCommand({
        TableName: usersTable,
        Key: { userSub: String(sub) },
        UpdateExpression:
          'SET currentPublicKey = :k, displayName = :d, usernameLower = :ul, updatedAt = :u' +
          (emailLower ? ', emailLower = :el' : ''),
        ExpressionAttributeValues: {
          ':k': publicKey,
          ':d': displayName,
          ':ul': usernameLower,
          ':u': nowMs,
          ...(emailLower ? { ':el': emailLower } : {}),
        },
      })
    );

    return { statusCode: 204 };
  } catch (err) {
    console.error('attachPublicKey error', err);
    return { statusCode: 500, body: JSON.stringify({ message: 'Internal error' }) };
  }
};