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

const safeString = (v) => {
  if (typeof v !== 'string') return '';
  return String(v).trim();
};

const isLikelyExpoToken = (token) => {
  const t = safeString(token);
  if (!t) return false;
  return (
    /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/.test(t) ||
    t.startsWith('ExponentPushToken[') ||
    t.startsWith('ExpoPushToken[')
  );
};

const queryExpoPushTokensByUserSub = async (userSub) => {
  const table = process.env.PUSH_TOKENS_TABLE;
  if (!table) return [];
  const u = safeString(userSub);
  if (!u) return [];
  try {
    const resp = await ddb.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: 'userSub = :u',
        ExpressionAttributeValues: { ':u': u },
        ProjectionExpression: 'expoPushToken',
      })
    );
    return (resp.Items || [])
      .map((it) => (it ? it.expoPushToken : undefined))
      .filter((t) => typeof t === 'string')
      .map((t) => String(t).trim())
      .filter((t) => isLikelyExpoToken(t));
  } catch (err) {
    console.warn('queryExpoPushTokensByUserSub failed', err);
    return [];
  }
};

const sendExpoPush = async (messages) => {
  // Expo push endpoint doesn't require credentials (it validates tokens server-side).
  // Requires Node 18+ for fetch in Lambda.
  if (typeof fetch !== 'function') {
    console.warn('sendExpoPush skipped: runtime missing fetch (use Node.js 18+ / 20.x)');
    return;
  }
  const url = process.env.EXPO_PUSH_URL || 'https://exp.host/--/api/v2/push/send';
  const payload = Array.isArray(messages) ? messages : [];
  if (!payload.length) return;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.warn('expo push non-2xx', resp.status, text);
      return;
    }
    const json = await resp.json().catch(() => null);
    const data = json && (json.data || json);
    if (Array.isArray(data)) {
      for (const r of data) {
        if (r && r.status === 'error') {
          console.warn('expo push error', r?.message || r);
        }
      }
    }
  } catch (err) {
    console.warn('sendExpoPush failed', err);
  }
};

