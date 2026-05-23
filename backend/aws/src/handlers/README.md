# Lambda source (tracked in repo)

This folder stores the **source code** for the AWS Lambdas used by OrkaChat.

## Layout

- `http/`: Lambdas invoked by the HTTP API (API Gateway HTTP API v2)
- `ws/`: Lambdas invoked by the WebSocket API (API Gateway WebSockets)

## Terraform staging backend (recommended for this repo)

This repo includes a Terraform-managed **staging** backend under `infra/terraform/staging/` (DynamoDB + Lambdas + API Gateway HTTP + WebSocket). That environment packages these handlers + `backend/aws/src/lib` into a single Lambda zip deployment package.

## Required AWS resources (manual backend reference)

This repo **tracks Lambda source**, but if you deploy by copy/paste in the AWS Console you must also create the backing AWS resources manually (API Gateway routes + DynamoDB tables + GSIs, etc.).

### DynamoDB tables + GSIs

Below are the DynamoDB tables referenced by the backend handlers, plus the **GSIs that the code expects** for the fast paths (some handlers fall back to scans/unsorted queries if an index is missing, but you’ll want these in any real environment).

#### Users

- **Table**: `Users`
- **PK**: `userSub` (S)
- **Attributes used**: `displayName`, `usernameLower`, `currentPublicKey`, `avatarBgColor`, `avatarTextColor`, `avatarImagePath`, `updatedAt`
- **GSI**: `byUsernameLower`
  - **PK**: `usernameLower` (S)
  - **Notes**: used for username lookup (blocks, start group DM, auth triggers, etc.)

#### Messages

- **Table**: `Messages`
- **PK**: `conversationId` (S) (e.g. `global`, `dm#<minSub>#<maxSub>`, `gdm#<groupId>`, `ch#<channelId>`)
- **SK**: `createdAt` (N) (epoch ms)

#### Conversations (DM/group list index)

- **Table**: `Conversations`
- **PK**: `userSub` (S)
- **SK**: `conversationId` (S)
- **Attributes used**: `peerSub`, `peerDisplayName`, `conversationKind`, `memberStatus`, `lastMessageAt`, `lastSenderSub`, `lastSenderDisplayName`
- **GSI**: `byUserLastMessageAt`
  - **PK**: `userSub` (S)
  - **SK**: `lastMessageAt` (N)
  - **Notes**: newest-first inbox ordering for `GET /conversations`

#### ConversationReads (read receipts)

- **Table**: `ConversationReads`
- **PK**: `conversationId` (S)
- **SK**: `key` (S) (server-defined; e.g. `read#<sub>`)

#### Unread DM conversations

- **Table**: `UnreadDmConversations`
- **PK**: `userSub` (S)
- **SK**: `conversationId` (S)

#### Blocks

- **Table**: `Blocks`
- **PK**: `blockerSub` (S)
- **SK**: `blockedSub` (S)
- **Attributes used**: `blockedAt`, `blockedUsernameLower`, `blockedDisplayName`

#### PushTokens

- **Table**: `PushTokens`
- **PK**: `userSub` (S)
- **SK**: `expoPushToken` (S)
- **Attributes used**: `platform`, `deviceId`, `updatedAt`
- **Optional TTL**: enable DynamoDB TTL using attribute **`expiresAt`**
  - Written by `POST /push/token` when `PUSH_TOKEN_TTL_DAYS` is set (recommended long TTL, e.g. 180–365 days).

#### RecoveryKeys

- **Table**: `RecoveryKeys`
- **PK**: `sub` (S)
- **Attributes used**: `ciphertext`, `iv`, `salt`, `updatedAt`

#### Reports

- **Table**: `Reports`
- **PK**: `reportId` (S)
- **Attributes used**: `kind`, `reportedUserSub`, `conversationId`, `messageCreatedAt`, `reason`, `details`, `messagePreview`, `createdAt`

#### Stats

- **Table**: `Stats`
- **PK**: `statKey` (S)
- **Attributes used**: `userCount` (Number)
- **Notes**: best-effort “global user count” chip for channel search UI

#### Channels (plaintext rooms)

