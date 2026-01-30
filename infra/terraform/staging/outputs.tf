output "staging_http_api_url" {
  value = aws_apigatewayv2_stage.http_default.invoke_url
}

output "staging_ws_url" {
  value = aws_apigatewayv2_stage.ws_stage.invoke_url
}