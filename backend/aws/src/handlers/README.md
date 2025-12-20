# Lambda source (tracked in repo)

This folder stores the **source code** for the AWS Lambdas used by ProjxonApp.

## Layout

- `http/`: Lambdas invoked by the HTTP API (API Gateway HTTP API v2)
- `ws/`: Lambdas invoked by the WebSocket API (API Gateway WebSockets)

## Notes

- The deployed Lambda code in AWS should match these files.
- Each handler should document required environment variables at the top of the file.


