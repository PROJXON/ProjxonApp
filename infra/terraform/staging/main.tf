data "aws_caller_identity" "current" {}

locals {
  # Standard tags applied to every resource we create.
  tags = {
    owner       = "evan"
    project     = "chat-app"
    environment = "staging"
    managed     = "terraform"
  }

  # Naming convention: existing staging names + "-tf-staging"
  suffix = var.name_suffix

  # Reuse existing staging Cognito (from frontend/amplify_outputs.web.staging.json)
  # User pool ARN format (AWS-defined):
  # arn:aws:cognito-idp:<region>:<account_id>:userpool/<user_pool_id>
  cognito_user_pool_arn = "arn:aws:cognito-idp:${var.aws_region}:${data.aws_caller_identity.current.account_id}:userpool/${var.cognito_user_pool_id}"
  # ---------- DynamoDB table names ----------
  users_table           = "Users-${local.suffix}"
  messages_table        = "Messages-${local.suffix}"
  connections_table     = "Connections-${local.suffix}"
  recovery_table        = "Recovery-${local.suffix}"
  unreads_table         = "UnreadDmConversations-${local.suffix}"
  channels_table        = "Channels-${local.suffix}"
  channel_members_table = "ChannelMembers-${local.suffix}"

  lambda_runtime = "nodejs20.x"

  http_api_name = "ProjxonChatHTTP-${local.suffix}"
  ws_api_name   = "ProjxonChat-${local.suffix}"

  cognito_issuer = "https://cognito-idp.${var.aws_region}.amazonaws.com/${var.cognito_user_pool_id}"
}

# -------------------------
# DynamoDB: Users-tf-staging
# -------------------------
resource "aws_dynamodb_table" "users" {
  name         = local.users_table
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userSub"

  attribute {
    name = "userSub"
    type = "S"
  }

  attribute {
    name = "usernameLower"
    type = "S"
  }

  # GSI required by backend lookups (case-insensitive username lookups)
  global_secondary_index {
    name            = "byUsernameLower"
    hash_key        = "usernameLower"
    projection_type = "ALL"
  }

  tags = local.tags
}

# -------------------------
# DynamoDB: Messages-tf-staging
# -------------------------
resource "aws_dynamodb_table" "messages" {
  name         = local.messages_table
  billing_mode = "PAY_PER_REQUEST"

  # Primary key: PK conversationId (S), SK createdAt (N)
  hash_key  = "conversationId"
  range_key = "createdAt"

  attribute {
    name = "conversationId"
    type = "S"
  }

  attribute {
    name = "createdAt"
    type = "N"
  }

  # Optional TTL used by the app for expiring messages/tombstones.
  ttl {
    enabled        = true
    attribute_name = "expiresAt"
  }

  tags = local.tags
}

