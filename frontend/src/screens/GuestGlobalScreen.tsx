import React from 'react';
import {
  ActivityIndicator,
  AppState,
  AppStateStatus,
  FlatList,
  Image,
  Linking,
  Modal,
  RefreshControl,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { API_URL } from '../config/env';
import { CDN_URL } from '../config/env';
import { VideoView, useVideoPlayer } from 'expo-video';
import Feather from '@expo/vector-icons/Feather';
import { HeaderMenuModal } from '../components/HeaderMenuModal';
import { AvatarBubble } from '../components/AvatarBubble';

type GuestMessage = {
  id: string;
  user: string;
  userSub?: string;
  avatarBgColor?: string;
  avatarTextColor?: string;
  avatarImagePath?: string;
  text: string;
  createdAt: number;
  editedAt?: number;
  reactions?: Record<string, { count: number; userSubs: string[] }>;
  reactionUsers?: Record<string, string>;
  // Backward-compat: historically we supported only a single attachment per message.
  // New messages can include multiple attachments; use `mediaList` when present.
  media?: GuestMediaItem;
  mediaList?: GuestMediaItem[];
};

type GuestMediaItem = {
  path: string;
  thumbPath?: string;
  kind: 'image' | 'video' | 'file';
  contentType?: string;
  thumbContentType?: string;
  fileName?: string;
  size?: number;
};

type ChatEnvelope = {
  type: 'chat';
  text?: string;
  // Backward-compat: `media` may be a single object (v1) or an array (v2+).
  media?: GuestMediaItem | GuestMediaItem[];
};

const GUEST_HISTORY_PAGE_SIZE = 50;

function formatGuestTimestamp(ms: number): string {
  const t = Number(ms);
  if (!Number.isFinite(t) || t <= 0) return '';
  const d = new Date(t);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (isToday) return time;
  return `${d.toLocaleDateString()} ${time}`;
}

function normalizeGuestReactions(raw: any): Record<string, { count: number; userSubs: string[] }> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Record<string, { count: number; userSubs: string[] }> = {};
  for (const [emoji, info] of Object.entries(raw)) {
    const count = Number((info as any)?.count);
    const subs = Array.isArray((info as any)?.userSubs) ? (info as any).userSubs.map(String).filter(Boolean) : [];
    const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : subs.length;
    if (safeCount <= 0 && subs.length === 0) continue;
    out[String(emoji)] = { count: safeCount, userSubs: subs };
  }
  return Object.keys(out).length ? out : undefined;
}

function normalizeGuestMediaList(raw: ChatEnvelope['media']): GuestMediaItem[] {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  const out: GuestMediaItem[] = [];
  for (const m of arr as any[]) {
    if (!m || typeof m !== 'object') continue;
    if (typeof m.path !== 'string') continue;
    const kind = m.kind === 'video' ? 'video' : m.kind === 'image' ? 'image' : 'file';
    out.push({
      path: String(m.path),
      thumbPath: typeof m.thumbPath === 'string' ? String(m.thumbPath) : undefined,
      kind,
      contentType: typeof m.contentType === 'string' ? String(m.contentType) : undefined,
      thumbContentType: typeof m.thumbContentType === 'string' ? String(m.thumbContentType) : undefined,
      fileName: typeof m.fileName === 'string' ? String(m.fileName) : undefined,
      size: typeof m.size === 'number' && Number.isFinite(m.size) ? m.size : undefined,
    });
  }
  return out;
}

function tryParseChatEnvelope(rawText: string): { text: string; mediaList: GuestMediaItem[] } | null {
  const t = (rawText || '').trim();
  if (!t || !t.startsWith('{') || !t.endsWith('}')) return null;
  try {
    const obj = JSON.parse(t) as any;
    if (!obj || typeof obj !== 'object') return null;
    if (obj.type !== 'chat') return null;
    const env = obj as ChatEnvelope;
    const text = typeof env.text === 'string' ? env.text : '';
    const mediaList = normalizeGuestMediaList(env.media);
    if (!text && mediaList.length === 0) return null;
    return { text, mediaList };
  } catch {
    return null;
  }
}

function normalizeGuestMessages(items: any[]): GuestMessage[] {
  const out: GuestMessage[] = [];
  for (const it of items) {
    const createdAt = Number(it?.createdAt ?? Date.now());
    const messageId =
      typeof it?.messageId === 'string' || typeof it?.messageId === 'number'
        ? String(it.messageId)
        : String(createdAt);
    const user = typeof it?.user === 'string' ? it.user : 'anon';
    const userSub = typeof it?.userSub === 'string' ? String(it.userSub) : undefined;
    const deletedAt = typeof it?.deletedAt === 'number' ? it.deletedAt : undefined;
    if (deletedAt) continue;
    const rawText = typeof it?.text === 'string' ? it.text : '';
    const parsed = tryParseChatEnvelope(rawText);
    const text = parsed ? parsed.text : rawText;
    const mediaList = parsed?.mediaList ?? [];
    const media = mediaList.length ? mediaList[0] : undefined;
    if (!text.trim() && mediaList.length === 0) continue;
    out.push({
      id: messageId,
      user,
      userSub,
      avatarBgColor: typeof (it as any)?.avatarBgColor === 'string' ? String((it as any).avatarBgColor) : undefined,
      avatarTextColor: typeof (it as any)?.avatarTextColor === 'string' ? String((it as any).avatarTextColor) : undefined,
      avatarImagePath: typeof (it as any)?.avatarImagePath === 'string' ? String((it as any).avatarImagePath) : undefined,
      text,
      createdAt,
      editedAt: typeof (it as any)?.editedAt === 'number' ? (it as any).editedAt : undefined,
      reactions: normalizeGuestReactions((it as any)?.reactions),
      reactionUsers:
        (it as any)?.reactionUsers && typeof (it as any).reactionUsers === 'object'
          ? Object.fromEntries(Object.entries((it as any).reactionUsers).map(([k, v]) => [String(k), String(v)]))
          : undefined,
      media,
      mediaList: mediaList.length ? mediaList : undefined,
    });
  }

  // Ensure newest-first for inverted list behavior.
  out.sort((a, b) => b.createdAt - a.createdAt);

  // Deduplicate by id (in case of overlapping history windows)
  const seen = new Set<string>();
  return out.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
}

