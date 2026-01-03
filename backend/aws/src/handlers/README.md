# Lambda source (tracked in repo)

This folder stores the **source code** for the AWS Lambdas used by ProjxonApp.

## Layout

- `http/`: Lambdas invoked by the HTTP API (API Gateway HTTP API v2)
- `ws/`: Lambdas invoked by the WebSocket API (API Gateway WebSockets)

## Routes

### HTTP API (API Gateway HTTP API v2)

> **Auth**: unless marked **Public**, routes are expected to be wired behind the **JWT authorizer** (Cognito).

- **GET `/messages`** → `http/getMessages.js`
  - **Auth**: JWT
  - **Query**: `conversationId` (defaults to `global`), `limit` (default 50, max 200), `before` (optional createdAt ms cursor), `cursor=1` (optional: return cursor metadata)
  - **Notes**: returns newest-first; if `BLOCKS_TABLE` is configured, filters out messages authored by blocked users (server-side)

- **GET `/public/messages`** → `http/getPublicMessages.js`
  - **Auth**: **Public** (no authorizer)
  - **Query**: `conversationId` (must be `global`), `limit` (default 50, max 200), `before` (optional createdAt ms cursor), `cursor=1` (optional: return cursor metadata)
  - **Notes**: intended for guest/portfolio preview

- **GET `/public/users`** → `http/getPublicUser.js`
  - **Auth**: **Public** (no authorizer)
  - **Query**: `sub` (required)
  - **Returns**: `{ sub, displayName, avatarBgColor?, avatarTextColor?, avatarImagePath? }`
  - **Notes**: guest-safe “profile-lite” endpoint for avatar rendering

- **POST `/public/users/batch`** → `http/getPublicUsersBatch.js`
  - **Auth**: **Public** (no authorizer)
  - **Body**: `{ subs: string[] }` (max 100)
  - **Returns**: `{ users: [{ sub, displayName, avatarBgColor?, avatarTextColor?, avatarImagePath? }] }`
  - **Notes**: batch version of `/public/users` to reduce request count in busy global chats

- **GET `/reads`** → `http/getReads.js`
  - **Auth**: JWT
  - **Query**: `conversationId` (required)
  - **Notes**: used to hydrate “Seen” state after reconnect

- **GET `/unreads`** → `http/getUnreadDms.js`
  - **Auth**: JWT
  - **Notes**: DM-only unread badge hydration

- **GET `/conversations`** → `http/getConversations.js`
  - **Auth**: JWT
  - **Query**: `limit` (default 50, max 200)
  - **Returns**: `{ conversations: [{ conversationId, peerSub?, peerDisplayName?, lastMessageAt, lastSenderSub?, lastSenderDisplayName? }] }`
  - **Notes**: DM inbox list, newest-first (requires Conversations GSI; falls back to unsorted base query if missing)

- **POST `/conversations/delete`** → `http/deleteConversation.js`
  - **Auth**: JWT
  - **Body**: `{ conversationId }`
  - **Notes**: removes a conversation from the user’s “Chats” list (does not delete message history)

- **GET `/users`** → `http/getUser.js`
  - **Auth**: JWT (current frontend expects this)
  - **Query**: `username` (case-insensitive) **or** `sub`
  - **Returns**: `{ sub, displayName, usernameLower?, public_key?, avatarBgColor?, avatarTextColor?, avatarImagePath? }`

- **POST `/users/public-key`** → `http/attachPublicKey.js`
  - **Auth**: JWT
  - **Body**: `{ publicKey: string }`
  - **Notes**: stores `currentPublicKey` + `displayName` into the Users table (source of truth)

- **POST `/users/profile`** → `http/updateProfile.js`
  - **Auth**: JWT
  - **Body**: `{ bgColor?, textColor?, imagePath? }`
  - **Notes**: updates user avatar preferences (colors + optional public avatar image path)

- **GET `/users/recovery`** → `http/getRecovery.js`
  - **Auth**: JWT
  - **Returns**: `{ ciphertext, iv, salt }`

- **POST `/users/recovery`** → `http/createRecovery.js`
  - **Auth**: JWT
  - **Body**: `{ ciphertext, iv, salt }`

- **POST `/ai/summary`** → `http/aiSummary.js`
  - **Auth**: JWT
  - **Body**: `{ conversationId, peer?, messages: [{ user, text, createdAt }] }`
  - **Returns**: `{ summary }`

