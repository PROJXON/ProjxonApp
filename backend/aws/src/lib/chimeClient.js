const {
  ChimeSDKMeetingsClient,
  CreateMeetingCommand,
  CreateAttendeeCommand,
  DeleteMeetingCommand,
} = require('@aws-sdk/client-chime-sdk-meetings');

let _client;

function getChimeSdkRegion() {
  return String(process.env.CHIME_SDK_REGION || 'us-east-1').trim() || 'us-east-1';
}

function getChimeClient() {
  if (!_client) {
    _client = new ChimeSDKMeetingsClient({ region: getChimeSdkRegion() });
  }
  return _client;
}

async function createVoiceMeeting(externalMeetingId) {
  const mediaRegion = getChimeSdkRegion();
  const client = getChimeClient();
  const token = String(externalMeetingId || '').trim();
  if (!token) throw new Error('externalMeetingId required');

  const resp = await client.send(
    new CreateMeetingCommand({
      ClientRequestToken: token,
      ExternalMeetingId: token.slice(0, 64),
      MediaRegion: mediaRegion,
    }),
  );
  if (!resp.Meeting?.MeetingId) throw new Error('CreateMeeting returned no MeetingId');
  return resp.Meeting;
}

async function createMeetingAttendee(meetingId, externalUserId) {
  const client = getChimeClient();
  const resp = await client.send(
    new CreateAttendeeCommand({
      MeetingId: meetingId,
      ExternalUserId: String(externalUserId || '').trim().slice(0, 64) || 'user',
    }),
  );
  if (!resp.Attendee?.AttendeeId) throw new Error('CreateAttendee returned no Attendee');
  return resp.Attendee;
}

async function deleteMeeting(meetingId) {
  const id = String(meetingId || '').trim();
  if (!id) return;
  const client = getChimeClient();
  try {
    await client.send(new DeleteMeetingCommand({ MeetingId: id }));
  } catch {
    // best-effort cleanup
  }
}

module.exports = {
  getChimeSdkRegion,
  getChimeClient,
  createVoiceMeeting,
  createMeetingAttendee,
  deleteMeeting,
};