function FullscreenVideo({ url }: { url: string }): React.JSX.Element {
  const player = useVideoPlayer(url, (p: any) => {
    try {
      p.play();
    } catch {}
  });

  return <VideoView player={player} style={styles.viewerVideo} contentFit="contain" nativeControls />;
}

async function fetchGuestGlobalHistoryPage(opts?: {
  before?: number | null;
}): Promise<{ items: GuestMessage[]; hasMore: boolean; nextCursor: number | null }> {
  if (!API_URL) throw new Error('API_URL is not configured');
  const base = API_URL.replace(/\/$/, '');
  const before = opts?.before;
  const qs =
    `conversationId=${encodeURIComponent('global')}` +
    `&limit=${GUEST_HISTORY_PAGE_SIZE}` +
    `&cursor=1` +
    (typeof before === 'number' && Number.isFinite(before) && before > 0 ? `&before=${encodeURIComponent(String(before))}` : '');
  const candidates = [`${base}/public/messages?${qs}`, `${base}/messages?${qs}`];

  const errors: string[] = [];
  for (const url of candidates) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        errors.push(`GET ${url} failed (${res.status}) ${text || ''}`.trim());
        continue;
      }
      const json = await res.json();
      const rawItems = Array.isArray(json) ? json : Array.isArray(json?.items) ? json.items : [];
      const items = normalizeGuestMessages(rawItems);

      const hasMoreFromServer = typeof json?.hasMore === 'boolean' ? json.hasMore : null;
      const nextCursorFromServer =
        typeof json?.nextCursor === 'number' && Number.isFinite(json.nextCursor) ? json.nextCursor : null;

      const nextCursor =
        typeof nextCursorFromServer === 'number' && Number.isFinite(nextCursorFromServer)
          ? nextCursorFromServer
          : items.length
            ? items[items.length - 1].createdAt
            : null;

      const hasMore =
        typeof hasMoreFromServer === 'boolean'
          ? hasMoreFromServer
          : rawItems.length >= GUEST_HISTORY_PAGE_SIZE && typeof nextCursor === 'number' && Number.isFinite(nextCursor);

      return {
        items,
        hasMore: !!hasMore,
        nextCursor: typeof nextCursor === 'number' && Number.isFinite(nextCursor) ? nextCursor : null,
      };
    } catch (err) {
      errors.push(`GET ${url} threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(errors.length ? errors.join('\n') : 'Guest history fetch failed');
}

export default function GuestGlobalScreen({
  onSignIn,
}: {
  onSignIn: () => void;
}): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const [theme, setTheme] = React.useState<'light' | 'dark'>('light');
  const isDark = theme === 'dark';

  // --- Guest onboarding (Option A + C) ---
  // A: show once per install (versioned key)
  // C: provide an "About" button to reopen later
  const ONBOARDING_VERSION = 'v1';
  const ONBOARDING_KEY = `onboardingSeen:${ONBOARDING_VERSION}`;
  const [onboardingOpen, setOnboardingOpen] = React.useState<boolean>(false);
  const [menuOpen, setMenuOpen] = React.useState<boolean>(false);

  React.useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem('ui:theme');
        if (stored === 'dark' || stored === 'light') setTheme(stored);
      } catch {
        // ignore
      }
    })();
  }, []);

  React.useEffect(() => {
    (async () => {
      try {
        await AsyncStorage.setItem('ui:theme', theme);
      } catch {
        // ignore
      }
    })();
  }, [theme]);

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const seen = await AsyncStorage.getItem(ONBOARDING_KEY);
        if (!mounted) return;
        if (!seen) setOnboardingOpen(true);
      } catch {
        if (mounted) setOnboardingOpen(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const dismissOnboarding = React.useCallback(async () => {
    setOnboardingOpen(false);
    try {
      await AsyncStorage.setItem(ONBOARDING_KEY, '1');
    } catch {
      // ignore
    }
  }, []);

  const [messages, setMessages] = React.useState<GuestMessage[]>([]);
  const messagesRef = React.useRef<GuestMessage[]>([]);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [refreshing, setRefreshing] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | null>(null);
  const [historyCursor, setHistoryCursor] = React.useState<number | null>(null);
  const [historyHasMore, setHistoryHasMore] = React.useState<boolean>(true);
  const [historyLoading, setHistoryLoading] = React.useState<boolean>(false);
  const historyLoadingRef = React.useRef<boolean>(false);
  const [urlByPath, setUrlByPath] = React.useState<Record<string, string>>({});
  // How quickly we’ll re-check guest profile avatars for updates (tradeoff: freshness vs API calls).
  const AVATAR_PROFILE_TTL_MS = 60_000;
  const [avatarProfileBySub, setAvatarProfileBySub] = React.useState<
    Record<
      string,
      {
        displayName?: string;
        avatarBgColor?: string;
        avatarTextColor?: string;
        avatarImagePath?: string;
        fetchedAt?: number;
      }
    >
  >({});
  const inFlightAvatarProfileRef = React.useRef<Set<string>>(new Set());
  const [reactionInfoOpen, setReactionInfoOpen] = React.useState<boolean>(false);
  const [reactionInfoEmoji, setReactionInfoEmoji] = React.useState<string>('');
  const [reactionInfoSubs, setReactionInfoSubs] = React.useState<string[]>([]);
  const [reactionInfoNamesBySub, setReactionInfoNamesBySub] = React.useState<Record<string, string>>({});

  const [viewerOpen, setViewerOpen] = React.useState<boolean>(false);
  const [viewerMedia, setViewerMedia] = React.useState<null | { url: string; kind: 'image' | 'video' | 'file'; fileName?: string }>(null);

  React.useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const resolvePathUrl = React.useCallback(
    async (path: string): Promise<string | null> => {
      if (!path) return null;
      const cached = urlByPath[path];
      if (cached) return cached;
      const base = (CDN_URL || '').trim();
      const p = String(path || '').replace(/^\/+/, '');
      if (!base || !p) return null;
      try {
        const b = base.endsWith('/') ? base : `${base}/`;
        const s = new URL(p, b).toString();
        setUrlByPath((prev) => (prev[path] ? prev : { ...prev, [path]: s }));
        return s;
      } catch {
        return null;
      }
    },
    [urlByPath]
  );

  // Guest profile-lite fetch (public endpoint) so avatars update for old messages.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!API_URL) return;
      const base = API_URL.replace(/\/$/, '');
      const missing: string[] = [];
      const now = Date.now();
      for (const m of messages) {
        const sub = m.userSub ? String(m.userSub) : '';
        if (!sub) continue;
        const existing = avatarProfileBySub[sub];
        const stale =
          !existing ||
          typeof existing.fetchedAt !== 'number' ||
          !Number.isFinite(existing.fetchedAt) ||
          now - existing.fetchedAt > AVATAR_PROFILE_TTL_MS;
        if (!stale) continue;
        if (inFlightAvatarProfileRef.current.has(sub)) continue;
        missing.push(sub);
      }
      if (!missing.length) return;
      const unique = Array.from(new Set(missing)).slice(0, 25);
      unique.forEach((s) => inFlightAvatarProfileRef.current.add(s));
      try {
        if (cancelled) return;
        const resp = await fetch(`${base}/public/users/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subs: unique }),
        });
        if (!resp.ok) return;
        const json = await resp.json();
        const users = Array.isArray(json?.users) ? json.users : [];
        if (!users.length) return;
        setAvatarProfileBySub((prev) => {
          const next = { ...prev };
          for (const u of users) {
            const sub = typeof u?.sub === 'string' ? String(u.sub).trim() : '';
            if (!sub) continue;
            next[sub] = {
              displayName: typeof u.displayName === 'string' ? String(u.displayName) : undefined,
              avatarBgColor: typeof u.avatarBgColor === 'string' ? String(u.avatarBgColor) : undefined,
              avatarTextColor: typeof u.avatarTextColor === 'string' ? String(u.avatarTextColor) : undefined,
              avatarImagePath: typeof u.avatarImagePath === 'string' ? String(u.avatarImagePath) : undefined,
              fetchedAt: now,
            };
          }
          return next;
        });
      } finally {
        unique.forEach((s) => inFlightAvatarProfileRef.current.delete(s));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [messages, avatarProfileBySub]);

  // Prefetch avatar image URLs (best-effort).
  React.useEffect(() => {
    let cancelled = false;
    const needed: string[] = [];
    for (const prof of Object.values(avatarProfileBySub)) {
      const p = prof?.avatarImagePath;
      if (!p) continue;
      if (urlByPath[p]) continue;
      needed.push(p);
    }
    if (!needed.length) return;
    const unique = Array.from(new Set(needed));
    (async () => {
      for (const p of unique) {
        if (cancelled) return;
        await resolvePathUrl(p);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [avatarProfileBySub, urlByPath, resolvePathUrl]);

  const openReactionInfo = React.useCallback(
    (emoji: string, subs: string[], namesBySub?: Record<string, string>) => {
    setReactionInfoEmoji(String(emoji || ''));
    setReactionInfoSubs(Array.isArray(subs) ? subs.map(String).filter(Boolean) : []);
    setReactionInfoNamesBySub(namesBySub && typeof namesBySub === 'object' ? namesBySub : {});
    setReactionInfoOpen(true);
  }, []);

  const openViewer = React.useCallback(
    async (media: GuestMessage['media']) => {
      if (!media?.path) return;
      const url = await resolvePathUrl(media.path);
      if (!url) return;

      // For files, keep the existing behavior (open externally).
      if (media.kind === 'file') {
        await Linking.openURL(url.toString());
        return;
      }

      setViewerMedia({
        url: url.toString(),
        kind: media.kind,
        fileName: media.fileName,
      });
      setViewerOpen(true);
    },
    [resolvePathUrl]
  );

  const fetchHistoryPage = React.useCallback(
    async (opts?: { reset?: boolean; before?: number | null; isManual?: boolean }) => {
      const reset = !!opts?.reset;
      const before = opts?.before;
      const isManual = !!opts?.isManual;

      if (reset) {
        historyLoadingRef.current = false;
      }
      if (historyLoadingRef.current) return;
      historyLoadingRef.current = true;
      setHistoryLoading(true);

      if (isManual) setRefreshing(true);
      else {
        const currentCount = messagesRef.current.length;
        setLoading((prev) => prev || (reset ? true : currentCount === 0));
      }

      try {
        setError(null);
        const page = await fetchGuestGlobalHistoryPage({ before });
        if (reset) {
          setMessages(page.items);
          setHistoryHasMore(!!page.hasMore);
          setHistoryCursor(page.nextCursor);
        } else {
          // Merge older page into the list; if the page is all duplicates, stop paging to avoid
          // an infinite spinner loop (usually means cursor was stale or server ignored `before`).
          let appendedCount = 0;
          let mergedNextCursor: number | null = null;

          setMessages((prev) => {
            const prevSeen = new Set(prev.map((m) => m.id));
            const filtered = page.items.filter((m) => !prevSeen.has(m.id));
            appendedCount = filtered.length;
            const merged = filtered.length ? [...prev, ...filtered] : prev;
            mergedNextCursor = merged.length ? merged[merged.length - 1].createdAt : null;
            return merged;
          });

          if (page.items.length > 0 && appendedCount === 0) {
            setHistoryHasMore(false);
          } else {
            setHistoryHasMore(!!page.hasMore);
          }
          setHistoryCursor(mergedNextCursor);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to load messages';
        setError(msg);
      } finally {
        setLoading(false);
        if (isManual) setRefreshing(false);
        historyLoadingRef.current = false;
        setHistoryLoading(false);
      }
    },
    []
  );

  const loadOlderHistory = React.useCallback(() => {
    if (!API_URL) return;
    if (!historyHasMore) return;
    // Fire and forget; guarded by historyLoadingRef.
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    fetchHistoryPage({
      // Use the oldest currently-rendered message as the cursor.
      // This avoids stale `historyCursor` edge-cases (e.g., user taps "Load older" quickly).
      before: messagesRef.current.length
        ? messagesRef.current[messagesRef.current.length - 1].createdAt
        : historyCursor,
      reset: false,
    });
  }, [fetchHistoryPage, historyCursor, historyHasMore]);

  const refreshLatest = React.useCallback(async () => {
    if (!API_URL) return;
    if (historyLoadingRef.current) return;
    historyLoadingRef.current = true;
    setHistoryLoading(true);
    try {
      setError(null);
      const page = await fetchGuestGlobalHistoryPage({ before: null });
      setMessages((prev) => {
        const seen = new Set<string>();
        const combined = [...page.items, ...prev];
        return combined.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
      });
      // IMPORTANT: do not reset cursor/hasMore during a "latest refresh" -
      // otherwise we can wipe paging state while the user is scrolling back.
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load messages';
      setError(msg);
    } finally {
      historyLoadingRef.current = false;
      setHistoryLoading(false);
    }
  }, []);

  const fetchNow = React.useCallback(
    async (opts?: { isManual?: boolean }) => {
      const isManual = !!opts?.isManual;
      if (isManual) {
        // Pull-to-refresh: fetch latest and merge (do NOT wipe older pages)
        await refreshLatest();
        return;
      }
      // Initial load: reset pagination.
      await fetchHistoryPage({ reset: true });
    },
    [fetchHistoryPage, refreshLatest]
  );

  // Initial fetch
  React.useEffect(() => {
    fetchNow().catch(() => {});
  }, [fetchNow]);

  // Poll every 60s while the app is in the foreground.
  React.useEffect(() => {
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    const appStateRef = { current: AppState.currentState as AppStateStatus };

    const stop = () => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
    };

    const start = () => {
      if (pollTimer) return;
      pollTimer = setInterval(() => {
        refreshLatest().catch(() => {});
      }, 60_000);
    };

    const sub = AppState.addEventListener('change', (nextState) => {
      appStateRef.current = nextState;
      if (nextState === 'active') start();
      else stop();
    });

    if (appStateRef.current === 'active') start();

    return () => {
      stop();
      sub.remove();
    };
  }, [refreshLatest]);

  return (
    // App.tsx already applies the top safe area. Avoid double top inset here (dead space).
    <SafeAreaView style={[styles.container, isDark && styles.containerDark]} edges={['left', 'right']}>
      <View style={styles.headerRow}>
        <Text style={[styles.headerTitle, isDark && styles.headerTitleDark]}>Global</Text>
        <View style={styles.headerRight}>
          <Pressable
            onPress={() => setMenuOpen(true)}
            style={({ pressed }) => [
              styles.menuIconBtn,
              isDark && styles.menuIconBtnDark,
              pressed && { opacity: 0.85 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Open menu"
          >
            <Feather name="menu" size={18} color={isDark ? '#fff' : '#111'} />
          </Pressable>
        </View>
      </View>

      <HeaderMenuModal
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={undefined}
        isDark={isDark}
        cardWidth={160}
        headerRight={
          <View style={[styles.themeToggle, isDark && styles.themeToggleDark]}>
            <Feather name={isDark ? 'moon' : 'sun'} size={16} color={isDark ? '#fff' : '#111'} />
            <Switch
              value={isDark}
              onValueChange={(v) => setTheme(v ? 'dark' : 'light')}
              trackColor={{ false: '#d1d1d6', true: '#d1d1d6' }}
              thumbColor={isDark ? '#2a2a33' : '#ffffff'}
            />
          </View>
        }
        items={[
          {
            key: 'about',
            label: 'About',
            onPress: () => {
              setMenuOpen(false);
              setOnboardingOpen(true);
            },
          },
          {
            key: 'signin',
            label: 'Sign in',
            onPress: () => {
              setMenuOpen(false);
              onSignIn();
            },
          },
        ]}
      />

      {error ? (
        <Text style={[styles.errorText, isDark && styles.errorTextDark]} numberOfLines={3}>
          {error}
        </Text>
      ) : null}

      {loading && messages.length === 0 ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator />
        </View>
      ) : null}

      <FlatList
        data={messages}
        keyExtractor={(m) => m.id}
        inverted
        keyboardShouldPersistTaps="handled"
        onEndReached={() => {
          if (!API_URL) return;
          if (!historyHasMore) return;
          if (historyLoading) return;
          loadOlderHistory();
        }}
        onEndReachedThreshold={0.2}
        ListFooterComponent={
          API_URL ? (
            <View style={{ paddingVertical: 10, alignItems: 'center' }}>
              {historyHasMore ? (
                <Pressable
                  onPress={loadOlderHistory}
                  disabled={historyLoading}
                  style={({ pressed }) => ({
                    paddingHorizontal: 14,
                    paddingVertical: 9,
                    borderRadius: 999,
                    backgroundColor: isDark ? '#2a2a33' : '#e9e9ee',
                    opacity: historyLoading ? 0.6 : pressed ? 0.85 : 1,
                  })}
                >
                  <Text style={{ color: isDark ? '#fff' : '#111', fontWeight: '700' }}>
                    {historyLoading ? 'Loading older…' : 'Load older messages'}
                  </Text>
                </Pressable>
              ) : (
                <Text style={{ color: isDark ? '#aaa' : '#666' }}>
                  {messages.length === 0 ? 'Sign in to Start the Conversation!' : 'No older messages'}
                </Text>
              )}
            </View>
          ) : null
        }
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => fetchNow({ isManual: true })}
            tintColor={isDark ? '#ffffff' : '#111'}
          />
        }
        renderItem={({ item, index }) => {
          const AVATAR_SIZE = 44;
          const AVATAR_GAP = 8;
          const senderKey = (item.userSub && String(item.userSub)) || item.user;
          const next = messages[index + 1];
          const nextSenderKey = next ? ((next.userSub && String(next.userSub)) || next.user) : '';
          const showAvatar = !next || nextSenderKey !== senderKey;
          const AVATAR_GUTTER = showAvatar ? AVATAR_SIZE + AVATAR_GAP : 0;
          const prof = item.userSub ? avatarProfileBySub[String(item.userSub)] : undefined;
          const avatarImageUri = prof?.avatarImagePath ? urlByPath[String(prof.avatarImagePath)] : undefined;
          return (
            <GuestMessageRow
              item={item}
              isDark={isDark}
              resolvePathUrl={resolvePathUrl}
              onOpenReactionInfo={openReactionInfo}
              onOpenViewer={openViewer}
              avatarSize={AVATAR_SIZE}
              avatarGutter={AVATAR_GUTTER}
              avatarSeed={senderKey}
              avatarImageUri={avatarImageUri}
              avatarBgColor={prof?.avatarBgColor ?? item.avatarBgColor}
              avatarTextColor={prof?.avatarTextColor ?? item.avatarTextColor}
              showAvatar={showAvatar}
            />
          );
        }}
      />

      {/* Bottom bar CTA (like the chat input row), so messages never render behind it */}
      <View
        style={[
          styles.bottomBar,
          isDark && styles.bottomBarDark,
          // Fill the safe area with the bar background, but keep the inner content vertically centered.
          { paddingBottom: insets.bottom },
        ]}
      >
        <View style={styles.bottomBarInner}>
          <Pressable
            onPress={onSignIn}
            style={({ pressed }) => [
              styles.bottomBarCta,
              isDark && styles.bottomBarCtaDark,
              pressed && { opacity: 0.9 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Sign in to chat"
          >
            <Text style={[styles.bottomBarCtaText, isDark && styles.bottomBarCtaTextDark]}>
              Sign in to Chat
            </Text>
          </Pressable>
        </View>
      </View>

      <Modal visible={reactionInfoOpen} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, isDark && styles.modalCardDark]}>
            <Text style={[styles.modalTitle, isDark && styles.modalTitleDark]}>
              Reactions{reactionInfoEmoji ? ` · ${reactionInfoEmoji}` : ''}
            </Text>
            <ScrollView style={styles.modalScroll}>
              {reactionInfoSubs.length ? (
                reactionInfoSubs.map((sub) => {
                  const name = reactionInfoNamesBySub[sub];
                  const label = name ? String(name) : sub;
                  return (
                  <Text key={`rx:${reactionInfoEmoji}:${sub}`} style={[styles.modalRowText, isDark && styles.modalRowTextDark]}>
                    {label}
                  </Text>
                  );
                })
              ) : (
                <Text style={[styles.modalRowText, isDark && styles.modalRowTextDark]}>No reactors</Text>
              )}
            </ScrollView>
            <View style={styles.modalButtons}>
              <Pressable
                style={[styles.modalBtn, isDark && styles.modalBtnDark]}
                onPress={() => setReactionInfoOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Close reactions"
              >
                <Text style={[styles.modalBtnText, isDark && styles.modalBtnTextDark]}>OK</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={onboardingOpen} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, isDark && styles.modalCardDark]}>
            <Text style={[styles.modalTitle, isDark && styles.modalTitleDark]}>Welcome to Projxon</Text>
            <ScrollView style={styles.modalScroll}>
              <Text style={[styles.modalRowText, isDark && styles.modalRowTextDark]}>
                You’re currently viewing a guest preview of Global chat. You can join public channels.
              </Text>
              <Text style={[styles.modalRowText, isDark && styles.modalRowTextDark]}>
                Sign in to send messages, react, utilize AI features, and access direct messages.
              </Text>
              <Text style={[styles.modalRowText, isDark && styles.modalRowTextDark]}>
                Tip: DMs support end-to-end encryption on signed-in devices.
              </Text>
            </ScrollView>
            <View style={styles.modalButtons}>
              <Pressable
                style={[styles.modalBtn, isDark && styles.modalBtnDark]}
                onPress={() => void dismissOnboarding()}
                accessibilityRole="button"
                accessibilityLabel="Dismiss welcome"
              >
                <Text style={[styles.modalBtnText, isDark && styles.modalBtnTextDark]}>Got it</Text>
              </Pressable>
              <Pressable
                style={[styles.modalBtn, isDark && styles.modalBtnDark]}
                onPress={() => {
                  void dismissOnboarding();
                  onSignIn();
                }}
                accessibilityRole="button"
                accessibilityLabel="Sign in"
              >
                <Text style={[styles.modalBtnText, isDark && styles.modalBtnTextDark]}>Sign in</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={viewerOpen} transparent animationType="fade">
        <View style={styles.viewerOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => {
              setViewerOpen(false);
              setViewerMedia(null);
            }}
          />
          <View style={styles.viewerCard}>
            <View style={styles.viewerTopBar}>
              <Text style={styles.viewerTitle}>{viewerMedia?.fileName || 'Attachment'}</Text>
              <Pressable
                style={styles.viewerCloseBtn}
                onPress={() => {
                  setViewerOpen(false);
                  setViewerMedia(null);
                }}
              >
                <Text style={styles.viewerCloseText}>Close</Text>
              </Pressable>
            </View>
            <View style={styles.viewerBody}>
              {viewerMedia?.kind === 'image' && viewerMedia?.url ? (
                <Image source={{ uri: viewerMedia.url }} style={styles.viewerImage} />
              ) : viewerMedia?.kind === 'video' && viewerMedia?.url ? (
                <FullscreenVideo url={viewerMedia.url} />
              ) : (
                <Text style={styles.viewerFallback}>No preview available.</Text>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function GuestMessageRow({
  item,
  isDark,
  resolvePathUrl,
  onOpenReactionInfo,
  onOpenViewer,
  avatarSize,
  avatarGutter,
  avatarSeed,
  avatarImageUri,
  avatarBgColor,
  avatarTextColor,
  showAvatar,
}: {
  item: GuestMessage;
  isDark: boolean;
  resolvePathUrl: (path: string) => Promise<string | null>;
  onOpenReactionInfo: (emoji: string, subs: string[], namesBySub?: Record<string, string>) => void;
  onOpenViewer: (media: GuestMediaItem) => void;
  avatarSize: number;
  avatarGutter: number;
  avatarSeed: string;
  avatarImageUri?: string;
  avatarBgColor?: string;
  avatarTextColor?: string;
  showAvatar: boolean;
}) {
  const AVATAR_TOP_OFFSET = 4;
  const { width: windowWidth } = useWindowDimensions();
  const [thumbUrl, setThumbUrl] = React.useState<string | null>(null);
  const [usedFullUrl, setUsedFullUrl] = React.useState<boolean>(false);
  const [thumbAspect, setThumbAspect] = React.useState<number | null>(null);

  const mediaList = item.mediaList ?? (item.media ? [item.media] : []);
  const primaryMedia = mediaList.length ? mediaList[0] : null;
  const extraCount = Math.max(0, mediaList.length - 1);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const preferredPath = primaryMedia?.thumbPath || primaryMedia?.path;
      if (!preferredPath) return;
      const u = await resolvePathUrl(preferredPath);
      if (!cancelled) setThumbUrl(u);
    })();
    return () => {
      cancelled = true;
    };
  }, [primaryMedia?.path, primaryMedia?.thumbPath, resolvePathUrl]);

  React.useEffect(() => {
    if (!thumbUrl) return;
    let cancelled = false;
    Image.getSize(
      thumbUrl,
      (w, h) => {
        if (cancelled) return;
        const aspect = w > 0 && h > 0 ? w / h : 1;
        setThumbAspect(Number.isFinite(aspect) ? aspect : 1);
      },
      () => {
        if (!cancelled) setThumbAspect(null);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [thumbUrl]);

  const hasMedia = !!primaryMedia?.path;
  const ts = formatGuestTimestamp(item.createdAt);
  const metaLine = `${item.user}${ts ? ` · ${ts}` : ''}`;
  const isEdited = typeof item.editedAt === 'number' && Number.isFinite(item.editedAt);
  const captionHasText = !!item.text && item.text.trim().length > 0;

  const reactionEntriesVisible = React.useMemo(() => {
    const entries = item.reactions ? Object.entries(item.reactions) : [];
    return entries
      .sort((a, b) => (b[1]?.count ?? 0) - (a[1]?.count ?? 0))
      .slice(0, 3);
  }, [item.reactions]);

  const onThumbError = React.useCallback(async () => {
    // Common cases:
    // - thumb object doesn't exist
    // - S3 returns 403 because guest read policy isn't deployed yet
    // Try the full object as a fallback (especially useful if only the thumb is missing).
    if (usedFullUrl) return;
    const fullPath = primaryMedia?.path;
    if (!fullPath) return;
    const u = await resolvePathUrl(fullPath);
    if (u) {
      setUsedFullUrl(true);
      setThumbUrl(u);
      return;
    }
    // If we couldn't resolve anything, drop the preview so we fall back to a file chip.
    setThumbUrl(null);
  }, [primaryMedia?.path, resolvePathUrl, usedFullUrl]);

  // Match ChatScreen-ish thumbnail sizing: capped max size, preserve aspect ratio, no crop.
  const CHAT_MEDIA_MAX_HEIGHT = 240;
  const CHAT_MEDIA_MAX_WIDTH_FRACTION = 0.86;
  const maxW = Math.max(220, Math.floor((windowWidth - Math.max(0, avatarGutter)) * CHAT_MEDIA_MAX_WIDTH_FRACTION));
  const maxH = CHAT_MEDIA_MAX_HEIGHT;
  const aspect = typeof thumbAspect === 'number' ? thumbAspect : 1;
  const capped = (() => {
    const w = maxW;
    const h = Math.max(80, Math.round(w / Math.max(0.1, aspect)));
    if (h <= maxH) return { w, h };
    const w2 = Math.max(160, Math.round(maxH * Math.max(0.1, aspect)));
    return { w: Math.min(maxW, w2), h: maxH };
  })();

  return (
    <View style={[styles.msgRow]}>
      {showAvatar ? (
        <View style={[styles.avatarGutter, { width: avatarSize, marginTop: AVATAR_TOP_OFFSET }]}>
          <AvatarBubble
            size={avatarSize}
            seed={avatarSeed}
            label={item.user}
            backgroundColor={avatarBgColor}
            textColor={avatarTextColor}
            imageUri={avatarImageUri}
            imageBgColor={isDark ? '#1c1c22' : '#f2f2f7'}
          />
        </View>
      ) : null}
      {hasMedia ? (
        <View style={[styles.guestMediaCardOuter, { width: capped.w }]}>
          <View style={[styles.guestMediaCard, isDark ? styles.guestMediaCardDark : null]}>
            <View style={[styles.guestMediaHeader, isDark ? styles.guestMediaHeaderDark : null]}>
              <View style={styles.guestMediaHeaderTopRow}>
                <View style={styles.guestMediaHeaderTopLeft}>
                  <Text
                    style={[styles.guestMetaLine, isDark ? styles.guestMetaLineDark : null]}
                  >
                    {metaLine}
                  </Text>
                </View>
                <View style={styles.guestMediaHeaderTopRight}>
                  {isEdited && !captionHasText ? (
                    <Text style={[styles.guestEditedLabel, isDark ? styles.guestEditedLabelDark : null]}>Edited</Text>
                  ) : null}
                </View>
              </View>
              {captionHasText ? (
                <View style={styles.guestMediaCaptionRow}>
                  <Text
                    style={[
                      styles.guestMediaCaption,
                      isDark ? styles.guestMediaCaptionDark : null,
                      styles.guestMediaCaptionFlex,
                    ]}
                  >
                    {item.text}
                  </Text>
                  {isEdited ? (
                    <View style={styles.guestMediaCaptionIndicators}>
                      <Text style={[styles.guestEditedLabel, isDark ? styles.guestEditedLabelDark : null]}>
                        Edited
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>

            <Pressable
              onPress={() => {
                if (primaryMedia) onOpenViewer(primaryMedia);
              }}
              style={({ pressed }) => [{ opacity: pressed ? 0.92 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel="Open media"
            >
              {primaryMedia?.kind === 'image' && thumbUrl ? (
                <Image
                  source={{ uri: thumbUrl }}
                  style={{ width: capped.w, height: capped.h }}
                  resizeMode="contain"
                  onError={() => void onThumbError()}
                />
              ) : primaryMedia?.kind === 'video' && thumbUrl ? (
                <View style={{ width: capped.w, height: capped.h }}>
                  <Image
                    source={{ uri: thumbUrl }}
                    style={styles.mediaFill}
                    resizeMode="cover"
                    onError={() => void onThumbError()}
                  />
                  <View style={styles.guestMediaPlayOverlay}>
                    <Text style={styles.guestMediaPlayOverlayText}>▶</Text>
                  </View>
                </View>
              ) : (
                <View style={[styles.guestMediaFileChip, isDark && styles.guestMediaFileChipDark]}>
                  <Text style={[styles.guestMediaFileText, isDark && styles.guestMediaFileTextDark]} numberOfLines={1}>
                    {primaryMedia?.fileName ? primaryMedia.fileName : primaryMedia?.kind === 'video' ? 'Video' : 'File'}
                  </Text>
                </View>
              )}
            </Pressable>

            {extraCount ? (
              <View style={styles.guestExtraMediaRow}>
                <Text style={[styles.guestExtraMediaText, isDark ? styles.guestExtraMediaTextDark : null]}>
                  +{extraCount} more
                </Text>
              </View>
            ) : null}
          </View>

          {reactionEntriesVisible.length ? (
            <View style={styles.guestReactionOverlay} pointerEvents="box-none">
              {reactionEntriesVisible.map(([emoji, info]) => (
                <Pressable
                  key={`${item.id}:${emoji}`}
                  onPress={() =>
                    onOpenReactionInfo(String(emoji), (info?.userSubs || []).map(String), item.reactionUsers)
                  }
                  style={[styles.guestReactionChip, isDark && styles.guestReactionChipDark]}
                  accessibilityRole="button"
                  accessibilityLabel={`Reactions ${emoji}`}
                >
                  <Text style={[styles.guestReactionText, isDark && styles.guestReactionTextDark]}>
                    {emoji}
                    {(info?.count ?? 0) > 1 ? ` ${(info?.count ?? 0)}` : ''}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ) : (
        <View style={styles.guestBubbleOuter}>
          <View style={[styles.bubble, isDark && styles.bubbleDark]}>
            <Text style={[styles.guestMetaLine, isDark ? styles.guestMetaLineDark : null]}>{metaLine}</Text>
            {item.text?.trim() ? (
              <View style={styles.guestTextRow}>
                <Text style={[styles.msgText, isDark && styles.msgTextDark, styles.guestTextFlex]}>{item.text}</Text>
                {isEdited ? (
                  <Text style={[styles.guestEditedInline, isDark ? styles.guestEditedLabelDark : null]}>Edited</Text>
                ) : null}
              </View>
            ) : null}
          </View>

          {reactionEntriesVisible.length ? (
            <View style={styles.guestReactionOverlay} pointerEvents="box-none">
              {reactionEntriesVisible.map(([emoji, info]) => (
                <Pressable
                  key={`${item.id}:${emoji}`}
                  onPress={() =>
                    onOpenReactionInfo(String(emoji), (info?.userSubs || []).map(String), item.reactionUsers)
                  }
                  style={[styles.guestReactionChip, isDark && styles.guestReactionChipDark]}
                  accessibilityRole="button"
                  accessibilityLabel={`Reactions ${emoji}`}
                >
                  <Text style={[styles.guestReactionText, isDark && styles.guestReactionTextDark]}>
                    {emoji}
                    {(info?.count ?? 0) > 1 ? ` ${(info?.count ?? 0)}` : ''}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  containerDark: {
    backgroundColor: '#0b0b0f',
  },
  headerRow: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111',
  },
  headerTitleDark: {
    color: '#fff',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  themeToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e3e3e3',
  },
  themeToggleDark: {
    backgroundColor: '#14141a',
    borderColor: '#2a2a33',
  },
  menuIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e3e3e3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuIconBtnDark: {
    backgroundColor: '#14141a',
    borderColor: '#2a2a33',
  },
  signInPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e3e3e3',
  },
  signInPillDark: {
    backgroundColor: '#14141a',
    borderColor: '#2a2a33',
  },
  signInPillText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111',
  },
  signInPillTextDark: {
    color: '#fff',
  },
  errorText: {
    paddingHorizontal: 12,
    paddingBottom: 6,
    color: '#b00020',
    fontSize: 12,
  },
  errorTextDark: {
    color: '#ff6b6b',
  },
  loadingWrap: {
    paddingVertical: 16,
  },
  listContent: {
    paddingHorizontal: 6,
    // Inverted list: include symmetric padding so the newest message doesn't hug the bottom bar.
    paddingTop: 12,
    paddingBottom: 12,
  },
  msgRow: {
    paddingVertical: 4,
    alignItems: 'flex-start',
    flexDirection: 'row',
  },
  avatarGutter: { marginRight: 8 },
  avatarSpacer: { opacity: 0 },
  guestBubbleOuter: { alignSelf: 'flex-start', position: 'relative', overflow: 'visible', maxWidth: '92%' },
  bubble: {
    maxWidth: '92%',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#f2f2f7',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e3e3e3',
  },
  bubbleDark: {
    backgroundColor: '#1c1c22',
    borderColor: '#2a2a33',
  },
  guestReactionOverlay: {
    position: 'absolute',
    bottom: -12,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  guestReactionChip: {
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 3,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e3e3e3',
  },
  guestReactionChipDark: {
    backgroundColor: '#14141a',
    borderColor: '#2a2a33',
  },
  guestReactionText: { color: '#111', fontWeight: '800', fontSize: 12 },
  guestReactionTextDark: { color: '#fff' },
  guestTextRow: { flexDirection: 'row', alignItems: 'flex-end', flexWrap: 'wrap' },
  guestTextFlex: { flexShrink: 1 },
  guestEditedInline: {
    marginLeft: 6,
    fontSize: 12,
    fontStyle: 'italic',
    fontWeight: '400',
    color: '#555',
  },
  userText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#444',
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 4,
  },
  guestMetaLine: {
    fontSize: 12,
    fontWeight: '800',
    color: '#555',
    marginBottom: 4,
    flexWrap: 'wrap',
  },
  guestMetaLineDark: {
    color: '#b7b7c2',
  },
  timeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#777',
  },
  timeTextDark: {
    color: '#a7a7b4',
  },
  userTextDark: {
    color: '#d7d7e0',
  },
  msgText: {
    fontSize: 15,
    color: '#111',
    lineHeight: 20,
  },
  msgTextDark: {
    color: '#fff',
  },
  guestMediaCardOuter: { alignSelf: 'flex-start', position: 'relative', overflow: 'visible' },
  guestMediaCard: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#f1f1f1',
  },
  guestMediaCardDark: {
    backgroundColor: '#1c1c22',
  },
  guestMediaHeader: {
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 6,
    backgroundColor: '#f1f1f1',
  },
  guestMediaHeaderDark: {
    backgroundColor: '#1c1c22',
  },
  guestMediaMeta: {
    fontSize: 12,
    fontWeight: '700',
    color: '#555',
  },
  guestMediaMetaDark: {
    color: '#b7b7c2',
  },
  guestMediaCaption: {
    marginTop: 4,
    fontSize: 15,
    fontWeight: '400',
    color: '#111',
    lineHeight: 20,
  },
  guestMediaHeaderTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  guestMediaHeaderTopLeft: { flex: 1, paddingRight: 10 },
  guestMediaHeaderTopRight: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  guestMediaCaptionRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 4 },
  guestMediaCaptionFlex: { flex: 1, marginTop: 0 },
  guestMediaCaptionIndicators: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'flex-end', marginLeft: 10 },
  guestEditedLabel: { fontSize: 12, fontStyle: 'italic', fontWeight: '400', color: '#555' },
  guestEditedLabelDark: { color: '#a7a7b4' },
  guestMediaCaptionDark: {
    color: '#fff',
  },
  guestMediaPlayOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guestMediaPlayOverlayText: {
    color: '#fff',
    fontSize: 42,
    fontWeight: '900',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  mediaFill: { width: '100%', height: '100%' },
  guestMediaFileChip: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e3e3e3',
    maxWidth: 260,
  },
  guestMediaFileChipDark: {
    backgroundColor: '#14141a',
    borderColor: '#2a2a33',
  },
  guestMediaFileText: {
    color: '#111',
    fontWeight: '800',
    fontSize: 13,
  },
  guestMediaFileTextDark: {
    color: '#fff',
  },
  guestExtraMediaRow: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10,
  },
  guestExtraMediaText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#555',
  },
  guestExtraMediaTextDark: {
    color: '#b7b7c2',
  },
  bottomBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e3e3e3',
    backgroundColor: '#f2f2f7',
  },
  bottomBarInner: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
  },
  bottomBarDark: {
    backgroundColor: '#1c1c22',
    borderTopColor: '#2a2a33',
  },
  bottomBarCta: {
    height: 48,
    borderRadius: 12,
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomBarCtaDark: {
    backgroundColor: '#2a2a33',
  },
  bottomBarCtaText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 15,
  },
  bottomBarCtaTextDark: {
    color: '#fff',
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    width: '92%',
    maxWidth: 420,
    maxHeight: '80%',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
  },
  modalCardDark: {
    backgroundColor: '#14141a',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111',
    marginBottom: 10,
  },
  modalTitleDark: { color: '#fff' },
  modalScroll: { maxHeight: 420 },
  modalRowText: { color: '#222', lineHeight: 20, marginBottom: 8 },
  modalRowTextDark: { color: '#d7d7e0' },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12, gap: 8 },
  modalBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#f2f2f7',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e3e3e3',
  },
  modalBtnDark: {
    backgroundColor: '#1c1c22',
    borderColor: '#2a2a33',
  },
  modalBtnText: { color: '#111', fontWeight: '800' },
  modalBtnTextDark: { color: '#fff' },

  viewerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', alignItems: 'center', padding: 12 },
  viewerCard: { width: '96%', maxWidth: 720, height: '78%', backgroundColor: '#111', borderRadius: 14, overflow: 'hidden' },
  viewerTopBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.12)' },
  viewerTitle: { color: '#fff', fontWeight: '700', flex: 1, marginRight: 12 },
  viewerCloseBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.12)' },
  viewerCloseText: { color: '#fff', fontWeight: '800' },
  viewerBody: { flex: 1 },
  viewerImage: { width: '100%', height: '100%', resizeMode: 'contain' },
  viewerVideo: { width: '100%', height: '100%' },
  viewerFallback: { color: '#fff', padding: 14 },
});


