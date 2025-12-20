const {
  CognitoIdentityProviderClient,
  AdminUpdateUserAttributesCommand,
} = require('@aws-sdk/client-cognito-identity-provider');

const client = new CognitoIdentityProviderClient({});

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const publicKey = body.publicKey?.trim();
    if (!publicKey) {
      return { statusCode: 400, body: JSON.stringify({ message: 'publicKey is required' }) };
    }

    const sub = event.requestContext?.authorizer?.jwt?.claims?.sub;
    if (!sub) {
      return { statusCode: 401, body: JSON.stringify({ message: 'Unauthorized' }) };
    }

    await client.send(
      new AdminUpdateUserAttributesCommand({
        UserPoolId: process.env.USER_POOL_ID,
        Username: sub,
        UserAttributes: [
          {
            Name: 'custom:public_key',
            Value: publicKey,
          },
        ],
      })
    );

    return { statusCode: 204 };
  } catch (err) {
    console.error('attachPublicKey error', err);
    return { statusCode: 500, body: JSON.stringify({ message: 'Internal error' }) };
  }
};