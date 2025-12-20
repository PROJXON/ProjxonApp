const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  DeleteCommand,
  UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');
const {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} = require('@aws-sdk/client-apigatewaymanagementapi');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Connections TTL refresh window (must match your DynamoDB TTL attribute "expiresAt")
const CONN_TTL_SECONDS = 6 * 60 * 60; // 6 hours

const broadcast = async (mgmt, connectionIds, payloadObj) => {
  const data = Buffer.from(JSON.stringify(payloadObj));
  await Promise.all(
    (connectionIds || []).map(async (connectionId) => {
      try {
        await mgmt.send(new PostToConnectionCommand({ ConnectionId: connectionId, Data: data }));
      } catch (err) {
        const status = err?.statusCode || err?.$metadata?.httpStatusCode || 'unknown';
        if (status === 410) {
          // Stale connection: delete it
          await ddb.send(
            new DeleteCommand({
              TableName: process.env.CONNECTIONS_TABLE,
              Key: { connectionId },
            })
          );
        }
      }
    })
  );
};

const queryConnIdsByConversation = async (conversationId) => {
  const resp = await ddb.send(
    new QueryCommand({
      TableName: process.env.CONNECTIONS_TABLE,
      IndexName: 'byConversation',
      KeyConditionExpression: 'conversationId = :c',
      ExpressionAttributeValues: { ':c': conversationId },
      ProjectionExpression: 'connectionId',
    })
  );
  return (resp.Items || []).map((it) => it.connectionId).filter(Boolean);
};

const queryConnIdsByUsernameLower = async (usernameLower) => {
  const resp = await ddb.send(
    new QueryCommand({
      TableName: process.env.CONNECTIONS_TABLE,
      IndexName: 'byUsername',
      KeyConditionExpression: 'usernameLower = :u',
      ExpressionAttributeValues: { ':u': usernameLower },
      ProjectionExpression: 'connectionId',
    })
  );
  return (resp.Items || []).map((it) => it.connectionId).filter(Boolean);
};

// conversationId is "alice#bob" (sorted, lowercase). Returns the other usernameLower.
const parseRecipientUsernameLower = (conversationId, senderUsernameLower) => {
  if (!conversationId || conversationId === 'global') return null;
  const parts = String(conversationId)
    .split('#')
    .map((p) => String(p).trim().toLowerCase())
    .filter(Boolean);
  const me = String(senderUsernameLower || '').trim().toLowerCase();
  return parts.find((p) => p !== me) || null;
};

const markUnread = async (recipientUsernameLower, conversationId, senderUsernameLower, nowMs) => {
  if (!process.env.UNREADS_TABLE) return;
  if (!recipientUsernameLower) return;

  await ddb.send(
    new UpdateCommand({
      TableName: process.env.UNREADS_TABLE,
      Key: { user: recipientUsernameLower, conversationId },
      UpdateExpression:
        'SET sender = :sender, lastMessageCreatedAt = :createdAt, messageCount = if_not_exists(messageCount, :zero) + :inc',
      ExpressionAttributeValues: {
        ':sender': senderUsernameLower,
        ':createdAt': nowMs,
        ':inc': 1,
        ':zero': 0,
      },
    })
  );
};

const clearUnread = async (readerUsernameLower, conversationId) => {
  if (!process.env.UNREADS_TABLE) return;
  if (!readerUsernameLower) return;
  if (!conversationId || conversationId === 'global') return;

  await ddb.send(
    new DeleteCommand({
      TableName: process.env.UNREADS_TABLE,
      Key: { user: readerUsernameLower, conversationId },
    })
  );
};

