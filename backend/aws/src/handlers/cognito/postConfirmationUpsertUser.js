// Cognito Trigger: Post confirmation
// Purpose: create/update a Users table row for the newly confirmed user.
//
// Env:
// - USERS_TABLE (required)
//
// Users table expected schema:
// - PK: userSub (String)
// - GSI: byUsernameLower (PK usernameLower String)
//
// Stored attributes (minimum):
// - userSub
// - displayName
// - usernameLower
// - emailLower (optional)
// - createdAt, updatedAt (Number)

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

exports.handler = async (event) => {
  const table = process.env.USERS_TABLE;
  if (!table) return event;

  const attrs = event.request?.userAttributes || {};
  const userSub = String(attrs.sub || '');
  const preferred = String(attrs.preferred_username || '');
  const email = String(attrs.email || '');

  if (!userSub) return event;

  const displayName = (preferred || email || userSub).trim();
  const usernameLower = displayName.toLowerCase();
  const emailLower = email ? email.trim().toLowerCase() : undefined;

  const nowMs = Date.now();
  await ddb.send(
    new PutCommand({
      TableName: table,
      Item: {
        userSub,
        displayName,
        usernameLower,
        ...(emailLower ? { emailLower } : {}),
        createdAt: nowMs,
        updatedAt: nowMs,
      },
      // If you want to prevent overwriting an existing user row, uncomment:
      // ConditionExpression: 'attribute_not_exists(userSub)',
    })
  );

  return event;
};