# -------------------------
# DynamoDB: Connections-tf-staging
# -------------------------
resource "aws_dynamodb_table" "connections" {
  name         = local.connections_table
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "connectionId"

  attribute {
    name = "connectionId"
    type = "S"
  }

  attribute {
    name = "conversationId"
    type = "S"
  }

  attribute {
    name = "userSub"
    type = "S"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  global_secondary_index {
    name               = "byConversation"
    hash_key           = "conversationId"
    projection_type    = "INCLUDE"
    non_key_attributes = ["connectionId"]
  }

  global_secondary_index {
    name               = "byConversationWithUser"
    hash_key           = "conversationId"
    range_key          = "connectionId"
    projection_type    = "INCLUDE"
    non_key_attributes = ["connectionId", "userSub"]
  }

  global_secondary_index {
    name               = "byUserSub"
    hash_key           = "userSub"
    projection_type    = "INCLUDE"
    non_key_attributes = ["connectionId"]
  }

  tags = local.tags
}

# -------------------------
# DynamoDB: Recovery-tf-staging
# -------------------------
resource "aws_dynamodb_table" "recovery" {
  name         = local.recovery_table
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "sub"

  attribute {
    name = "sub"
    type = "S"
  }

  tags = local.tags
}

# -------------------------
# DynamoDB: UnreadDmConversations-tf-staging
# -------------------------
resource "aws_dynamodb_table" "unreads" {
  name         = local.unreads_table
  billing_mode = "PAY_PER_REQUEST"

  # PK userSub (S), SK conversationId (S)
  hash_key  = "userSub"
  range_key = "conversationId"

  attribute {
    name = "userSub"
    type = "S"
  }

  attribute {
    name = "conversationId"
    type = "S"
  }

  tags = local.tags
}

# -------------------------
# DynamoDB: Channels-tf-staging
# -------------------------
resource "aws_dynamodb_table" "channels" {
  name         = local.channels_table
  billing_mode = "PAY_PER_REQUEST"

  # PK channelId (S)
  hash_key = "channelId"

  attribute {
    name = "channelId"
    type = "S"
  }

  attribute {
    name = "nameLower"
    type = "S"
  }

  attribute {
    name = "publicIndexPk"
    type = "S"
  }

  attribute {
    name = "publicRankSk"
    type = "S"
  }

  global_secondary_index {
    name            = "byNameLower"
    hash_key        = "nameLower"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "byPublicRank"
    hash_key        = "publicIndexPk"
    range_key       = "publicRankSk"
    projection_type = "ALL"
  }

  tags = local.tags
}

# -------------------------
# DynamoDB: ChannelMembers-tf-staging
# -------------------------
resource "aws_dynamodb_table" "channel_members" {
  name         = local.channel_members_table
  billing_mode = "PAY_PER_REQUEST"

  # PK channelId (S), SK memberSub (S)
  hash_key  = "channelId"
  range_key = "memberSub"

  attribute {
    name = "channelId"
    type = "S"
  }

  attribute {
    name = "memberSub"
    type = "S"
  }

  global_secondary_index {
    name            = "byMemberSub"
    hash_key        = "memberSub"
    range_key       = "channelId"
    projection_type = "ALL"
  }

  tags = local.tags
}

# -------------------------
# IAM: Trust policy for Lambda
# -------------------------
data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }

    actions = ["sts:AssumeRole"]
  }
}

# -------------------------
# IAM: HTTP Lambda role
# -------------------------
resource "aws_iam_role" "lambda_http_exec" {
  name               = "chat-app-lambda-http-exec-${local.suffix}"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
  tags               = local.tags
}

data "aws_iam_policy_document" "lambda_http_inline" {
  # CloudWatch Logs
  statement {
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents"
    ]
    resources = ["*"]
  }

  # DynamoDB (HTTP handlers)
  statement {
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
      "dynamodb:Scan",
      "dynamodb:BatchGetItem",
      "dynamodb:BatchWriteItem"
    ]
    resources = [
      aws_dynamodb_table.users.arn,
      "${aws_dynamodb_table.users.arn}/index/*",
      aws_dynamodb_table.messages.arn,
      "${aws_dynamodb_table.messages.arn}/index/*",
      aws_dynamodb_table.recovery.arn,
      "${aws_dynamodb_table.recovery.arn}/index/*",
      aws_dynamodb_table.unreads.arn,
      "${aws_dynamodb_table.unreads.arn}/index/*",
      aws_dynamodb_table.channels.arn,
      "${aws_dynamodb_table.channels.arn}/index/*",
      aws_dynamodb_table.channel_members.arn,
      "${aws_dynamodb_table.channel_members.arn}/index/*"
    ]
  }

  # Cognito admin delete user (used by /account/delete)
  statement {
    effect    = "Allow"
    actions   = ["cognito-idp:AdminDeleteUser"]
    resources = [local.cognito_user_pool_arn]
  }
}

resource "aws_iam_role_policy" "lambda_http_exec_inline" {
  name   = "chat-app-lambda-http-exec-${local.suffix}"
  role   = aws_iam_role.lambda_http_exec.id
  policy = data.aws_iam_policy_document.lambda_http_inline.json
}

# -------------------------
# IAM: WebSocket Lambda role
# -------------------------
resource "aws_iam_role" "lambda_ws_exec" {
  name               = "chat-app-lambda-ws-exec-${local.suffix}"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
  tags               = local.tags
}

