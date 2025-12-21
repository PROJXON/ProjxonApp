import { defineStorage } from '@aws-amplify/backend';

/**
 * Auth-only S3 storage for Global chat attachments.
 *
 * Objects are written under `uploads/*` and are readable/writable by authenticated users.
 */
export const storage = defineStorage({
  name: 'chatMedia',
  access: (allow) => ({
    // Current upload paths used by the app (global + DM encrypted media)
    'uploads/*': [allow.authenticated.to(['read', 'write'])],
  }),
});


