const { safeString } = require('./dmConversation');

function getJwtSub(event) {
  const claims = event.requestContext?.authorizer?.jwt?.claims || {};
  return safeString(claims.sub);
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function parseJsonBody(event) {
  const raw = event.body;
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

module.exports = {
  getJwtSub,
  jsonResponse,
  parseJsonBody,
};
