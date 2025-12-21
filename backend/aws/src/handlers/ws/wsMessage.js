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

const queryConnIdsByUserSub = async (userSub) => {
  const resp = await ddb.send(
    new QueryCommand({
      TableName: process.env.CONNECTIONS_TABLE,
      IndexName: 'byUserSub',
      KeyConditionExpression: 'userSub = :u',
      ExpressionAttributeValues: { ':u': userSub },
      ProjectionExpression: 'connectionId',
    })
  );
  return (resp.Items || []).map((it) => it.connectionId).filter(Boolean);
};

// DM conversationId format: "dm#<minSub>#<maxSub>"
const parseDmRecipientSub = (conversationId, senderSub) => {
  if (!conversationId || conversationId === 'global') return null;
  const raw = String(conversationId).trim();
  if (!raw.startsWith('dm#')) return null;
  const parts = raw.split('#').map((p) => String(p).trim()).filter(Boolean);
  if (parts.length !== 3) return null;
  const a = parts[1];
  const b = parts[2];
  const me = String(senderSub || '').trim();
  if (!me) return null;
  if (a === me) return b;
  if (b === me) return a;
  return null;
};

const markUnread = async (recipientSub, conversationId, sender) => {
  if (!process.env.UNREADS_TABLE) return;
  if (!recipientSub) return;

  await ddb.send(
    new UpdateCommand({
      TableName: process.env.UNREADS_TABLE,
      Key: { userSub: recipientSub, conversationId },
      UpdateExpression:
        'SET senderSub = :ss, senderDisplayName = :sd, lastMessageCreatedAt = :createdAt, messageCount = if_not_exists(messageCount, :zero) + :inc',
      ExpressionAttributeValues: {
        ':ss': sender.userSub,
        ':sd': sender.displayName,
        ':createdAt': sender.createdAtMs,
        ':inc': 1,
        ':zero': 0,
      },
    })
  );
};

const clearUnread = async (readerSub, conversationId) => {
  if (!process.env.UNREADS_TABLE) return;
  if (!readerSub) return;
  if (!conversationId || conversationId === 'global') return;

  await ddb.send(
    new DeleteCommand({
      TableName: process.env.UNREADS_TABLE,
      Key: { userSub: readerSub, conversationId },
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

    const senderSub = conn?.Item?.userSub ? String(conn.Item.userSub) : '';
    if (!senderSub) {
      return { statusCode: 401, body: 'Unauthorized (missing connection identity).' };
    }

    const senderUsernameLower = conn?.Item?.usernameLower ? String(conn.Item.usernameLower) : '';
    const senderDisplayName = conn?.Item?.displayName ? String(conn.Item.displayName) : 'anon';

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
    let dmRecipientSub = null;

    if (conversationId === 'global') {
      // Only broadcast to people who are currently "joined" to global
      recipientConnIds = await queryConnIdsByConversation('global');
    } else {
      dmRecipientSub = parseDmRecipientSub(conversationId, senderSub);
      if (!dmRecipientSub) {
        return { statusCode: 400, body: 'Invalid DM conversationId (expected dm#minSub#maxSub).' };
      }
      const a = await queryConnIdsByUserSub(senderSub);
      const b = await queryConnIdsByUserSub(dmRecipientSub);
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
        userSub: senderSub,
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
              key: `${senderSub}#${messageCreatedAt}`,
              userSub: senderSub,
              user: senderDisplayName,
              messageCreatedAt,
              readAt,
              updatedAt: nowMs,
            },
          })
        );
      }

      // Clear unread for the reader (best-effort)
      await clearUnread(senderSub, conversationId).catch(() => {});

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
        userSub: senderSub,
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
          userSub: senderSub,
          ...(ttlSeconds ? { ttlSeconds } : {}),
        },
      })
    );

    // Broadcast (send display + stable key)
    await broadcast(mgmt, recipientConnIds, {
      messageId,
      user: senderDisplayName,
      userLower: senderUsernameLower,
      userSub: senderSub,
      text,
      createdAt: nowMs,
      conversationId,
      ...(ttlSeconds ? { ttlSeconds } : {}),
    });

    // Persist unread (DM only) so offline users see it on next login via GET /unreads
    if (conversationId !== 'global') {
      try {
        if (!dmRecipientSub) {
          dmRecipientSub = parseDmRecipientSub(conversationId, senderSub);
        }
        await markUnread(dmRecipientSub, conversationId, {
          userSub: senderSub,
          displayName: senderDisplayName,
          createdAtMs: nowMs,
        });
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