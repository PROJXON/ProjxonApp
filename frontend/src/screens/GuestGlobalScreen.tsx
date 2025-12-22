import React from 'react';
import {
  ActivityIndicator,
  AppState,
  AppStateStatus,
  FlatList,
  RefreshControl,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../config/env';

type GuestMessage = {
  id: string;
  user: string;
  text: string;
  createdAt: number;
};

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
    const text = typeof it?.text === 'string' ? it.text : '';
    if (!text.trim()) continue;
    out.push({ id: messageId, user, text, createdAt });
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
    <View style={[styles.container, isDark && styles.containerDark]}>
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
          <View style={[styles.msgRow]}>
            <View style={[styles.bubble, isDark && styles.bubbleDark]}>
              <Text style={[styles.userText, isDark && styles.userTextDark]}>{item.user}</Text>
              <Text style={[styles.msgText, isDark && styles.msgTextDark]}>{item.text}</Text>
            </View>
          </View>
        )}
      />

      <Pressable
        onPress={onSignIn}
        style={({ pressed }) => [
          styles.bottomCta,
          isDark && styles.bottomCtaDark,
          pressed && { opacity: 0.9 },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Sign in to post"
      >
        <Text style={[styles.bottomCtaText, isDark && styles.bottomCtaTextDark]}>
          Sign in to post
        </Text>
      </Pressable>
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
    paddingBottom: 80,
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
  userText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#444',
    marginBottom: 4,
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
  bottomCta: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomCtaDark: {
    backgroundColor: '#2a2a33',
  },
  bottomCtaText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 15,
  },
  bottomCtaTextDark: {
    color: '#fff',
  },
});


