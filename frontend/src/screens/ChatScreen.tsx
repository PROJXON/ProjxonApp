import React from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WS_URL } from '../config/env';
const API_URL = "https://828bp5ailc.execute-api.us-east-2.amazonaws.com"
// const WS_URL = "wss://ws.ifelse.io"
import { useAuthenticator } from '@aws-amplify/ui-react-native';
import Constants from 'expo-constants';
import { fetchUserAttributes } from 'aws-amplify/auth';

type ChatMessage = {
  id: string;
  user?: string;
  text: string;
  createdAt: number;
};

export default function ChatScreen(): React.JSX.Element {
  const { user } = useAuthenticator();
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState<string>('');
  const [isConnecting, setIsConnecting] = React.useState<boolean>(false);
  const [isConnected, setIsConnected] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | null>(null);
  const wsRef = React.useRef<WebSocket | null>(null);
  const [displayName, setDisplayName] = React.useState<string>('anon');
  const hasLoadedHistoryRef = React.useRef<boolean>(false);

  React.useEffect(() => {
    console.log('WS_URL =', WS_URL)
    console.log('expoConfig.extra', Constants.expoConfig?.extra)
    console.log('manifestExtra', (Constants as any).manifestExtra)
    if (!WS_URL) {
      setError('WebSocket URL not configured. Set expo.extra.WS_URL in app.json');
      return;
    }
    setError(null);
    setIsConnecting(true);

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnecting(false);
      setIsConnected(true);
    };
    ws.onmessage = (event) => {
      // Useful for debugging echo services
      // console.log('WS message:', event.data);
      try {
        const payload = JSON.parse(event.data);
        if (payload && payload.text) {
          const msg: ChatMessage = {
            id: payload.id || `${payload.createdAt || Date.now()}`,
            user: payload.user,
            text: String(payload.text),
            createdAt: Number(payload.createdAt || Date.now()),
          };
          setMessages((prev) => [msg, ...prev]);
        }
      } catch {
        const msg: ChatMessage = {
          id: `${Date.now()}`,
          text: String(event.data),
          createdAt: Date.now(),
        };
        setMessages((prev) => [msg, ...prev]);
      }
    };
    ws.onerror = (e: any) => {
      // RN WebSocket doesn't expose much, but log what we can
      // eslint-disable-next-line no-console
      console.log('WS error:', e?.message ?? e);
      setIsConnecting(false);
      setIsConnected(false);
      setError(e?.message ? `WebSocket error: ${e.message}` : 'WebSocket error');
    };
    ws.onclose = (e) => {
      // eslint-disable-next-line no-console
      console.log('WS close:', (e as any)?.code, (e as any)?.reason);
      setIsConnected(false);
    };
    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [user]);

  // Load a display name from Cognito attributes
  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const attrs = await fetchUserAttributes();
        const name =
          (attrs.preferred_username as string | undefined) ||
          (attrs.email as string | undefined) ||
          (user as any)?.username ||
          'anon';
        if (mounted) setDisplayName(name);
      } catch {
        if (mounted) setDisplayName((user as any)?.username || 'anon');
      }
    })();
    return () => {
      mounted = false;
    };
  }, [user]);

  // Fetch recent history from HTTP API (if configured)
  React.useEffect(() => {
    const fetchHistory = async () => {
      if (!API_URL || hasLoadedHistoryRef.current) return;
      try {
        const res = await fetch(`${API_URL.replace(/\/$/, '')}/messages?channelId=global&limit=50`);
        if (!res.ok) return;
        const items = await res.json();
        if (Array.isArray(items)) {
          const normalized = items
            .map((it: any) => ({
              id: String(it.messageId ?? it.createdAt ?? Date.now()),
              user: it.user ?? 'anon',
              text: String(it.text ?? ''),
              createdAt: Number(it.createdAt ?? Date.now()),
            }))
            .filter(m => m.text.length > 0)
            .sort((a, b) => b.createdAt - a.createdAt);
          setMessages(normalized);
          hasLoadedHistoryRef.current = true;
        }
      } catch {
        // ignore fetch errors; WS will still populate
      }
    };
    fetchHistory();
  }, [API_URL, user]);

  const sendMessage = React.useCallback(() => {
    if (!input.trim()) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError('Not connected');
      return;
    }
    const outgoing = {
      action: 'message',
      text: input.trim(),
      channelId: 'global',
      user: displayName,
      createdAt: Date.now(),
    };
    wsRef.current.send(JSON.stringify(outgoing));
    setInput('');
  }, [input, displayName]);

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.select({ ios: 'padding', android: undefined })}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Global Chat</Text>
          {isConnecting ? (
            <View style={styles.statusRow}>
              <ActivityIndicator size="small" />
              <Text style={styles.statusText}>Connecting…</Text>
            </View>
          ) : (
            <Text style={[styles.statusText, isConnected ? styles.ok : styles.err]}>
              {isConnected ? 'Connected' : 'Disconnected'}
            </Text>
          )}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
        <FlatList
          data={messages}
          keyExtractor={(m) => m.id}
          inverted
          renderItem={({ item }) => (
            <View style={styles.message}>
              <Text style={styles.messageUser}>
                {(item.user ?? 'anon')}{' · '}{new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Text>
              <Text style={styles.messageText}>{item.text}</Text>
            </View>
          )}
          contentContainerStyle={styles.listContent}
        />
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="Type a message"
            value={input}
            onChangeText={setInput}
            onSubmitEditing={sendMessage}
            returnKeyType="send"
          />
          <Pressable style={styles.sendBtn} onPress={sendMessage}>
            <Text style={styles.sendTxt}>Send..</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e3e3e3',
    backgroundColor: '#fafafa',
  },
  title: { fontSize: 20, fontWeight: '600', color: '#222' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  statusText: { fontSize: 12, color: '#666', marginTop: 6 },
  ok: { color: '#2e7d32' },
  err: { color: '#d32f2f' },
  error: { color: '#d32f2f', marginTop: 6 },
  listContent: { padding: 12 },
  message: {
    marginBottom: 8,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#f1f1f1',
  },
  messageUser: { fontSize: 12, color: '#555' },
  messageText: { fontSize: 16, color: '#222', marginTop: 2 },
  inputRow: {
    flexDirection: 'row',
    padding: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e3e3e3',
    backgroundColor: '#fff',
  },
  input: {
    flex: 1,
    height: 44,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  sendBtn: {
    marginLeft: 8,
    height: 44,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#1976d2',
  },
  sendTxt: { color: '#fff', fontWeight: '600' },
});


