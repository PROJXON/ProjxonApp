export type ConversationRow = {
  conversationId: string;
  peerDisplayName?: string;
};

export type UnreadRow = {
  user: string;
  count: number;
  senderSub?: string;
};

export type TitleOverrides = Record<string, string>;

export function normalizeTitle(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

export function setTitleOverride(
  overrides: TitleOverrides,
  convIdRaw: unknown,
  titleRaw: unknown
): TitleOverrides {
  const convId = typeof convIdRaw === 'string' ? convIdRaw.trim() : '';
  const title = normalizeTitle(titleRaw);
  if (!convId || convId === 'global' || !title) return overrides || {};
  return { ...(overrides || {}), [convId]: title };
}

export function applyTitleOverridesToConversations<T extends ConversationRow>(
  conversations: T[],
  overrides: TitleOverrides
): T[] {
  const ov = overrides || {};
  if (!conversations?.length) return conversations || [];
  return conversations.map((c) => {
    const id = typeof c?.conversationId === 'string' ? c.conversationId : '';
    const t = id ? normalizeTitle(ov[id]) : '';
    return t ? ({ ...c, peerDisplayName: t } as T) : c;
  });
}

export function applyTitleOverridesToUnreadMap(
  unread: Record<string, UnreadRow>,
  overrides: TitleOverrides
): Record<string, UnreadRow> {
  const merged: Record<string, UnreadRow> = { ...(unread || {}) };
  const ov = overrides || {};
  for (const [convId, titleRaw] of Object.entries(ov)) {
    if (!convId || !convId.startsWith('gdm#')) continue;
    const title = normalizeTitle(titleRaw);
    if (!title) continue;
    const existing = merged[convId];
    if (!existing) continue;
    const u = normalizeTitle(existing.user);
    if (u.startsWith('Added to group:')) merged[convId] = { ...existing, user: `Added to group: ${title}` };
    else merged[convId] = { ...existing, user: title };
  }
  return merged;
}

