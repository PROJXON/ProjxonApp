import AsyncStorage from '@react-native-async-storage/async-storage';
import * as React from 'react';

import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { searchChannels } from '../../../utils/channelSearch';

function readCachedChannelNamesByIdSync(): Record<string, string> {
  // Web-only: localStorage is synchronous; use it to hydrate the header chip on first paint.
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem('ui:channelNamesById:v1');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}

export type ChannelSearchResult = {
  channelId: string;
  name: string;
  nameLower?: string;
  isPublic: boolean;
  hasPassword?: boolean;
  activeMemberCount?: number;
  isMember?: boolean;
};

export type LeaveChannelDecision =
  | {
      kind: 'block';
      title: string;
      message: string;
    }
  | {
      kind: 'confirm';
      title: string;
      message: string;
      confirmText: string;
      cancelText: string;
      destructive?: boolean;
    };

export type LeaveChannelResult = { ok: true } | { ok: false; title: string; message: string };

export function useChannelsFlow({
  apiUrl,
  userSub,
  getIdToken,
  promptAlert,
  promptConfirm,
  currentConversationId,
  // navigation + shared UI state
  setConversationId,
  setPeer,
  setSearchOpen,
  setPeerInput,
  setSearchError,
}: {
  apiUrl: string;
  /** When this changes (new sign-in), channel list/search state must not leak from the previous user. */
  userSub?: string | null;
  getIdToken: () => Promise<string | null>;
  promptAlert: (title: string, message: string) => Promise<void>;
  promptConfirm: (
    title: string,
    message: string,
    opts?: { confirmText?: string; cancelText?: string; destructive?: boolean },
  ) => Promise<boolean>;
  currentConversationId: string;
  setConversationId: (v: string) => void;
  setPeer: (v: string | null) => void;
  setSearchOpen: (v: boolean) => void;
  setPeerInput: (v: string) => void;
  setSearchError: (v: string | null) => void;
}): {
  // My Channels
  channelsOpen: boolean;
  setChannelsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  myChannelsLoading: boolean;
  myChannelsError: string | null;
  setMyChannelsError: React.Dispatch<React.SetStateAction<string | null>>;
  myChannels: Array<{
    channelId: string;
    name: string;
    isPublic?: boolean;
    hasPassword?: boolean;
  }>;
  fetchMyChannels: () => Promise<void>;
  leaveChannelFromSettings: (channelId: string) => Promise<void>;
  // iOS: avoid nested native modal stacking by letting the Channels modal render
  // the confirmation/alert as a View overlay.
  getLeaveChannelDecisionForIos: (channelId: string) => Promise<LeaveChannelDecision>;
  leaveChannelFromSettingsIosConfirmed: (channelId: string) => Promise<LeaveChannelResult>;

  // Find Channels
  channelSearchOpen: boolean;
  setChannelSearchOpen: React.Dispatch<React.SetStateAction<boolean>>;
  channelsLoading: boolean;
  channelsQuery: string;
  setChannelsQuery: React.Dispatch<React.SetStateAction<string>>;
  channelsError: string | null;
  setChannelsError: React.Dispatch<React.SetStateAction<string | null>>;
  globalUserCount: number | null;
  channelsResults: ChannelSearchResult[];
  fetchChannelsSearch: (query: string) => Promise<void>;

  // join flow
  joinChannel: (channel: {
    channelId: string;
    name: string;
    isMember?: boolean;
    hasPassword?: boolean;
  }) => Promise<void>;
  channelPasswordPrompt: null | { channelId: string; name: string };
  setChannelPasswordPrompt: React.Dispatch<
    React.SetStateAction<null | { channelId: string; name: string }>
  >;
  channelPasswordInput: string;
  setChannelPasswordInput: React.Dispatch<React.SetStateAction<string>>;
  channelJoinError: string | null;
  setChannelJoinError: React.Dispatch<React.SetStateAction<string | null>>;
  channelPasswordSubmitting: boolean;
  submitChannelPassword: () => Promise<void>;

  // inline create (inside My Channels modal)
  createChannelOpen: boolean;
  setCreateChannelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  createChannelName: string;
  setCreateChannelName: React.Dispatch<React.SetStateAction<string>>;
  createChannelPassword: string;
  setCreateChannelPassword: React.Dispatch<React.SetStateAction<string>>;
  createChannelIsPublic: boolean;
  setCreateChannelIsPublic: React.Dispatch<React.SetStateAction<boolean>>;
  createChannelLoading: boolean;
  setCreateChannelLoading: React.Dispatch<React.SetStateAction<boolean>>;
  createChannelError: string | null;
  setCreateChannelError: React.Dispatch<React.SetStateAction<string | null>>;
  submitCreateChannelInline: () => Promise<void>;

  // channel titles cache
  channelNameById: Record<string, string>;
  setChannelNameById: React.Dispatch<React.SetStateAction<Record<string, string>>>;

  // shared navigation
  enterChannelConversation: (nextConversationId: string) => void;
} {
  // `getIdToken` is often passed as an inline closure from the app shell; keep a ref so
  // effects/callbacks below don't churn and retrigger fetch loops.
  const getIdTokenRef = React.useRef(getIdToken);
  React.useEffect(() => {
    getIdTokenRef.current = getIdToken;
  }, [getIdToken]);

  // "My Channels" modal (opened from Settings → Channels). Lists channels you've joined.
  const [channelsOpen, setChannelsOpen] = React.useState<boolean>(false);
  const [myChannelsLoading, setMyChannelsLoading] = React.useState<boolean>(false);
  const [myChannelsError, setMyChannelsError] = React.useState<string | null>(null);
  const [myChannels, setMyChannels] = React.useState<
    Array<{ channelId: string; name: string; isPublic?: boolean; hasPassword?: boolean }>
  >([]);

  // Channel search/join modal (opened from header channel pill).
  const [channelSearchOpen, setChannelSearchOpen] = React.useState<boolean>(false);
  const [channelsLoading, setChannelsLoading] = React.useState<boolean>(false);
  const [channelsQuery, setChannelsQuery] = React.useState<string>('');
  const [channelsError, setChannelsError] = React.useState<string | null>(null);
  const [globalUserCount, setGlobalUserCount] = React.useState<number | null>(null);
  const [channelsResults, setChannelsResults] = React.useState<ChannelSearchResult[]>([]);

  const [channelNameById, setChannelNameById] = React.useState<Record<string, string>>(() =>
    readCachedChannelNamesByIdSync(),
  );

  // Persist channelId -> name map so the header chip can hydrate instantly on refresh.
  // (DMs already have dm:threads + conversations:cache; channels need a similar local cache.)
  const [channelNamesRestoreDone, setChannelNamesRestoreDone] = React.useState<boolean>(false);

  // Re-load names from storage when identity is known; deps include userSub so a stale async read
  // cannot merge another user's map after account switch (see effect below).
  React.useEffect(() => {
    const sub = typeof userSub === 'string' ? userSub.trim() : '';
    if (!sub) {
      setChannelNamesRestoreDone(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('ui:channelNamesById:v1');
        if (cancelled) return;
        if (!raw) {
          setChannelNamesRestoreDone(true);
          return;
        }
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          setChannelNameById((prev) => ({ ...parsed, ...prev }));
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setChannelNamesRestoreDone(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userSub]);

  // Drop in-memory channel roster/search state whenever the signed-in Cognito identity changes.
  React.useEffect(() => {
    const sub = typeof userSub === 'string' ? userSub.trim() : '';
    if (!sub) return;
    setMyChannels([]);
    setMyChannelsError(null);
    setChannelsResults([]);
    setChannelsError(null);
    setChannelJoinError(null);
    setGlobalUserCount(null);
    setChannelsQuery('');
    setChannelNameById({});
  }, [userSub]);

  React.useEffect(() => {
    // Avoid clobbering storage with {} before the restore runs.
    if (!channelNamesRestoreDone) return;
    const payload = channelNameById || {};
    (async () => {
      try {
        await AsyncStorage.setItem('ui:channelNamesById:v1', JSON.stringify(payload));
      } catch {
        // ignore
      }
      // Web-only: also write raw localStorage for true first-paint hydration.
      try {
        if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
          window.localStorage.setItem('ui:channelNamesById:v1', JSON.stringify(payload));
        }
      } catch {
        // ignore
      }
    })();
  }, [channelNameById, channelNamesRestoreDone]);
  const [channelPasswordPrompt, setChannelPasswordPrompt] = React.useState<null | {
    channelId: string;
    name: string;
  }>(null);
  const [channelPasswordInput, setChannelPasswordInput] = React.useState<string>('');
  const [channelJoinError, setChannelJoinError] = React.useState<string | null>(null);
  const [channelPasswordSubmitting, setChannelPasswordSubmitting] = React.useState<boolean>(false);

  // Inline create form (inside My Channels modal)
  const [createChannelOpen, setCreateChannelOpen] = React.useState<boolean>(false);
  const [createChannelName, setCreateChannelName] = React.useState<string>('');
  const [createChannelPassword, setCreateChannelPassword] = React.useState<string>('');
  const [createChannelIsPublic, setCreateChannelIsPublic] = React.useState<boolean>(true);
  const [createChannelLoading, setCreateChannelLoading] = React.useState<boolean>(false);
  const [createChannelError, setCreateChannelError] = React.useState<string | null>(null);

  const enterChannelConversation = React.useCallback(
    (nextConversationId: string) => {
      const cid = String(nextConversationId || '').trim() || 'global';
      // Entering a channel should close DM search UI and clear DM peer state.
      setConversationId(cid);
      setPeer(null);
      setSearchOpen(false);
      setPeerInput('');
      setSearchError(null);
      setChannelsOpen(false);
      setChannelSearchOpen(false);
      setChannelsError(null);
      setChannelJoinError(null);
      setChannelsQuery('');
    },
    [setConversationId, setPeer, setPeerInput, setSearchError, setSearchOpen],
  );

  const fetchChannelsSearch = React.useCallback(
    async (query: string) => {
      if (!apiUrl) return;
      setChannelsLoading(true);
      setChannelsError(null);
      try {
        const token = await getIdTokenRef.current();
        if (!token) {
          setChannelsError('Unable to authenticate');
          return;
        }
        const q = String(query || '').trim();
        const r = await searchChannels({
          apiUrl,
          query: q,
          limit: 50,
          token,
          preferPublic: false,
          includePublic: false,
          includeAuthed: true,
        });
        if (typeof r.globalUserCount === 'number') {
          setGlobalUserCount(r.globalUserCount);
        } else if (!q) {
          // When opening the modal with empty search, prefer clearing stale counts if not provided.
          setGlobalUserCount(null);
        }
        const normalized: ChannelSearchResult[] = r.channels.map((c) => ({
          ...c,
          isPublic: !!c.isPublic,
        }));
        setChannelsResults(normalized);
        setChannelNameById((prev) => {
          const next = { ...prev };
          for (const c of normalized) next[c.channelId] = c.name;
          return next;
        });
      } catch (e: unknown) {
        setChannelsError(e instanceof Error ? e.message : 'Channel search failed');
      } finally {
        setChannelsLoading(false);
      }
    },
    [apiUrl],
  );

  const debouncedChannelsQuery = useDebouncedValue(channelsQuery, 150, channelSearchOpen);
  React.useEffect(() => {
    if (!channelSearchOpen) return;
    const q = debouncedChannelsQuery;
    void fetchChannelsSearch(q);
  }, [channelSearchOpen, debouncedChannelsQuery, fetchChannelsSearch]);

  const joinChannel = React.useCallback(
    async (channel: {
      channelId: string;
      name: string;
      isMember?: boolean;
      hasPassword?: boolean;
    }) => {
      const channelId = String(channel.channelId || '').trim();
      if (!channelId) return;
      if (channel.isMember) {
        enterChannelConversation(`ch#${channelId}`);
        return;
      }
      if (channel.hasPassword) {
        setChannelPasswordInput('');
        setChannelJoinError(null);
        setChannelPasswordSubmitting(false);
        setChannelSearchOpen(false);
        setChannelPasswordPrompt({ channelId, name: String(channel.name || 'Channel') });
        return;
      }
      if (!apiUrl) return;
      const token = await getIdTokenRef.current();
      if (!token) {
        setChannelJoinError('Unable to authenticate');
        return;
      }
      const base = apiUrl.replace(/\/$/, '');
      const resp = await fetch(`${base}/channels/join`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId }),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        let msg = `Join failed (${resp.status})`;
        try {
          const parsed = text ? JSON.parse(text) : null;
          if (parsed && typeof parsed.message === 'string') msg = parsed.message;
        } catch {
          if (text.trim()) msg = `${msg}: ${text.trim()}`;
        }
        setChannelJoinError(msg);
        return;
      }
      const raw: unknown = await resp.json().catch(() => ({}));
      const rec = typeof raw === 'object' && raw != null ? (raw as Record<string, unknown>) : {};
      const chRec =
        typeof rec.channel === 'object' && rec.channel != null
          ? (rec.channel as Record<string, unknown>)
          : {};
      const name =
        typeof chRec.name === 'string'
          ? String(chRec.name).trim()
          : String(channel.name || 'Channel').trim();
      setChannelNameById((prev) => ({ ...prev, [channelId]: name }));
      enterChannelConversation(`ch#${channelId}`);
    },
    [apiUrl, enterChannelConversation],
  );

  const submitChannelPassword = React.useCallback(async () => {
    const prompt = channelPasswordPrompt;
    if (!prompt) return;
    const channelId = String(prompt.channelId || '').trim();
    const pw = String(channelPasswordInput || '').trim();
    if (!channelId) return;
    if (channelPasswordSubmitting) return;
    if (!pw) {
      setChannelJoinError('Enter a password');
      return;
    }
    if (!apiUrl) return;
    const token = await getIdTokenRef.current();
    if (!token) {
      setChannelJoinError('Unable to authenticate');
      return;
    }
    try {
      setChannelPasswordSubmitting(true);
      setChannelJoinError(null);
      const base = apiUrl.replace(/\/$/, '');
      const resp = await fetch(`${base}/channels/join`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId, password: pw }),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        let msg = `Join failed (${resp.status})`;
        try {
          const parsed = text ? JSON.parse(text) : null;
          if (parsed && typeof parsed.message === 'string') msg = parsed.message;
        } catch {
          if (text.trim()) msg = `${msg}: ${text.trim()}`;
        }
        setChannelJoinError(msg);
        return;
      }
      const raw: unknown = await resp.json().catch(() => ({}));
      const rec = typeof raw === 'object' && raw != null ? (raw as Record<string, unknown>) : {};
      const chRec =
        typeof rec.channel === 'object' && rec.channel != null
          ? (rec.channel as Record<string, unknown>)
          : {};
      const name =
        typeof chRec.name === 'string'
          ? String(chRec.name).trim()
          : String(prompt.name || 'Channel').trim();
      setChannelNameById((prev) => ({ ...prev, [channelId]: name }));
      // Save locally for re-join UX (optional).
      try {
        await AsyncStorage.setItem(`channels:pw:${channelId}`, pw);
      } catch {
        // ignore
      }
      setChannelPasswordPrompt(null);
      setChannelPasswordInput('');
      enterChannelConversation(`ch#${channelId}`);
    } finally {
      setChannelPasswordSubmitting(false);
    }
  }, [
    apiUrl,
    channelPasswordInput,
    channelPasswordPrompt,
    channelPasswordSubmitting,
    enterChannelConversation,
  ]);

  const fetchMyChannels = React.useCallback(async () => {
    if (!apiUrl) return;
    setMyChannelsLoading(true);
    setMyChannelsError(null);
    try {
      const token = await getIdTokenRef.current();
      if (!token) {
        setMyChannelsError('Unable to authenticate');
        return;
      }
      const r = await searchChannels({
        apiUrl,
        query: '',
        limit: 100,
        token,
        preferPublic: false,
        includePublic: false,
        includeAuthed: true,
      });
      const joined = r.channels
        .filter((c) => c && c.isMember === true)
        .map((c) => ({
          channelId: String(c.channelId || '').trim(),
          name: String(c.name || '').trim(),
          isPublic: typeof c.isPublic === 'boolean' ? c.isPublic : undefined,
          hasPassword: typeof c.hasPassword === 'boolean' ? c.hasPassword : undefined,
        }))
        .filter((c) => c.channelId && c.name)
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
      setMyChannels(joined);
      setChannelNameById((prev) => {
        const next = { ...prev };
        for (const c of joined) next[c.channelId] = c.name;
        return next;
      });
    } catch (e: unknown) {
      setMyChannelsError(e instanceof Error ? e.message : 'Failed to load channels');
    } finally {
      setMyChannelsLoading(false);
    }
  }, [apiUrl]);

  React.useEffect(() => {
    if (!channelsOpen) return;
    void fetchMyChannels();
  }, [channelsOpen, fetchMyChannels]);

  const leaveChannelFromSettings = React.useCallback(
    async (channelId: string) => {
      const cid = String(channelId || '').trim();
      if (!cid) return;
      if (!apiUrl) return;
      const leavingActiveChannel = String(currentConversationId || '').trim() === `ch#${cid}`;
      try {
        const token = await getIdTokenRef.current();
        if (!token) {
          setMyChannelsError('Unable to authenticate');
          return;
        }
        const base = apiUrl.replace(/\/$/, '');
        let skipStandardConfirm = false;

        // Best-effort: fetch roster snapshot so we can match ChatScreen leave UX:
        // - Block leaving if user is last admin (and other active members exist)
        // - Warn if user is the last member (leaving will delete channel)
        try {
          const rosterResp = await fetch(
            `${base}/channels/members?channelId=${encodeURIComponent(cid)}`,
            {
              headers: { Authorization: `Bearer ${token}` },
            },
          );
          if (rosterResp.ok) {
            const raw: unknown = await rosterResp.json().catch(() => ({}));
            const data =
              raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : ({} as const);
            const me =
              data.me && typeof data.me === 'object'
                ? (data.me as Record<string, unknown>)
                : ({} as const);
            const meIsAdmin = !!me.isAdmin;
            const membersRaw: unknown[] = Array.isArray(data.members) ? data.members : [];
            const members = membersRaw
              .map((m) => (m && typeof m === 'object' ? (m as Record<string, unknown>) : null))
              .filter(Boolean) as Array<Record<string, unknown>>;
            const active = members.filter((m) => String(m.status || '') === 'active');
            const activeAdmins = active.filter((m) => !!m.isAdmin);
            // If I'm an admin, and there are other active members, require at least one *other* active admin.
            // We don't need mySub: if I'm admin and there's exactly one admin total, that admin must be me.
            if (meIsAdmin && active.length > 1 && activeAdmins.length === 1) {
              await promptAlert(
                'Wait!',
                'You are the last admin. Promote someone else before leaving.',
              );
              return;
            }

            if (active.length === 1) {
              const ok = await promptConfirm(
                'Leave and Delete Channel?',
                'You are the last member in this channel.\n\nIf you leave, the channel and its message history will be deleted.\n\nYou can recreate the channel later.',
                { confirmText: 'Leave & Delete', cancelText: 'Cancel', destructive: true },
              );
              if (!ok) {
                return;
              }
              // This prompt is the confirmation; do not show a second "Leave channel?" modal.
              skipStandardConfirm = true;
            }
          }
        } catch {
          // ignore and fall back to basic confirm + server enforcement
        }

        if (!skipStandardConfirm) {
          const ok = await promptConfirm('Leave Channel?', 'You will stop receiving new messages', {
            confirmText: 'Leave',
            cancelText: 'Cancel',
            destructive: true,
          });
          if (!ok) {
            return;
          }
        }

        const resp = await fetch(`${base}/channels/leave`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ channelId: cid }),
        });
        if (!resp.ok) {
          const text = await resp.text().catch(() => '');
          let msg = `Leave failed (${resp.status})`;
          try {
            const parsed = text ? JSON.parse(text) : null;
            if (parsed && typeof parsed.message === 'string') msg = parsed.message;
          } catch {
            if (text.trim()) msg = `${msg}: ${text.trim()}`;
          }
          // Match ChatScreen: "last admin" should show as "Wait!".
          const looksLikeLastAdmin =
            String(msg || '')
              .toLowerCase()
              .includes('last admin') &&
            String(msg || '')
              .toLowerCase()
              .includes('promote');
          void promptAlert(looksLikeLastAdmin ? 'Wait!' : 'Unable to leave', msg);
          return;
        }
        setMyChannels((prev) =>
          (Array.isArray(prev) ? prev : []).filter((c) => String(c.channelId) !== cid),
        );

        // If the user left the channel they're currently viewing, behave like the in-channel leave action:
        // navigate back to Global and close any channel modals.
        if (leavingActiveChannel) {
          enterChannelConversation('global');
        }
      } catch (e: unknown) {
        void promptAlert('Unable to leave', e instanceof Error ? e.message : 'Leave failed');
      }
    },
    [apiUrl, currentConversationId, enterChannelConversation, promptAlert, promptConfirm],
  );

  const getLeaveChannelDecisionForIos = React.useCallback(
    async (channelId: string): Promise<LeaveChannelDecision> => {
      const cid = String(channelId || '').trim();
      if (!cid) {
        return {
          kind: 'block',
          title: 'Unable to leave',
          message: 'Invalid channel.',
        };
      }
      if (!apiUrl) {
        return {
          kind: 'block',
          title: 'Unable to leave',
          message: 'Backend not configured.',
        };
      }

      const token = await getIdTokenRef.current();
      if (!token) {
        throw new Error('Unable to authenticate');
      }

      const base = apiUrl.replace(/\/$/, '');
      try {
        const rosterResp = await fetch(
          `${base}/channels/members?channelId=${encodeURIComponent(cid)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        if (rosterResp.ok) {
          const raw: unknown = await rosterResp.json().catch(() => ({}));
          const data =
            raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : ({} as const);

          const me =
            data.me && typeof data.me === 'object' ? (data.me as Record<string, unknown>) : {};
          const meIsAdmin = !!me.isAdmin;

          const membersRaw: unknown[] = Array.isArray(data.members) ? data.members : [];
          const members = membersRaw
            .map((m) => (m && typeof m === 'object' ? (m as Record<string, unknown>) : null))
            .filter(Boolean) as Array<Record<string, unknown>>;

          const active = members.filter((m) => String(m.status || '') === 'active');
          const activeAdmins = active.filter((m) => !!m.isAdmin);

          // If I'm an admin, and there are other active members, require at least one *other* active admin.
          if (meIsAdmin && active.length > 1 && activeAdmins.length === 1) {
            return {
              kind: 'block',
              title: 'Wait!',
              message: 'You are the last admin. Promote someone else before leaving.',
            };
          }

          if (active.length === 1) {
            return {
              kind: 'confirm',
              title: 'Leave and Delete Channel?',
              message:
                'You are the last member in this channel.\n\nIf you leave, the channel and its message history will be deleted.\n\nYou can recreate the channel later.',
              confirmText: 'Leave & Delete',
              cancelText: 'Cancel',
              destructive: true,
            };
          }
        }
      } catch {
        // ignore and fall back to basic confirm
      }

      return {
        kind: 'confirm',
        title: 'Leave Channel?',
        message: 'You will stop receiving new messages',
        confirmText: 'Leave',
        cancelText: 'Cancel',
        destructive: true,
      };
    },
    [apiUrl],
  );

  const leaveChannelFromSettingsIosConfirmed = React.useCallback(
    async (channelId: string): Promise<LeaveChannelResult> => {
      const cid = String(channelId || '').trim();
      if (!cid) return { ok: false, title: 'Unable to leave', message: 'Invalid channel.' };
      if (!apiUrl)
        return { ok: false, title: 'Unable to leave', message: 'Backend not configured.' };

      const leavingActiveChannel = String(currentConversationId || '').trim() === `ch#${cid}`;

      try {
        const token = await getIdTokenRef.current();
        if (!token) throw new Error('Unable to authenticate');

        const base = apiUrl.replace(/\/$/, '');
        const resp = await fetch(`${base}/channels/leave`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ channelId: cid }),
        });

        if (!resp.ok) {
          const text = await resp.text().catch(() => '');
          let msg = `Leave failed (${resp.status})`;
          try {
            const parsed = text ? JSON.parse(text) : null;
            if (parsed && typeof parsed.message === 'string') msg = parsed.message;
          } catch {
            if (text.trim()) msg = `${msg}: ${text.trim()}`;
          }

          const looksLikeLastAdmin =
            String(msg || '')
              .toLowerCase()
              .includes('last admin') &&
            String(msg || '')
              .toLowerCase()
              .includes('promote');

          return {
            ok: false,
            title: looksLikeLastAdmin ? 'Wait!' : 'Unable to leave',
            message: msg,
          };
        }

        setMyChannels((prev) =>
          (Array.isArray(prev) ? prev : []).filter((c) => String(c.channelId) !== cid),
        );

        // If we left the channel currently being viewed, behave like the in-channel leave action:
        // navigate back to Global and close any channel modals.
        if (leavingActiveChannel) {
          enterChannelConversation('global');
        } else {
          setChannelsOpen(false);
        }

        return { ok: true };
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Leave failed';
        return { ok: false, title: 'Unable to leave', message };
      }
    },
    [apiUrl, currentConversationId, enterChannelConversation],
  );

  const submitCreateChannelInline = React.useCallback(async () => {
    if (!apiUrl) return;
    if (createChannelLoading) return;
    const name = String(createChannelName || '').trim();
    if (!name) {
      setCreateChannelError('Enter a channel name');
      return;
    }
    const token = await getIdTokenRef.current();
    if (!token) {
      setCreateChannelError('Unable to authenticate');
      return;
    }
    setCreateChannelLoading(true);
    setCreateChannelError(null);
    try {
      const base = apiUrl.replace(/\/$/, '');
      const body: { name: string; isPublic: boolean; password?: string } = {
        name,
        isPublic: !!createChannelIsPublic,
      };
      const pw = String(createChannelPassword || '').trim();
      // Passwords only apply to public channels (private channels aren't joinable via password).
      if (pw && createChannelIsPublic) body.password = pw;
      const resp = await fetch(`${base}/channels/create`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        let msg = `Create failed (${resp.status})`;
        try {
          const parsed = text ? JSON.parse(text) : null;
          if (parsed && typeof parsed.message === 'string') msg = parsed.message;
        } catch {
          if (text.trim()) msg = `${msg}: ${text.trim()}`;
        }
        setCreateChannelError(msg);
        return;
      }
      const raw: unknown = await resp.json().catch(() => ({}));
      const rec = typeof raw === 'object' && raw != null ? (raw as Record<string, unknown>) : {};
      const chRec =
        typeof rec.channel === 'object' && rec.channel != null
          ? (rec.channel as Record<string, unknown>)
          : {};
      const channelId = String(chRec.channelId || '').trim();
      const channelName =
        typeof chRec.name === 'string'
          ? String(chRec.name).trim()
          : String(name || 'Channel').trim();
      if (!channelId) {
        setCreateChannelError('Create failed (missing channelId)');
        return;
      }
      setChannelNameById((prev) => ({ ...prev, [channelId]: channelName }));
      setCreateChannelOpen(false);
      setCreateChannelName('');
      setCreateChannelPassword('');
      setCreateChannelError(null);
      setChannelsOpen(false);
      enterChannelConversation(`ch#${channelId}`);
      void fetchMyChannels();
    } finally {
      setCreateChannelLoading(false);
    }
  }, [
    apiUrl,
    createChannelLoading,
    createChannelName,
    createChannelIsPublic,
    createChannelPassword,
    enterChannelConversation,
    fetchMyChannels,
  ]);

  return {
    channelsOpen,
    setChannelsOpen,
    myChannelsLoading,
    myChannelsError,
    setMyChannelsError,
    myChannels,
    fetchMyChannels,
    leaveChannelFromSettings,
    getLeaveChannelDecisionForIos,
    leaveChannelFromSettingsIosConfirmed,

    channelSearchOpen,
    setChannelSearchOpen,
    channelsLoading,
    channelsQuery,
    setChannelsQuery,
    channelsError,
    setChannelsError,
    globalUserCount,
    channelsResults,
    fetchChannelsSearch,

    joinChannel,
    channelPasswordPrompt,
    setChannelPasswordPrompt,
    channelPasswordInput,
    setChannelPasswordInput,
    channelJoinError,
    setChannelJoinError,
    channelPasswordSubmitting,
    submitChannelPassword,

    createChannelOpen,
    setCreateChannelOpen,
    createChannelName,
    setCreateChannelName,
    createChannelPassword,
    setCreateChannelPassword,
    createChannelIsPublic,
    setCreateChannelIsPublic,
    createChannelLoading,
    setCreateChannelLoading,
    createChannelError,
    setCreateChannelError,
    submitCreateChannelInline,

    channelNameById,
    setChannelNameById,
    enterChannelConversation,
  };
}
