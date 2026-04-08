/**
 * 1:1 DM conversation ids are `dm#<subA>#<subB>` with Cognito subs (lexicographic order).
 */
export function parseDirectDmSubs(conversationId: string): [string, string] | null {
  const cid = String(conversationId || '').trim();
  if (!cid.startsWith('dm#')) return null;
  const rest = cid.slice('dm#'.length);
  const parts = rest
    .split('#')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length !== 2) return null;
  return [parts[0], parts[1]];
}

export function isUserInDirectDmConversation(
  conversationId: string,
  userSub: string | null | undefined,
): boolean {
  const me = typeof userSub === 'string' ? userSub.trim() : '';
  if (!me) return false;
  const subs = parseDirectDmSubs(conversationId);
  if (!subs) return false;
  return subs[0] === me || subs[1] === me;
}

/** After a successful `/conversations` fetch for the signed-in user. */
export type ConversationRosterRow = {
  conversationId: string;
  memberStatus?: 'active' | 'left' | 'banned';
};

export function isConversationActiveInRoster(
  conversationId: string,
  roster: ReadonlyArray<ConversationRosterRow>,
): boolean {
  const cid = String(conversationId || '').trim();
  if (!cid) return false;
  const row = roster.find((r) => String(r.conversationId || '').trim() === cid);
  if (!row) return false;
  if (row.memberStatus === 'left' || row.memberStatus === 'banned') return false;
  return true;
}
