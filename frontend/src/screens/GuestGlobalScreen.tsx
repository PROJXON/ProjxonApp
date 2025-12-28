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
import { SafeAreaView } from 'react-native-safe-area-context';
import { API_URL } from '../config/env';
import { getUrl } from 'aws-amplify/storage';

type GuestMessage = {
  id: string;
  user: string;
  text: string;
  createdAt: number;
  editedAt?: number;
  reactions?: Record<string, { count: number; userSubs: string[] }>;
  reactionUsers?: Record<string, string>;
  media?: {
    path: string;
    thumbPath?: string;
    kind: 'image' | 'video' | 'file';
    contentType?: string;
    thumbContentType?: string;
    fileName?: string;
    size?: number;
  };
};

type ChatEnvelope = {
  type: 'chat';
  text?: string;
  media?: GuestMessage['media'];
};

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

function tryParseChatEnvelope(rawText: string): { text: string; media?: GuestMessage['media'] } | null {
  const t = (rawText || '').trim();
  if (!t || !t.startsWith('{') || !t.endsWith('}')) return null;
  try {
    const obj = JSON.parse(t) as any;
    if (!obj || typeof obj !== 'object') return null;
    if (obj.type !== 'chat') return null;
    const env = obj as ChatEnvelope;
    const text = typeof env.text === 'string' ? env.text : '';
    const media = env.media && typeof env.media === 'object' ? (env.media as GuestMessage['media']) : undefined;
    if (!text && !media) return null;
    return { text, media };
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
    const deletedAt = typeof it?.deletedAt === 'number' ? it.deletedAt : undefined;
    if (deletedAt) continue;
    const rawText = typeof it?.text === 'string' ? it.text : '';
    const parsed = tryParseChatEnvelope(rawText);
    const text = parsed ? parsed.text : rawText;
    const media = parsed?.media;
    if (!text.trim() && !media) continue;
    out.push({
      id: messageId,
      user,
      text,
      createdAt,
      editedAt: typeof (it as any)?.editedAt === 'number' ? (it as any).editedAt : undefined,
      reactions: normalizeGuestReactions((it as any)?.reactions),
      reactionUsers:
        (it as any)?.reactionUsers && typeof (it as any).reactionUsers === 'object'
          ? Object.fromEntries(Object.entries((it as any).reactionUsers).map(([k, v]) => [String(k), String(v)]))
          : undefined,
      media,
    });
  }

  // Ensure newest-first for inverted list behavior.
  out.sort((a, b) => b.createdAt - a.createdAt);

  // Deduplicate by id (in case of overlapping history windows)
  const seen = new Set<string>();
  return out.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
}