data "aws_iam_policy_document" "lambda_ws_inline" {
  # CloudWatch Logs
  statement {
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents"
    ]
    resources = ["*"]
  }

  # DynamoDB (WS handlers)
  statement {
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
      "dynamodb:Scan",
      "dynamodb:BatchGetItem",
      "dynamodb:BatchWriteItem"
    ]
    resources = [
      aws_dynamodb_table.connections.arn,
      "${aws_dynamodb_table.connections.arn}/index/*",
      aws_dynamodb_table.messages.arn,
      "${aws_dynamodb_table.messages.arn}/index/*",
      aws_dynamodb_table.users.arn,
      "${aws_dynamodb_table.users.arn}/index/*",
      aws_dynamodb_table.unreads.arn,
      "${aws_dynamodb_table.unreads.arn}/index/*",
      aws_dynamodb_table.channels.arn,
      "${aws_dynamodb_table.channels.arn}/index/*",
      aws_dynamodb_table.channel_members.arn,
      "${aws_dynamodb_table.channel_members.arn}/index/*"
    ]
  }
}

resource "aws_iam_role_policy" "lambda_ws_exec_inline" {
  name   = "chat-app-lambda-ws-exec-${local.suffix}"
  role   = aws_iam_role.lambda_ws_exec.id
  policy = data.aws_iam_policy_document.lambda_ws_inline.json
}

resource "aws_lambda_function" "get_messages" {
  function_name    = "getMessages-${local.suffix}"
  role             = aws_iam_role.lambda_http_exec.arn
  runtime          = local.lambda_runtime
  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)
  handler          = "handlers/http/getMessages.handler"

  environment {
    variables = {
      MESSAGES_TABLE        = aws_dynamodb_table.messages.name
      USERS_TABLE           = aws_dynamodb_table.users.name
      CHANNELS_TABLE        = aws_dynamodb_table.channels.name
      CHANNEL_MEMBERS_TABLE = aws_dynamodb_table.channel_members.name
      UNREADS_TABLE         = aws_dynamodb_table.unreads.name
      CONNECTIONS_TABLE     = aws_dynamodb_table.connections.name
      # Optional tables you are NOT creating for staging are intentionally omitted.
    }
  }

  tags = local.tags
}

resource "aws_lambda_function" "get_public_messages" {
  function_name    = "getPublicMessages-${local.suffix}"
  role             = aws_iam_role.lambda_http_exec.arn
  runtime          = local.lambda_runtime
  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)
  handler          = "handlers/http/getPublicMessages.handler"

  environment {
    variables = {
      MESSAGES_TABLE        = aws_dynamodb_table.messages.name
      USERS_TABLE           = aws_dynamodb_table.users.name
      CHANNELS_TABLE        = aws_dynamodb_table.channels.name
      CHANNEL_MEMBERS_TABLE = aws_dynamodb_table.channel_members.name
    }
  }

  tags = local.tags
}

resource "aws_lambda_function" "get_public_user" {
  function_name    = "getPublicUser-${local.suffix}"
  role             = aws_iam_role.lambda_http_exec.arn
  runtime          = local.lambda_runtime
  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)
  handler          = "handlers/http/getPublicUser.handler"

  environment {
    variables = {
      USERS_TABLE = aws_dynamodb_table.users.name
    }
  }

  tags = local.tags
}

resource "aws_lambda_function" "get_public_users_batch" {
  function_name    = "getPublicUsersBatch-${local.suffix}"
  role             = aws_iam_role.lambda_http_exec.arn
  runtime          = local.lambda_runtime
  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)
  handler          = "handlers/http/getPublicUsersBatch.handler"

  environment {
    variables = {
      USERS_TABLE = aws_dynamodb_table.users.name
    }
  }

  tags = local.tags
}

resource "aws_lambda_function" "get_user" {
  function_name    = "getUser-${local.suffix}"
  role             = aws_iam_role.lambda_http_exec.arn
  runtime          = local.lambda_runtime
  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)
  handler          = "handlers/http/getUser.handler"

  environment {
    variables = {
      USERS_TABLE = aws_dynamodb_table.users.name
    }
  }

  tags = local.tags
}

resource "aws_lambda_function" "attach_public_key" {
  function_name    = "attachPublicKey-${local.suffix}"
  role             = aws_iam_role.lambda_http_exec.arn
  runtime          = local.lambda_runtime
  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)
  handler          = "handlers/http/attachPublicKey.handler"

  environment {
    variables = {
      USERS_TABLE = aws_dynamodb_table.users.name
    }
  }

  tags = local.tags
}