- **Table**: `Channels`
- **PK**: `channelId` (S)
- **Attributes used**: `name`, `nameLower`, `isPublic`, `hasPassword`, `passwordHash`, `aboutText`, `aboutVersion`, `activeMemberCount`, `createdBySub`, `createdAt`, `updatedAt`, `deletedAt`
- **GSI**: `byNameLower`
  - **PK**: `nameLower` (S)
  - **Notes**: name uniqueness + join-by-name
- **GSI**: `byPublicRank`
  - **PK**: `publicIndexPk` (S) (value: `"public"`)
  - **SK**: `publicRankSk` (S)
  - **Notes**: public channel discovery ordering (member-count ranking encoded into `publicRankSk`)

#### ChannelMembers

- **Table**: `ChannelMembers`
- **PK**: `channelId` (S)
- **SK**: `memberSub` (S)
- **Attributes used**: `status` (`active`/`left`/`banned`), `isAdmin`, `joinedAt`, `leftAt`, `bannedAt`, `updatedAt`
- **GSI**: `byMemberSub`
  - **PK**: `memberSub` (S)
  - **SK**: `channelId` (S) (or `joinedAt` if you prefer; handlers only require PK)
  - **Notes**: “my channels” list + cleanup paths (delete account)

#### Groups (encrypted group DMs)

- **Table**: `Groups`
- **PK**: `groupId` (S)
- **Attributes used**: `rosterKey`, `groupName`, `createdBySub`, `createdAt`, `updatedAt`
- **GSI**: `byRosterKey`
  - **PK**: `rosterKey` (S)
  - **SK**: `groupId` (S)
  - **Notes**: reuse an existing group if the roster matches

#### GroupMembers

- **Table**: `GroupMembers`
- **PK**: `groupId` (S)
- **SK**: `memberSub` (S)
- **Attributes used**: `status` (`active`/`left`/`banned`), `isAdmin`, `joinedAt`, `addedBySub`, `leftAt`, `bannedAt`, `updatedAt`

#### Connections (WebSocket presence)

- **Table**: `Connections`
- **PK**: `connectionId` (S)
- **Attributes used**: `conversationId`, `userSub`, `usernameLower`, `displayName`, `connectedAt` (epoch seconds), `expiresAt` (epoch seconds)
- **TTL**: enable DynamoDB TTL using attribute **`expiresAt`**
- **GSI**: `byConversation`
  - **PK**: `conversationId` (S)
  - **Projection needs**: `connectionId`
- **GSI**: `byConversationWithUser`
  - **PK**: `conversationId` (S)
  - **SK**: `connectionId` (S)
  - **Projection needs**: `connectionId`, `userSub`
  - **Notes**: preferred for global presence because it can project `userSub` for deduping/filtering
- **GSI**: `byUserSub`
  - **PK**: `userSub` (S)
  - **Projection needs**: `connectionId`

#### Calls (voice / future video)

- **Table**: `Calls`
- **PK**: `callId` (S)
- **Attributes used**: `conversationId`, `kind` (`voice`), `status` (`ringing` | `active` | `ended`), `callerSub`, `calleeSub`, `meetingId`, `meeting` (map), `externalMeetingId`, `createdAt`, `updatedAt`, `endedAt`
- **TTL**: enable DynamoDB TTL using attribute **`expiresAt`** (epoch seconds)
- **Notes**: Chime SDK Meetings run in **`CHIME_SDK_REGION`** (default `us-east-1`); DynamoDB/API Gateway remain in the app region (e.g. `us-east-2`).

#### AI quota tables (optional)

The AI and media-quota handlers can optionally use DynamoDB for rate/usage tracking:

- `AiSummaries`: PK `sub` (S), SK `conversationId` (S)
- `AiHelper` (if used): PK `sub` (S), SK `conversationId` (S)
- A shared quota table used by media signer / media upload caps (preferred): PK `sub` (S), SK `conversationId` (S)

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
  - **Streaming variant (SSE)**: wire `http/aiSummaryStream.js` *instead* when using a streaming-capable integration (SSE `Content-Type: text/event-stream`)
  - **Abuse caps** (optional, requires `AI_SUMMARY_TABLE` + `dynamodb:UpdateItem` on that table):
    - `AI_SUMMARY_MAX_PER_MINUTE` (default: 3)
    - `AI_SUMMARY_MAX_PER_DAY` (default: 40)

