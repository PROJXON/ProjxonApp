// POST /calls/start
// Body: { conversationId: "dm#<subA>#<subB>" }
//
// Env:
// - CALLS_TABLE (required)
// - CHIME_SDK_REGION (optional, default us-east-1) — Chime only; DynamoDB stays in Lambda region
//
const { randomUUID } = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { createVoiceMeeting, createMeetingAttendee } = require('../../lib/chimeClient');
const { safeString, parseDmConversationId, isDmParticipant, getDmPeerSub } = require('../../lib/dmConversation');
const { getJwtSub, jsonResponse, parseJsonBody } = require('../../lib/httpAuth');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const CALL_TTL_MS = 2 * 60 * 60 * 1000;

exports.handler = async (event) => {
  try {
    const method = event.requestContext?.http?.method;
    if (method && method !== 'POST') {
      return jsonResponse(405, { message: 'Method not allowed' });
    }

    const sub = getJwtSub(event);
    if (!sub) return jsonResponse(401, { message: 'Unauthorized' });

    const callsTable = safeString(process.env.CALLS_TABLE);
    if (!callsTable) {
      return jsonResponse(500, { message: 'Server misconfigured: CALLS_TABLE is not set' });
    }

    const body = parseJsonBody(event);
    if (body === null) return jsonResponse(400, { message: 'Invalid JSON body' });

    const conversationId = safeString(body.conversationId);
    if (!parseDmConversationId(conversationId)) {
      return jsonResponse(400, { message: 'Only DM conversations are supported for voice calls' });
    }
    if (!isDmParticipant(conversationId, sub)) {
      return jsonResponse(403, { message: 'Not a participant in this conversation' });
    }

    const calleeSub = getDmPeerSub(conversationId, sub);
    if (!calleeSub) return jsonResponse(400, { message: 'Invalid DM conversation' });

    const callId = randomUUID();
    const externalMeetingId = `call-${callId}`;
    const now = Date.now();

    const meeting = await createVoiceMeeting(externalMeetingId);
    const callerAttendee = await createMeetingAttendee(meeting.MeetingId, sub);

    await ddb.send(
      new PutCommand({
        TableName: callsTable,
        Item: {
          callId,
          conversationId,
          kind: 'voice',
          status: 'ringing',
          callerSub: sub,
          calleeSub,
          meetingId: meeting.MeetingId,
          meeting,
          externalMeetingId,
          createdAt: now,
          updatedAt: now,
          expiresAt: Math.floor((now + CALL_TTL_MS) / 1000),
        },
        ConditionExpression: 'attribute_not_exists(callId)',
      }),
    );

    return jsonResponse(200, {
      callId,
      conversationId,
      status: 'ringing',
      calleeSub,
      meeting,
      attendee: callerAttendee,
    });
  } catch (err) {
    console.error('callsStart error', err);
    return jsonResponse(500, { message: 'Internal server error' });
  }
};
