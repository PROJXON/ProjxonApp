# Testing (Jest + Playwright)

This repo uses **Jest** for unit/integration tests and **Playwright** for end‑to‑end (E2E) tests of the web build (RN Web).

## Jest (unit/integration)

Run from `frontend/`:

```bash
npm test
```

Useful variants:

```bash
npm run test:watch
npm run test:ci
```

## Playwright (E2E)

E2E tests live in `frontend/e2e/`:

- `smoke.guest.spec.ts`: guest can load and open sign‑in modal
- `smoke.signedin.spec.ts`: signed‑in user can send a message and survive a reload

### Local: run E2E against a **static export**

Playwright is most stable against a static export (`expo export`) rather than Metro.

From `frontend/` (recommended: one command; Playwright will export + serve automatically when `E2E_BASE_URL` is local):

```bash
ORKA_ENV=staging \
STAGING_API_URL="https://biihelt40a.execute-api.us-east-2.amazonaws.com/" \
STAGING_WS_URL="wss://ux6kuwr0o0.execute-api.us-east-2.amazonaws.com/tf-staging" \
E2E_BASE_URL="http://127.0.0.1:4173" \
npm run e2e
```

If you prefer to do it manually (or want to inspect the output folder), you can export + serve yourself:

```bash
ORKA_ENV=staging \
STAGING_API_URL="https://biihelt40a.execute-api.us-east-2.amazonaws.com/" \
STAGING_WS_URL="wss://ux6kuwr0o0.execute-api.us-east-2.amazonaws.com/tf-staging" \
npx expo export -p web --output-dir dist-staging --clear

npx http-server dist-staging -p 4173 -c-1
```

In another terminal, set E2E auth env vars:

```bash
export E2E_BASE_URL="http://127.0.0.1:4173"
export E2E_EMAIL="your-staging-email"
export E2E_PASSWORD="your-staging-password"
export E2E_RECOVERY_PASSPHRASE="your-recovery-passphrase"
```

Run Playwright (if you didn’t already via the one-command flow above):

```bash
npm run e2e
```

Or interactive UI:

```bash
npm run e2e:ui
```

### Why `--clear` and `dist-staging` matter

For RN Web builds, it’s easy to accidentally serve a bundle that still has **production** `API_URL/WS_URL` baked in (from `frontend/app.json`) even if you intended staging. The reliable pattern is:

- export to a dedicated folder (`dist-staging`)
- pass staging env vars
- include `--clear` to avoid cached bundles

### Auth state (`storageState`)

Playwright `globalSetup` writes an auth state file:

- `frontend/e2e/.auth/staging.json`

This file is **local-only** and should not be committed (it’s ignored by `.gitignore`).

### Staging Amplify outputs file (required for CI)

The staging web build imports `frontend/amplify_outputs.web.staging.json` (used by `App.tsx` when `ORKA_ENV=staging`).
This file should be committed so GitHub Actions can bundle the staging build during `expo export`.

## CI (GitHub Actions)

The workflow `.github/workflows/frontend-ci.yml` includes an `e2e-web-staging` job that:

- installs dependencies
- installs Playwright Chromium
- exports the web build with `--clear` to `dist-staging`
- serves it on `127.0.0.1:4173`
- runs `npx playwright test`
- uploads `playwright-report/` and `test-results/` as artifacts

### Required repo secrets

Add these in GitHub:

`Settings → Secrets and variables → Actions → New repository secret`

- `E2E_EMAIL`
- `E2E_PASSWORD`
- `E2E_RECOVERY_PASSPHRASE`

