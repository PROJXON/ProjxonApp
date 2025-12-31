import { defineStorage } from '@aws-amplify/backend';

/**
 * S3 storage for chat media.
 *
 * Layout (prefixes):
 * - `uploads/channels/<channelId>/...`   Public channels (readable by guests; writeable by authed users)
 * - `uploads/public/avatars/...`        Public avatars (readable by guests; writeable by authed users)
 * - `uploads/dm/<conversationId>/...`   Private DM/group-DM media (writeable by authed users; reads should go via CloudFront signed URLs)
 */
export const storage = defineStorage({
  name: 'chatMedia',
  access: (allow) => ({
    // IMPORTANT:
    // Amplify Gen2 storage access paths have a constraint:
    // for any given path, only ONE other path may be a prefix of it.
    // So avoid broad prefixes like `uploads/*` if we also want granular subpaths.

    // ---- Public channels (plaintext attachments) ----
    // NOTE: trailing `*` matches the entire suffix (including nested keys), so this covers thumbs too.
    'uploads/channels/*': [allow.authenticated.to(['read', 'write']), allow.guest.to(['read'])],

    // ---- Public avatars ----
    'uploads/public/*': [allow.authenticated.to(['read', 'write']), allow.guest.to(['read'])],

    // ---- DM chat (E2EE encrypted blobs) ----
    // Keep these auth-only (includes nested keys like thumbs/).
    // NOTE: for now the mobile app still uses Amplify `getUrl()` for DMs (S3 presigned URLs).
    // Once the CloudFront signer service is added, we can remove direct read access here.
    'uploads/dm/*': [allow.authenticated.to(['read', 'write'])],
  }),
});


