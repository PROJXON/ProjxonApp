variable "aws_region" {
  type        = string
  description = "AWS region for staging."
  default     = "us-east-2"
}

variable "name_suffix" {
  type        = string
  description = "Suffix appended to all staging resources."
  default     = "tf-staging"
}

variable "cognito_user_pool_id" {
  type        = string
  description = "Existing staging Cognito User Pool ID (from amplify_outputs.web.staging.json)."
}

variable "cognito_user_pool_client_id" {
  type        = string
  description = "Existing staging Cognito App Client ID (from amplify_outputs.web.staging.json)."
}

variable "lambda_zip_path" {
  type        = string
  description = "Path to backend zip for Lambda (must include handlers/ at zip root)."
}

variable "alarm_email" {
  type        = string
  description = "Optional: email to receive CloudWatch alarms. Empty disables alarms."
  default     = ""
}

variable "chime_sdk_region" {
  type        = string
  description = "Region for Amazon Chime SDK Meetings (control + media). App data stays in aws_region."
  default     = "us-east-1"
}