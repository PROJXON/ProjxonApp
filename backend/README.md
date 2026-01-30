# Backend

This repo tracks the Lambda source code under `backend/aws/src/handlers/`.

## Terraform staging (IaC)

For staging (used by Playwright E2E and learning/resume work), the backend is provisioned with **Terraform**:

- Terraform config: `infra/terraform/staging/`
- Deploy artifact: `backend/aws/dist/backend.zip` (built from `backend/aws/src` + `backend/aws/node_modules`)
- Outputs: `terraform output` prints the **HTTP** and **WebSocket** URLs used by CI (`STAGING_API_URL`, `STAGING_WS_URL`)

See `infra/terraform/staging/README.md` for the exact workflow.

## Where the backend code lives

- Lambda handlers (HTTP + WebSocket + async worker): `backend/aws/src/handlers/`
  - Note: Terraform staging bundles shared libs directly into the Lambda zip (no Lambda Layers).

## Setup docs

- Routes → Lambdas (HTTP + WebSocket): `backend/aws/src/handlers/README.md`
- Required DynamoDB tables + GSIs (manual): `backend/aws/src/handlers/README.md`

## AI streaming (SSE)

The backend includes **streaming-capable** variants of the AI endpoints:

- `backend/aws/src/handlers/http/aiHelperStream.js` (streaming variant of **POST `/ai/helper`**)
- `backend/aws/src/handlers/http/aiSummaryStream.js` (streaming variant of **POST `/ai/summary`**)

Important:
- **API Gateway HTTP API v2 may buffer responses** and not stream to clients.
- For true streaming, wire these handlers behind a **streaming-capable integration** (e.g. **Lambda Function URL** with `InvokeMode=RESPONSE_STREAM`, or **API Gateway REST API** response streaming).
