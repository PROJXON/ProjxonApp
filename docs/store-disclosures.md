# Store disclosures (Apple App Privacy + Google Data Safety)

This file is a **working checklist** to keep our store disclosures aligned with the current app build.

Last updated: 2026-01-03

## Features shipped

- Auth: Amazon Cognito (Amplify)
- Messaging: global + DMs (UGC)
- Media: attachments + avatars (S3/CloudFront)
- Push notifications: Expo notifications (DM notifications)
- Safety: block users, report message/user
- AI: summary + helper (sends message history to an AI provider when used)
- Guest mode: read-only access to global chat (public endpoints)

## Data types used by the app (high-level)

- **Identifiers**: Cognito user ID (sub), username/display name
- **Contact info**: email (via Cognito; used for account and support)
- **User content**: messages, attachments, avatars, reactions
- **Diagnostics**: server logs may contain non-sensitive request metadata (avoid tokens/PII in logs)
- **Push tokens**: Expo push token + device id
- **AI inputs** (optional feature): message text + optional attachment thumbnails (signed https URLs)

## Apple “App Privacy” notes (what to disclose)

You must ensure App Store Connect’s “App Privacy” answers match actual behavior:

- **User Content**
  - Chat messages and attachments (stored/processed)
- **Identifiers**
  - User ID (Cognito sub), device identifiers we generate for push (deviceId)
- **Contact info**
  - Email address (Cognito account attribute)
- **Other data**
  - Push token (device token)
- **AI processing**
  - When AI features are used, chat history (and optional thumbnails) are sent to an AI provider

Tracking:
- We do not implement ad tracking/IDFA flows in the current build.

## Google Play “Data safety” notes (what to disclose)

Ensure the Data Safety form matches:

- **Data collected**
  - Account identifiers + email
  - User-generated content (messages/media)
  - Push token
  - AI inputs (when feature is used)
- **Data shared**
  - AI provider when AI features are used
  - Cloud providers for hosting/storage/auth/notifications
- **Security**
  - Data in transit is sent over HTTPS
- **Deletion**
  - In-app delete account
  - Web delete account link (Hosted UI + API)

## Account deletion behavior (what we promise)

- **In-app deletion**: Menu → Delete account
- **Web deletion**: https://projxon.github.io/ProjxonApp/delete-account.html
- Deletes:
  - Users table row (profile + avatar pointers)
  - Push tokens
  - Recovery blob
  - Blocklist entries (best-effort)
  - Conversation index/unread entries (best-effort)
  - Cognito user (AdminDeleteUser enabled)
- May remain:
  - Messages already delivered to other users may remain visible
  - Cached media may take a short time to fully disappear