resource "aws_lambda_function" "get_unread_dms" {
  function_name    = "getUnreadDms-${local.suffix}"
  role             = aws_iam_role.lambda_http_exec.arn
  runtime          = local.lambda_runtime
  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)
  handler          = "handlers/http/getUnreadDms.handler"

  environment {
    variables = {
      UNREADS_TABLE = aws_dynamodb_table.unreads.name
    }
  }

  tags = local.tags
}

resource "aws_lambda_function" "create_recovery" {
  function_name    = "createRecovery-${local.suffix}"
  role             = aws_iam_role.lambda_http_exec.arn
  runtime          = local.lambda_runtime
  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)
  handler          = "handlers/http/createRecovery.handler"

  environment {
    variables = {
      RECOVERY_TABLE = aws_dynamodb_table.recovery.name
    }
  }

  tags = local.tags
}

resource "aws_lambda_function" "get_recovery" {
  function_name    = "getRecovery-${local.suffix}"
  role             = aws_iam_role.lambda_http_exec.arn
  runtime          = local.lambda_runtime
  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)
  handler          = "handlers/http/getRecovery.handler"

  environment {
    variables = {
      RECOVERY_TABLE = aws_dynamodb_table.recovery.name
    }
  }

  tags = local.tags
}

resource "aws_lambda_function" "channels_search" {
  function_name    = "channelsSearch-${local.suffix}"
  role             = aws_iam_role.lambda_http_exec.arn
  runtime          = local.lambda_runtime
  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)
  handler          = "handlers/http/channelsSearch.handler"

  environment {
    variables = {
      CHANNELS_TABLE        = aws_dynamodb_table.channels.name
      CHANNEL_MEMBERS_TABLE = aws_dynamodb_table.channel_members.name
      USERS_TABLE           = aws_dynamodb_table.users.name
      # STATS_TABLE is optional; omitted.
    }
  }

  tags = local.tags
}

resource "aws_lambda_function" "channels_create" {
  function_name    = "channelsCreate-${local.suffix}"
  role             = aws_iam_role.lambda_http_exec.arn
  runtime          = local.lambda_runtime
  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)
  handler          = "handlers/http/channelsCreate.handler"

  environment {
    variables = {
      CHANNELS_TABLE        = aws_dynamodb_table.channels.name
      CHANNEL_MEMBERS_TABLE = aws_dynamodb_table.channel_members.name
    }
  }

  tags = local.tags
}

resource "aws_lambda_function" "channels_join" {
  function_name    = "channelsJoin-${local.suffix}"
  role             = aws_iam_role.lambda_http_exec.arn
  runtime          = local.lambda_runtime
  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)
  handler          = "handlers/http/channelsJoin.handler"

  environment {
    variables = {
      CHANNELS_TABLE        = aws_dynamodb_table.channels.name
      CHANNEL_MEMBERS_TABLE = aws_dynamodb_table.channel_members.name
    }
  }

  tags = local.tags
}

resource "aws_lambda_function" "channels_update" {
  function_name    = "channelsUpdate-${local.suffix}"
  role             = aws_iam_role.lambda_http_exec.arn
  runtime          = local.lambda_runtime
  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)
  handler          = "handlers/http/channelsUpdate.handler"

  environment {
    variables = {
      CHANNELS_TABLE        = aws_dynamodb_table.channels.name
      CHANNEL_MEMBERS_TABLE = aws_dynamodb_table.channel_members.name
      USERS_TABLE           = aws_dynamodb_table.users.name
    }
  }

  tags = local.tags
}

resource "aws_lambda_function" "ws_authorizer" {
  function_name    = "wsAuthorizer-${local.suffix}"
  role             = aws_iam_role.lambda_ws_exec.arn
  runtime          = local.lambda_runtime
  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)
  handler          = "handlers/ws/wsAuthorizer.handler"

  environment {
    variables = {
      COGNITO_USER_POOL_ID = var.cognito_user_pool_id
      COGNITO_CLIENT_ID    = var.cognito_user_pool_client_id
    }
  }

  tags = local.tags
}

resource "aws_lambda_function" "ws_connect" {
  function_name    = "wsConnect-${local.suffix}"
  role             = aws_iam_role.lambda_ws_exec.arn
  runtime          = local.lambda_runtime
  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)
  handler          = "handlers/ws/wsConnect.handler"

  environment {
    variables = {
      CONNECTIONS_TABLE = aws_dynamodb_table.connections.name
    }
  }

  tags = local.tags
}