- **POST `/ai/helper`** → `http/aiHelper.js`
  - **Auth**: JWT
  - **Body**: `{ conversationId, peer?, instruction, wantReplies?: boolean, messages: [{ user, text, createdAt }], thread?: [{ role: "user"|"assistant", text }], resetThread?: boolean, attachments?: [{ kind: "image"|"video", thumbKey, thumbUrl, fileName?, size?, user?, createdAt? }] }`
  - **Returns**: `{ answer, suggestions: string[], thread: [{ role, text }] }`

- **POST `/push/token`** → `http/registerPushToken.js`
  - **Auth**: JWT
  - **Body**: `{ expoPushToken, platform?, deviceId? }`
  - **Notes**: stores the device’s Expo push token for DM notifications

- **POST `/push/token/delete`** → `http/unregisterPushToken.js`
  - **Auth**: JWT
  - **Body**: `{ expoPushToken?, deviceId? }`
  - **Notes**: removes a token on sign-out (prevents another account on the same device from receiving pushes)

- **POST `/reports`** → `http/reportContent.js`
  - **Auth**: JWT
  - **Body**: `{ kind?: "message"|"user", conversationId?, messageCreatedAt?, reportedUserSub?, reason?, details?, messagePreview? }`
  - **Returns**: `{ ok: true, reportId }`
  - **Notes**:
    - Stores a report in `REPORTS_TABLE` for moderation review (Apple/Google UGC requirement).
    - You can optionally wire notifications via DynamoDB Streams / SNS / email later.

- **POST `/account/delete`** → `http/deleteAccount.js`
  - **Auth**: JWT
  - **Returns**: `{ ok: true, deletedAt, stats: {...} }`
  - **Notes**:
    - Deletes app-side data (Users row, push tokens, blocks, conversation index, etc.).
    - The client should then call Cognito deletion (e.g. Amplify Auth `deleteUser()`) to remove the login itself.
    - Message history deletion is **best-effort** and optional (see `DELETE_ACCOUNT_SCAN_MESSAGES`); at scale you should add a `userSub` index.

- **GET `/blocks`** → `http/getBlocks.js`
  - **Auth**: JWT
  - **Returns**: `{ blocked: [{ blockedSub, blockedDisplayName?, blockedUsernameLower?, blockedAt? }] }`
  - **Notes**: if `USERS_TABLE` is configured, hydrates missing `blockedDisplayName` from Users

- **POST `/blocks`** → `http/addBlock.js`
  - **Auth**: JWT
  - **Body**: `{ username }` (case-insensitive) **or** `{ blockedSub }`
  - **Notes**: adds a user to your blocklist

- **POST `/blocks/delete`** → `http/deleteBlock.js`
  - **Auth**: JWT
  - **Body**: `{ blockedSub }`
  - **Notes**: removes a user from your blocklist

- **POST `/media/dm/signed-url`** → `http/getDmSignedUrl.js`
  - **Auth**: JWT
  - **Body**: `{ path: "uploads/dm/<conversationId>/...", ttlSeconds?: number }`
  - **Returns**: `{ url, expires }`
  - **Notes**:
    - validates the caller is a participant of the DM (based on `dm#<subA>#<subB>` in the path)
    - signs CloudFront URLs using a trusted key group (canned policy, short TTL)

### WebSocket API (API Gateway WebSockets)

> **Auth**: WebSocket connections are authorized by `ws/wsAuthorizer.js` (Cognito JWT).

- **`$connect`** → `ws/wsConnect.js`
  - Stores connection in `CONNECTIONS_TABLE` and defaults to `conversationId=global`

- **`$disconnect`** → `ws/wsDisconnect.js`
  - Removes connection from `CONNECTIONS_TABLE`

- **Route `message` (default)** → `ws/wsMessage.js`
  - Client sends JSON with `action`:
    - **`join`**: join a conversation room (updates connection record)
    - **`message`**: broadcast + persist message
    - **`typing`**: typing indicator
    - **`read`**: read receipts (+ persists to `READS_TABLE`, clears `UNREADS_TABLE`)
    - **`edit`**: edit a message (sender-only)
    - **`delete`**: delete a message (sender-only)
    - **`react`**: reactions (single-reaction-per-user model)

- **Authorizer** → `ws/wsAuthorizer.js`
  - Validates Cognito JWT and injects `{ sub, usernameLower, displayName }` into authorizer context

## Notes

- The deployed Lambda code in AWS should match these files.
- Each handler should document required environment variables at the top of the file.


