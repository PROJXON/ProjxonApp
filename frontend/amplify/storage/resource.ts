import { defineStorage } from '@aws-amplify/backend';

/**
 * S3 storage for chat media uploads.
 *
 * Access model (MVP):
 * - Any authenticated user can read/write objects under uploads/*
 * - Objects are NOT public on the internet; clients access via signed URLs.
 *
 * Later (for true E2EE DMs): store encrypted blobs and tighten access rules.
 */
export const storage = defineStorage({
  name: 'chatMedia',
  access: (allow) => ({
    'uploads/*': [
      allow.authenticated.to(['read', 'write', 'delete']),
    ],
  }),
});


