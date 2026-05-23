// POST /calls/end
// Body: { callId: string }
//
// Env:
// - CALLS_TABLE (required)
// - CHIME_SDK_REGION (optional, default us-east-1)
//
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { deleteMeeting } = require('../../lib/chimeClient');
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

    const callerSub = safeString(call.callerSub);
    const calleeSub = safeString(call.calleeSub);
    if (sub !== callerSub && sub !== calleeSub) {
      return jsonResponse(403, { message: 'Not a participant in this call' });
    }

    const status = safeString(call.status);
    if (status === 'ended') {
      return jsonResponse(200, { callId, status: 'ended' });
    }

    const meetingId = safeString(call.meetingId);
    await deleteMeeting(meetingId);

    const now = Date.now();
    await ddb.send(
      new UpdateCommand({
        TableName: callsTable,
        Key: { callId },
        UpdateExpression: 'SET #s = :ended, updatedAt = :now, endedAt = :now',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':ended': 'ended',
          ':now': now,
        },
      }),
    );

    return jsonResponse(200, { callId, status: 'ended' });
  } catch (err) {
    console.error('callsEnd error', err);
    return jsonResponse(500, { message: 'Internal server error' });
  }
};
