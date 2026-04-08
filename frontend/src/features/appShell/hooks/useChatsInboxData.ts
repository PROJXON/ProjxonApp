import AsyncStorage from '@react-native-async-storage/async-storage';
import * as React from 'react';

import {
  applyTitleOverridesToConversations,
  applyTitleOverridesToUnreadMap,
} from '../../../utils/conversationTitles';

export type UnreadDmInfo = { user: string; count: number; senderSub?: string };
export type UnreadDmMap = Record<string, UnreadDmInfo>;

export type DmThreads = Record<string, { peer: string; lastActivityAt: number }>;

export type ServerConversation = {
  conversationId: string;
  peerDisplayName?: string;
  peerSub?: string;
  conversationKind?: 'dm' | 'group';
  memberStatus?: 'active' | 'left' | 'banned';
  lastMessageAt?: number;
};

export type ChatsListEntry = {
  conversationId: string;
  peer: string;
  conversationKind?: 'dm' | 'group';
  memberStatus?: 'active' | 'left' | 'banned';
  lastActivityAt: number;
  unreadCount: number;
};

function isDmLikeConversationId(conversationId: string): boolean {
  const id = String(conversationId || '').trim();
  return id.startsWith('dm#') || id.startsWith('gdm#');
}

export function useChatsInboxData({
  apiUrl,
  fetchAuthSession,
  chatsOpen,
  userSub,
}: {
  apiUrl: string;
  fetchAuthSession: () => Promise<{ tokens?: { idToken?: { toString: () => string } } }>;
  chatsOpen: boolean;
  /** Used to run one roster fetch on sign-in so group DMs can be validated against `/conversations`. */
  userSub: string | null;
}): {
  unreadDmMap: UnreadDmMap;
  setUnreadDmMap: React.Dispatch<React.SetStateAction<UnreadDmMap>>;

  dmThreads: DmThreads;
  setDmThreads: React.Dispatch<React.SetStateAction<DmThreads>>;

  serverConversations: ServerConversation[];
  setServerConversations: React.Dispatch<React.SetStateAction<ServerConversation[]>>;

  chatsLoading: boolean;
  conversationsCacheAt: number;

  titleOverrideByConvIdRef: React.MutableRefObject<Record<string, string>>;

  upsertDmThread: (convId: string, peerName: string, lastActivityAt?: number) => void;
  dmThreadsList: ChatsListEntry[];
  chatsList: ChatsListEntry[];

  fetchConversations: () => Promise<void>;
  fetchUnreads: () => Promise<void>;

  /** True after a successful `/conversations` response for the current session (see boot fetch). */
  conversationsRosterHydrated: boolean;
} {
  const [unreadDmMap, setUnreadDmMap] = React.useState<UnreadDmMap>(() => ({}));
  // Local-only DM thread list (v1): used to power "Chats" inbox UI.
  // Backed by AsyncStorage so it survives restarts (per-device is OK for now).
  const [dmThreads, setDmThreads] = React.useState<DmThreads>(() => ({}));

  const [serverConversations, setServerConversations] = React.useState<ServerConversation[]>([]);
  const [chatsLoading, setChatsLoading] = React.useState<boolean>(false);
  const [conversationsCacheAt, setConversationsCacheAt] = React.useState<number>(0);
  const [conversationsRosterHydrated, setConversationsRosterHydrated] =
    React.useState<boolean>(false);
  const bootConversationsFetchedForSubRef = React.useRef<string | null>(null);

  // Local title overrides (source of truth from in-chat group meta).
  // Used to keep Chats list + unread labels consistent even if serverConversations is stale.
  const titleOverrideByConvIdRef = React.useRef<Record<string, string>>({});

  const upsertDmThread = React.useCallback(
    (convId: string, peerName: string, lastActivityAt?: number) => {
      const id = String(convId || '').trim();
      if (!id || id === 'global') return;
      const name = String(peerName || '').trim() || 'Direct Message';
      const ts = Number.isFinite(Number(lastActivityAt)) ? Number(lastActivityAt) : Date.now();
      setDmThreads((prev) => {
        const existing = prev[id];
        const next = { ...prev };
        next[id] = {
          peer: name || existing?.peer || 'Direct Message',
          lastActivityAt: Math.max(ts, existing?.lastActivityAt || 0),
        };
        return next;
      });
    },
    [],
  );

  const dmThreadsList = React.useMemo((): ChatsListEntry[] => {
    const entries = Object.entries(dmThreads)
      .map(([convId, info]) => ({
        conversationId: convId,
        peer: info.peer,
        lastActivityAt: info.lastActivityAt || 0,
        unreadCount: unreadDmMap[convId]?.count || 0,
      }))
      .sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0));
    return entries;
  }, [dmThreads, unreadDmMap]);

  const fetchConversations = React.useCallback(async (): Promise<void> => {
    if (!apiUrl) return;
    try {
      setChatsLoading(true);
      const { tokens } = await fetchAuthSession();
      const idToken = tokens?.idToken?.toString();
      if (!idToken) return;
      const res = await fetch(`${apiUrl.replace(/\/$/, '')}/conversations?limit=100`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) return;
      const json: unknown = await res.json().catch(() => null);
      const jsonRec =
        typeof json === 'object' && json != null ? (json as Record<string, unknown>) : {};
      const convos: unknown[] = Array.isArray(jsonRec.conversations) ? jsonRec.conversations : [];
      const parsed: ServerConversation[] = convos
        .map((c) => {
          const rec = typeof c === 'object' && c != null ? (c as Record<string, unknown>) : {};
          const conversationId = String(rec.conversationId || '').trim();
          const conversationKind =
            rec.conversationKind === 'group'
              ? 'group'
              : rec.conversationKind === 'dm'
                ? 'dm'
                : undefined;
          const memberStatus =
            rec.memberStatus === 'active'
              ? 'active'
              : rec.memberStatus === 'left'
                ? 'left'
                : rec.memberStatus === 'banned'
                  ? 'banned'
                  : undefined;
          return {
            conversationId,
            peerDisplayName:
              typeof rec.peerDisplayName === 'string' ? String(rec.peerDisplayName) : undefined,
            peerSub: typeof rec.peerSub === 'string' ? String(rec.peerSub) : undefined,
            conversationKind,
            memberStatus,
            lastMessageAt: Number(rec.lastMessageAt ?? 0),
          } as ServerConversation;
        })
        .filter((c) => c.conversationId);

      // Apply any local overrides (e.g. group name changed in-chat).
      const parsedWithOverrides = applyTitleOverridesToConversations(
        parsed,
        titleOverrideByConvIdRef.current,
      );
      setServerConversations(parsedWithOverrides);
      setConversationsCacheAt(Date.now());
      setConversationsRosterHydrated(true);
      try {
        await AsyncStorage.setItem(
          'conversations:cache:v1',
          JSON.stringify({ at: Date.now(), conversations: parsedWithOverrides }),
        );
      } catch {
        // ignore
      }

      // Best-effort: keep "Added to group: <title>" unread labels in sync with renamed group titles.
      try {
        const titleByConvId = new Map(
          parsedWithOverrides
            .map(
              (c) =>
                [String(c.conversationId || ''), String(c.peerDisplayName || '').trim()] as const,
            )
            .filter(([id, t]) => id && t),
        );
        setUnreadDmMap((prev) => {
          const next = { ...prev };
          for (const [convId, info] of Object.entries(prev || {})) {
            const title = titleByConvId.get(convId);
            if (!title) continue;
            if (info?.user && String(info.user).startsWith('Added to group:')) {
              next[convId] = { ...info, user: `Added to group: ${title}` };
            }
          }
          return next;
        });
      } catch {
        // ignore
      }
    } catch {
      // ignore
    } finally {
      setChatsLoading(false);
    }
  }, [apiUrl, fetchAuthSession]);

  const fetchUnreads = React.useCallback(async (): Promise<void> => {
    if (!apiUrl) return;
    try {
      const { tokens } = await fetchAuthSession();
      const idToken = tokens?.idToken?.toString();
      if (!idToken) return;
      const res = await fetch(`${apiUrl.replace(/\/$/, '')}/unreads`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      const unread = Array.isArray(data.unread) ? data.unread : [];
      const next: UnreadDmMap = {};
      for (const it of unread) {
        const convId = String(it.conversationId || '');
        if (!convId) continue;
        const kind = typeof it.kind === 'string' ? String(it.kind) : '';
        // Prefer display name if backend provides it; fall back to legacy `sender`/`user`.
        // For kind=added, senderDisplayName is treated as the group title.
        const sender = String(
          it.senderDisplayName ||
            it.sender ||
            it.user ||
            (kind === 'added' ? 'Added to group' : 'someone'),
        );
        const senderSub = it.senderSub ? String(it.senderSub) : undefined;
        const countRaw = Number.isFinite(Number(it.messageCount)) ? Number(it.messageCount) : 1;
        const count = kind === 'added' ? 1 : Math.max(1, Math.floor(countRaw));
        next[convId] = {
          user: kind === 'added' ? `Added to group: ${sender}` : sender,
          senderSub,
          count,
        };
        const lastAt = Number(it.lastMessageCreatedAt || 0);
        if (isDmLikeConversationId(convId)) {
          upsertDmThread(
            convId,
            sender,
            Number.isFinite(lastAt) && lastAt > 0 ? lastAt : Date.now(),
          );
        }
      }
      setUnreadDmMap((prev) => {
        // Prefer freshly fetched unread info, but apply any local group title overrides
        // so UI doesn't regress to a stale default name.
        const merged: UnreadDmMap = { ...prev, ...next };
        return applyTitleOverridesToUnreadMap(merged, titleOverrideByConvIdRef.current);
      });
    } catch {
      // ignore
    }
  }, [apiUrl, fetchAuthSession, upsertDmThread]);

  const chatsList = React.useMemo((): ChatsListEntry[] => {
    const mapUnread = unreadDmMap;
    if (serverConversations.length) {
      return serverConversations
        .filter((c) => isDmLikeConversationId(c.conversationId))
        .map((c) => ({
          conversationId: c.conversationId,
          peer: c.peerDisplayName || mapUnread[c.conversationId]?.user || 'Direct Message',
          conversationKind: c.conversationKind,
          memberStatus: c.memberStatus,
          lastActivityAt: Number(c.lastMessageAt || 0),
          unreadCount: mapUnread[c.conversationId]?.count || 0,
        }))
        .sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0));
    }
    return dmThreadsList.filter((c) => isDmLikeConversationId(c.conversationId));
  }, [dmThreadsList, serverConversations, unreadDmMap]);

  // Load persisted DM threads (best-effort).
  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('dm:threads:v1');
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!mounted) return;
        if (parsed && typeof parsed === 'object') {
          setDmThreads(() => parsed);
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Persist DM threads (best-effort).
  React.useEffect(() => {
    (async () => {
      try {
        await AsyncStorage.setItem('dm:threads:v1', JSON.stringify(dmThreads));
      } catch {
        // ignore
      }
    })();
  }, [dmThreads]);

  // One roster fetch per signed-in user so MainApp can validate `gdm#` against the server (not just 403).
  React.useEffect(() => {
    const sub = typeof userSub === 'string' ? userSub.trim() : '';
    if (!sub || !apiUrl) {
      bootConversationsFetchedForSubRef.current = null;
      setConversationsRosterHydrated(false);
      return;
    }
    if (bootConversationsFetchedForSubRef.current === sub) return;
    bootConversationsFetchedForSubRef.current = sub;
    setConversationsRosterHydrated(false);
    void fetchConversations();
  }, [apiUrl, userSub, fetchConversations]);

  // Refresh conversation list when opening the Chats modal.
  React.useEffect(() => {
    if (!chatsOpen) return;
    void fetchConversations();
    void fetchUnreads();
  }, [chatsOpen, fetchConversations, fetchUnreads]);

  // Load cached conversations on boot so Chats opens instantly.
  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('conversations:cache:v1');
        if (!raw) return;
        const parsed = JSON.parse(raw);
        const convos = Array.isArray(parsed?.conversations) ? parsed.conversations : [];
        const at = Number(parsed?.at ?? 0);
        if (!mounted) return;
        if (convos.length) setServerConversations(convos);
        if (Number.isFinite(at) && at > 0) setConversationsCacheAt(at);
      } catch {
        // ignore
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  return {
    unreadDmMap,
    setUnreadDmMap,
    dmThreads,
    setDmThreads,
    serverConversations,
    setServerConversations,
    chatsLoading,
    conversationsCacheAt,
    titleOverrideByConvIdRef,
    upsertDmThread,
    dmThreadsList,
    chatsList,
    fetchConversations,
    fetchUnreads,
    conversationsRosterHydrated,
  };
}
