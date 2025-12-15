import React from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  AppStateStatus,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
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
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { getUrl, uploadData } from 'aws-amplify/storage';
import { VideoView, useVideoPlayer } from 'expo-video';
import * as ImageManipulator from 'expo-image-manipulator';
import * as VideoThumbnails from 'expo-video-thumbnails';

function InlineVideoThumb({
  url,
  onPress,
}: {
  url: string;
  onPress: () => void;
}): React.JSX.Element {
  const player = useVideoPlayer(url, (p: any) => {
    // Ensure we don't auto-play in the message list.
    try {
      p.pause();
    } catch {}
  });

  React.useEffect(() => {
    try {
      player.pause();
    } catch {}
  }, [player]);

  return (
    <Pressable onPress={onPress}>
      <View style={styles.videoThumbWrap}>
        <VideoView
          player={player}
          style={styles.mediaThumb}
          contentFit="cover"
          nativeControls={false}
        />
        <View style={styles.videoPlayOverlay}>
          <Text style={styles.videoPlayText}>▶</Text>
        </View>
      </View>
    </Pressable>
  );
}

function FullscreenVideo({ url }: { url: string }): React.JSX.Element {
  const player = useVideoPlayer(url, (p: any) => {
    try {
      p.play();
    } catch {}
  });

  return (
    <VideoView
      player={player}
      style={styles.viewerVideo}
      contentFit="contain"
      nativeControls
    />
  );
}

type ChatScreenProps = {
  conversationId?: string | null;
  peer?: string | null;
  displayName: string;
  onNewDmNotification?: (conversationId: string, user: string) => void;
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
  media?: {
    path: string;
    thumbPath?: string;
    kind: 'image' | 'video' | 'file';
    contentType?: string;
    thumbContentType?: string;
    fileName?: string;
    size?: number;
  };
  createdAt: number;
};

type ChatEnvelope = {
  type: 'chat';
  text?: string;
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

const parseChatEnvelope = (raw: string): ChatEnvelope | null => {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return null;
    if (obj.type !== 'chat') return null;
    return obj as ChatEnvelope;
  } catch {
    return null;
  }
};

const guessContentTypeFromName = (name?: string): string | undefined => {
  if (!name) return undefined;
  const lower = name.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.m4v')) return 'video/x-m4v';
  return undefined;
};

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_VIDEO_BYTES = 75 * 1024 * 1024; // 75MB
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25MB (GIFs/documents)
const THUMB_MAX_DIM = 720; // px
const THUMB_JPEG_QUALITY = 0.85; // preview-only; original stays untouched

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

