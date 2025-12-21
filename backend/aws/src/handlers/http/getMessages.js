//MESSAGES_TABLE: Messages

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Expects Messages table schema: PK conversationId (String), SK createdAt (Number)
exports.handler = async (event) => {
  try {
    const params = event.queryStringParameters || {};
    const limit = Math.min(parseInt(params.limit || '50', 10) || 50, 200);
    const conversationId = params.conversationId || 'global';

    const resp = await ddb.send(
      new QueryCommand({
        TableName: process.env.MESSAGES_TABLE,
        KeyConditionExpression: 'conversationId = :c',
        ExpressionAttributeValues: { ':c': conversationId },
        ScanIndexForward: false, // newest first
        Limit: limit,
      })
    );

    const nowSec = Math.floor(Date.now() / 1000);

    const items = (resp.Items || [])
      .filter((it) => !(typeof it.expiresAt === 'number' && it.expiresAt <= nowSec))
      .map((it) => ({
        conversationId: it.conversationId,
        createdAt: Number(it.createdAt),
        messageId: String(it.messageId ?? it.createdAt),
        text: String(it.text ?? ''),
        user: it.user ? String(it.user) : 'anon',
        userLower: it.userLower ? String(it.userLower) : undefined,
        userSub: it.userSub ? String(it.userSub) : undefined,
        ttlSeconds: typeof it.ttlSeconds === 'number' ? it.ttlSeconds : undefined,
        expiresAt: typeof it.expiresAt === 'number' ? it.expiresAt : undefined,
      }));

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(items),
    };
  } catch (err) {
    console.error('getMessages error', err);
    return { statusCode: 500, body: 'Internal error' };
  }
};