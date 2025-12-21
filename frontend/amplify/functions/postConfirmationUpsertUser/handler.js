// Cognito Trigger: Post confirmation
//
// Env:
// - USERS_TABLE (required)
//
// Users table expected schema:
// - PK: userSub (String)
// - Attributes: displayName, usernameLower, emailLower, createdAt, updatedAt
//
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = async (event) => {
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
    })
  );

  return event;
};


