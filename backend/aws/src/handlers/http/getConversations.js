// HTTP API (payload v2) Lambda: GET /conversations
// Returns a user's DM conversation list (newest-first).
//
// Env:
// - CONVERSATIONS_TABLE (required): DynamoDB table for conversation index
// - CONVERSATIONS_GSI (optional, default "byUserLastMessageAt"): GSI name for newest-first query
//
// Table schema (recommended):
// - PK: userSub (String)
// - SK: conversationId (String, e.g. "dm#<minSub>#<maxSub>")
// - Attributes: peerSub (String), peerDisplayName (String), lastMessageAt (Number epoch ms),
//              lastSenderSub (String), lastSenderDisplayName (String)
// - GSI: byUserLastMessageAt
//     - PK: userSub
//     - SK: lastMessageAt (Number)
//
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method;
  if (method !== 'GET') {
    return { statusCode: 405, headers: { Allow: 'GET' }, body: JSON.stringify({ message: 'Method not allowed' }) };
  }

  try {
    const sub = event.requestContext?.authorizer?.jwt?.claims?.sub;
    if (!sub) return { statusCode: 401, body: JSON.stringify({ message: 'Unauthorized' }) };

    const table = process.env.CONVERSATIONS_TABLE;
    if (!table) return { statusCode: 500, body: JSON.stringify({ message: 'CONVERSATIONS_TABLE not configured' }) };

    const qs = event.queryStringParameters || {};
    const limitRaw = Number(qs.limit ?? 50);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 50;
    const gsiName = String(process.env.CONVERSATIONS_GSI || 'byUserLastMessageAt').trim();

    const queryBase = async (useGsi) => {
      const params = {
        TableName: table,
        ...(useGsi ? { IndexName: gsiName } : {}),
        KeyConditionExpression: 'userSub = :u',
        ExpressionAttributeValues: { ':u': String(sub) },
        ScanIndexForward: false,
        Limit: limit,
      };
      return await ddb.send(new QueryCommand(params));
    };

    let resp;
    try {
      resp = await queryBase(true);
    } catch (err) {
      // Fallback if GSI not created yet; still return something (sorted client-side will be best-effort).
      resp = await queryBase(false);
    }

    const items = resp.Items || [];
    const conversations = items
      .map((it) => ({
        conversationId: String(it.conversationId || ''),
        peerSub: it.peerSub ? String(it.peerSub) : undefined,
        peerDisplayName: it.peerDisplayName ? String(it.peerDisplayName) : undefined,
        conversationKind: it.conversationKind ? String(it.conversationKind) : undefined,
        memberStatus: it.memberStatus ? String(it.memberStatus) : undefined,
        lastMessageAt: Number(it.lastMessageAt ?? 0),
        lastSenderSub: it.lastSenderSub ? String(it.lastSenderSub) : undefined,
        lastSenderDisplayName: it.lastSenderDisplayName ? String(it.lastSenderDisplayName) : undefined,
      }))
      .filter((c) => c.conversationId);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ conversations }),
    };
  } catch (err) {
    console.error('getConversations error', err);
    return { statusCode: 500, body: JSON.stringify({ message: 'Internal error' }) };
  }
};


