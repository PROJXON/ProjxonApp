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
  - **Query**: `conversationId` (defaults to `global`), `limit` (default 50, max 200)
  - **Notes**: returns newest-first

- **GET `/public/messages`** → `http/getPublicMessages.js`
  - **Auth**: **Public** (no authorizer)
  - **Query**: `conversationId` (must be `global`), `limit` (default 50, max 200)
  - **Notes**: intended for guest/portfolio preview

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

- **GET `/users`** → `http/getUser.js`
  - **Auth**: JWT (current frontend expects this)
  - **Query**: `username` (case-insensitive) **or** `sub`
  - **Returns**: `{ sub, displayName, usernameLower?, public_key? }`

- **POST `/users/public-key`** → `http/attachPublicKey.js`
  - **Auth**: JWT
  - **Body**: `{ publicKey: string }`
  - **Notes**: stores `currentPublicKey` + `displayName` into the Users table (source of truth)

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
  - **Body**: `{ conversationId, peer?, instruction, messages: [{ user, text, createdAt }] }`
  - **Returns**: `{ answer, suggestions: string[] }`

- **POST `/push/token`** → `http/registerPushToken.js`
  - **Auth**: JWT
  - **Body**: `{ expoPushToken, platform?, deviceId? }`
  - **Notes**: stores the device’s Expo push token for DM notifications

- **POST `/push/token/delete`** → `http/unregisterPushToken.js`
  - **Auth**: JWT
  - **Body**: `{ expoPushToken?, deviceId? }`
  - **Notes**: removes a token on sign-out (prevents another account on the same device from receiving pushes)

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


