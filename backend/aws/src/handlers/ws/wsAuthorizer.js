const { CognitoJwtVerifier } = require('aws-jwt-verify');

const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.COGNITO_USER_POOL_ID,
  tokenUse: 'id',
  clientId: process.env.COGNITO_CLIENT_ID,
});

function generatePolicy(principalId, effect, resource, context = {}) {
  return {
    principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [{ Action: 'execute-api:Invoke', Effect: effect, Resource: resource }],
    },
    context, // values must be strings
  };
}

function readToken(event) {
  // 1) Preferred: REQUEST authorizer identitySource
  const fromIdentitySource =
    Array.isArray(event.identitySource) && typeof event.identitySource[0] === 'string'
      ? event.identitySource[0]
      : null;

  // 2) Some gateways include query params directly
  const fromQueryParams =
    event.queryStringParameters && typeof event.queryStringParameters.token === 'string'
      ? event.queryStringParameters.token
      : null;

  // 3) Some include rawQueryString
  const raw = typeof event.rawQueryString === 'string' ? event.rawQueryString : '';
  const m = raw.match(/(?:^|&)token=([^&]+)/);
  const fromRawQueryString = m ? decodeURIComponent(m[1]) : null;

  // 4) TOKEN authorizer shape fallback
  const fromAuthToken = typeof event.authorizationToken === 'string' ? event.authorizationToken : null;

  return fromIdentitySource || fromQueryParams || fromRawQueryString || fromAuthToken || '';
}

exports.handler = async (event) => {
  const arn = event.routeArn || event.methodArn || '*';

  const token = readToken(event);
  try {
    if (!token) return generatePolicy('anon', 'Deny', arn);

    const payload = await verifier.verify(token);

    const sub = String(payload.sub || '');

    const displayName = String(
      payload.preferred_username || payload.email || payload['cognito:username'] || 'anon'
    ).trim();

    const usernameLower = displayName.toLowerCase();

    return generatePolicy(sub || usernameLower, 'Allow', arn, {
      sub,
      usernameLower,
      displayName,
    });
  } catch (err) {
    console.warn('wsAuthorizer verify failed', err?.name || 'Error', err?.message || '');
    return generatePolicy('anon', 'Deny', arn);
  }
};

// TODO: Paste deployed Lambda source for wsAuthorizer here.
exports.handler = async () => ({ isAuthorized: false });


