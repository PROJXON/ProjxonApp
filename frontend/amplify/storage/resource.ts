import { defineStorage } from '@aws-amplify/backend';

/**
 * Auth-only S3 storage for Global chat attachments.
 *
 * Objects are written under `global/*` and are readable/writable by authenticated users.
 * (DM media will be E2EE and handled separately.)
 */
export const storage = defineStorage({
  name: 'chatMedia',
  access: (allow) => ({
    'global/*': [allow.authenticated.to(['read', 'write'])],
  }),
});


