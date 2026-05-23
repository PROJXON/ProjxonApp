// POST /calls/accept
// Body: { callId: string }
//
// Env:
// - CALLS_TABLE (required)
// - CHIME_SDK_REGION (optional, default us-east-1)
//
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { createMeetingAttendee } = require('../../lib/chimeClient');
const { safeString } = require('../../lib/dmConversation');
const { getJwtSub, jsonResponse, parseJsonBody } = require('../../lib/httpAuth');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

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

    const callId = safeString(body.callId);
    if (!callId) return jsonResponse(400, { message: 'callId is required' });

    const row = await ddb.send(
      new GetCommand({
        TableName: callsTable,
        Key: { callId },
      }),
    );
    const call = row.Item;
    if (!call) return jsonResponse(404, { message: 'Call not found' });

    if (safeString(call.calleeSub) !== sub) {
      return jsonResponse(403, { message: 'Only the callee can accept this call' });
    }
    if (safeString(call.status) !== 'ringing') {
      return jsonResponse(409, { message: `Call is not ringing (status=${call.status})` });
    }

    const meetingId = safeString(call.meetingId);
    if (!meetingId) return jsonResponse(500, { message: 'Call record missing meetingId' });

    const attendee = await createMeetingAttendee(meetingId, sub);
    const now = Date.now();

    await ddb.send(
      new UpdateCommand({
        TableName: callsTable,
        Key: { callId },
        UpdateExpression: 'SET #s = :active, updatedAt = :now',
        ConditionExpression: '#s = :ringing',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':active': 'active',
          ':ringing': 'ringing',
          ':now': now,
        },
      }),
    );

    return jsonResponse(200, {
      callId,
      conversationId: safeString(call.conversationId),
      status: 'active',
      meetingId,
      meeting: call.meeting || null,
      attendee,
    });
  } catch (err) {
    if (err?.name === 'ConditionalCheckFailedException') {
      return jsonResponse(409, { message: 'Call is no longer ringing' });
    }
    console.error('callsAccept error', err);
    return jsonResponse(500, { message: 'Internal server error' });
  }
};
