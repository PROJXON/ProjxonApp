import * as React from 'react';

import type { DmThreads, ServerConversation, UnreadDmMap } from './useChatsInboxData';

export function useDeleteConversationFromList({
  apiUrl,
  fetchAuthSession,
  promptConfirm,
  setServerConversations,
  setDmThreads,
  setUnreadDmMap,
}: {
  apiUrl: string;
  fetchAuthSession: () => Promise<{ tokens?: { idToken?: { toString: () => string } } }>;
  promptConfirm: (
    title: string,
    message: string,
    opts?: { confirmText?: string; cancelText?: string; destructive?: boolean },
  ) => Promise<boolean>;
  setServerConversations: React.Dispatch<React.SetStateAction<ServerConversation[]>>;
  setDmThreads: React.Dispatch<React.SetStateAction<DmThreads>>;
  setUnreadDmMap: React.Dispatch<React.SetStateAction<UnreadDmMap>>;
}): {
  deleteConversationFromList: (
    conversationIdToDelete: string,
    opts?: { skipConfirm?: boolean },
  ) => Promise<void>;
} {
  const deleteConversationFromList = React.useCallback(
    async (conversationIdToDelete: string, opts?: { skipConfirm?: boolean }) => {
      const convId = String(conversationIdToDelete || '').trim();
      if (!convId || !apiUrl) return;
      if (!opts?.skipConfirm) {
        const ok = await promptConfirm(
          'Remove chat?',
          'This removes the selected chat from your Chats list. If they message you again, it will reappear.\n\nThis does not delete message history.',
          { confirmText: 'Remove', cancelText: 'Cancel', destructive: true },
        );
        if (!ok) return;
      }

      try {
        const { tokens } = await fetchAuthSession();
        const idToken = tokens?.idToken?.toString();
        if (!idToken) return;
        const res = await fetch(`${apiUrl.replace(/\/$/, '')}/conversations/delete`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${idToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ conversationId: convId }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          console.warn('deleteConversation failed', res.status, text);
          return;
        }
      } catch (err) {
        console.warn('deleteConversation error', err);
        return;
      }

      // Optimistic local cleanup
      setServerConversations((prev) => prev.filter((c) => c.conversationId !== convId));
      setDmThreads((prev) => {
        if (!prev[convId]) return prev;
        const next = { ...prev };
        delete next[convId];
        return next;
      });
      setUnreadDmMap((prev) => {
        if (!prev[convId]) return prev;
        const next = { ...prev };
        delete next[convId];
        return next;
      });
    },
    [apiUrl, fetchAuthSession, promptConfirm, setDmThreads, setServerConversations, setUnreadDmMap],
  );

  return { deleteConversationFromList };
}