resource "aws_lambda_function" "ws_disconnect" {
  function_name    = "wsDisconnect-${local.suffix}"
  role             = aws_iam_role.lambda_ws_exec.arn
  runtime          = local.lambda_runtime
  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)
  handler          = "handlers/ws/wsDisconnect.handler"

  environment {
    variables = {
      CONNECTIONS_TABLE = aws_dynamodb_table.connections.name
    }
  }

  tags = local.tags
}

resource "aws_lambda_function" "ws_message" {
  function_name    = "wsMessage-${local.suffix}"
  role             = aws_iam_role.lambda_ws_exec.arn
  runtime          = local.lambda_runtime
  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)
  handler          = "handlers/ws/wsMessage.handler"

  environment {
    variables = {
      CONNECTIONS_TABLE     = aws_dynamodb_table.connections.name
      MESSAGES_TABLE        = aws_dynamodb_table.messages.name
      USERS_TABLE           = aws_dynamodb_table.users.name
      UNREADS_TABLE         = aws_dynamodb_table.unreads.name
      CHANNELS_TABLE        = aws_dynamodb_table.channels.name
      CHANNEL_MEMBERS_TABLE = aws_dynamodb_table.channel_members.name
      # READS_TABLE omitted (you’re not using it for staging)
    }
  }

  tags = local.tags
}

resource "aws_apigatewayv2_api" "http_api" {
  name          = local.http_api_name
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_headers = ["*"]
  }

  tags = local.tags
}

resource "aws_apigatewayv2_authorizer" "http_jwt" {
  api_id          = aws_apigatewayv2_api.http_api.id
  authorizer_type = "JWT"
  name            = "cognito-jwt"

  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    issuer   = local.cognito_issuer
    audience = [var.cognito_user_pool_client_id]
  }
}

resource "aws_apigatewayv2_stage" "http_default" {
  api_id      = aws_apigatewayv2_api.http_api.id
  name        = "$default"
  auto_deploy = true

  tags = local.tags
}

resource "aws_apigatewayv2_integration" "http_get_public_messages" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.get_public_messages.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "http_get_public_messages" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "GET /public/messages"
  target    = "integrations/${aws_apigatewayv2_integration.http_get_public_messages.id}"
}

resource "aws_apigatewayv2_integration" "http_get_public_user" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.get_public_user.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "http_get_public_user" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "GET /public/users"
  target    = "integrations/${aws_apigatewayv2_integration.http_get_public_user.id}"
}

resource "aws_apigatewayv2_integration" "http_post_public_users_batch" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.get_public_users_batch.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "http_post_public_users_batch" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "POST /public/users/batch"
  target    = "integrations/${aws_apigatewayv2_integration.http_post_public_users_batch.id}"
}

resource "aws_apigatewayv2_integration" "http_get_messages" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.get_messages.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "http_get_messages" {
  api_id             = aws_apigatewayv2_api.http_api.id
  route_key          = "GET /messages"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.http_jwt.id
  target             = "integrations/${aws_apigatewayv2_integration.http_get_messages.id}"
}

resource "aws_apigatewayv2_integration" "http_get_user" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.get_user.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "http_get_user" {
  api_id             = aws_apigatewayv2_api.http_api.id
  route_key          = "GET /users"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.http_jwt.id
  target             = "integrations/${aws_apigatewayv2_integration.http_get_user.id}"
}

resource "aws_apigatewayv2_integration" "http_post_users_public_key" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.attach_public_key.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "http_post_users_public_key" {
  api_id             = aws_apigatewayv2_api.http_api.id
  route_key          = "POST /users/public-key"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.http_jwt.id
  target             = "integrations/${aws_apigatewayv2_integration.http_post_users_public_key.id}"
}

resource "aws_apigatewayv2_integration" "http_get_recovery" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.get_recovery.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "http_get_recovery" {
  api_id             = aws_apigatewayv2_api.http_api.id
  route_key          = "GET /users/recovery"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.http_jwt.id
  target             = "integrations/${aws_apigatewayv2_integration.http_get_recovery.id}"
}

