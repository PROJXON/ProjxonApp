# Terraform staging backend

This folder provisions a **Terraform-managed staging backend** for OrkaChat:

- DynamoDB tables (staging suffix)
- Lambda functions (Node.js) deployed from a local zip
- API Gateway v2:
  - HTTP API (JWT authorizer: Cognito)
  - WebSocket API (REQUEST authorizer: Lambda)
- Outputs: `staging_http_api_url`, `staging_ws_url`
- Optional alarms: SNS email + CloudWatch alarms (controlled by `alarm_email`)

## Prereqs

- Terraform installed
- AWS credentials configured locally (profile/env/SSO)

## Variables (tfvars)

This repo ignores `*.tfvars` by default, so keep your real values local.

Create `terraform.tfvars` (example values):

```hcl
cognito_user_pool_id        = "us-east-2_XXXXXXXXX"
cognito_user_pool_client_id = "xxxxxxxxxxxxxxxxxxxxxxxxxx"

# Path is relative to this folder:
lambda_zip_path = "../../../backend/aws/dist/backend.zip"

name_suffix = "tf-staging"

# Empty string disables alarms:
alarm_email = "you@example.com"
```

## Build the Lambda zip

Terraform deploys Lambda code using the zip at `lambda_zip_path`.

The zip must contain these folders at the **zip root**:

- `handlers/`
- `lib/`
- `node_modules/`

The recommended build is:

1. `cd backend/aws && npm install` (creates `node_modules/`, including `@aws-sdk/client-chime-sdk-meetings`)
2. Zip `backend/aws/src/handlers`, `backend/aws/src/lib`, and `backend/aws/node_modules` into `backend/aws/dist/backend.zip`

## Deploy

From this directory:

```bash
terraform init
terraform plan
terraform apply
```

## Outputs (URLs for CI/E2E)

After apply:

```bash
terraform output
```

Use:

- `staging_http_api_url` → `STAGING_API_URL`
- `staging_ws_url` → `STAGING_WS_URL`

## Alarms (optional)

If `alarm_email` is non-empty, Terraform creates:

- an SNS topic + email subscription (you must confirm the email)
- CloudWatch alarms for core Lambda Errors/Throttles and HTTP API 5XX

## State note

State (`*.tfstate`) is ignored by git in this repo. If you switch branches/worktrees, keep the state file safe or migrate to a remote backend (S3 + DynamoDB lock) to avoid losing state.

