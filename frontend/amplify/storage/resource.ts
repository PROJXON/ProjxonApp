import { defineStorage } from '@aws-amplify/backend';

/**
 * Auth-only S3 storage for Global chat attachments.
 *
 * Objects are written under `uploads/*` and are readable/writable by authenticated users.
 */
export const storage = defineStorage({
  name: 'chatMedia',
  access: (allow) => ({
    // IMPORTANT:
    // Amplify Gen2 storage access paths have a constraint:
    // for any given path, only ONE other path may be a prefix of it.
    // So avoid broad prefixes like `uploads/*` if we also want granular subpaths.

    // ---- Global chat (plaintext attachments) ----
    // NOTE: the trailing `*` matches the entire suffix (including nested keys), so this covers
    // both `uploads/global/<file>` and `uploads/global/thumbs/<file>.jpg`.
    'uploads/global/*': [allow.authenticated.to(['read', 'write']), allow.guest.to(['read'])],

    // ---- DM chat (E2EE encrypted blobs) ----
    // Keep these auth-only (includes nested keys like thumbs/).
    'uploads/dm/*': [allow.authenticated.to(['read', 'write'])],
  }),
});