export default function ChatScreen({
  conversationId,
  peer,
  displayName,
  onNewDmNotification,
}: ChatScreenProps): React.JSX.Element {
  const { user } = useAuthenticator();
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState<string>('');
  const [isConnecting, setIsConnecting] = React.useState<boolean>(false);
  const [isConnected, setIsConnected] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | null>(null);
  const wsRef = React.useRef<WebSocket | null>(null);
  const wsReconnectTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsReconnectAttemptRef = React.useRef<number>(0);
  const appStateRef = React.useRef<AppStateStatus>(AppState.currentState);
  const activeConversationIdRef = React.useRef<string>('global');
  const displayNameRef = React.useRef<string>('');
  const myPublicKeyRef = React.useRef<string | null>(null);
  const onNewDmNotificationRef = React.useRef<typeof onNewDmNotification | undefined>(undefined);
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
  const [isUploading, setIsUploading] = React.useState(false);
  const [pendingMedia, setPendingMedia] = React.useState<{
    uri: string;
    kind: 'image' | 'video' | 'file';
    contentType?: string;
    fileName?: string;
    size?: number;
  } | null>(null);
  const [mediaUrlByPath, setMediaUrlByPath] = React.useState<Record<string, string>>({});
  const inFlightMediaUrlRef = React.useRef<Set<string>>(new Set());
  const [imageAspectByPath, setImageAspectByPath] = React.useState<Record<string, number>>({});
  const inFlightImageSizeRef = React.useRef<Set<string>>(new Set());
  const [viewerOpen, setViewerOpen] = React.useState(false);
  const [viewerMedia, setViewerMedia] = React.useState<{
    url: string;
    kind: 'image' | 'video' | 'file';
    fileName?: string;
  } | null>(null);
  const activeConversationId = React.useMemo(
    () => (conversationId && conversationId.length > 0 ? conversationId : 'global'),
    [conversationId]
  );
  const isDm = React.useMemo(() => activeConversationId !== 'global', [activeConversationId]);

  React.useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);
  React.useEffect(() => {
    displayNameRef.current = displayName;
  }, [displayName]);
  React.useEffect(() => {
    myPublicKeyRef.current = myPublicKey;
  }, [myPublicKey]);
  React.useEffect(() => {
    onNewDmNotificationRef.current = onNewDmNotification;
  }, [onNewDmNotification]);

  const normalizeUser = React.useCallback((v: unknown): string => {
    return String(v ?? '').trim().toLowerCase();
  }, []);

  // If Android kills the activity while the picker is open, we can recover the result.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pending = await ImagePicker.getPendingResultAsync();
        if (cancelled) return;
        if (!pending || (pending as any).canceled) return;
        const first = (pending as any).assets?.[0];
        if (!first) return;
        const kind =
          first.type === 'video' ? 'video' : first.type === 'image' ? 'image' : 'file';
        const fileName = (first as any).fileName as string | undefined;
        const size = (first as any).fileSize as number | undefined;
        setPendingMedia({
          uri: first.uri,
          kind,
          contentType: (first as any).mimeType ?? guessContentTypeFromName(fileName),
          fileName,
          size,
        });
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const pickFromLibrary = React.useCallback(async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Please allow photo library access to pick media.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        // MediaTypeOptions is deprecated in SDK 54+. Use MediaType (or array) instead.
        mediaTypes: ['images', 'videos'],
        quality: 1,
      });

      if (result.canceled) return;
      const first = result.assets?.[0];
      if (!first) return;

      const kind =
        first.type === 'video'
          ? 'video'
          : first.type === 'image'
            ? 'image'
            : 'file';
      const fileName = (first as any).fileName as string | undefined;
      const size = (first as any).fileSize as number | undefined;

      setPendingMedia({
        uri: first.uri,
        kind,
        contentType: (first as any).mimeType ?? guessContentTypeFromName(fileName),
        fileName,
        size,
      });
    } catch (e: any) {
      Alert.alert('Picker failed', e?.message ?? 'Unknown error');
    }
  }, []);

  const pickDocument = React.useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const first = result.assets?.[0];
      if (!first) return;

      const fileName = first.name;
      const contentType = first.mimeType ?? guessContentTypeFromName(fileName);
      setPendingMedia({
        uri: first.uri,
        kind: contentType?.startsWith('image/')
          ? 'image'
          : contentType?.startsWith('video/')
            ? 'video'
            : 'file',
        contentType,
        fileName,
        size: typeof first.size === 'number' ? first.size : undefined,
      });
    } catch (e: any) {
      Alert.alert('File picker failed', e?.message ?? 'Unknown error');
    }
  }, []);

  // Global chat attachments (DM attachments will be E2EE later)
  const handlePickMedia = React.useCallback(() => {
    if (isDm) {
      Alert.alert('Not supported yet', 'Media attachments for DMs will be added with E2EE later.');
      return;
    }
    Alert.alert('Attach', 'Choose a source', [
      { text: 'Photos / Videos', onPress: () => void pickFromLibrary() },
      { text: 'File (GIF, etc.)', onPress: () => void pickDocument() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [isDm, pickFromLibrary, pickDocument]);

  const uploadPendingMedia = React.useCallback(
    async (
      media: NonNullable<typeof pendingMedia>
    ): Promise<ChatEnvelope['media']> => {
      const declaredSize = typeof media.size === 'number' ? media.size : undefined;
      const hardLimit =
        media.kind === 'image' ? MAX_IMAGE_BYTES : media.kind === 'video' ? MAX_VIDEO_BYTES : MAX_FILE_BYTES;
      if (declaredSize && declaredSize > hardLimit) {
        throw new Error(
          `File too large (${formatBytes(declaredSize)}). Limit for ${media.kind} is ${formatBytes(hardLimit)}.`
        );
      }

      const res = await fetch(media.uri);
      const blob = await res.blob();
      if (blob.size > hardLimit) {
        throw new Error(
          `File too large (${formatBytes(blob.size)}). Limit for ${media.kind} is ${formatBytes(hardLimit)}.`
        );
      }

      const safeName =
        (media.fileName || `${media.kind}-${Date.now()}`)
          .replace(/[^\w.\-() ]+/g, '_')
          .slice(0, 120) || `file-${Date.now()}`;
      // NOTE: current Amplify Storage auth policies (from amplify_outputs.json) allow `uploads/*`.
      // Keep uploads under that prefix so authenticated users can PUT.
      const baseKey = `${Date.now()}-${safeName}`;
      const path = `uploads/global/${baseKey}`;
      const thumbPath = `uploads/global/thumbs/${baseKey}.jpg`;

      await uploadData({
        path,
        data: blob,
        options: {
          contentType: media.contentType,
        },
      }).result;

      // Upload a separate thumbnail for fast list rendering (original stays full quality).
      let uploadedThumbPath: string | undefined;
      let uploadedThumbContentType: string | undefined;
      if (media.kind === 'image') {
        try {
          const thumb = await ImageManipulator.manipulateAsync(
            media.uri,
            [{ resize: { width: THUMB_MAX_DIM } }],
            { compress: THUMB_JPEG_QUALITY, format: ImageManipulator.SaveFormat.JPEG }
          );
          const thumbRes = await fetch(thumb.uri);
          const thumbBlob = await thumbRes.blob();
          await uploadData({
            path: thumbPath,
            data: thumbBlob,
            options: { contentType: 'image/jpeg' },
          }).result;
          uploadedThumbPath = thumbPath;
          uploadedThumbContentType = 'image/jpeg';
        } catch {
          // ignore thumb failures; fall back to original
        }
      } else if (media.kind === 'video') {
        try {
          const { uri } = await VideoThumbnails.getThumbnailAsync(media.uri, {
            time: 500,
            quality: THUMB_JPEG_QUALITY,
          });
          const thumbRes = await fetch(uri);
          const thumbBlob = await thumbRes.blob();
          await uploadData({
            path: thumbPath,
            data: thumbBlob,
            options: { contentType: 'image/jpeg' },
          }).result;
          uploadedThumbPath = thumbPath;
          uploadedThumbContentType = 'image/jpeg';
        } catch {
          // ignore thumb failures; fall back to video preview
        }
      }

      return {
        path,
        ...(uploadedThumbPath ? { thumbPath: uploadedThumbPath } : {}),
        kind: media.kind,
        contentType: media.contentType,
        ...(uploadedThumbContentType ? { thumbContentType: uploadedThumbContentType } : {}),
        fileName: media.fileName,
        size: media.size,
      };
    },
    [pendingMedia]
  );

  const openMedia = React.useCallback(async (path: string) => {
    try {
      const { url } = await getUrl({ path });
      await Linking.openURL(url.toString());
    } catch (e: any) {
      Alert.alert('Open failed', e?.message ?? 'Could not open attachment');
    }
  }, []);

  // Lazily resolve signed URLs for any media we see in message list (Global only).
  React.useEffect(() => {
    if (isDm) return;
    let cancelled = false;
    const needed: string[] = [];

    for (const m of messages) {
      const env = !m.encrypted ? parseChatEnvelope(m.rawText ?? m.text) : null;
      const media = env?.media ?? m.media;
      const paths: string[] = [];
      if (media?.path) paths.push(media.path);
      if (media?.thumbPath) paths.push(media.thumbPath);
      for (const path of paths) {
        if (!path) continue;
        if (mediaUrlByPath[path]) continue;
        if (inFlightMediaUrlRef.current.has(path)) continue;
        needed.push(path);
      }
    }

    if (!needed.length) return;
    needed.forEach((path) => inFlightMediaUrlRef.current.add(path));

    (async () => {
      const pairs: Array<[string, string]> = [];
      for (const path of needed) {
        try {
          const { url } = await getUrl({ path });
          pairs.push([path, url.toString()]);
        } catch {
          // ignore
        }
      }
      if (cancelled) return;
      if (pairs.length) {
        setMediaUrlByPath((prev) => {
          const next = { ...prev };
          for (const [p, u] of pairs) next[p] = u;
          return next;
        });
      }
      for (const p of needed) inFlightMediaUrlRef.current.delete(p);
    })();

    return () => {
      cancelled = true;
    };
  }, [isDm, messages, mediaUrlByPath]);

  // Lazily fetch image aspect ratios so thumbnails can render without letterboxing (and thus can be truly rounded).
  React.useEffect(() => {
    if (isDm) return;
    const needed: Array<{ path: string; url: string }> = [];

    for (const m of messages) {
      const env = !m.encrypted ? parseChatEnvelope(m.rawText ?? m.text) : null;
      const media = env?.media ?? m.media;
      if (!media?.path) continue;
      const looksImage =
        media.kind === 'image' || (media.kind === 'file' && (media.contentType || '').startsWith('image/'));
      if (!looksImage) continue;
      const url = mediaUrlByPath[media.path];
      if (!url) continue;
      if (imageAspectByPath[media.path]) continue;
      if (inFlightImageSizeRef.current.has(media.path)) continue;
      needed.push({ path: media.path, url });
    }

    if (!needed.length) return;
    needed.forEach(({ path }) => inFlightImageSizeRef.current.add(path));

    needed.forEach(({ path, url }) => {
      Image.getSize(
        url,
        (w, h) => {
          const aspect = w > 0 && h > 0 ? w / h : 1;
          setImageAspectByPath((prev) => ({ ...prev, [path]: aspect }));
          inFlightImageSizeRef.current.delete(path);
        },
        () => {
          inFlightImageSizeRef.current.delete(path);
        }
      );
    });
  }, [isDm, messages, mediaUrlByPath, imageAspectByPath]);

  const openViewer = React.useCallback(
    (media: NonNullable<ChatEnvelope['media']>) => {
      const url = mediaUrlByPath[media.path];
      if (!url) return;
      const kind =
        media.kind === 'file' && (media.contentType || '').startsWith('image/')
          ? 'image'
          : media.kind === 'file' && (media.contentType || '').startsWith('video/')
            ? 'video'
            : media.kind;
      if (kind !== 'image' && kind !== 'video') {
        void openMedia(media.path);
        return;
      }
      setViewerMedia({ url, kind, fileName: media.fileName });
      setViewerOpen(true);
    },
    [mediaUrlByPath, openMedia]
  );

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

  const closeWs = React.useCallback(() => {
    if (wsReconnectTimerRef.current) {
      clearTimeout(wsReconnectTimerRef.current);
      wsReconnectTimerRef.current = null;
    }
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      try {
        ws.close(1000, 'app background');
      } catch {
        // ignore
      }
    }
    setIsConnecting(false);
    setIsConnected(false);
  }, []);

  const scheduleReconnect = React.useCallback(() => {
    if (wsReconnectTimerRef.current) return;
    if (!user) return;
    if (!WS_URL) return;
    if (appStateRef.current !== 'active') return;
    const attempt = Math.min(wsReconnectAttemptRef.current + 1, 8);
    wsReconnectAttemptRef.current = attempt;
    const delayMs = Math.min(10_000, 500 * Math.pow(1.7, attempt - 1));
    wsReconnectTimerRef.current = setTimeout(() => {
      wsReconnectTimerRef.current = null;
      // connectWs will no-op if already open/connecting
      connectWs();
    }, delayMs);
  }, [user]);

  const connectWs = React.useCallback(() => {
    if (!user) return;
    if (!WS_URL) {
      setError('WebSocket URL not configured. Set expo.extra.WS_URL in app.json');
      return;
    }
    const existing = wsRef.current;
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
      return;
    }

    setError(null);
    setIsConnecting(true);

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      wsReconnectAttemptRef.current = 0;
      setIsConnecting(false);
      setIsConnected(true);
      flushPendingRead();
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        const activeConv = activeConversationIdRef.current;
        const dn = displayNameRef.current;

        const isPayloadDm =
          typeof payload?.conversationId === 'string' && payload?.conversationId !== 'global';
        const isDifferentConversation = payload?.conversationId !== activeConv;
        const fromOtherUser =
          typeof payload?.user === 'string' &&
          normalizeUser(payload.user) !== normalizeUser(dn);
        const hasText = typeof payload?.text === 'string';
        if (
          isPayloadDm &&
          isDifferentConversation &&
          fromOtherUser &&
          hasText &&
          typeof payload.conversationId === 'string'
        ) {
          onNewDmNotificationRef.current?.(payload.conversationId, payload.user || 'someone');
        }

        // Read receipt events (broadcast by backend)
        if (payload && payload.type === 'read' && payload.conversationId === activeConv) {
          if (payload.user && payload.user !== dn) {
            const readAt =
              typeof payload.readAt === 'number' ? payload.readAt : Math.floor(Date.now() / 1000);
            // New: per-message receipt (messageCreatedAt). Backward compat: treat readUpTo as a messageCreatedAt.
            const messageCreatedAt =
              typeof payload.messageCreatedAt === 'number'
                ? payload.messageCreatedAt
                : typeof payload.readUpTo === 'number'
                  ? payload.readUpTo
                  : undefined;

            if (typeof messageCreatedAt === 'number') {
              setPeerSeenAtByCreatedAt((prev) => ({
                ...prev,
                [String(messageCreatedAt)]: Math.max(prev[String(messageCreatedAt)] ?? 0, readAt),
              }));

              // TTL-from-read for outgoing messages: start countdown for that specific message (if it has ttlSeconds).
              setMessages((prev) =>
                prev.map((m) => {
                  const isEncryptedOutgoing =
                    !!m.encrypted &&
                    !!myPublicKeyRef.current &&
                    m.encrypted.senderPublicKey === myPublicKeyRef.current;
                  const isPlainOutgoing = !m.encrypted && (m.user ?? 'anon') === dn;
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
            text: encrypted
              ? 'Encrypted message (tap to decrypt; long-press to view ciphertext)'
              : rawText,
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
      scheduleReconnect();
    };
    ws.onclose = (e) => {
      // eslint-disable-next-line no-console
      console.log('WS close:', (e as any)?.code, (e as any)?.reason);
      setIsConnected(false);
      scheduleReconnect();
    };
  }, [user, normalizeUser, flushPendingRead, scheduleReconnect]);

  // Keep WS alive across "open picker -> app background -> return" transitions.
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      appStateRef.current = nextState;
      if (nextState === 'active') {
        connectWs();
      } else {
        // Free resources while backgrounded; we'll reconnect on resume.
        closeWs();
      }
    });
    return () => sub.remove();
  }, [connectWs, closeWs]);

  // Initial connect on mount / when user changes
  React.useEffect(() => {
    connectWs();
    return () => closeWs();
  }, [connectWs, closeWs]);

  // Fetch recent history from HTTP API (if configured)
  React.useEffect(() => {
    const fetchHistory = async () => {
      if (!API_URL) return;
      setMessages([]);
      try {
        // Some deployments protect GET /messages behind a Cognito authorizer.
        // Include the idToken when available; harmless if the route is public.
        const { tokens } = await fetchAuthSession().catch(() => ({ tokens: undefined }));
        const idToken = tokens?.idToken?.toString();
        const url = `${API_URL.replace(/\/$/, '')}/messages?conversationId=${encodeURIComponent(
          activeConversationId
        )}&limit=50`;
        const res = await fetch(url, idToken ? { headers: { Authorization: `Bearer ${idToken}` } } : undefined);
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          console.warn('fetchHistory failed', res.status, text);
          setError(`History fetch failed (${res.status})`);
          return;
        }
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

  const sendMessage = React.useCallback(async () => {
    if (isUploading) return;
    if (!input.trim() && !pendingMedia) return;
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
    } else if (pendingMedia) {
      try {
        setIsUploading(true);
        const uploaded = await uploadPendingMedia(pendingMedia);
        const envelope: ChatEnvelope = {
          type: 'chat',
          text: outgoingText,
          media: uploaded,
        };
        outgoingText = JSON.stringify(envelope);
      } catch (e: any) {
        Alert.alert('Upload failed', e?.message ?? 'Failed to upload media');
        return;
      } finally {
        setIsUploading(false);
      }
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
    setPendingMedia(null);
  }, [
    input,
    pendingMedia,
    isUploading,
    uploadPendingMedia,
    displayName,
    activeConversationId,
    isDm,
    myPrivateKey,
    peerPublicKey,
    ttlIdx,
    TTL_OPTIONS,
  ]);

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

          const envelope =
            !item.encrypted && !isDm ? parseChatEnvelope(item.rawText ?? item.text) : null;
          const captionText =
            envelope && typeof envelope.text === 'string' ? envelope.text : item.text;
          const media = envelope?.media ?? item.media;
          const mediaUrl = media?.path ? mediaUrlByPath[media.path] : null;
          const mediaThumbUrl = media?.thumbPath ? mediaUrlByPath[media.thumbPath] : null;
          const mediaLooksImage =
            !!media &&
            (media.kind === 'image' ||
              (media.kind === 'file' && (media.contentType || '').startsWith('image/')));
          const mediaLooksVideo =
            !!media &&
            (media.kind === 'video' ||
              (media.kind === 'file' && (media.contentType || '').startsWith('video/')));
          const imageAspect =
            mediaLooksImage && media?.path ? imageAspectByPath[media.path] : undefined;

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
                  {captionText?.length ? (
                    <Text style={styles.messageText}>{captionText}</Text>
                  ) : null}
                  {media?.path ? (
                    (mediaThumbUrl || mediaUrl) && mediaLooksImage ? (
                      <Pressable onPress={() => openViewer(media)}>
                        {typeof imageAspect === 'number' ? (
                          <Image
                            source={{ uri: mediaThumbUrl || mediaUrl || '' }}
                            style={[styles.imagePreview, { aspectRatio: imageAspect }]}
                            resizeMode="cover"
                          />
                        ) : (
                          <View style={[styles.mediaFrame, styles.imageFrame]}>
                            <Image
                              source={{ uri: mediaThumbUrl || mediaUrl || '' }}
                              style={styles.mediaFill}
                              resizeMode="contain"
                            />
                          </View>
                        )}
                      </Pressable>
                    ) : (mediaThumbUrl || mediaUrl) && mediaLooksVideo ? (
                      <Pressable onPress={() => openViewer(media)}>
                        <View style={styles.videoThumbWrap}>
                          <Image
                            source={{ uri: mediaThumbUrl || mediaUrl || '' }}
                            style={[styles.mediaThumb, { borderRadius: 16 }]}
                            resizeMode="cover"
                          />
                          <View style={styles.videoPlayOverlay}>
                            <Text style={styles.videoPlayText}>▶</Text>
                          </View>
                        </View>
                      </Pressable>
                    ) : (
                      <Pressable onPress={() => void openMedia(media.path)}>
                        <Text style={styles.attachmentLink}>
                          {`Attachment: ${media.kind}${media.fileName ? ` · ${media.fileName}` : ''} (tap to open)`}
                        </Text>
                      </Pressable>
                    )
                  ) : null}
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
          {!isDm ? (
            <Pressable style={styles.pickBtn} onPress={handlePickMedia} disabled={isUploading}>
              <Text style={styles.pickTxt}>＋</Text>
            </Pressable>
          ) : null}
          <TextInput
            style={styles.input}
            placeholder={pendingMedia ? 'Add a caption (optional)…' : 'Type a message'}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={sendMessage}
            returnKeyType="send"
          />
          <Pressable style={styles.sendBtn} onPress={sendMessage} disabled={isUploading}>
            <Text style={styles.sendTxt}>{isUploading ? 'Uploading…' : 'Send'}</Text>
          </Pressable>
        </View>
        {!isDm && pendingMedia ? (
          <Pressable
            style={styles.attachmentPill}
            onPress={() => setPendingMedia(null)}
            disabled={isUploading}
          >
            <Text style={styles.attachmentPillText}>
              {`Attached: ${pendingMedia.fileName || pendingMedia.kind} (tap to remove)`}
            </Text>
          </Pressable>
        ) : null}
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
  attachmentLink: {
    marginTop: 6,
    fontSize: 13,
    color: '#1976d2',
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  imagePreview: {
    marginTop: 8,
    width: '50%',
    alignSelf: 'flex-start',
    borderRadius: 16,
    backgroundColor: '#e9e9e9',
  },
  mediaFrame: {
    marginTop: 8,
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
    // Match the message bubble background so "contain" letterboxing doesn't show as white.
    backgroundColor: '#f1f1f1',
  },
  mediaFill: {
    width: '100%',
    height: '100%',
  },
  mediaThumb: {
    marginTop: 8,
    width: '100%',
    height: 220,
    borderRadius: 16,
    backgroundColor: '#e9e9e9',
  },
  imageFrame: {
    // Prefer showing the entire image (no cropping). Slightly shorter so tall images don't dominate.
    height: 180,
  },
  videoThumbWrap: {
    marginTop: 8,
    borderRadius: 16,
    overflow: 'hidden',
  },
  videoPlayOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoPlayText: {
    color: '#fff',
    fontSize: 42,
    fontWeight: '900',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
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
  attachmentPill: {
    marginHorizontal: 12,
    marginBottom: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#e8eefc',
    borderWidth: 1,
    borderColor: '#c7d6ff',
  },
  attachmentPillText: { color: '#1b3a7a', fontWeight: '700' },
  pickBtn: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#222',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  pickTxt: { color: '#fff', fontWeight: '800', fontSize: 18, lineHeight: 18 },
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

  viewerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewerCard: {
    width: '94%',
    height: '86%',
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  viewerTopBar: {
    height: 52,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  viewerTitle: { color: '#fff', fontWeight: '700', flex: 1, marginRight: 12 },
  viewerCloseBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: '#222' },
  viewerCloseText: { color: '#fff', fontWeight: '700' },
  viewerBody: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  viewerImage: { width: '100%', height: '100%', resizeMode: 'contain' },
  viewerVideo: { width: '100%', height: '100%' },
  viewerFallback: { color: '#fff' },
});