exports.handler = async (event) => {
  try {
    const { domainName, stage, connectionId } = event.requestContext;

    const mgmt = new ApiGatewayManagementApiClient({
      endpoint: `https://${domainName}/${stage}`,
      region: process.env.AWS_REGION,
    });

    let body = {};
    try {
      body = JSON.parse(event.body || '{}');
    } catch {}

    const action = body.action || 'message';
    const nowMs = Date.now();
    const nowSec = Math.floor(nowMs / 1000);
    const conversationId = String(body.conversationId || 'global');

    // Authoritative sender identity from DynamoDB (prevents spoofing)
    const conn = await ddb.send(
      new GetCommand({
        TableName: process.env.CONNECTIONS_TABLE,
        Key: { connectionId },
      })
    );

    const senderUsernameLower = conn?.Item?.usernameLower ? String(conn.Item.usernameLower) : '';
    if (!senderUsernameLower) {
      return { statusCode: 401, body: 'Unauthorized (missing connection identity).' };
    }

    const senderDisplayName =
      conn?.Item?.displayName ? String(conn.Item.displayName) : senderUsernameLower;

    // Refresh connection TTL on any activity
    const expiresAt = nowSec + CONN_TTL_SECONDS;

    // JOIN: update convo + refresh TTL in one write
    if (action === 'join') {
      await ddb.send(
        new UpdateCommand({
          TableName: process.env.CONNECTIONS_TABLE,
          Key: { connectionId },
          UpdateExpression: 'SET conversationId = :c, expiresAt = :e',
          ExpressionAttributeValues: { ':c': conversationId, ':e': expiresAt },
        })
      );
      return { statusCode: 200, body: 'Joined.' };
    }

    // Best-effort TTL refresh (don’t break chat if it fails)
    await ddb
      .send(
        new UpdateCommand({
          TableName: process.env.CONNECTIONS_TABLE,
          Key: { connectionId },
          UpdateExpression: 'SET expiresAt = :e',
          ExpressionAttributeValues: { ':e': expiresAt },
        })
      )
      .catch(() => {});

    // Recipients (NO scans)
    let recipientConnIds = [];
    let dmRecipientUsernameLower = null;

    if (conversationId === 'global') {
      // Only broadcast to people who are currently "joined" to global
      recipientConnIds = await queryConnIdsByConversation('global');
    } else {
      dmRecipientUsernameLower = parseRecipientUsernameLower(conversationId, senderUsernameLower);
      const a = await queryConnIdsByUsernameLower(senderUsernameLower);
      const b = dmRecipientUsernameLower
        ? await queryConnIdsByUsernameLower(dmRecipientUsernameLower)
        : [];
      recipientConnIds = Array.from(new Set([...a, ...b]));
    }

    // ---- READ ----
    if (action === 'read') {
      if (conversationId === 'global') return { statusCode: 200, body: 'Ignored read for global.' };

      const messageCreatedAt = Number(body.messageCreatedAt ?? body.readUpTo);
      const readAt = typeof body.readAt === 'number' ? Math.floor(body.readAt) : nowSec;

      if (!Number.isFinite(messageCreatedAt) || messageCreatedAt <= 0) {
        return { statusCode: 400, body: 'Invalid messageCreatedAt.' };
      }

      // Broadcast read event (for online sender)
      await broadcast(mgmt, recipientConnIds, {
        type: 'read',
        conversationId,
        user: senderDisplayName,
        userLower: senderUsernameLower,
        messageCreatedAt,
        readAt,
      });

      // Persist read receipt so sender sees "Seen" even if offline at time of read
      if (process.env.READS_TABLE) {
        await ddb.send(
          new PutCommand({
            TableName: process.env.READS_TABLE,
            Item: {
              conversationId,
              key: `${senderUsernameLower}#${messageCreatedAt}`,
              user: senderUsernameLower,
              messageCreatedAt,
              readAt,
              updatedAt: nowMs,
            },
          })
        );
      }

      // Clear unread for the reader (best-effort)
      await clearUnread(senderUsernameLower, conversationId).catch(() => {});

      // TTL-from-read: if this message has ttlSeconds and reader is not sender, set expiresAt on the message
      if (process.env.MESSAGES_TABLE) {
        const existing = await ddb.send(
          new GetCommand({
            TableName: process.env.MESSAGES_TABLE,
            Key: { conversationId, createdAt: messageCreatedAt },
          })
        );
        const msg = existing.Item;
        if (msg) {
          const msgUserLower = msg.userLower ? String(msg.userLower).trim().toLowerCase() : '';
          const senderFallbackLower = msg.user ? String(msg.user).trim().toLowerCase() : '';
          const actualSenderLower = msgUserLower || senderFallbackLower || 'anon';

          const ttlSeconds = Number(msg.ttlSeconds);
          const alreadyExpiresAt =
            typeof msg.expiresAt === 'number' && Number.isFinite(msg.expiresAt);

          if (
            actualSenderLower !== senderUsernameLower &&
            !alreadyExpiresAt &&
            Number.isFinite(ttlSeconds) &&
            ttlSeconds > 0
          ) {
            const msgExpiresAt = readAt + Math.floor(ttlSeconds);
            await ddb
              .send(
                new UpdateCommand({
                  TableName: process.env.MESSAGES_TABLE,
                  Key: { conversationId, createdAt: messageCreatedAt },
                  UpdateExpression: 'SET expiresAt = :e',
                  ConditionExpression: 'attribute_not_exists(expiresAt)',
                  ExpressionAttributeValues: { ':e': msgExpiresAt },
                })
              )
              .catch(() => {});
          }
        }
      }

      return { statusCode: 200, body: 'Read receipt processed.' };
    }

    // ---- TYPING ----
    if (action === 'typing') {
      const isTyping = body.isTyping === true;

      // Don’t send typing events back to the sender’s own connection
      const senderConnId = event.requestContext.connectionId;
      const recipientConnIdsWithoutSender = recipientConnIds.filter((id) => id !== senderConnId);

      await broadcast(mgmt, recipientConnIdsWithoutSender, {
        type: 'typing',
        conversationId,
        user: senderDisplayName,
        userLower: senderUsernameLower,
        isTyping,
        createdAt: nowMs,
      });

      return { statusCode: 200, body: 'Typing event broadcasted.' };
    }

    // ---- MESSAGE ----
    const text = String(body.text || '').trim();
    if (!text) return { statusCode: 400, body: 'Empty message.' };
    if (!process.env.MESSAGES_TABLE) return { statusCode: 500, body: 'Missing MESSAGES_TABLE env.' };

    // Optional DM self-destruct duration (seconds)
    let ttlSeconds;
    if (conversationId !== 'global' && typeof body.ttlSeconds === 'number' && Number.isFinite(body.ttlSeconds)) {
      const v = Math.floor(body.ttlSeconds);
      if (v > 0 && v <= 365 * 24 * 60 * 60) ttlSeconds = v;
    }

    const messageId = `${nowMs}-${Math.random().toString(36).slice(2)}`;

    // Persist (store display + stable key)
    await ddb.send(
      new PutCommand({
        TableName: process.env.MESSAGES_TABLE,
        Item: {
          conversationId,
          createdAt: nowMs,
          messageId,
          text,
          user: senderDisplayName,
          userLower: senderUsernameLower,
          ...(ttlSeconds ? { ttlSeconds } : {}),
        },
      })
    );

    // Broadcast (send display + stable key)
    await broadcast(mgmt, recipientConnIds, {
      messageId,
      user: senderDisplayName,
      userLower: senderUsernameLower,
      text,
      createdAt: nowMs,
      conversationId,
      ...(ttlSeconds ? { ttlSeconds } : {}),
    });

    // Persist unread (DM only) so offline users see it on next login via GET /unreads
    if (conversationId !== 'global') {
      try {
        if (!dmRecipientUsernameLower) {
          dmRecipientUsernameLower = parseRecipientUsernameLower(conversationId, senderUsernameLower);
        }
        await markUnread(dmRecipientUsernameLower, conversationId, senderUsernameLower, nowMs);
      } catch {
        // ignore
      }
    }

    return { statusCode: 200, body: 'Message broadcasted.' };
  } catch (err) {
    console.error('wsMessage error', err);
    return { statusCode: 500, body: 'Internal error.' };
  }
};