const sendDmPushNotification = async ({ recipientSub, senderDisplayName, senderSub, conversationId }) => {
  try {
    const tokens = await queryExpoPushTokensByUserSub(recipientSub);
    if (!tokens.length) return;

    // Privacy-first default (Signal-like): show sender name, no message preview.
    const title = safeString(senderDisplayName) || 'New message';
    const body = 'New message';
    const convId = safeString(conversationId);
    const sSub = safeString(senderSub);

    const base = {
      title,
      body,
      sound: 'default',
      priority: 'high',
      channelId: 'dm',
      data: {
        kind: 'dm',
        conversationId: convId,
        senderDisplayName: safeString(senderDisplayName),
        senderSub: sSub,
      },
    };

    // Expo accepts up to 100 messages per request.
    const batchSize = 100;
    for (let i = 0; i < tokens.length; i += batchSize) {
      const slice = tokens.slice(i, i + batchSize);
      const msgs = slice.map((to) => ({ ...base, to }));
      // eslint-disable-next-line no-await-in-loop
      await sendExpoPush(msgs);
    }
  } catch (err) {
    console.warn('sendDmPushNotification failed', err);
  }
};

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

    // ---- EDIT ----
    if (action === 'edit') {
      if (conversationId === 'global') {
        // allow edits in global too, same rules (sender-only)
      }

      const messageCreatedAt = Number(body.messageCreatedAt ?? body.createdAt);
      const newText = String(body.text || '').trim();
      if (!Number.isFinite(messageCreatedAt) || messageCreatedAt <= 0) {
        return { statusCode: 400, body: 'Invalid messageCreatedAt.' };
      }
      if (!newText) {
        return { statusCode: 400, body: 'Empty edit text.' };
      }
      if (!process.env.MESSAGES_TABLE) return { statusCode: 500, body: 'Missing MESSAGES_TABLE env.' };

      // Verify sender owns the message
      const existing = await ddb.send(
        new GetCommand({
          TableName: process.env.MESSAGES_TABLE,
          Key: { conversationId, createdAt: messageCreatedAt },
        })
      );
      const msg = existing.Item;
      if (!msg) return { statusCode: 404, body: 'Message not found.' };
      if (String(msg.userSub || '') !== senderSub) return { statusCode: 403, body: 'Forbidden.' };
      if (msg.deletedAt) return { statusCode: 409, body: 'Message already deleted.' };

      await ddb.send(
        new UpdateCommand({
          TableName: process.env.MESSAGES_TABLE,
          Key: { conversationId, createdAt: messageCreatedAt },
          UpdateExpression: 'SET #t = :t, editedAt = :ea, updatedAt = :ua',
          ExpressionAttributeNames: { '#t': 'text' },
          ExpressionAttributeValues: { ':t': newText, ':ea': nowMs, ':ua': nowMs },
        })
      );

      await broadcast(mgmt, recipientConnIds, {
        type: 'edit',
        conversationId,
        messageId: msg.messageId ? String(msg.messageId) : undefined,
        createdAt: messageCreatedAt,
        text: newText,
        editedAt: nowMs,
        userSub: senderSub,
      });

      return { statusCode: 200, body: 'Edit processed.' };
    }

    // ---- DELETE ----
    if (action === 'delete') {
      const messageCreatedAt = Number(body.messageCreatedAt ?? body.createdAt);
      if (!Number.isFinite(messageCreatedAt) || messageCreatedAt <= 0) {
        return { statusCode: 400, body: 'Invalid messageCreatedAt.' };
      }
      if (!process.env.MESSAGES_TABLE) return { statusCode: 500, body: 'Missing MESSAGES_TABLE env.' };

      // Verify sender owns the message
      const existing = await ddb.send(
        new GetCommand({
          TableName: process.env.MESSAGES_TABLE,
          Key: { conversationId, createdAt: messageCreatedAt },
        })
      );
      const msg = existing.Item;
      if (!msg) return { statusCode: 404, body: 'Message not found.' };
      if (String(msg.userSub || '') !== senderSub) return { statusCode: 403, body: 'Forbidden.' };
      if (msg.deletedAt) return { statusCode: 200, body: 'Already deleted.' };

      // Preserve audit fields, but remove message contents
      await ddb.send(
        new UpdateCommand({
          TableName: process.env.MESSAGES_TABLE,
          Key: { conversationId, createdAt: messageCreatedAt },
          UpdateExpression: 'SET deletedAt = :da, deletedBySub = :db, updatedAt = :ua REMOVE #t',
          ExpressionAttributeNames: { '#t': 'text' },
          ExpressionAttributeValues: { ':da': nowMs, ':db': senderSub, ':ua': nowMs },
        })
      );

      await broadcast(mgmt, recipientConnIds, {
        type: 'delete',
        conversationId,
        messageId: msg.messageId ? String(msg.messageId) : undefined,
        createdAt: messageCreatedAt,
        deletedAt: nowMs,
        deletedBySub: senderSub,
      });

      return { statusCode: 200, body: 'Delete processed.' };
    }

    // ---- REACT ----
    if (action === 'react') {
      const messageCreatedAt = Number(body.messageCreatedAt ?? body.createdAt);
      const emoji = typeof body.emoji === 'string' ? String(body.emoji) : '';
      const opRaw = typeof body.op === 'string' ? String(body.op) : '';
      const op = opRaw === 'remove' ? 'remove' : 'add';

      if (!Number.isFinite(messageCreatedAt) || messageCreatedAt <= 0) {
        return { statusCode: 400, body: 'Invalid messageCreatedAt.' };
      }
      if (!emoji || emoji.length > 16) {
        return { statusCode: 400, body: 'Invalid emoji.' };
      }
      if (!process.env.MESSAGES_TABLE) return { statusCode: 500, body: 'Missing MESSAGES_TABLE env.' };

      const key = { conversationId, createdAt: messageCreatedAt };
      const setVal = new Set([senderSub]);
      const senderName = senderDisplayName ? String(senderDisplayName) : 'anon';

      // Enforce "single reaction per user per message":
      // - reactions is a map: emoji -> StringSet(userSub)
      // - when adding a reaction, remove userSub from ALL other emoji sets first
      const existing = await ddb.send(
        new GetCommand({
          TableName: process.env.MESSAGES_TABLE,
          Key: key,
          ProjectionExpression: 'messageId, reactions',
        })
      );
      const existingReactions = existing?.Item?.reactions && typeof existing.Item.reactions === 'object'
        ? existing.Item.reactions
        : {};

      const emojiKeys = Object.keys(existingReactions || {});
      const toRemoveFrom = [];
      for (const k of emojiKeys) {
        try {
          const set = existingReactions[k];
          const arr =
            set && typeof set === 'object' && set instanceof Set
              ? Array.from(set)
              : Array.isArray(set)
              ? set
              : [];
          if (arr.map(String).includes(senderSub) && k !== emoji) toRemoveFrom.push(k);
        } catch {
          // ignore malformed reaction set
        }
      }

      const exprNames = { '#e': emoji };
      const exprValues = { ':u': setVal, ':empty': {} };
      const deleteParts = [];

      for (let i = 0; i < toRemoveFrom.length; i++) {
        const k = toRemoveFrom[i];
        const nameKey = `#r${i}`;
        exprNames[nameKey] = k;
        deleteParts.push(`reactions.${nameKey} :u`);
      }

      // DynamoDB cannot update 'reactions' and 'reactions.<emoji>' in the same UpdateExpression
      // (paths overlap). So we do it in two steps:
      // 1) ensure reactions map exists (and also reactionUsers map for name snapshots)
      // 2) apply ADD/DELETE on reactions.<emoji> sets (and other emoji sets for single-reaction model)
      await ddb.send(
        new UpdateCommand({
          TableName: process.env.MESSAGES_TABLE,
          Key: key,
          UpdateExpression:
            'SET reactions = if_not_exists(reactions, :empty), reactionUsers = if_not_exists(reactionUsers, :emptyUsers)',
          ExpressionAttributeValues: { ':empty': {}, ':emptyUsers': {} },
        })
      );

      // DynamoDB UpdateExpression section order matters (SET, REMOVE, ADD, DELETE).
      // We SET reactionUsers.<senderSub> (username snapshot) and ADD/DELETE reactions.* sets.
      let updateExpression = '';
      // add/remove username snapshot (remove when user removes their reaction)
      exprNames['#s'] = senderSub;
      if (op === 'remove') {
        // Order must be: SET, REMOVE, ADD, DELETE
        updateExpression = 'REMOVE reactionUsers.#s DELETE reactions.#e :u';
      } else {
        updateExpression = 'SET reactionUsers.#s = :sn ADD reactions.#e :u';
        if (deleteParts.length) updateExpression += ` DELETE ${deleteParts.join(', ')}`;
      }

      await ddb.send(
        new UpdateCommand({
          TableName: process.env.MESSAGES_TABLE,
          Key: key,
          UpdateExpression: updateExpression,
          ExpressionAttributeNames: exprNames,
          ExpressionAttributeValues: op === 'remove' ? { ':u': setVal } : { ':u': setVal, ':sn': senderName },
        })
      );

      // Fetch updated reactions (full map) so clients can reconcile multiple-emoji changes.
      const updated = await ddb.send(
        new GetCommand({
          TableName: process.env.MESSAGES_TABLE,
          Key: key,
          ProjectionExpression: 'messageId, createdAt, reactions',
        })
      );
      const msg = updated.Item || {};

      const reactions = msg?.reactions && typeof msg.reactions === 'object' ? msg.reactions : {};
      const reactionPayload = {};
      for (const [k, set] of Object.entries(reactions)) {
        const arr =
          set && typeof set === 'object' && set instanceof Set
            ? Array.from(set).map(String)
            : Array.isArray(set)
            ? set.map(String)
            : [];
        if (arr.length) reactionPayload[String(k)] = { count: arr.length, userSubs: arr };
      }

      await broadcast(mgmt, recipientConnIds, {
        type: 'reaction',
        conversationId,
        messageId: msg.messageId ? String(msg.messageId) : undefined,
        createdAt: messageCreatedAt,
        reactions: reactionPayload,
        actorSub: senderSub,
        op,
      });

      return { statusCode: 200, body: 'Reaction processed.' };
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

    const clientMessageId =
      typeof body.clientMessageId === 'string' ? String(body.clientMessageId).trim() : '';
    const messageId =
      clientMessageId && clientMessageId.length <= 120
        ? clientMessageId
        : `${nowMs}-${Math.random().toString(36).slice(2)}`;

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

        // Best-effort: DM push for background/offline users.
        // We avoid pushing when the recipient appears "online" (has any active WS connections).
        // Default payload mirrors Signal privacy: sender name only, no message content.
        const activeRecipientConns = await queryConnIdsByUserSub(dmRecipientSub).catch(() => []);
        if (!Array.isArray(activeRecipientConns) || activeRecipientConns.length === 0) {
          await sendDmPushNotification({
            recipientSub: dmRecipientSub,
            senderDisplayName,
            senderSub,
            conversationId,
          });
        }
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