async function fetchGuestGlobalHistory(): Promise<GuestMessage[]> {
  if (!API_URL) throw new Error('API_URL is not configured');
  const base = API_URL.replace(/\/$/, '');
  const qs = `conversationId=${encodeURIComponent('global')}&limit=50`;
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
      if (!Array.isArray(json)) {
        errors.push(`GET ${url} returned non-array JSON`);
        continue;
      }
      return normalizeGuestMessages(json);
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
  const [theme, setTheme] = React.useState<'light' | 'dark'>('light');
  const isDark = theme === 'dark';

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

  const [messages, setMessages] = React.useState<GuestMessage[]>([]);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [refreshing, setRefreshing] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | null>(null);
  const [urlByPath, setUrlByPath] = React.useState<Record<string, string>>({});
  const [reactionInfoOpen, setReactionInfoOpen] = React.useState<boolean>(false);
  const [reactionInfoEmoji, setReactionInfoEmoji] = React.useState<string>('');
  const [reactionInfoSubs, setReactionInfoSubs] = React.useState<string[]>([]);
  const [reactionInfoNamesBySub, setReactionInfoNamesBySub] = React.useState<Record<string, string>>({});

  const resolvePathUrl = React.useCallback(
    async (path: string): Promise<string | null> => {
      if (!path) return null;
      const cached = urlByPath[path];
      if (cached) return cached;
      try {
        const { url } = await getUrl({ path });
        const s = url.toString();
        setUrlByPath((prev) => (prev[path] ? prev : { ...prev, [path]: s }));
        return s;
      } catch {
        return null;
      }
    },
    [urlByPath]
  );

  const openReactionInfo = React.useCallback(
    (emoji: string, subs: string[], namesBySub?: Record<string, string>) => {
    setReactionInfoEmoji(String(emoji || ''));
    setReactionInfoSubs(Array.isArray(subs) ? subs.map(String).filter(Boolean) : []);
    setReactionInfoNamesBySub(namesBySub && typeof namesBySub === 'object' ? namesBySub : {});
    setReactionInfoOpen(true);
  }, []);

  const fetchNow = React.useCallback(async (opts?: { isManual?: boolean }) => {
    const isManual = !!opts?.isManual;
    if (isManual) setRefreshing(true);
    else setLoading((prev) => prev || messages.length === 0);

    try {
      setError(null);
      const next = await fetchGuestGlobalHistory();
      setMessages(next);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load messages';
      setError(msg);
    } finally {
      setLoading(false);
      if (isManual) setRefreshing(false);
    }
  }, [messages.length]);

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
        fetchNow().catch(() => {});
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
  }, [fetchNow]);

  return (
    <SafeAreaView style={[styles.container, isDark && styles.containerDark]} edges={['top', 'bottom']}>
      <View style={styles.headerRow}>
        <Text style={[styles.headerTitle, isDark && styles.headerTitleDark]}>Global</Text>
        <View style={styles.headerRight}>
          <View style={[styles.themeToggle, isDark && styles.themeToggleDark]}>
            <Text style={[styles.themeToggleText, isDark && styles.themeToggleTextDark]}>
              {isDark ? 'Dark' : 'Light'}
            </Text>
            <Switch
              value={isDark}
              onValueChange={(v) => setTheme(v ? 'dark' : 'light')}
              trackColor={{ false: '#d1d1d6', true: '#d1d1d6' }}
              thumbColor={isDark ? '#2a2a33' : '#ffffff'}
            />
          </View>
          <Pressable
            onPress={onSignIn}
            style={({ pressed }) => [
              styles.signInPill,
              isDark && styles.signInPillDark,
              pressed && { opacity: 0.85 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Sign in"
          >
            <Text style={[styles.signInPillText, isDark && styles.signInPillTextDark]}>
              Sign in
            </Text>
          </Pressable>
        </View>
      </View>

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
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => fetchNow({ isManual: true })}
            tintColor={isDark ? '#ffffff' : '#111'}
          />
        }
        renderItem={({ item }) => (
          <GuestMessageRow
            item={item}
            isDark={isDark}
            resolvePathUrl={resolvePathUrl}
            onOpenReactionInfo={openReactionInfo}
          />
        )}
      />

      {/* Bottom bar CTA (like the chat input row), so messages never render behind it */}
      <View style={[styles.bottomBar, isDark && styles.bottomBarDark]}>
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
    </SafeAreaView>
  );
}