resource "aws_apigatewayv2_integration" "http_post_recovery" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.create_recovery.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "http_post_recovery" {
  api_id             = aws_apigatewayv2_api.http_api.id
  route_key          = "POST /users/recovery"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.http_jwt.id
  target             = "integrations/${aws_apigatewayv2_integration.http_post_recovery.id}"
}

resource "aws_apigatewayv2_integration" "http_get_unreads" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.get_unread_dms.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "http_get_unreads" {
  api_id             = aws_apigatewayv2_api.http_api.id
  route_key          = "GET /unreads"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.http_jwt.id
  target             = "integrations/${aws_apigatewayv2_integration.http_get_unreads.id}"
}

# Reuse channelsSearch for both authed and public search paths.
resource "aws_apigatewayv2_integration" "http_channels_search" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.channels_search.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "http_channels_search_authed" {
  api_id             = aws_apigatewayv2_api.http_api.id
  route_key          = "GET /channels/search"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.http_jwt.id
  target             = "integrations/${aws_apigatewayv2_integration.http_channels_search.id}"
}

resource "aws_apigatewayv2_route" "http_channels_search_public" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "GET /public/channels/search"
  target    = "integrations/${aws_apigatewayv2_integration.http_channels_search.id}"
}

resource "aws_apigatewayv2_integration" "http_channels_create" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.channels_create.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "http_channels_create" {
  api_id             = aws_apigatewayv2_api.http_api.id
  route_key          = "POST /channels/create"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.http_jwt.id
  target             = "integrations/${aws_apigatewayv2_integration.http_channels_create.id}"
}

resource "aws_apigatewayv2_integration" "http_channels_join" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.channels_join.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "http_channels_join" {
  api_id             = aws_apigatewayv2_api.http_api.id
  route_key          = "POST /channels/join"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.http_jwt.id
  target             = "integrations/${aws_apigatewayv2_integration.http_channels_join.id}"
}

resource "aws_apigatewayv2_integration" "http_channels_update" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.channels_update.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "http_channels_update" {
  api_id             = aws_apigatewayv2_api.http_api.id
  route_key          = "POST /channels/update"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.http_jwt.id
  target             = "integrations/${aws_apigatewayv2_integration.http_channels_update.id}"
}

