const {
  CognitoIdentityProviderClient,
  ListUsersCommand,
} = require('@aws-sdk/client-cognito-identity-provider');

const client = new CognitoIdentityProviderClient({});

exports.handler = async (event) => {
  try {
    const raw = String(event.queryStringParameters?.username || '').trim();
    const username = raw.toLowerCase();
    if (!username) {
      return { statusCode: 400, body: JSON.stringify({ message: 'username is required' }) };
    }

    const resp = await client.send(
      new ListUsersCommand({
        UserPoolId: process.env.USER_POOL_ID, // set this in your function env
        Filter: `preferred_username = "${username}"`,
        Limit: 1,
      })
    );

    const user = resp.Users?.[0];
    if (!user) {
      return { statusCode: 404, body: JSON.stringify({ message: 'User does not exist' }) };
    }

    const attrs = (user.Attributes || []).reduce((acc, attr) => {
      acc[attr.Name] = attr.Value;
      return acc;
    }, {});
    const canonical = attrs.preferred_username || attrs.email || user.Username;

    return {
      statusCode: 200,
      body: JSON.stringify({
        username: canonical,
        email: attrs.email,
        preferred_username: attrs.preferred_username,
        public_key: attrs['custom:public_key'],
      }),
    };
  } catch (err) {
    console.error('getUser error', err);
    return { statusCode: 500, body: JSON.stringify({ message: 'Internal error' }) };
  }
};