function GuestMessageRow({
  item,
  isDark,
  resolvePathUrl,
  onOpenReactionInfo,
}: {
  item: GuestMessage;
  isDark: boolean;
  resolvePathUrl: (path: string) => Promise<string | null>;
  onOpenReactionInfo: (emoji: string, subs: string[], namesBySub?: Record<string, string>) => void;
}) {
  const { width: windowWidth } = useWindowDimensions();
  const [thumbUrl, setThumbUrl] = React.useState<string | null>(null);
  const [usedFullUrl, setUsedFullUrl] = React.useState<boolean>(false);
  const [thumbAspect, setThumbAspect] = React.useState<number | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const preferredPath = item.media?.thumbPath || item.media?.path;
      if (!preferredPath) return;
      const u = await resolvePathUrl(preferredPath);
      if (!cancelled) setThumbUrl(u);
    })();
    return () => {
      cancelled = true;
    };
  }, [item.media?.path, item.media?.thumbPath, resolvePathUrl]);

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

  const openMedia = React.useCallback(async () => {
    const p = item.media?.path;
    if (!p) return;
    const u = await resolvePathUrl(p);
    if (u) await Linking.openURL(u);
  }, [item.media?.path, resolvePathUrl]);

  const hasMedia = !!item.media?.path;
  const ts = formatGuestTimestamp(item.createdAt);
  const metaLine = `${item.user}${ts ? ` · ${ts}` : ''}`;
  const isEdited = typeof item.editedAt === 'number' && Number.isFinite(item.editedAt);
  const captionHasText = !!item.text && item.text.trim().length > 0;

  const onThumbError = React.useCallback(async () => {
    // Common cases:
    // - thumb object doesn't exist
    // - S3 returns 403 because guest read policy isn't deployed yet
    // Try the full object as a fallback (especially useful if only the thumb is missing).
    if (usedFullUrl) return;
    const fullPath = item.media?.path;
    if (!fullPath) return;
    const u = await resolvePathUrl(fullPath);
    if (u) {
      setUsedFullUrl(true);
      setThumbUrl(u);
      return;
    }
    // If we couldn't resolve anything, drop the preview so we fall back to a file chip.
    setThumbUrl(null);
  }, [item.media?.path, resolvePathUrl, usedFullUrl]);

  // Match ChatScreen-ish thumbnail sizing: capped max size, preserve aspect ratio, no crop.
  const CHAT_MEDIA_MAX_HEIGHT = 240;
  const CHAT_MEDIA_MAX_WIDTH_FRACTION = 0.86;
  const maxW = Math.max(220, Math.floor(windowWidth * CHAT_MEDIA_MAX_WIDTH_FRACTION));
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
      {hasMedia ? (
        <View style={{ alignSelf: 'flex-start' }}>
          <View
            style={[
              styles.guestMediaCard,
              isDark ? styles.guestMediaCardDark : null,
              { width: capped.w },
            ]}
          >
            <View style={[styles.guestMediaHeader, isDark ? styles.guestMediaHeaderDark : null]}>
              <View style={styles.guestMediaHeaderTopRow}>
                <Text style={[styles.guestMetaLine, isDark ? styles.guestMetaLineDark : null]}>{metaLine}</Text>
                {isEdited && !captionHasText ? (
                  <Text style={[styles.guestEditedLabel, isDark ? styles.guestEditedLabelDark : null]}>Edited</Text>
                ) : null}
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
              onPress={() => void openMedia()}
              style={({ pressed }) => [{ opacity: pressed ? 0.92 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel="Open media"
            >
              {item.media?.kind === 'image' && thumbUrl ? (
                <Image
                  source={{ uri: thumbUrl }}
                  style={{ width: capped.w, height: capped.h }}
                  resizeMode="contain"
                  onError={() => void onThumbError()}
                />
              ) : item.media?.kind === 'video' && thumbUrl ? (
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
                    {item.media?.fileName ? item.media.fileName : item.media?.kind === 'video' ? 'Video' : 'File'}
                  </Text>
                </View>
              )}
            </Pressable>
          </View>

          {item.reactions ? (
            <View style={styles.guestReactionRow}>
              {Object.entries(item.reactions)
                .sort((a, b) => (b[1]?.count ?? 0) - (a[1]?.count ?? 0))
                .slice(0, 3)
                .map(([emoji, info], idx) => (
                  <Pressable
                    key={`${item.id}:${emoji}`}
                    onPress={() =>
                      onOpenReactionInfo(
                        String(emoji),
                        (info?.userSubs || []).map(String),
                        item.reactionUsers
                      )
                    }
                    style={[
                      styles.guestReactionChip,
                      isDark && styles.guestReactionChipDark,
                      idx ? styles.guestReactionChipStacked : null,
                    ]}
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
        <View style={[styles.bubble, isDark && styles.bubbleDark]}>
          <Text style={[styles.guestMetaLine, isDark ? styles.guestMetaLineDark : null]}>{metaLine}</Text>
          {item.text?.trim() ? (
            <View style={styles.guestTextRow}>
              <Text style={[styles.msgText, isDark && styles.msgTextDark, styles.guestTextFlex]}>{item.text}</Text>
              {isEdited ? (
                <Text style={[styles.guestEditedInline, isDark ? styles.guestEditedLabelDark : null]}> Edited</Text>
              ) : null}
            </View>
          ) : null}

          {item.reactions ? (
            <View style={styles.guestReactionRow}>
              {Object.entries(item.reactions)
                .sort((a, b) => (b[1]?.count ?? 0) - (a[1]?.count ?? 0))
                .slice(0, 3)
                .map(([emoji, info], idx) => (
                  <Pressable
                    key={`${item.id}:${emoji}`}
                    onPress={() =>
                      onOpenReactionInfo(
                        String(emoji),
                        (info?.userSubs || []).map(String),
                        item.reactionUsers
                      )
                    }
                    style={[
                      styles.guestReactionChip,
                      isDark && styles.guestReactionChipDark,
                      idx ? styles.guestReactionChipStacked : null,
                    ]}
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
  themeToggleText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111',
  },
  themeToggleTextDark: {
    color: '#fff',
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
    paddingHorizontal: 12,
    // Inverted list: include symmetric padding so the newest message doesn't hug the bottom bar.
    paddingTop: 12,
    paddingBottom: 12,
  },
  msgRow: {
    paddingVertical: 4,
    alignItems: 'flex-start',
  },
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
  guestReactionRow: {
    flexDirection: 'row',
    marginTop: 8,
  },
  guestReactionChip: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e3e3e3',
    marginRight: -10,
  },
  guestReactionChipStacked: {},
  guestReactionChipDark: {
    backgroundColor: '#14141a',
    borderColor: '#2a2a33',
  },
  guestReactionText: { color: '#111', fontWeight: '800', fontSize: 12 },
  guestReactionTextDark: { color: '#fff' },
  guestTextRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  guestTextFlex: { flex: 1 },
  guestEditedInline: { marginLeft: 6, fontSize: 12, fontStyle: 'italic', fontWeight: '400', color: '#555' },
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
  bottomBar: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e3e3e3',
    backgroundColor: '#f2f2f7',
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
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 },
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
});


