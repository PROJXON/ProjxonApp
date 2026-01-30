# OrkaChat frontend (Expo / React Native / Web)

This is the **Expo** app for OrkaChat (React Native + RN Web), written in **TypeScript**.

## Setup

From `frontend/`:

```bash
npm install
npm start
```

Useful scripts:

- **web**: `npm run web`
- **android**: `npm run android`
- **ios** (macOS): `npm run ios`
- **static export**: `npm run build:web` (outputs `dist/`)
- **tests**: `npm test` (or `npm run test:watch`, `npm run test:ci`)

## Runtime configuration (API / WS / AI / CDN)

URLs are sourced from:

- `app.json` → `expo.extra`:
  - `API_URL`
  - `WS_URL`
  - `AI_API_URL` (**optional**: dedicated base URL for AI, e.g. streaming-capable endpoint)
- `amplify_outputs.web.json` / `amplify_outputs.json` (preferred for CDN + signer URLs)
- Code: `src/config/env.ts`

### Staging backend (Terraform)

For Playwright E2E (CI + local), the staging backend is provisioned by Terraform in `infra/terraform/staging/`.
Use `terraform output` from that folder to get the current:

- `STAGING_API_URL` (HTTP API base URL)
- `STAGING_WS_URL` (WebSocket `wss://...` URL)

## AI streaming (SSE)

The app supports **streamed AI responses** for:

- **AI summary** (`/ai/summary`)
- **AI helper** (`/ai/helper`)

How it works:

- If the server responds with `Content-Type: text/event-stream`, the UI progressively updates using SSE parsing.
- On **native** (iOS/Android), streaming uses `expo/fetch` (standard `fetch` often doesn’t expose a readable stream on React Native).
- On **web**, standard `fetch` is used.

Backend note:

- Streaming requires wiring the backend handler behind a **streaming-capable integration** (see `backend/README.md` and `backend/aws/src/handlers/README.md`).
- If your main `API_URL` is an API Gateway HTTP API (buffered), set `AI_API_URL` to the streaming base URL.

## Attachments + native file viewer

Attachments can be opened with the OS viewer/share sheet using `src/utils/openExternalFile.ts`.

- **Web**: opens in a new tab (optionally gated by a confirmation modal).
- **Android**: prefers a proper `VIEW` intent (via `expo-intent-launcher`) with a `content://` URI when possible.
- **iOS**: falls back to the share/open sheet (via `expo-sharing`) for good “Open in…” UX.

The app also guesses common MIME types from filename (PDF, Office docs, archives, audio/video/images, etc.) to improve viewer selection.

## Voice clips + inline audio playback

- Voice clip recording is implemented by `src/features/chat/components/VoiceClipMicButton.tsx` (native) and `VoiceClipMicButton.web.tsx` (web).
- Inline audio playback is handled by `src/features/chat/useChatAudioPlayback.ts` so clips can be played in-place.

## Local UI caches (AsyncStorage)

To reduce “flash of unknown” and speed up cold starts, the app caches some UI-hydration state in **AsyncStorage**, including:

- Display name (device hint)
- Avatar settings (per signed-in user)
- Channel name labels for fast header hydration
- “Last opened” DM/channel conversation IDs

## Testing (Jest)

Jest is configured with `jest-expo` (unit + component tests):

- Config: `jest.config.js`
- Setup: `jest.setup.ts`

Run:

```bash
npm test
```

## Testing (Playwright E2E)

Playwright tests live in `e2e/` and are intended to run against a **static web export** (more stable than Metro).

Scripts:

- `npm run e2e` (headless by default)
- `npm run e2e:ui` (interactive UI)

For local runs, `npm run e2e` will auto-export + auto-serve when `E2E_BASE_URL` is local (e.g. `http://127.0.0.1:4173`).
Signed-in E2E uses Playwright `globalSetup` (`e2e/global-setup.ts`) to perform a one-time login and write `e2e/.auth/staging.json` (`storageState`), so signed-in tests simulate a returning, already-authenticated device.
See `../docs/testing.md` for the staging workflow and CI setup.

## License

MIT (see root `LICENSE`).
