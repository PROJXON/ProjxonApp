import { defineFunction } from '@aws-amplify/backend';

// Cognito Trigger: Pre sign-up (Gen2-managed)
// - Enforces username rules
// - Optionally enforces case-insensitive uniqueness via USERS_TABLE (query byUsernameLower)
export const preSignUpUniqueUsername = defineFunction({
  name: 'preSignUpUniqueUsername',
  entry: './handler.js',
  timeoutSeconds: 10,
  environment: {
    USERS_TABLE: 'Users',
    USERS_BY_USERNAME_GSI: 'byUsernameLower',
  },
  resourceGroupName: 'auth',
});


