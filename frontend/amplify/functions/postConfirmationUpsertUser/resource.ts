import { defineFunction } from '@aws-amplify/backend';

// Cognito Trigger: Post confirmation (Gen2-managed)
// Creates/updates the Users table row after a user is confirmed.
export const postConfirmationUpsertUser = defineFunction({
  name: 'postConfirmationUpsertUser',
  entry: './handler.js',
  timeoutSeconds: 10,
  environment: {
    USERS_TABLE: 'Users',
  },
  resourceGroupName: 'auth',
});


