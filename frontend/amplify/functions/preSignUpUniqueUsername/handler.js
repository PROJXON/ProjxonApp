// Cognito Trigger: Pre sign-up
//
// Env:
// - USERS_TABLE (optional but recommended): DynamoDB Users table
// - USERS_BY_USERNAME_GSI (optional): GSI name (default: byUsernameLower)
//
// Users table expected schema:
// - PK: userSub (String)
// - GSI: byUsernameLower (PK usernameLower String)
//
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = async (event) => {
  const attrs = event.request?.userAttributes || {};
  const preferred = attrs.preferred_username;

  if (!preferred) {
    throw new Error('Username (preferred_username) is required.');
  }

  // Reject ANY whitespace
  if (/\s/.test(preferred)) {
    throw new Error('Username cannot contain spaces.');
  }

  // Reject commas, backslash, forward slash, apostrophe, #, and double-quote
  if (/[,\\/"'#]/.test(preferred)) {
    throw new Error(`Username cannot contain commas, /, \\, ', #, or ".`);
  }

  const usersTable = process.env.USERS_TABLE;
  const gsi = process.env.USERS_BY_USERNAME_GSI || 'byUsernameLower';

  // Enforce case-insensitive uniqueness via Users table (recommended).
  if (usersTable) {
    const usernameLower = String(preferred).trim().toLowerCase();
    const resp = await ddb.send(
      new QueryCommand({
        TableName: usersTable,
        IndexName: gsi,
        KeyConditionExpression: 'usernameLower = :u',
        ExpressionAttributeValues: { ':u': usernameLower },
        Limit: 1,
      })
    );
    if (resp.Items && resp.Items.length > 0) {
      throw new Error('Username is already taken.');
    }
  }

  // Auto-confirm user so no email code is required.
  event.response.autoConfirmUser = true;
  // Also mark email verified when email is present.
  if (attrs.email) event.response.autoVerifyEmail = true;

  return event;
};


