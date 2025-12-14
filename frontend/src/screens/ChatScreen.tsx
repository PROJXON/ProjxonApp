import React from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WS_URL, API_URL } from '../config/env';
// const API_URL = "https://828bp5ailc.execute-api.us-east-2.amazonaws.com"
// const WS_URL = "wss://ws.ifelse.io"
import { useAuthenticator } from '@aws-amplify/ui-react-native';
import Constants from 'expo-constants';
import { fetchAuthSession } from '@aws-amplify/auth';
import { fetchUserAttributes } from 'aws-amplify/auth';
import { decryptChatMessageV1, encryptChatMessageV1, EncryptedChatPayloadV1, derivePublicKey, loadKeyPair } from '../../utils/crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';

type ChatScreenProps = {
  conversationId?: string | null;
  peer?: string | null;
  displayName: string;
};

type ChatMessage = {
  id: string;
  user?: string;
  text: string;
  rawText?: string;
  encrypted?: EncryptedChatPayloadV1;
  decryptedText?: string;
  decryptFailed?: boolean;
  expiresAt?: number; // epoch seconds
  ttlSeconds?: number; // duration, seconds (TTL-from-read)
  createdAt: number;
};

export default function ChatScreen({ conversationId, peer, displayName }: ChatScreenProps): React.JSX.Element {
  const { user } = useAuthenticator();
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState<string>('');
  const [isConnecting, setIsConnecting] = React.useState<boolean>(false);
  const [isConnected, setIsConnected] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | null>(null);
  const wsRef = React.useRef<WebSocket | null>(null);
  const [myUserId, setMyUserId] = React.useState<string | null>(null);
  const [myPrivateKey, setMyPrivateKey] = React.useState<string | null>(null);
  const [myPublicKey, setMyPublicKey] = React.useState<string | null>(null);
  const [peerPublicKey, setPeerPublicKey] = React.useState<string | null>(null);
  const [autoDecrypt, setAutoDecrypt] = React.useState<boolean>(false);
  const [cipherOpen, setCipherOpen] = React.useState(false);
  const [cipherText, setCipherText] = React.useState<string>('');
  // Per-message "Seen" state for outgoing messages (keyed by message createdAt ms)
  const [peerSeenAtByCreatedAt, setPeerSeenAtByCreatedAt] = React.useState<Record<string, number>>(
    {}
  ); // createdAt(ms) -> readAt(sec)
  const [mySeenAtByCreatedAt, setMySeenAtByCreatedAt] = React.useState<Record<string, number>>({});
  const pendingReadCreatedAtRef = React.useRef<number>(0);
  const [nowSec, setNowSec] = React.useState<number>(() => Math.floor(Date.now() / 1000));
  const TTL_OPTIONS = React.useMemo(
    () => [
      { label: 'Off', seconds: 0 },
      { label: '5 min', seconds: 5 * 60 },
      { label: '30 min', seconds: 30 * 60 },
      { label: '1 hour', seconds: 60 * 60 },
      { label: '6 hours', seconds: 6 * 60 * 60 },
      { label: '1 day', seconds: 24 * 60 * 60 },
      { label: '1 week', seconds: 7 * 24 * 60 * 60 },
      { label: '30 days', seconds: 30 * 24 * 60 * 60 },
    ],
    []
  );
  const [ttlIdx, setTtlIdx] = React.useState<number>(0);
  const [ttlPickerOpen, setTtlPickerOpen] = React.useState(false);
  const [summaryOpen, setSummaryOpen] = React.useState(false);
  const [summaryText, setSummaryText] = React.useState<string>('');
  const [summaryLoading, setSummaryLoading] = React.useState(false);
  const activeConversationId = React.useMemo(
    () => (conversationId && conversationId.length > 0 ? conversationId : 'global'),
    [conversationId]
  );
  const isDm = React.useMemo(() => activeConversationId !== 'global', [activeConversationId]);

  // Reset per-conversation read bookkeeping
  React.useEffect(() => {
    pendingReadCreatedAtRef.current = 0;
    setPeerSeenAtByCreatedAt({});
  }, [activeConversationId]);

  // Fetch persisted read state so "Seen" works even if sender was offline when peer decrypted.
  React.useEffect(() => {
    (async () => {
      if (!API_URL || !isDm) {
        setPeerSeenAtByCreatedAt({});
        return;
      }
      try {
        const { tokens } = await fetchAuthSession();
        const idToken = tokens?.idToken?.toString();
        if (!idToken) return;
        const res = await fetch(
          `${API_URL.replace(/\/$/, '')}/reads?conversationId=${encodeURIComponent(activeConversationId)}`,
          { headers: { Authorization: `Bearer ${idToken}` } }
        );
        if (!res.ok) return;
        const data = await res.json();
        // Expected shape (new): { reads: [{ user: string, messageCreatedAt: number, readAt: number }] }
        // Backward compat: accept { readUpTo } as a messageCreatedAt.
        const reads = Array.isArray(data.reads) ? data.reads : [];
        const map: Record<string, number> = {};
        for (const r of reads) {
          if (!r || typeof r.user !== 'string' || r.user === displayName) continue;
          const mc = Number(r.messageCreatedAt ?? r.readUpTo);
          const ra = Number(r.readAt);
          if (!Number.isFinite(mc) || !Number.isFinite(ra)) continue;
          const key = String(mc);
          map[key] = Math.max(map[key] ?? 0, ra);
        }
        setPeerSeenAtByCreatedAt(map);
      } catch {
        // ignore
      }
    })();
  }, [API_URL, isDm, activeConversationId, displayName]);

  React.useEffect(() => {
    setMySeenAtByCreatedAt({});
  }, [activeConversationId]);

  React.useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(`chat:seen:${activeConversationId}`);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          setMySeenAtByCreatedAt(parsed);
        }
      } catch {
        // ignore
      }
    })();
  }, [activeConversationId]);

  React.useEffect(() => {
    (async () => {
      try {
        await AsyncStorage.setItem(
          `chat:seen:${activeConversationId}`,
          JSON.stringify(mySeenAtByCreatedAt)
        );
      } catch {
        // ignore
      }
    })();
  }, [activeConversationId, mySeenAtByCreatedAt]);

  // Persist autoDecrypt per-conversation so users don't need to keep re-enabling it after relogin.
  React.useEffect(() => {
    (async () => {
      try {
        const key = `chat:autoDecrypt:${activeConversationId}`;
        const v = await AsyncStorage.getItem(key);
        if (v === '1') setAutoDecrypt(true);
        if (v === '0') setAutoDecrypt(false);
      } catch {
        // ignore
      }
    })();
  }, [activeConversationId]);

  React.useEffect(() => {
    (async () => {
      try {
        const key = `chat:autoDecrypt:${activeConversationId}`;
        await AsyncStorage.setItem(key, autoDecrypt ? '1' : '0');
      } catch {
        // ignore
      }
    })();
  }, [activeConversationId, autoDecrypt]);

  // ttlIdx is UI state for the disappearing-message setting.

  // ticking clock for TTL countdown labels (DM only):
  // - update every minute normally
  // - switch to every second when any message is within the last minute
  React.useEffect(() => {
    if (!isDm) return;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const tick = () => {
      if (cancelled) return;
      const nextNowSec = Math.floor(Date.now() / 1000);
      setNowSec(nextNowSec);

      let minRemaining: number | null = null;
      for (const m of messages) {
        if (!m.expiresAt) continue;
        const remaining = m.expiresAt - nextNowSec;
        if (remaining <= 0) continue;
        minRemaining = minRemaining == null ? remaining : Math.min(minRemaining, remaining);
      }

      const delayMs = minRemaining != null && minRemaining <= 60 ? 1_000 : 60_000;
      timeoutId = setTimeout(tick, delayMs);
    };

    tick();
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [isDm, messages]);

  const formatRemaining = React.useCallback((seconds: number): string => {
    if (seconds <= 0) return '0s';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (d > 0) return `${d}d${h > 0 ? ` ${h}h` : ''}`;
    if (h > 0) return `${h}h${m > 0 ? ` ${m}m` : ''}`;
    if (m > 0) return `${m}m`;
    return `${s}s`;
  }, []);

  const parseEncrypted = React.useCallback((text: string): EncryptedChatPayloadV1 | null => {
    try {
      const obj = JSON.parse(text);
      if (
        obj &&
        obj.v === 1 &&
        obj.alg === 'secp256k1-ecdh+aes-256-gcm' &&
        typeof obj.iv === 'string' &&
        typeof obj.ciphertext === 'string' &&
        typeof obj.senderPublicKey === 'string'
      ) {
        return obj as EncryptedChatPayloadV1;
      }
      return null;
    } catch {
      return null;
    }
  }, []);

  const decryptForDisplay = React.useCallback(
    (msg: ChatMessage): string => {
      if (!msg.encrypted) throw new Error('Not encrypted');
      if (!myPrivateKey) throw new Error('Missing your private key on this device.');

      const isFromMe = !!myPublicKey && msg.encrypted.senderPublicKey === myPublicKey;
      const primaryTheirPub = isFromMe
        ? (peerPublicKey ?? msg.encrypted.senderPublicKey)
        : msg.encrypted.senderPublicKey;

      try {
        return decryptChatMessageV1(msg.encrypted, myPrivateKey, primaryTheirPub);
      } catch (e) {
        if (peerPublicKey && peerPublicKey !== primaryTheirPub) {
          return decryptChatMessageV1(msg.encrypted, myPrivateKey, peerPublicKey);
        }
        throw e;
      }
    },
    [myPrivateKey, myPublicKey, peerPublicKey]
  );

  const markMySeen = React.useCallback((messageCreatedAt: number, readAt: number) => {
    setMySeenAtByCreatedAt((prev) => ({
      ...prev,
      [String(messageCreatedAt)]: Math.max(prev[String(messageCreatedAt)] ?? 0, readAt),
    }));
  }, []);

  const sendReadReceipt = React.useCallback(
    (messageCreatedAt: number) => {
      if (!isDm) return;
      // If WS isn't ready yet (common right after login), queue and flush on connect.
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        pendingReadCreatedAtRef.current = Math.max(pendingReadCreatedAtRef.current, messageCreatedAt);
        return;
      }
      wsRef.current.send(
        JSON.stringify({
          action: 'read',
          conversationId: activeConversationId,
          user: displayName,
          // New: per-message read receipt
          messageCreatedAt,
          // Backward compat: older backend treats readUpTo as a single value
          readUpTo: messageCreatedAt,
          readAt: Math.floor(Date.now() / 1000),
          createdAt: Date.now(),
        })
      );
    },
    [isDm, activeConversationId, displayName]
  );

  const flushPendingRead = React.useCallback(() => {
    if (!isDm) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    const pending = pendingReadCreatedAtRef.current;
    if (!pending) return;
    pendingReadCreatedAtRef.current = 0;
    sendReadReceipt(pending);
  }, [isDm, sendReadReceipt]);

  const refreshMyKeys = React.useCallback(async (sub: string) => {
    const kp = await loadKeyPair(sub);
    setMyPrivateKey(kp?.privateKey ?? null);
    setMyPublicKey(kp?.privateKey ? derivePublicKey(kp.privateKey) : null);
  }, []);

  React.useEffect(() => {
    (async () => {
      try {
        const attrs = await fetchUserAttributes();
        const sub = attrs.sub as string | undefined;
        if (sub) {
          setMyUserId(sub);
          await refreshMyKeys(sub);
        }
      } catch {
        // ignore
      }
    })();
  }, [user]);

  // If ChatScreen mounts before App.tsx finishes generating/storing keys, retry a few times.
  React.useEffect(() => {
    if (!myUserId || myPrivateKey) return;
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 20; // ~10s
    const tick = async () => {
      if (cancelled) return;
      attempts += 1;
      try {
        const kp = await loadKeyPair(myUserId);
        if (kp?.privateKey) {
          setMyPrivateKey(kp.privateKey);
          setMyPublicKey(derivePublicKey(kp.privateKey));
          return;
        }
      } catch {
        // ignore
      }
      if (!cancelled && !myPrivateKey && attempts < maxAttempts) {
        setTimeout(tick, 500);
      }
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, [myUserId, myPrivateKey]);

  // Auto-decrypt pass: whenever enabled and keys are ready, decrypt any encrypted messages once.
  React.useEffect(() => {
    if (!autoDecrypt || !myPrivateKey) return;
    const needsDecrypt = messages.some(
      (m) => m.encrypted && !m.decryptedText && !m.decryptFailed
    );
    if (!needsDecrypt) return;

    let maxReadUpTo = 0;
    const readAt = Math.floor(Date.now() / 1000);
    let changed = false;

    const nextMessages = messages.map((m) => {
      if (!m.encrypted || m.decryptedText || m.decryptFailed) return m;
      const isFromMe = !!myPublicKey && m.encrypted.senderPublicKey === myPublicKey;
      if (isFromMe && !peerPublicKey) return m; // wait for peer key
      try {
        const plaintext = decryptForDisplay(m);
        changed = true;
        if (!isFromMe) {
          maxReadUpTo = Math.max(maxReadUpTo, m.createdAt);
          const expiresAt =
            m.ttlSeconds && m.ttlSeconds > 0 ? readAt + m.ttlSeconds : m.expiresAt;
          markMySeen(m.createdAt, readAt);
          return { ...m, decryptedText: plaintext, text: plaintext, expiresAt };
        }
        markMySeen(m.createdAt, readAt);
        return { ...m, decryptedText: plaintext, text: plaintext };
      } catch {
        changed = true;
        return { ...m, decryptFailed: true };
      }
    });

    if (changed) {
      setMessages(nextMessages);
      if (maxReadUpTo) sendReadReceipt(maxReadUpTo);
    }
  }, [
    autoDecrypt,
    myPrivateKey,
    decryptForDisplay,
    myPublicKey,
    sendReadReceipt,
    markMySeen,
    messages,
    peerPublicKey,
  ]);

  React.useEffect(() => {
    (async () => {
      if (!peer || !API_URL || !isDm) {
        setPeerPublicKey(null);
        return;
      }
      // Clear any previously cached key so we don't encrypt to the wrong recipient if peer changes.
      setPeerPublicKey(null);
      try {
        const { tokens } = await fetchAuthSession();
        const idToken = tokens?.idToken?.toString();
        if (!idToken) return;
        const controller = new AbortController();
        const currentPeer = peer;
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        const cleanup = () => clearTimeout(timeoutId);
        const res = await fetch(
          `${API_URL.replace(/\/$/, '')}/users?username=${encodeURIComponent(peer)}`,
          { headers: { Authorization: `Bearer ${idToken}` }, signal: controller.signal }
        );
        cleanup();
        if (!res.ok) {
          setPeerPublicKey(null);
          return;
        }
        const data = await res.json();
        const pk =
          (data.public_key as string | undefined) ||
          (data.publicKey as string | undefined) ||
          (data['custom:public_key'] as string | undefined) ||
          (data.custom_public_key as string | undefined);
        // Only apply if peer hasn't changed mid-request
        if (currentPeer === peer) {
          setPeerPublicKey(typeof pk === 'string' && pk.length > 0 ? pk : null);
        }
      } catch {
        setPeerPublicKey(null);
      }
    })();
  }, [peer, isDm, API_URL, activeConversationId]);

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
      flushPendingRead();
    };
    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        // Read receipt events (broadcast by backend)
        if (payload && payload.type === 'read' && payload.conversationId === activeConversationId) {
          if (payload.user && payload.user !== displayName) {
            const readAt =
              typeof payload.readAt === 'number' ? payload.readAt : Math.floor(Date.now() / 1000);
            // New: per-message receipt (messageCreatedAt). Backward compat: treat readUpTo as a messageCreatedAt.
            const messageCreatedAt =
              typeof payload.messageCreatedAt === 'number'
                ? payload.messageCreatedAt
                : (typeof payload.readUpTo === 'number' ? payload.readUpTo : undefined);

            if (typeof messageCreatedAt === 'number') {
              setPeerSeenAtByCreatedAt((prev) => ({
                ...prev,
                [String(messageCreatedAt)]: Math.max(prev[String(messageCreatedAt)] ?? 0, readAt),
              }));

              // TTL-from-read for outgoing messages: start countdown for that specific message (if it has ttlSeconds).
              setMessages((prev) =>
                prev.map((m) => {
                  const isEncryptedOutgoing =
                    !!m.encrypted && !!myPublicKey && m.encrypted.senderPublicKey === myPublicKey;
                  const isPlainOutgoing = !m.encrypted && (m.user ?? 'anon') === displayName;
                  const isOutgoing = isEncryptedOutgoing || isPlainOutgoing;
                  if (!isOutgoing) return m;
                  if (m.createdAt !== messageCreatedAt) return m;
                  if (m.expiresAt) return m;
                  if (!m.ttlSeconds || m.ttlSeconds <= 0) return m;
                  return { ...m, expiresAt: readAt + m.ttlSeconds };
                })
              );
            }
          }
          return;
        }
        if (payload && payload.text) {
          const rawText = String(payload.text);
          const encrypted = parseEncrypted(rawText);
          const createdAt = Number(payload.createdAt || Date.now());
          const stableId =
            (payload.messageId && String(payload.messageId)) ||
            (payload.id && String(payload.id)) ||
            `${createdAt}-${Math.random().toString(36).slice(2)}`;
          const msg: ChatMessage = {
            id: stableId,
            user: payload.user,
            rawText,
            encrypted: encrypted ?? undefined,
            text: encrypted ? 'Encrypted message (tap to decrypt; long-press to view ciphertext)' : rawText,
            createdAt,
            expiresAt: typeof payload.expiresAt === 'number' ? payload.expiresAt : undefined,
            ttlSeconds: typeof payload.ttlSeconds === 'number' ? payload.ttlSeconds : undefined,
          };
          setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [msg, ...prev]));
        }
      } catch {
        const msg: ChatMessage = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          text: String(event.data),
          createdAt: Date.now(),
        };
        setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [msg, ...prev]));
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
  }, [user, flushPendingRead]);

  // Fetch recent history from HTTP API (if configured)
  React.useEffect(() => {
    const fetchHistory = async () => {
      if (!API_URL) return;
      setMessages([]);
      try {
        const res = await fetch(
          `${API_URL.replace(/\/$/, '')}/messages?conversationId=${encodeURIComponent(
            activeConversationId
          )}&limit=50`
        );
        if (!res.ok) return;
        const items = await res.json();
        if (Array.isArray(items)) {
          const normalized = items
            .map((it: any) => ({
              id: String(it.messageId ?? `${it.createdAt ?? Date.now()}-${Math.random().toString(36).slice(2)}`),
              user: it.user ?? 'anon',
              rawText: String(it.text ?? ''),
              encrypted: parseEncrypted(String(it.text ?? '')) ?? undefined,
              text: parseEncrypted(String(it.text ?? ''))
                ? 'Encrypted message (tap to decrypt; long-press to view ciphertext)'
                : String(it.text ?? ''),
              createdAt: Number(it.createdAt ?? Date.now()),
              expiresAt: typeof it.expiresAt === 'number' ? it.expiresAt : undefined,
              ttlSeconds: typeof it.ttlSeconds === 'number' ? it.ttlSeconds : undefined,
            }))
            .filter(m => m.text.length > 0)
            .sort((a, b) => b.createdAt - a.createdAt);
          // Deduplicate by id (history may overlap with WS delivery)
          const seen = new Set<string>();
          const deduped = normalized.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
          setMessages(deduped);
        }
      } catch {
        // ignore fetch errors; WS will still populate
      }
    };
    fetchHistory();
  }, [API_URL, activeConversationId]);

  // Client-side hiding of expired DM messages (server-side TTL still required for real deletion).
  React.useEffect(() => {
    if (!isDm) return;
    const interval = setInterval(() => {
      const nowSec = Math.floor(Date.now() / 1000);
      setMessages((prev) => prev.filter((m) => !(m.expiresAt && m.expiresAt <= nowSec)));
    }, 10_000);
    return () => clearInterval(interval);
  }, [isDm]);

  const sendMessage = React.useCallback(() => {
    if (!input.trim()) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError('Not connected');
      return;
    }
    let outgoingText = input.trim();
    if (isDm) {
      if (!myPrivateKey) {
        Alert.alert('Encryption not ready', 'Missing your private key on this device.');
        return;
      }
      if (!peerPublicKey) {
        Alert.alert('Encryption not ready', "Can't find the recipient's public key.");
        return;
      }
      const enc = encryptChatMessageV1(outgoingText, myPrivateKey, peerPublicKey);
      outgoingText = JSON.stringify(enc);
    }
    const outgoing = {
      action: 'message',
      text: outgoingText,
      conversationId: activeConversationId,
      user: displayName,
      createdAt: Date.now(),
      // TTL-from-read: we send a duration, and the countdown starts when the recipient decrypts.
      ttlSeconds: isDm && TTL_OPTIONS[ttlIdx]?.seconds ? TTL_OPTIONS[ttlIdx].seconds : undefined,
    };
    wsRef.current.send(JSON.stringify(outgoing));
    setInput('');
  }, [input, displayName, activeConversationId, isDm, myPrivateKey, peerPublicKey, ttlIdx, TTL_OPTIONS]);

  const onPressMessage = React.useCallback(
    (msg: ChatMessage) => {
      if (!msg.encrypted) return;
      try {
        const readAt = Math.floor(Date.now() / 1000);
        const plaintext = decryptForDisplay(msg);
        const isFromMe = !!myPublicKey && msg.encrypted?.senderPublicKey === myPublicKey;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msg.id
              ? {
                  ...m,
                  decryptedText: plaintext,
                  text: plaintext,
                  expiresAt:
                    // TTL-from-read:
                    // - Incoming messages: start countdown at decrypt time.
                    // - Outgoing messages: do NOT start countdown when you decrypt your own message;
                    //   only start when the peer decrypts (via read receipt).
                    !isFromMe && m.ttlSeconds && m.ttlSeconds > 0
                      ? (m.expiresAt ?? readAt + m.ttlSeconds)
                      : m.expiresAt,
                }
              : m
          )
        );
        if (!isFromMe) sendReadReceipt(msg.createdAt);
      if (!isFromMe) markMySeen(msg.createdAt, readAt);
      } catch (e: any) {
        Alert.alert('Cannot decrypt', e?.message ?? 'Failed to decrypt message');
      }
    },
    [decryptForDisplay, myPublicKey, sendReadReceipt]
  );

  const formatSeenLabel = React.useCallback((readAtSec: number): string => {
    const dt = new Date(readAtSec * 1000);
    return `Seen · ${dt.toLocaleDateString()} · ${dt.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })}`;
  }, []);

  const getSeenLabelFor = React.useCallback(
    (map: Record<string, number>, messageCreatedAtMs: number): string | null => {
      const readAtSec = map[String(messageCreatedAtMs)];
      if (!readAtSec) return null;
      return formatSeenLabel(readAtSec);
    },
    [formatSeenLabel]
  );

  const summarize = React.useCallback(async () => {
    if (!API_URL) {
      Alert.alert('AI not configured', 'API_URL is not configured.');
      return;
    }
    try {
      setSummaryLoading(true);
      setSummaryOpen(true);
      setSummaryText('');

      const { tokens } = await fetchAuthSession();
      const idToken = tokens?.idToken?.toString();
      if (!idToken) throw new Error('Not authenticated');

      // messages[] is newest-first (FlatList inverted), so take the most recent 50 and send oldest-first.
      const recent = messages.slice(0, 50).slice().reverse();
      const transcript = recent
        .map((m) => {
          // Only send plaintext. If message is still encrypted, skip it.
          const raw = m.decryptedText ?? (m.encrypted ? '' : (m.rawText ?? m.text));
          const text = raw.length > 500 ? `${raw.slice(0, 500)}…` : raw;
          return text
            ? {
                user: m.user ?? 'anon',
                text,
                createdAt: m.createdAt,
              }
            : null;
        })
        .filter(Boolean);

      const resp = await fetch(`${API_URL.replace(/\/$/, '')}/ai/summary`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          conversationId: activeConversationId,
          peer: peer ?? null,
          messages: transcript,
        }),
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`AI summary failed (${resp.status}): ${text || 'no body'}`);
      }
      const data = await resp.json();
      setSummaryText(String(data.summary ?? ''));
    } catch (e: any) {
      Alert.alert('Summary failed', e?.message ?? 'Unknown error');
      setSummaryOpen(false);
    } finally {
      setSummaryLoading(false);
    }
  }, [messages, activeConversationId, peer]);

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.select({ ios: 'padding', android: undefined })}
      >
        <View style={styles.header}>
          <Text style={styles.title}>{peer ? `DM with ${peer}` : 'Global Chat'}</Text>
          <Text style={styles.welcomeText}>{`Welcome ${displayName}!`}</Text>
          {isDm ? (
            <View style={styles.decryptRow}>
              <Text style={styles.decryptLabel}>Auto-decrypt</Text>
              <Switch
                value={autoDecrypt}
                onValueChange={setAutoDecrypt}
                disabled={!myPrivateKey}
              />
            </View>
          ) : null}
          {isDm ? (
            <View style={styles.decryptRow}>
              <Text style={styles.decryptLabel}>Disappearing messages</Text>
              <Pressable style={styles.ttlChip} onPress={() => setTtlPickerOpen(true)}>
                <Text style={styles.ttlChipText}>{TTL_OPTIONS[ttlIdx]?.label ?? 'Off'}</Text>
              </Pressable>
            </View>
          ) : null}
          <View style={styles.toolsRow}>
            <Pressable style={styles.toolBtn} onPress={summarize}>
              <Text style={styles.toolBtnText}>Summarize</Text>
            </Pressable>
          </View>
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
          renderItem={({ item }) => {
            const timestamp = new Date(item.createdAt); 
            const formatted = `${timestamp.toLocaleDateString()} · ${timestamp.toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}`;
            const expiresIn =
              isDm && typeof item.expiresAt === 'number' ? item.expiresAt - nowSec : null;

          const isEncryptedOutgoing =
            !!item.encrypted && !!myPublicKey && item.encrypted.senderPublicKey === myPublicKey;
          const isPlainOutgoing = !item.encrypted && (item.user ?? 'anon') === displayName;
          const isOutgoing = isEncryptedOutgoing || isPlainOutgoing;
          const outgoingSeenLabel = isDm
            ? getSeenLabelFor(peerSeenAtByCreatedAt, item.createdAt)
            : null;
          const incomingSeenLabel = isDm
            ? getSeenLabelFor(mySeenAtByCreatedAt, item.createdAt)
            : null;
          const seenLabel = isOutgoing ? outgoingSeenLabel : incomingSeenLabel;

            return (           
              <Pressable
                onPress={() => onPressMessage(item)}
                onLongPress={() => {
                  if (!item.encrypted) return;
                  setCipherText(item.rawText ?? '');
                  setCipherOpen(true);
                }}
              >
                <View style={styles.message}>
                  <Text style={styles.messageUser}>
                    {(item.user ?? 'anon')}{' · '}{formatted}
                    {expiresIn != null ? ` · disappears in ${formatRemaining(expiresIn)}` : ''}
                  </Text>
                  <Text style={styles.messageText}>{item.text}</Text>
                  {seenLabel ? (
                    <Text style={styles.seenText}>{seenLabel}</Text>
                  ) : null}
                </View>
              </Pressable>
            );
          }}
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
      <Modal visible={summaryOpen} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.summaryModal}>
            <Text style={styles.summaryTitle}>Summary</Text>
            {summaryLoading ? (
              <View style={styles.summaryLoadingRow}>
                <ActivityIndicator />
                <Text style={styles.summaryLoadingText}>Summarizing…</Text>
              </View>
            ) : (
              <ScrollView style={styles.summaryScroll}>
                <Text style={styles.summaryText}>
                  {summaryText.length ? summaryText : 'No summary returned.'}
                </Text>
              </ScrollView>
            )}
            <View style={styles.summaryButtons}>
              <Pressable
                style={styles.toolBtn}
                onPress={() => {
                  setSummaryOpen(false);
                  setSummaryText('');
                }}
              >
                <Text style={styles.toolBtnText}>Close</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={cipherOpen} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.summaryModal}>
            <Text style={styles.summaryTitle}>Encrypted payload</Text>
            <ScrollView style={styles.summaryScroll}>
              <Text style={styles.summaryText}>{cipherText || '(empty)'}</Text>
            </ScrollView>
            <View style={styles.summaryButtons}>
              <Pressable style={styles.toolBtn} onPress={() => setCipherOpen(false)}>
                <Text style={styles.toolBtnText}>Close</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={ttlPickerOpen} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setTtlPickerOpen(false)} />
          <View style={styles.summaryModal}>
            <Text style={styles.summaryTitle}>Disappearing messages</Text>
            <Text style={styles.summaryText}>
              Messages will disappear after the selected time from when they are sent.
            </Text>
            <View style={{ height: 12 }} />
            {TTL_OPTIONS.map((opt, idx) => {
              const selected = idx === ttlIdx;
              return (
                <Pressable
                  key={opt.label}
                  style={[styles.ttlOptionRow, selected ? styles.ttlOptionRowSelected : null]}
                  onPress={() => {
                    setTtlIdx(idx);
                  }}
                >
                  <Text style={styles.ttlOptionLabel}>{opt.label}</Text>
                  <Text style={styles.ttlOptionRadio}>{selected ? '◉' : '○'}</Text>
                </Pressable>
              );
            })}
            <View style={styles.summaryButtons}>
              <Pressable
                style={styles.toolBtn}
                onPress={() => setTtlPickerOpen(false)}
              >
                <Text style={styles.toolBtnText}>Done</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
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
  welcomeText: { fontSize: 14, color: '#555', marginTop: 4 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  statusText: { fontSize: 12, color: '#666', marginTop: 6 },
  decryptRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  decryptLabel: { fontSize: 12, color: '#555', fontWeight: '600' },
  ttlChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#eee',
  },
  ttlChipText: { fontSize: 12, color: '#333', fontWeight: '700' },
  ttlOptionRow: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    backgroundColor: '#f4f4f4',
  },
  ttlOptionRowSelected: { backgroundColor: '#e8eefc' },
  ttlOptionLabel: { color: '#222', fontWeight: '600' },
  ttlOptionRadio: { color: '#222', fontSize: 18, fontWeight: '800' },
  toolsRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 },
  toolBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#222' },
  toolBtnText: { color: '#fff', fontWeight: '600' },
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
  seenText: {
    marginTop: 6,
    fontSize: 12,
    color: '#1976d2',
    fontStyle: 'italic',
    fontWeight: '600',
    alignSelf: 'flex-end',
  },
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

  summaryModal: {
    width: '88%',
    maxHeight: '80%',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
  },
  summaryTitle: { fontSize: 18, fontWeight: '700', marginBottom: 10, color: '#111' },
  summaryLoadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  summaryLoadingText: { color: '#555', fontWeight: '600' },
  summaryScroll: { maxHeight: 420 },
  summaryText: { color: '#222', lineHeight: 20 },
  summaryButtons: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 },
});


