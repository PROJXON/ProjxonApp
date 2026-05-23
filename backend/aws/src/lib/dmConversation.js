const safeString = (v) => (typeof v === 'string' ? String(v).trim() : '');

/** @returns {{ a: string, b: string } | null} */
function parseDmConversationId(conversationId) {
  const raw = safeString(conversationId);
  if (!raw.startsWith('dm#')) return null;
  const parts = raw
    .split('#')
    .map((p) => safeString(p))
    .filter(Boolean);
  if (parts.length !== 3) return null;
  return { a: parts[1], b: parts[2] };
}

function isDmParticipant(conversationId, userSub) {
  const parsed = parseDmConversationId(conversationId);
  const sub = safeString(userSub);
  if (!parsed || !sub) return false;
  return sub === parsed.a || sub === parsed.b;
}

/** Other participant in a 1:1 DM, or null if invalid / self-chat. */
function getDmPeerSub(conversationId, userSub) {
  const parsed = parseDmConversationId(conversationId);
  const sub = safeString(userSub);
  if (!parsed || !sub) return null;
  if (sub === parsed.a) return parsed.b;
  if (sub === parsed.b) return parsed.a;
  return null;
}

module.exports = {
  safeString,
  parseDmConversationId,
  isDmParticipant,
  getDmPeerSub,
};