resource "aws_lambda_permission" "http_invoke_all" {
  for_each = {
    get_messages           = aws_lambda_function.get_messages.arn
    get_public_messages    = aws_lambda_function.get_public_messages.arn
    get_public_user        = aws_lambda_function.get_public_user.arn
    get_public_users_batch = aws_lambda_function.get_public_users_batch.arn
    get_user               = aws_lambda_function.get_user.arn
    attach_public_key      = aws_lambda_function.attach_public_key.arn
    get_unread_dms         = aws_lambda_function.get_unread_dms.arn
    get_recovery           = aws_lambda_function.get_recovery.arn
    create_recovery        = aws_lambda_function.create_recovery.arn
    channels_search        = aws_lambda_function.channels_search.arn
    channels_create        = aws_lambda_function.channels_create.arn
    channels_join          = aws_lambda_function.channels_join.arn
    channels_update        = aws_lambda_function.channels_update.arn
  }

  statement_id  = "AllowInvokeHttpApi-${each.key}"
  action        = "lambda:InvokeFunction"
  function_name = each.value
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.execution_arn}/*/*"
}

resource "aws_apigatewayv2_api" "ws_api" {
  name                       = local.ws_api_name
  protocol_type              = "WEBSOCKET"
  route_selection_expression = "$request.body.action"
  tags                       = local.tags
}

resource "aws_apigatewayv2_integration" "ws_connect" {
  api_id                 = aws_apigatewayv2_api.ws_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.ws_connect.invoke_arn
  payload_format_version = "1.0"
}

resource "aws_apigatewayv2_integration" "ws_disconnect" {
  api_id                 = aws_apigatewayv2_api.ws_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.ws_disconnect.invoke_arn
  payload_format_version = "1.0"
}

resource "aws_apigatewayv2_integration" "ws_message" {
  api_id                 = aws_apigatewayv2_api.ws_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.ws_message.invoke_arn
  payload_format_version = "1.0"
}

resource "aws_apigatewayv2_authorizer" "ws_request" {
  api_id           = aws_apigatewayv2_api.ws_api.id
  name             = "ws-authorizer"
  authorizer_type  = "REQUEST"
  authorizer_uri   = "arn:aws:apigateway:${var.aws_region}:lambda:path/2015-03-31/functions/${aws_lambda_function.ws_authorizer.arn}/invocations"
  identity_sources = ["route.request.querystring.token"]
}

resource "aws_apigatewayv2_route" "ws_connect" {
  api_id             = aws_apigatewayv2_api.ws_api.id
  route_key          = "$connect"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.ws_request.id
  target             = "integrations/${aws_apigatewayv2_integration.ws_connect.id}"
}

resource "aws_apigatewayv2_route" "ws_disconnect" {
  api_id    = aws_apigatewayv2_api.ws_api.id
  route_key = "$disconnect"
  target    = "integrations/${aws_apigatewayv2_integration.ws_disconnect.id}"
}

resource "aws_apigatewayv2_route" "ws_message" {
  api_id    = aws_apigatewayv2_api.ws_api.id
  route_key = "message"
  target    = "integrations/${aws_apigatewayv2_integration.ws_message.id}"
}

resource "aws_apigatewayv2_stage" "ws_stage" {
  api_id      = aws_apigatewayv2_api.ws_api.id
  name        = local.suffix
  auto_deploy = true
  tags        = local.tags
}

resource "aws_lambda_permission" "ws_invoke_all" {
  for_each = {
    ws_connect    = aws_lambda_function.ws_connect.arn
    ws_disconnect = aws_lambda_function.ws_disconnect.arn
    ws_message    = aws_lambda_function.ws_message.arn
  }

  statement_id  = "AllowInvokeWsApi-${each.key}"
  action        = "lambda:InvokeFunction"
  function_name = each.value
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.ws_api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "ws_authorizer_invoke" {
  statement_id  = "AllowInvokeWsAuthorizer"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ws_authorizer.arn
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.ws_api.execution_arn}/authorizers/*"
}

# -------------------------
# Alarms (core)
# -------------------------

locals {
  alarms_enabled = trim(var.alarm_email) != ""

  # Create the topic only when alarms_enabled is true.
  alarm_topic_arn = try(aws_sns_topic.alarms[0].arn, null)

  # CloudWatch alarm_actions must be a list; empty list disables notifications.
  alarm_actions = local.alarm_topic_arn == null ? [] : [local.alarm_topic_arn]

  # Minimal: “is chat working?” alarms
  alarm_lambda_functions = {
    getMessages       = aws_lambda_function.get_messages.function_name
    getPublicMessages = aws_lambda_function.get_public_messages.function_name
    wsMessage         = aws_lambda_function.ws_message.function_name
    wsAuthorizer      = aws_lambda_function.ws_authorizer.function_name
  }
}

resource "aws_sns_topic" "alarms" {
  count = local.alarms_enabled ? 1 : 0
  name  = "chat-app-alarms-${local.suffix}"
  tags  = local.tags
}

resource "aws_sns_topic_subscription" "alarms_email" {
  count     = local.alarms_enabled ? 1 : 0
  topic_arn = aws_sns_topic.alarms[0].arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  for_each = local.alarms_enabled ? local.alarm_lambda_functions : {}

  alarm_name        = "lambda-errors-${each.key}-${local.suffix}"
  alarm_description = "Lambda Errors >= 1 in 1 minute (${each.key})"

  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = each.value
  }

  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions

  tags = local.tags
}

resource "aws_cloudwatch_metric_alarm" "lambda_throttles" {
  for_each = local.alarms_enabled ? local.alarm_lambda_functions : {}

  alarm_name        = "lambda-throttles-${each.key}-${local.suffix}"
  alarm_description = "Lambda Throttles >= 1 in 1 minute (${each.key})"

  namespace           = "AWS/Lambda"
  metric_name         = "Throttles"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = each.value
  }

  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions

  tags = local.tags
}

resource "aws_cloudwatch_metric_alarm" "http_5xx" {
  count = local.alarms_enabled ? 1 : 0

  alarm_name        = "http-api-5xx-${local.suffix}"
  alarm_description = "HTTP API 5XX >= 1 in 1 minute"

  namespace           = "AWS/ApiGateway"
  metric_name         = "5XXError"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    ApiId = aws_apigatewayv2_api.http_api.id
    Stage = aws_apigatewayv2_stage.http_default.name
  }

  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions

  tags = local.tags
}