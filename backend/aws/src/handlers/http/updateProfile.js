const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function normalizeHexColor(input) {
  const s = typeof input === 'string' ? input.trim() : '';
  if (!s) return null;
  const withHash = s.startsWith('#') ? s : `#${s}`;
  // Accept both #RRGGBB and shorthand #RGB, normalize to #RRGGBB uppercase.
  if (/^#[0-9a-fA-F]{6}$/.test(withHash)) return withHash.toUpperCase();
  if (/^#[0-9a-fA-F]{3}$/.test(withHash)) {
    const r = withHash[1];
    const g = withHash[2];
    const b = withHash[3];
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return null;
}

exports.handler = async (event) => {
  try {
    const usersTable = process.env.USERS_TABLE;
    if (!usersTable) {
      return { statusCode: 500, body: JSON.stringify({ message: 'Server misconfigured: USERS_TABLE is not set' }) };
    }

    const claims = event.requestContext?.authorizer?.jwt?.claims || {};
    const sub = typeof claims.sub === 'string' ? String(claims.sub).trim() : '';
    if (!sub) return { statusCode: 401, body: JSON.stringify({ message: 'Unauthorized' }) };

    const body = JSON.parse(event.body || '{}');

    // We accept only explicit fields; omitting a field means "no change".
    // Passing null or empty string means "clear" for that field.
    const bgRaw = Object.prototype.hasOwnProperty.call(body, 'bgColor') ? body.bgColor : undefined;
    const textRaw = Object.prototype.hasOwnProperty.call(body, 'textColor') ? body.textColor : undefined;
    const imgRaw = Object.prototype.hasOwnProperty.call(body, 'imagePath') ? body.imagePath : undefined;

    const updates = [];
    const removes = [];
    const values = { ':u': Date.now() };

    // bgColor
    if (bgRaw === null || bgRaw === '') {
      removes.push('avatarBgColor');
    } else if (typeof bgRaw === 'string') {
      const norm = normalizeHexColor(bgRaw);
      if (!norm) return { statusCode: 400, body: JSON.stringify({ message: 'bgColor must be a hex color like #RRGGBB' }) };
      updates.push('avatarBgColor = :bg');
      values[':bg'] = norm;
    }

    // textColor
    if (textRaw === null || textRaw === '') {
      removes.push('avatarTextColor');
    } else if (typeof textRaw === 'string') {
      const norm = normalizeHexColor(textRaw);
      if (!norm) {
        return { statusCode: 400, body: JSON.stringify({ message: 'textColor must be a hex color like #RRGGBB' }) };
      }
      updates.push('avatarTextColor = :tc');
      values[':tc'] = norm;
    }

    // imagePath
    if (imgRaw === null || imgRaw === '') {
      removes.push('avatarImagePath');
    } else if (typeof imgRaw === 'string') {
      const path = String(imgRaw).trim();
      // Prevent arbitrary bucket reads; avatars are expected to live under one of these prefixes.
      // NOTE: We prefer uploads/global/avatars/* because Amplify Storage policies already grant
      // guest+authenticated read access to uploads/global/*.
      const allowedPrefixes = ['uploads/global/avatars/', 'public/avatars/'];
      const ok = !path || allowedPrefixes.some((pfx) => path.startsWith(pfx));
      if (!ok) {
        return {
          statusCode: 400,
          body: JSON.stringify({
            message: `imagePath must start with ${allowedPrefixes.join(' or ')}`,
          }),
        };
      }
      updates.push('avatarImagePath = :ip');
      values[':ip'] = path;
    }

    // Nothing to do? Still touch updatedAt for consistency.
    updates.push('updatedAt = :u');

    let expr = `SET ${updates.join(', ')}`;
    if (removes.length) expr += ` REMOVE ${removes.join(', ')}`;

    await ddb.send(
      new UpdateCommand({
        TableName: usersTable,
        Key: { userSub: sub },
        UpdateExpression: expr,
        ExpressionAttributeValues: values,
      })
    );

    return { statusCode: 204 };
  } catch (err) {
    console.error('updateProfile error', err);
    return { statusCode: 500, body: JSON.stringify({ message: 'Internal error' }) };
  }
};