- **POST `/ai/helper`** → `http/aiHelper.js`
  - **Auth**: JWT
  - **Body**: `{ conversationId, peer?, instruction, wantReplies?: boolean, messages: [{ user, text, createdAt }], thread?: [{ role: "user"|"assistant", text }], resetThread?: boolean, attachments?: [{ kind: "image"|"video", thumbKey, thumbUrl, fileName?, size?, user?, createdAt? }] }`
  - **Returns**: `{ answer, suggestions: string[], thread: [{ role, text }] }`
  - **Streaming variant (SSE)**: wire `http/aiHelperStream.js` *instead* when using a streaming-capable integration (SSE `Content-Type: text/event-stream`)
  - **Abuse caps** (optional, requires `AI_HELPER_TABLE` + `dynamodb:UpdateItem` on that table):
    - `AI_HELPER_MAX_PER_MINUTE` (default: 10)
    - `AI_HELPER_MAX_PER_DAY` (default: 250)

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
  - **Abuse caps** (optional, requires a DynamoDB table with PK=`sub` (S), SK=`conversationId` (S) and `dynamodb:UpdateItem` on that table):
    - `MEDIA_SIGNER_QUOTA_TABLE` (preferred) or falls back to `AI_HELPER_TABLE` / `AI_SUMMARY_TABLE` if set
    - `DM_MEDIA_SIGNEDURL_MAX_PER_MINUTE` (default: 60)
    - `DM_MEDIA_SIGNEDURL_MAX_PER_DAY` (default: 5000)

- **POST `/calls/start`** → `http/callsStart.js`
  - **Auth**: JWT
  - **Body**: `{ conversationId }` (DM only: `dm#<subA>#<subB>`)
  - **Returns**: `{ callId, conversationId, status, calleeSub, meeting, attendee }`
  - **Env**: `CALLS_TABLE`, `CHIME_SDK_REGION` (default `us-east-1`)

- **POST `/calls/accept`** → `http/callsAccept.js`
  - **Auth**: JWT (callee only)
  - **Body**: `{ callId }`
  - **Returns**: `{ callId, conversationId, status, meetingId, meeting, attendee }`

- **POST `/calls/end`** → `http/callsEnd.js`
  - **Auth**: JWT (caller or callee)
  - **Body**: `{ callId }`
  - **Returns**: `{ callId, status: "ended" }`

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

  - **Media upload cost caps** (optional, enforced when a message references media paths)
    - **What it does**:
      - For DMs/group DMs, uses `mediaPaths` provided by the client.
      - For global/channels, parses `{type:"chat", media:[{path, thumbPath}]}` out of the stored `text`.
      - Looks up actual object sizes via S3 `HeadObject`, then increments a DynamoDB bytes/day counter.
      - If over quota, rejects the message (HTTP 429) and enqueues best-effort deletes for the referenced objects.
    - **Env**:
      - `MEDIA_BUCKET_NAME` (required for enforcement)
      - `MEDIA_UPLOAD_MAX_BYTES_PER_DAY` (required; set to 0/unset to disable)
      - `MEDIA_UPLOAD_QUOTA_TABLE` (preferred) or falls back to `MEDIA_SIGNER_QUOTA_TABLE` / `AI_SUMMARY_TABLE` / `AI_HELPER_TABLE`
    - **IAM**:
      - `s3:GetObject` on `arn:aws:s3:::<MEDIA_BUCKET_NAME>/*` (needed for HeadObject)
      - `dynamodb:UpdateItem` on the chosen quota table

- **Authorizer** → `ws/wsAuthorizer.js`
  - Validates Cognito JWT and injects `{ sub, usernameLower, displayName }` into authorizer context

## Notes

- The deployed Lambda code in AWS should match these files.
- Each handler should document required environment variables at the top of the file.


