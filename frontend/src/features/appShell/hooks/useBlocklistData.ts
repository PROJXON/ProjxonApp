import AsyncStorage from '@react-native-async-storage/async-storage';
import * as React from 'react';

export type BlockedUser = {
  blockedSub: string;
  blockedDisplayName?: string;
  blockedUsernameLower?: string;
  blockedAt?: number;
};

function parseApiErrorMessage(raw: string): string {
  const t = String(raw || '').trim();
  if (!t) return '';
  try {
    const parsed: unknown = JSON.parse(t);
    const rec =
      typeof parsed === 'object' && parsed != null ? (parsed as Record<string, unknown>) : null;
    const msg = rec && typeof rec.message === 'string' ? String(rec.message).trim() : '';
    return msg || t;
  } catch {
    return t;
  }
}

export function useBlocklistData({
  apiUrl,
  fetchAuthSession,
  promptConfirm,
  blocklistOpen,
}: {
  apiUrl: string;
  fetchAuthSession: () => Promise<{ tokens?: { idToken?: { toString: () => string } } }>;
  promptConfirm: (
    title: string,
    message: string,
    opts?: { confirmText?: string; cancelText?: string; destructive?: boolean },
  ) => Promise<boolean>;
  blocklistOpen: boolean;
}): {
  blocklistLoading: boolean;
  blockedUsers: BlockedUser[];
  blockedSubs: string[];
  blockUsername: string;
  setBlockUsername: (v: string) => void;
  blockError: string | null;
  setBlockError: (v: string | null) => void;
  addBlockByUsername: () => Promise<void>;
  addBlockBySub: (blockedSub: string, label?: string) => Promise<void>;
  unblockUser: (blockedSub: string, label?: string) => Promise<void>;
} {
  const [blocklistLoading, setBlocklistLoading] = React.useState<boolean>(false);
  const [blockUsername, setBlockUsername] = React.useState<string>('');
  const [blockError, setBlockError] = React.useState<string | null>(null);
  const [blockedUsers, setBlockedUsers] = React.useState<BlockedUser[]>([]);
  const [blocklistCacheAt, setBlocklistCacheAt] = React.useState<number>(0);

  const blockedSubs = React.useMemo(
    () => blockedUsers.map((b) => b.blockedSub).filter(Boolean),
    [blockedUsers],
  );

  const fetchBlocks = React.useCallback(async (): Promise<void> => {
    if (!apiUrl) return;
    try {
      setBlocklistLoading(true);
      const { tokens } = await fetchAuthSession();
      const idToken = tokens?.idToken?.toString();
      if (!idToken) return;
      const res = await fetch(`${apiUrl.replace(/\/$/, '')}/blocks`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) return;
      const json: unknown = await res.json().catch(() => null);
      const rec = typeof json === 'object' && json != null ? (json as Record<string, unknown>) : {};
      const arr: unknown[] = Array.isArray(rec.blocked) ? rec.blocked : [];
      const parsed: BlockedUser[] = arr
        .map((it) => {
          const itRec = typeof it === 'object' && it != null ? (it as Record<string, unknown>) : {};
          const blockedSub = String(itRec.blockedSub || '').trim();
          return {
            blockedSub,
            blockedDisplayName:
              typeof itRec.blockedDisplayName === 'string'
                ? String(itRec.blockedDisplayName)
                : undefined,
            blockedUsernameLower:
              typeof itRec.blockedUsernameLower === 'string'
                ? String(itRec.blockedUsernameLower)
                : undefined,
            blockedAt: typeof itRec.blockedAt === 'number' ? Number(itRec.blockedAt) : undefined,
          };
        })
        .filter((b) => b.blockedSub);
      setBlockedUsers(parsed);
      setBlocklistCacheAt(Date.now());
      try {
        await AsyncStorage.setItem(
          'blocklist:cache:v1',
          JSON.stringify({ at: Date.now(), blocked: parsed }),
        );
      } catch {
        // ignore
      }
    } catch {
      // ignore
    } finally {
      setBlocklistLoading(false);
    }
  }, [apiUrl, fetchAuthSession]);

  const addBlockByUsername = React.useCallback(async (): Promise<void> => {
    if (!apiUrl) return;
    const username = blockUsername.trim();
    if (!username) {
      setBlockError('Enter a username');
      return;
    }
    const ok = await promptConfirm(
      'Block user?',
      `Block "${username}"? You won’t see their messages, and they won’t be able to DM you.\n\nYou can unblock them later from your Blocklist.`,
      { confirmText: 'Block', cancelText: 'Cancel', destructive: true },
    );
    if (!ok) return;

    try {
      setBlockError(null);
      setBlocklistLoading(true);
      const { tokens } = await fetchAuthSession();
      const idToken = tokens?.idToken?.toString();
      if (!idToken) return;
      const res = await fetch(`${apiUrl.replace(/\/$/, '')}/blocks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      if (res.status === 404) {
        setBlockError('No such user');
        return;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const msg = parseApiErrorMessage(text);
        if (res.status === 400 && msg.toLowerCase().includes('cannot block yourself')) {
          setBlockError("You can't block yourself");
          return;
        }
        setBlockError(msg || `Failed to block (${res.status})`);
        return;
      }
      setBlockUsername('');
      await fetchBlocks();
    } catch {
      setBlockError('Failed to block user');
    } finally {
      setBlocklistLoading(false);
    }
  }, [apiUrl, blockUsername, fetchAuthSession, fetchBlocks, promptConfirm]);

  const addBlockBySub = React.useCallback(
    async (blockedSub: string, label?: string): Promise<void> => {
      if (!apiUrl) throw new Error('Missing API_URL');
      const sub = String(blockedSub || '').trim();
      if (!sub) throw new Error('Missing user id');

      const { tokens } = await fetchAuthSession();
      const idToken = tokens?.idToken?.toString();
      if (!idToken) throw new Error('Missing auth token');

      const res = await fetch(`${apiUrl.replace(/\/$/, '')}/blocks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ blockedSub: sub }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const msg = parseApiErrorMessage(text);
        const who = label ? `"${label}"` : 'user';
        if (res.status === 400 && msg.toLowerCase().includes('cannot block yourself')) {
          throw new Error("You can't block yourself");
        }
        throw new Error(
          msg?.trim()
            ? `Failed to block ${who}: ${msg.trim()}`
            : `Failed to block ${who} (${res.status})`,
        );
      }

      await fetchBlocks();
    },
    [apiUrl, fetchAuthSession, fetchBlocks],
  );

  const unblockUser = React.useCallback(
    async (blockedSub: string, label?: string) => {
      const subToUnblock = String(blockedSub || '').trim();
      if (!subToUnblock || !apiUrl) return;
      const ok = await promptConfirm(
        'Unblock User?',
        `Unblock ${label ? `${label}` : 'this user'}?`,
        { confirmText: 'Unblock', cancelText: 'Cancel', destructive: false },
      );
      if (!ok) return;

      try {
        setBlocklistLoading(true);
        const { tokens } = await fetchAuthSession();
        const idToken = tokens?.idToken?.toString();
        if (!idToken) return;
        const res = await fetch(`${apiUrl.replace(/\/$/, '')}/blocks/delete`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ blockedSub: subToUnblock }),
        });
        if (!res.ok) return;
        setBlockedUsers((prev) => prev.filter((b) => b.blockedSub !== subToUnblock));
      } finally {
        setBlocklistLoading(false);
      }
    },
    [apiUrl, fetchAuthSession, promptConfirm],
  );

  React.useEffect(() => {
    if (!blocklistOpen) return;
    setBlockError(null);
    // Cache strategy:
    // - Show whatever we already have immediately (state or persisted cache).
    // - Refresh in background only if stale.
    const STALE_MS = 60_000;
    if (blocklistCacheAt && Date.now() - blocklistCacheAt < STALE_MS) return;
    void fetchBlocks();
  }, [blocklistOpen, blocklistCacheAt, fetchBlocks]);

  // Load cached blocklist on boot so Blocklist opens instantly.
  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('blocklist:cache:v1');
        if (!raw) return;
        const parsed = JSON.parse(raw);
        const arr = Array.isArray(parsed?.blocked) ? parsed.blocked : [];
        const at = Number(parsed?.at ?? 0);
        if (!mounted) return;
        if (arr.length) setBlockedUsers(arr);
        if (Number.isFinite(at) && at > 0) setBlocklistCacheAt(at);
      } catch {
        // ignore
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  return {
    blocklistLoading,
    blockedUsers,
    blockedSubs,
    blockUsername,
    setBlockUsername,
    blockError,
    setBlockError,
    addBlockByUsername,
    addBlockBySub,
    unblockUser,
  };
}
