import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  AppStateStatus,
  Easing,
  useWindowDimensions,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Dimensions,
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
import { AnimatedDots } from '../components/AnimatedDots';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WS_URL, API_URL } from '../config/env';
// const API_URL = "https://828bp5ailc.execute-api.us-east-2.amazonaws.com"
// const WS_URL = "wss://ws.ifelse.io"
import { useAuthenticator } from '@aws-amplify/ui-react-native';
import Constants from 'expo-constants';
import { fetchAuthSession } from '@aws-amplify/auth';
import { fetchUserAttributes } from 'aws-amplify/auth';
import {
  aesGcmDecryptBytes,
  aesGcmEncryptBytes,
  decryptChatMessageV1,
  deriveChatKeyBytesV1,
  encryptChatMessageV1,
  EncryptedChatPayloadV1,
  derivePublicKey,
  loadKeyPair,
} from '../../utils/crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getRandomBytes } from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { getUrl, uploadData } from 'aws-amplify/storage';
import { VideoView, useVideoPlayer } from 'expo-video';
import * as ImageManipulator from 'expo-image-manipulator';
import * as VideoThumbnails from 'expo-video-thumbnails';
import * as FileSystem from 'expo-file-system';
import { fromByteArray, toByteArray } from 'base64-js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { gcm } from '@noble/ciphers/aes.js';

function TypingIndicator({
  text,
  color,
}: {
  text: string;
  color: string;
}): React.JSX.Element {
  const dot1 = React.useRef(new Animated.Value(0)).current;
  const dot2 = React.useRef(new Animated.Value(0)).current;
  const dot3 = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    const makeDotAnim = (v: Animated.Value) =>
      Animated.sequence([
        Animated.timing(v, {
          toValue: 1,
          duration: 260,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(v, {
          toValue: 0,
          duration: 260,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]);

    const loop = Animated.loop(
      Animated.sequence([
        Animated.stagger(130, [makeDotAnim(dot1), makeDotAnim(dot2), makeDotAnim(dot3)]),
        Animated.delay(450),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [dot1, dot2, dot3]);

  const dotStyle = (v: Animated.Value) => ({
    transform: [
      {
        translateY: v.interpolate({
          inputRange: [0, 1],
          outputRange: [0, -5],
        }),
      },
    ],
    opacity: v.interpolate({
      inputRange: [0, 1],
      outputRange: [0.4, 1],
    }),
  });

  return (
    <View style={styles.typingIndicatorRow}>
      <Text style={[styles.typingText, { color }]}>{text}</Text>
      <View style={styles.typingDotsRow} accessibilityLabel={`${text}...`}>
        <Animated.Text style={[styles.typingDot, { color }, dotStyle(dot1)]}>.</Animated.Text>
        <Animated.Text style={[styles.typingDot, { color }, dotStyle(dot2)]}>.</Animated.Text>
        <Animated.Text style={[styles.typingDot, { color }, dotStyle(dot3)]}>.</Animated.Text>
      </View>
    </View>
  );
}

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
  onNewDmNotification?: (conversationId: string, user: string, userSub?: string) => void;
  headerTop?: React.ReactNode;
  theme?: 'light' | 'dark';
};

type ChatMessage = {
  id: string;
  user?: string;
  // Stable identity key for comparisons (lowercased username). Prefer this over `user` for logic.
  userLower?: string;
  // Stable identity key for comparisons (Cognito sub). Prefer this over display strings for logic.
  userSub?: string;
  text: string;
  rawText?: string;
  encrypted?: EncryptedChatPayloadV1;
  decryptedText?: string;
  decryptFailed?: boolean;
  expiresAt?: number; // epoch seconds
  ttlSeconds?: number; // duration, seconds (TTL-from-read)
  editedAt?: number; // epoch ms
  deletedAt?: number; // epoch ms
  deletedBySub?: string;
  reactions?: Record<string, { count: number; userSubs: string[] }>;
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
  // Local-only UI state for optimistic sends.
  localStatus?: 'sending' | 'sent' | 'failed';
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

const ENCRYPTED_PLACEHOLDER = 'Encrypted message (tap to decrypt)';

type DmMediaEnvelopeV1 = {
  type: 'dm_media_v1';
  v: 1;
  caption?: string;
  media: {
    kind: 'image' | 'video' | 'file';
    contentType?: string;
    fileName?: string;
    size?: number;
    path: string; // encrypted blob
    iv: string; // hex
    thumbPath?: string; // encrypted thumb blob
    thumbIv?: string; // hex
    thumbContentType?: string; // e.g. image/jpeg
  };
  wrap: {
    iv: string; // hex
    ciphertext: string; // hex (wrapped fileKey)
  };
};

const parseDmMediaEnvelope = (raw: string): DmMediaEnvelopeV1 | null => {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return null;
    if (obj.type !== 'dm_media_v1' || obj.v !== 1) return null;
    if (!obj.media || !obj.wrap) return null;
    if (typeof obj.media.path !== 'string' || typeof obj.media.iv !== 'string') return null;
    if (typeof obj.wrap.iv !== 'string' || typeof obj.wrap.ciphertext !== 'string') return null;
    return obj as DmMediaEnvelopeV1;
  } catch {
    return null;
  }
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

const normalizeReactions = (
  raw: any
): Record<string, { count: number; userSubs: string[] }> | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Record<string, { count: number; userSubs: string[] }> = {};
  for (const [emoji, info] of Object.entries(raw)) {
    if (!emoji) continue;
    const count = Number((info as any)?.count);
    const userSubsRaw = (info as any)?.userSubs;
    const userSubs = Array.isArray(userSubsRaw)
      ? userSubsRaw.map((s) => String(s)).filter(Boolean)
      : [];
    const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : userSubs.length;
    if (safeCount <= 0 && userSubs.length === 0) continue;
    out[String(emoji)] = { count: safeCount, userSubs };
  }
  return Object.keys(out).length ? out : undefined;
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
  const CHAT_MEDIA_MAX_HEIGHT = 240; // dp
  const CHAT_MEDIA_MAX_WIDTH_FRACTION = 0.86; // fraction of screen width (roughly bubble width)

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
  headerTop,
  theme = 'light',
}: ChatScreenProps): React.JSX.Element {
  const isDark = theme === 'dark';
  const { user } = useAuthenticator();
  const { width: windowWidth } = useWindowDimensions();
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState<string>('');
  const inputRef = React.useRef<string>('');
  const textInputRef = React.useRef<TextInput | null>(null);
  const [inputEpoch, setInputEpoch] = React.useState<number>(0);
  const sendTimeoutRef = React.useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [typingByUserExpiresAt, setTypingByUserExpiresAt] = React.useState<Record<string, number>>(
    {}
  ); // user -> expiresAtMs
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
  const isTypingRef = React.useRef<boolean>(false);
  const lastTypingSentAtRef = React.useRef<number>(0);
  const typingCleanupTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingJoinConversationIdRef = React.useRef<string | null>(null);
  const [myUserId, setMyUserId] = React.useState<string | null>(null);
  const [myPrivateKey, setMyPrivateKey] = React.useState<string | null>(null);
  const [myPublicKey, setMyPublicKey] = React.useState<string | null>(null);
  const [peerPublicKey, setPeerPublicKey] = React.useState<string | null>(null);
  const [autoDecrypt, setAutoDecrypt] = React.useState<boolean>(false);
  const [cipherOpen, setCipherOpen] = React.useState(false);
  const [cipherText, setCipherText] = React.useState<string>('');
  const [reactionInfoOpen, setReactionInfoOpen] = React.useState(false);
  const [reactionInfoEmoji, setReactionInfoEmoji] = React.useState<string>('');
  const [reactionInfoSubs, setReactionInfoSubs] = React.useState<string[]>([]);
  const [reactionInfoTarget, setReactionInfoTarget] = React.useState<ChatMessage | null>(null);
  const [nameBySub, setNameBySub] = React.useState<Record<string, string>>({});
  const [reactionPickerOpen, setReactionPickerOpen] = React.useState(false);
  const [reactionPickerTarget, setReactionPickerTarget] = React.useState<ChatMessage | null>(null);
  const [messageActionOpen, setMessageActionOpen] = React.useState(false);
  const [messageActionTarget, setMessageActionTarget] = React.useState<ChatMessage | null>(null);
  const [messageActionAnchor, setMessageActionAnchor] = React.useState<{ x: number; y: number } | null>(null);
  const actionMenuAnim = React.useRef(new Animated.Value(0)).current;
  const [inlineEditTargetId, setInlineEditTargetId] = React.useState<string | null>(null);
  const [inlineEditDraft, setInlineEditDraft] = React.useState<string>('');
  const [hiddenMessageIds, setHiddenMessageIds] = React.useState<Record<string, true>>({});
  const [infoOpen, setInfoOpen] = React.useState(false);
  const [infoTitle, setInfoTitle] = React.useState<string>('');
  const [infoBody, setInfoBody] = React.useState<string>('');
  // Per-message "Seen" state for outgoing messages (keyed by message createdAt ms)
  const [peerSeenAtByCreatedAt, setPeerSeenAtByCreatedAt] = React.useState<Record<string, number>>(
    {}
  ); // createdAt(ms) -> readAt(sec)
  const [mySeenAtByCreatedAt, setMySeenAtByCreatedAt] = React.useState<Record<string, number>>({});
  const pendingReadCreatedAtSetRef = React.useRef<Set<number>>(new Set());
  const sentReadCreatedAtSetRef = React.useRef<Set<number>>(new Set());
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
  const pendingMediaRef = React.useRef<typeof pendingMedia>(null);
  const [mediaUrlByPath, setMediaUrlByPath] = React.useState<Record<string, string>>({});
  const inFlightMediaUrlRef = React.useRef<Set<string>>(new Set());
  const [storageSessionReady, setStorageSessionReady] = React.useState<boolean>(false);
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
    inputRef.current = input;
  }, [input]);

  React.useEffect(() => {
    pendingMediaRef.current = pendingMedia;
  }, [pendingMedia]);
  React.useEffect(() => {
    myPublicKeyRef.current = myPublicKey;
  }, [myPublicKey]);
  React.useEffect(() => {
    onNewDmNotificationRef.current = onNewDmNotification;
  }, [onNewDmNotification]);

  const normalizeUser = React.useCallback((v: unknown): string => {
    return String(v ?? '').trim().toLowerCase();
  }, []);

  // Signal-style: show a tiny send-status indicator only on the most recent outgoing message.
  const latestOutgoingMessageId = React.useMemo(() => {
    const myLower = normalizeUser(displayName);
    for (const m of messages) {
      const isEncryptedOutgoing =
        !!m.encrypted && !!myPublicKey && m.encrypted.senderPublicKey === myPublicKey;
      const isPlainOutgoing =
        !m.encrypted &&
        (m.userSub && myUserId
          ? m.userSub === myUserId
          : normalizeUser(m.userLower ?? m.user ?? 'anon') === myLower);
      if (isEncryptedOutgoing || isPlainOutgoing) return m.id;
    }
    return null;
  }, [messages, myPublicKey, myUserId, displayName, normalizeUser]);

  const appendQueryParam = React.useCallback((url: string, key: string, value: string): string => {
    const hasQuery = url.includes('?');
    const sep = hasQuery ? '&' : '?';
    return `${url}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  }, []);

  const redactWsUrl = React.useCallback((url: string): string => {
    // Avoid leaking JWTs into device logs/crash reports.
    // Replace token=<anything> with token=REDACTED (handles ?token= and &token=).
    return String(url || '').replace(/([?&]token=)[^&]*/i, '$1REDACTED');
  }, []);

  const getCappedMediaSize = React.useCallback(
    (aspect: number | undefined) => {
      const maxW = Math.max(220, Math.floor(windowWidth * CHAT_MEDIA_MAX_WIDTH_FRACTION));
      const maxH = CHAT_MEDIA_MAX_HEIGHT;
      const a = typeof aspect === 'number' && Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
      // start with max width
      let w = maxW;
      let h = Math.floor(w / a);
      if (h > maxH) {
        h = maxH;
        w = Math.floor(h * a);
      }
      // Avoid 0 height/width
      w = Math.max(140, w);
      h = Math.max(120, h);
      return { w, h };
    },
    [windowWidth]
  );

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

  const captureFromCamera = React.useCallback(async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Please allow camera access to capture media.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images', 'videos'],
        quality: 1,
        allowsEditing: false,
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
      Alert.alert('Camera failed', e?.message ?? 'Unknown error');
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

  // Attachments: Global = plaintext S3; DM = E2EE (client-side encryption before upload)
  const handlePickMedia = React.useCallback(() => {
    if (isDm) {
      if (!myPrivateKey) {
        Alert.alert('Encryption not ready', 'Missing your private key on this device.');
        return;
      }
      if (!peerPublicKey) {
        Alert.alert('Encryption not ready', "Can't find the recipient's public key.");
        return;
      }
    }
    Alert.alert('Attach', 'Choose a source', [
      { text: 'Photos / Videos', onPress: () => void pickFromLibrary() },
      { text: 'Camera (photo or video)', onPress: () => void captureFromCamera() },
      { text: 'File (GIF, etc.)', onPress: () => void pickDocument() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [isDm, myPrivateKey, peerPublicKey, pickFromLibrary, captureFromCamera, pickDocument]);

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

  const uploadPendingMediaDmEncrypted = React.useCallback(
    async (
      media: NonNullable<typeof pendingMedia>,
      conversationKey: string,
      senderPrivateKeyHex: string,
      recipientPublicKeyHex: string
    ): Promise<DmMediaEnvelopeV1> => {
      const readUriBytes = async (uri: string): Promise<Uint8Array> => {
        // Prefer fetch(...).arrayBuffer() (works for http(s) and often for file://),
        // fallback to FileSystem Base64 read for cases where Blob.arrayBuffer is missing.
        try {
          const resp: any = await fetch(uri);
          if (resp && typeof resp.arrayBuffer === 'function') {
            return new Uint8Array(await resp.arrayBuffer());
          }
          if (resp && typeof resp.blob === 'function') {
            const b: any = await resp.blob();
            if (b && typeof b.arrayBuffer === 'function') {
              return new Uint8Array(await b.arrayBuffer());
            }
          }
        } catch {
          // fall through
        }
        const b64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        return toByteArray(b64);
      };

      const declaredSize = typeof media.size === 'number' ? media.size : undefined;
      const hardLimit =
        media.kind === 'image' ? MAX_IMAGE_BYTES : media.kind === 'video' ? MAX_VIDEO_BYTES : MAX_FILE_BYTES;
      if (declaredSize && declaredSize > hardLimit) {
        throw new Error(
          `File too large (${formatBytes(declaredSize)}). Limit for ${media.kind} is ${formatBytes(hardLimit)}.`
        );
      }

      // 1) Read original bytes (avoid Blob.arrayBuffer on Android)
      const plainBytes = await readUriBytes(media.uri);
      if (plainBytes.byteLength > hardLimit) {
        throw new Error(
          `File too large (${formatBytes(plainBytes.byteLength)}). Limit for ${media.kind} is ${formatBytes(
            hardLimit
          )}.`
        );
      }

      // 2) Generate per-attachment key and encrypt bytes
      const fileKey = new Uint8Array(getRandomBytes(32));
      const fileIv = new Uint8Array(getRandomBytes(12));
      const fileCipher = gcm(fileKey, fileIv).encrypt(plainBytes);

      // 3) Upload encrypted blob
      const safeName =
        (media.fileName || `${media.kind}-${Date.now()}`)
          .replace(/[^\w.\-() ]+/g, '_')
          .slice(0, 120) || `file-${Date.now()}`;
      const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const path = `uploads/dm/${conversationKey}/${uploadId}-${safeName}.enc`;
      // NOTE: avoid Blob construction on RN (can throw). uploadData supports Uint8Array directly.
      await uploadData({ path, data: fileCipher, options: { contentType: 'application/octet-stream' } }).result;

      // 4) Create + encrypt thumbnail (also E2EE)
      let thumbPath: string | undefined;
      let thumbIvHex: string | undefined;
      let thumbContentType: string | undefined;
      try {
        let thumbUri: string | null = null;
        if (media.kind === 'image') {
          const thumb = await ImageManipulator.manipulateAsync(
            media.uri,
            [{ resize: { width: THUMB_MAX_DIM } }],
            { compress: THUMB_JPEG_QUALITY, format: ImageManipulator.SaveFormat.JPEG }
          );
          thumbUri = thumb.uri;
        } else if (media.kind === 'video') {
          const { uri } = await VideoThumbnails.getThumbnailAsync(media.uri, {
            time: 500,
            quality: THUMB_JPEG_QUALITY,
          });
          thumbUri = uri;
        }

        if (thumbUri) {
          const tBytes = await readUriBytes(thumbUri);
          const tIv = new Uint8Array(getRandomBytes(12));
          const tCipher = gcm(fileKey, tIv).encrypt(tBytes);
          thumbPath = `uploads/dm/${conversationKey}/thumbs/${uploadId}.jpg.enc`;
          await uploadData({
            path: thumbPath,
            data: tCipher,
            options: { contentType: 'application/octet-stream' },
          }).result;
          thumbIvHex = bytesToHex(tIv);
          thumbContentType = 'image/jpeg';
        }
      } catch {
        // ignore thumb failures
      }

      // 5) Wrap fileKey with conversation ECDH key
      const chatKey = deriveChatKeyBytesV1(senderPrivateKeyHex, recipientPublicKeyHex);
      const wrap = aesGcmEncryptBytes(chatKey, fileKey);

      return {
        type: 'dm_media_v1',
        v: 1,
        caption: input.trim() || undefined,
        media: {
          kind: media.kind,
          contentType: media.contentType,
          fileName: media.fileName,
          size: media.size,
          path,
          iv: bytesToHex(fileIv),
          ...(thumbPath ? { thumbPath } : {}),
          ...(thumbIvHex ? { thumbIv: thumbIvHex } : {}),
          ...(thumbContentType ? { thumbContentType } : {}),
        },
        wrap: {
          iv: wrap.ivHex,
          ciphertext: wrap.ciphertextHex,
        },
      };
    },
    [input]
  );

  const openMedia = React.useCallback(async (path: string) => {
    try {
      const { url } = await getUrl({ path });
      await Linking.openURL(url.toString());
    } catch (e: any) {
      Alert.alert('Open failed', e?.message ?? 'Could not open attachment');
    }
  }, []);

  // Ensure we have credentials before trying to resolve signed URLs for media.
  // Without this, `getUrl()` can fail right after sign-in and thumbnails get stuck without a URL.
  React.useEffect(() => {
    let cancelled = false;
    setStorageSessionReady(false);

    (async () => {
      // If we don't have a signed-in user, don't block the UI.
      if (!user) {
        setStorageSessionReady(true);
        return;
      }

      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          const sess = await fetchAuthSession({ forceRefresh: attempt === 0 });
          if (sess?.credentials?.accessKeyId) {
            if (!cancelled) setStorageSessionReady(true);
            return;
          }
        } catch {
          // ignore; retry
        }
        // Small backoff (keeps the UI snappy but avoids tight loops)
        await new Promise((r) => setTimeout(r, 250 + attempt * 250));
      }

      // Don't block forever; we'll still retry getUrl, but the user can at least interact.
      if (!cancelled) setStorageSessionReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  // Lazily resolve signed URLs for any media we see in message list (Global only).
  React.useEffect(() => {
    if (isDm) return;
    if (!storageSessionReady) return;
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
    const uniqueNeeded = Array.from(new Set(needed));
    uniqueNeeded.forEach((path) => inFlightMediaUrlRef.current.add(path));

    (async () => {
      const pairs: Array<[string, string]> = [];
      try {
        for (const path of uniqueNeeded) {
          try {
            // One short retry helps with transient network hiccups (without adding complex state).
            try {
              const { url } = await getUrl({ path });
              pairs.push([path, url.toString()]);
            } catch {
              await new Promise((r) => setTimeout(r, 300));
              const { url } = await getUrl({ path });
              pairs.push([path, url.toString()]);
            }
          } catch {
            // ignore; user can still tap to open, and future renders may re-trigger resolution
          }
        }
        if (!cancelled && pairs.length) {
          setMediaUrlByPath((prev) => {
            const next = { ...prev };
            for (const [p, u] of pairs) next[p] = u;
            return next;
          });
        }
      } finally {
        // IMPORTANT: always clear in-flight flags, even if the effect is cancelled
        // (otherwise thumbnails can get stuck "loading" forever).
        for (const p of uniqueNeeded) inFlightMediaUrlRef.current.delete(p);
      }
    })();

    return () => {
      cancelled = true;
      // Also clear any remaining in-flight flags for this run.
      for (const p of uniqueNeeded) inFlightMediaUrlRef.current.delete(p);
    };
  }, [isDm, messages, mediaUrlByPath, storageSessionReady]);

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
      const keyPath = media.thumbPath || media.path;
      const url = mediaUrlByPath[keyPath];
      if (!url) continue;
      if (imageAspectByPath[keyPath]) continue;
      if (inFlightImageSizeRef.current.has(keyPath)) continue;
      needed.push({ path: keyPath, url });
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
    pendingReadCreatedAtSetRef.current = new Set();
    sentReadCreatedAtSetRef.current = new Set();
  }, [activeConversationId]);

  // Fetch persisted read state so "Seen" works even if sender was offline when peer decrypted.
  React.useEffect(() => {
    (async () => {
      if (!API_URL || !isDm) {
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
        // Expected shape (new): { reads: [{ userSub?: string, user?: string, messageCreatedAt: number, readAt: number }] }
        // Backward compat: accept { readUpTo } as a messageCreatedAt.
        const reads = Array.isArray(data.reads) ? data.reads : [];
        const map: Record<string, number> = {};
        for (const r of reads) {
          if (!r || typeof r !== 'object') continue;
          const readerSub = typeof (r as any).userSub === 'string' ? String((r as any).userSub) : '';
          const readerName = typeof (r as any).user === 'string' ? String((r as any).user) : '';
          // Ignore reads from myself
          if (myUserId && readerSub && readerSub === myUserId) continue;
          if (!readerSub && readerName && normalizeUser(readerName) === normalizeUser(displayName)) continue;
          const mc = Number(r.messageCreatedAt ?? r.readUpTo);
          const ra = Number(r.readAt);
          if (!Number.isFinite(mc) || !Number.isFinite(ra)) continue;
          const key = String(mc);
          map[key] = map[key] ? Math.min(map[key], ra) : ra;
        }
        setPeerSeenAtByCreatedAt((prev) => {
          const next = { ...prev };
          for (const [k, v] of Object.entries(map)) {
            const existing = next[k];
            next[k] = existing ? Math.min(existing, v) : v;
          }
          return next;
        });
      } catch {
        // ignore
      }
    })();
  }, [API_URL, isDm, activeConversationId, displayName, myUserId]);

  // Persist peer "Seen" state locally so it survives switching conversations (until backend persistence catches up).
  React.useEffect(() => {
    setPeerSeenAtByCreatedAt({});
  }, [activeConversationId]);

  React.useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(`chat:peerSeen:${activeConversationId}`);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          // Merge (don't overwrite) so server-hydrated /reads can't get clobbered by a slow local read.
          setPeerSeenAtByCreatedAt((prev) => {
            const next = { ...prev };
            for (const [k, v] of Object.entries(parsed)) {
              const n = Number(v);
              if (!Number.isFinite(n) || n <= 0) continue;
              const existing = next[k];
              next[k] = existing ? Math.min(existing, n) : n;
            }
            return next;
          });
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
          `chat:peerSeen:${activeConversationId}`,
          JSON.stringify(peerSeenAtByCreatedAt)
        );
      } catch {
        // ignore
      }
    })();
  }, [activeConversationId, peerSeenAtByCreatedAt]);

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
          setMySeenAtByCreatedAt((prev) => {
            const next = { ...prev };
            for (const [k, v] of Object.entries(parsed)) {
              const n = Number(v);
              if (!Number.isFinite(n) || n <= 0) continue;
              const existing = next[k];
              next[k] = existing ? Math.min(existing, n) : n;
            }
            return next;
          });
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

  const buildDmMediaKey = React.useCallback(
    (msg: ChatMessage): Uint8Array => {
      if (!msg.encrypted) throw new Error('Not encrypted');
      if (!myPrivateKey) throw new Error('Missing your private key on this device.');
      const isFromMe = !!myPublicKey && msg.encrypted.senderPublicKey === myPublicKey;
      const theirPub = isFromMe ? peerPublicKey : msg.encrypted.senderPublicKey;
      if (!theirPub) throw new Error("Can't derive DM media key (missing peer key).");
      return deriveChatKeyBytesV1(myPrivateKey, theirPub);
    },
    [myPrivateKey, myPublicKey, peerPublicKey]
  );

  const [dmThumbUriByPath, setDmThumbUriByPath] = React.useState<Record<string, string>>({});
  const [dmFileUriByPath, setDmFileUriByPath] = React.useState<Record<string, string>>({});

  const decryptDmThumbToDataUri = React.useCallback(
    async (msg: ChatMessage, env: DmMediaEnvelopeV1): Promise<string | null> => {
      if (!env.media.thumbPath || !env.media.thumbIv) return null;
      const cacheKey = env.media.thumbPath;
      if (dmThumbUriByPath[cacheKey]) return dmThumbUriByPath[cacheKey];

      const chatKey = buildDmMediaKey(msg);
      const fileKey = aesGcmDecryptBytes(chatKey, env.wrap.iv, env.wrap.ciphertext); // 32 bytes

      const { url } = await getUrl({ path: env.media.thumbPath });
      const encResp = await fetch(url.toString());
      const encBytes = new Uint8Array(await encResp.arrayBuffer());
      const plainThumbBytes = gcm(fileKey, new Uint8Array(hexToBytes(env.media.thumbIv))).decrypt(encBytes);

      const b64 = fromByteArray(plainThumbBytes);
      const ct = env.media.thumbContentType || 'image/jpeg';
      const dataUri = `data:${ct};base64,${b64}`;
      setDmThumbUriByPath((prev) => ({ ...prev, [cacheKey]: dataUri }));

      // Cache aspect ratio for sizing (DM thumbs are decrypted, so Image.getSize must run on the data URI)
      Image.getSize(
        dataUri,
        (w, h) => {
          const aspect = w > 0 && h > 0 ? w / h : 1;
          setImageAspectByPath((prev) => ({ ...prev, [cacheKey]: aspect }));
        },
        () => {}
      );
      return dataUri;
    },
    [aesGcmDecryptBytes, buildDmMediaKey, dmThumbUriByPath]
  );

  const decryptDmFileToCacheUri = React.useCallback(
    async (msg: ChatMessage, env: DmMediaEnvelopeV1): Promise<string> => {
      const cacheKey = env.media.path;
      if (dmFileUriByPath[cacheKey]) return dmFileUriByPath[cacheKey];

      const chatKey = buildDmMediaKey(msg);
      const fileKey = aesGcmDecryptBytes(chatKey, env.wrap.iv, env.wrap.ciphertext);

      const { url } = await getUrl({ path: env.media.path });
      const encResp = await fetch(url.toString());
      const encBytes = new Uint8Array(await encResp.arrayBuffer());
      const fileIvBytes = hexToBytes(env.media.iv);
      const plainBytes = gcm(fileKey, fileIvBytes).decrypt(encBytes);

      const ct = env.media.contentType || 'application/octet-stream';
      const ext =
        ct.startsWith('image/')
          ? ct.split('/')[1] || 'jpg'
          : ct.startsWith('video/')
            ? ct.split('/')[1] || 'mp4'
            : 'bin';
      const fileNameSafe = (env.media.fileName || `dm-${Date.now()}`).replace(/[^\w.\-() ]+/g, '_');
      const outUri = `${FileSystem.cacheDirectory}dm-${fileNameSafe}.${ext}`;
      const b64 = fromByteArray(plainBytes);
      await FileSystem.writeAsStringAsync(outUri, b64, { encoding: FileSystem.EncodingType.Base64 });

      setDmFileUriByPath((prev) => ({ ...prev, [cacheKey]: outUri }));
      return outUri;
    },
    [aesGcmDecryptBytes, buildDmMediaKey, dmFileUriByPath]
  );

  // DM: decrypt thumbnails once messages are decrypted (so we can render inline previews).
  React.useEffect(() => {
    if (!isDm) return;
    let cancelled = false;
    const run = async () => {
      for (const m of messages) {
        if (cancelled) return;
        if (!m.decryptedText) continue;
        const env = parseDmMediaEnvelope(m.decryptedText);
        if (!env?.media?.thumbPath || !env.media.thumbIv) continue;
        if (dmThumbUriByPath[env.media.thumbPath]) continue;
        try {
          await decryptDmThumbToDataUri(m, env);
        } catch {
          // ignore
        }
      }
    };
    setTimeout(() => void run(), 0);
    return () => {
      cancelled = true;
    };
  }, [isDm, messages, dmThumbUriByPath, decryptDmThumbToDataUri]);

  const openDmMediaViewer = React.useCallback(
    async (msg: ChatMessage) => {
      if (!isDm) return;
      if (!msg.decryptedText) return;
      const env = parseDmMediaEnvelope(msg.decryptedText);
      if (!env) return;
      try {
        const localUri = await decryptDmFileToCacheUri(msg, env);
        setViewerMedia({
          url: localUri,
          kind: env.media.kind === 'video' ? 'video' : env.media.kind === 'image' ? 'image' : 'file',
          fileName: env.media.fileName,
        });
        setViewerOpen(true);
      } catch (e: any) {
        Alert.alert('Open failed', e?.message ?? 'Could not decrypt attachment');
      }
    },
    [isDm, decryptDmFileToCacheUri]
  );

  const markMySeen = React.useCallback((messageCreatedAt: number, readAt: number) => {
    setMySeenAtByCreatedAt((prev) => ({
      ...prev,
      [String(messageCreatedAt)]: prev[String(messageCreatedAt)]
        ? Math.min(prev[String(messageCreatedAt)], readAt)
        : readAt,
    }));
  }, []);

  const sendReadReceipt = React.useCallback(
    (messageCreatedAt: number) => {
      if (!isDm) return;
      if (!Number.isFinite(messageCreatedAt) || messageCreatedAt <= 0) return;
      // Avoid duplicate sends/queues per conversation.
      if (sentReadCreatedAtSetRef.current.has(messageCreatedAt)) return;
      if (pendingReadCreatedAtSetRef.current.has(messageCreatedAt)) return;
      // If WS isn't ready yet (common right after login), queue and flush on connect.
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        pendingReadCreatedAtSetRef.current.add(messageCreatedAt);
        return;
      }
      sentReadCreatedAtSetRef.current.add(messageCreatedAt);
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
    const pending = Array.from(pendingReadCreatedAtSetRef.current);
    if (!pending.length) return;
    pendingReadCreatedAtSetRef.current = new Set();
    // send oldest-first (nice-to-have)
    pending.sort((a, b) => a - b);
    for (const mc of pending) {
      if (sentReadCreatedAtSetRef.current.has(mc)) continue;
      sentReadCreatedAtSetRef.current.add(mc);
      try {
        wsRef.current.send(
          JSON.stringify({
            action: 'read',
            conversationId: activeConversationId,
            user: displayName,
            messageCreatedAt: mc,
            readUpTo: mc,
            readAt: Math.floor(Date.now() / 1000),
            createdAt: Date.now(),
          })
        );
      } catch {
        // If send fails, re-queue and bail; connectWs will retry.
        pendingReadCreatedAtSetRef.current.add(mc);
        break;
      }
    }
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

    const decryptedIncomingCreatedAts: number[] = [];
    const readAt = Math.floor(Date.now() / 1000);
    let changed = false;

    const nextMessages = messages.map((m) => {
      if (!m.encrypted || m.decryptedText || m.decryptFailed) return m;
      const isFromMe = !!myPublicKey && m.encrypted.senderPublicKey === myPublicKey;
      if (isFromMe && !peerPublicKey) return m; // wait for peer key
      try {
        const plaintext = decryptForDisplay(m);
        changed = true;
        const dmEnv = isDm ? parseDmMediaEnvelope(plaintext) : null;
        if (!isFromMe) {
          decryptedIncomingCreatedAts.push(m.createdAt);
          const expiresAt =
            m.ttlSeconds && m.ttlSeconds > 0 ? readAt + m.ttlSeconds : m.expiresAt;
          markMySeen(m.createdAt, readAt);
          return {
            ...m,
            decryptedText: plaintext,
            text: dmEnv ? (dmEnv.caption ?? '') : plaintext,
            media: dmEnv
              ? {
                  path: dmEnv.media.path,
                  thumbPath: dmEnv.media.thumbPath,
                  kind: dmEnv.media.kind,
                  contentType: dmEnv.media.contentType,
                  thumbContentType: dmEnv.media.thumbContentType,
                  fileName: dmEnv.media.fileName,
                  size: dmEnv.media.size,
                }
              : m.media,
            expiresAt,
          };
        }
        markMySeen(m.createdAt, readAt);
        return {
          ...m,
          decryptedText: plaintext,
          text: dmEnv ? (dmEnv.caption ?? '') : plaintext,
          media: dmEnv
            ? {
                path: dmEnv.media.path,
                thumbPath: dmEnv.media.thumbPath,
                kind: dmEnv.media.kind,
                contentType: dmEnv.media.contentType,
                thumbContentType: dmEnv.media.thumbContentType,
                fileName: dmEnv.media.fileName,
                size: dmEnv.media.size,
              }
            : m.media,
        };
      } catch {
        changed = true;
        return { ...m, decryptFailed: true };
      }
    });

    if (changed) {
      setMessages(nextMessages);
      // Send per-message read receipts for messages we actually decrypted.
      decryptedIncomingCreatedAts.sort((a, b) => a - b);
      for (const mc of decryptedIncomingCreatedAts) {
        sendReadReceipt(mc);
      }
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
        // Prefer fetching by sub from the dm#<minSub>#<maxSub> conversationId.
        // This avoids relying on case/displayName matching.
        const parseDmPeerSub = (convId: string, mySub: string | null): string | null => {
          if (!mySub) return null;
          if (!convId.startsWith('dm#')) return null;
          const parts = convId.split('#').map((p) => p.trim()).filter(Boolean);
          if (parts.length !== 3) return null;
          const a = parts[1];
          const b = parts[2];
          if (a === mySub) return b;
          if (b === mySub) return a;
          return null;
        };
        const peerSub = parseDmPeerSub(activeConversationId, myUserId);
        const controller = new AbortController();
        const currentPeer = peer;
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        const cleanup = () => clearTimeout(timeoutId);
        const url = peerSub
          ? `${API_URL.replace(/\/$/, '')}/users?sub=${encodeURIComponent(peerSub)}`
          : `${API_URL.replace(/\/$/, '')}/users?username=${encodeURIComponent(peer)}`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${idToken}` },
          signal: controller.signal,
        });
        cleanup();
        if (!res.ok) {
          setPeerPublicKey(null);
          return;
        }
        const data = await res.json();
        // Source of truth: DynamoDB Users.currentPublicKey (returned as `public_key`).
        // (We intentionally do not fall back to Cognito custom attributes here.)
        const pk = (data.public_key as string | undefined) || (data.publicKey as string | undefined);
        // Only apply if peer hasn't changed mid-request
        if (currentPeer === peer) {
          setPeerPublicKey(typeof pk === 'string' && pk.length > 0 ? pk : null);
        }
      } catch {
        setPeerPublicKey(null);
      }
    })();
  }, [peer, isDm, API_URL, activeConversationId, myUserId]);

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

    (async () => {
      // If WS auth is enabled, include Cognito token in the WS URL query string.
      // (React Native WebSocket headers are unreliable cross-platform, query string is the common pattern.)
      let wsUrlWithAuth = WS_URL;
      try {
        const { tokens } = await fetchAuthSession();
        const idToken = tokens?.idToken?.toString();
        if (!idToken) {
          setIsConnecting(false);
          setIsConnected(false);
          setError('Not authenticated (missing idToken).');
          scheduleReconnect();
          return;
        }
        wsUrlWithAuth = appendQueryParam(WS_URL, 'token', idToken);
      } catch {
        setIsConnecting(false);
        setIsConnected(false);
        setError('Unable to authenticate WebSocket connection.');
        scheduleReconnect();
        return;
      }

      const ws = new WebSocket(wsUrlWithAuth);
    wsRef.current = ws;

    ws.onopen = () => {
        // Ignore events from stale sockets.
        if (wsRef.current !== ws) return;
      wsReconnectAttemptRef.current = 0;
      setIsConnecting(false);
      setIsConnected(true);
        setError(null);
      flushPendingRead();
        // Best-effort "join" so backend can route/broadcast efficiently.
        const pendingJoin = pendingJoinConversationIdRef.current || activeConversationIdRef.current;
        if (pendingJoin) {
          try {
            ws.send(
              JSON.stringify({
                action: 'join',
                conversationId: pendingJoin,
                createdAt: Date.now(),
              })
            );
            pendingJoinConversationIdRef.current = null;
          } catch {
            // ignore
          }
        }
    };

    ws.onmessage = (event) => {
        // Ignore events from stale sockets.
        if (wsRef.current !== ws) return;
      try {
        const payload = JSON.parse(event.data);
        const activeConv = activeConversationIdRef.current;
        const dn = displayNameRef.current;
          const myUserLower = normalizeUser(dn);
          const payloadUserLower =
            typeof payload?.userLower === 'string'
              ? normalizeUser(payload.userLower)
              : typeof payload?.user === 'string'
                ? normalizeUser(payload.user)
                : '';

        const isPayloadDm =
          typeof payload?.conversationId === 'string' && payload?.conversationId !== 'global';
        const isDifferentConversation = payload?.conversationId !== activeConv;
        const payloadSub = typeof payload?.userSub === 'string' ? payload.userSub : '';
        const fromOtherUser =
          (payloadSub && myUserId ? payloadSub !== myUserId : payloadUserLower !== myUserLower);
        const hasText = typeof payload?.text === 'string';
        if (
          isPayloadDm &&
          isDifferentConversation &&
          fromOtherUser &&
          hasText &&
          typeof payload.conversationId === 'string'
        ) {
          // Prefer display string when available; fall back to userLower for older deployments.
          const senderLabel =
            (typeof payload.user === 'string' && payload.user) ||
            (typeof payload.userLower === 'string' && payload.userLower) ||
            'someone';
          const senderSub = typeof payload.userSub === 'string' ? payload.userSub : undefined;
          onNewDmNotificationRef.current?.(payload.conversationId, senderLabel, senderSub);
        }

        // Read receipt events (broadcast by backend)
        if (payload && payload.type === 'read' && payload.conversationId === activeConv) {
          const readerSub = typeof payload.userSub === 'string' ? payload.userSub : '';
          const fromMe = myUserId && readerSub ? readerSub === myUserId : payloadUserLower === myUserLower;
          if (payload.user && !fromMe) {
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
                [String(messageCreatedAt)]: prev[String(messageCreatedAt)]
                  ? Math.min(prev[String(messageCreatedAt)], readAt)
                  : readAt,
              }));

              // TTL-from-read for outgoing messages: start countdown for that specific message (if it has ttlSeconds).
              setMessages((prev) =>
                prev.map((m) => {
                  const isEncryptedOutgoing =
                    !!m.encrypted &&
                    !!myPublicKeyRef.current &&
                    m.encrypted.senderPublicKey === myPublicKeyRef.current;
                  const isPlainOutgoing =
                    !m.encrypted &&
                    (m.userSub && myUserId
                      ? m.userSub === myUserId
                      : normalizeUser(m.userLower ?? m.user ?? 'anon') === myUserLower);
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

        // Typing indicator events (broadcast by backend)
        // Expected shape:
        // { type: 'typing', conversationId, user, isTyping: boolean, createdAt?: number }
        if (payload && payload.type === 'typing') {
          const incomingConv =
            typeof payload.conversationId === 'string' && payload.conversationId.length > 0
              ? payload.conversationId
              : 'global';
          if (incomingConv !== activeConv) return;
          const u = typeof payload.user === 'string' ? payload.user : 'someone';
          const payloadUserSub = typeof payload.userSub === 'string' ? payload.userSub : '';
          if (myUserId && payloadUserSub && payloadUserSub === myUserId) return;
          if (!payloadUserSub && payloadUserLower && payloadUserLower === myUserLower) return;
          const isTyping = payload.isTyping === true;
          if (!isTyping) {
            setTypingByUserExpiresAt((prev) => {
              if (!prev[u]) return prev;
              const next = { ...prev };
              delete next[u];
              return next;
            });
          } else {
            const expiresAtMs = Date.now() + 4000; // client-side TTL for "typing..." line
            setTypingByUserExpiresAt((prev) => ({ ...prev, [u]: expiresAtMs }));
          }
          return;
        }

        // Edit/delete events (broadcast by backend)
        if (payload && payload.type === 'edit') {
          const messageCreatedAt = Number(payload.createdAt);
          const editedAt = typeof payload.editedAt === 'number' ? payload.editedAt : Date.now();
          const newRaw = typeof payload.text === 'string' ? payload.text : '';
          if (Number.isFinite(messageCreatedAt) && newRaw) {
            setMessages((prev) =>
              prev.map((m) => {
                if (m.createdAt !== messageCreatedAt) return m;
                if (m.deletedAt) return m;
                const encrypted = parseEncrypted(newRaw);
                const isEncrypted = !!encrypted;
                return {
                  ...m,
                  rawText: newRaw,
                  encrypted: encrypted ?? undefined,
                  text: isEncrypted ? ENCRYPTED_PLACEHOLDER : newRaw,
                  decryptedText: undefined,
                  decryptFailed: false,
                  editedAt,
                };
              })
            );
          }
          return;
        }

        if (payload && payload.type === 'delete') {
          const messageCreatedAt = Number(payload.createdAt);
          const deletedAt = typeof payload.deletedAt === 'number' ? payload.deletedAt : Date.now();
          const deletedBySub = typeof payload.deletedBySub === 'string' ? payload.deletedBySub : undefined;
          if (Number.isFinite(messageCreatedAt)) {
            setMessages((prev) =>
              prev.map((m) =>
                m.createdAt === messageCreatedAt
                  ? {
                      ...m,
                      deletedAt,
                      deletedBySub,
                      rawText: '',
                      text: '',
                      encrypted: undefined,
                      decryptedText: undefined,
                      decryptFailed: false,
                    }
                  : m
              )
            );
          }
          return;
        }

        // Reaction events (broadcast by backend)
        if (payload && payload.type === 'reaction') {
          const messageCreatedAt = Number(payload.createdAt);
          if (!Number.isFinite(messageCreatedAt)) return;

          // New shape: payload.reactions is the full map { emoji: {count, userSubs} }
          if (payload.reactions) {
            const normalized = normalizeReactions(payload.reactions);
            setMessages((prev) =>
              prev.map((m) => (m.createdAt === messageCreatedAt ? { ...m, reactions: normalized } : m))
            );
            return;
          }

          // Backward compat: payload has { emoji, users }
          const emoji = typeof payload.emoji === 'string' ? payload.emoji : '';
          const users = Array.isArray(payload.users) ? payload.users.map(String).filter(Boolean) : [];
          if (emoji) {
            setMessages((prev) =>
              prev.map((m) => {
                if (m.createdAt !== messageCreatedAt) return m;
                const nextReactions = { ...(m.reactions || {}) };
                if (users.length === 0) delete nextReactions[emoji];
                else nextReactions[emoji] = { count: users.length, userSubs: users };
                return { ...m, reactions: Object.keys(nextReactions).length ? nextReactions : undefined };
              })
            );
          }
          return;
        }

        if (payload && payload.text) {
          // Only render messages for the currently open conversation.
          // (We still emit DM notifications above for other conversations.)
          const incomingConv =
            typeof payload.conversationId === 'string' && payload.conversationId.length > 0
              ? payload.conversationId
              : 'global';
          if (incomingConv !== activeConv) return;

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
            userSub: typeof payload.userSub === 'string' ? payload.userSub : undefined,
            userLower:
              typeof payload.userLower === 'string'
                ? normalizeUser(payload.userLower)
                : typeof payload.user === 'string'
                  ? normalizeUser(payload.user)
                  : undefined,
            reactions: normalizeReactions((payload as any)?.reactions),
            rawText,
            encrypted: encrypted ?? undefined,
            text: encrypted ? ENCRYPTED_PLACEHOLDER : rawText,
            createdAt,
            expiresAt: typeof payload.expiresAt === 'number' ? payload.expiresAt : undefined,
            ttlSeconds: typeof payload.ttlSeconds === 'number' ? payload.ttlSeconds : undefined,
            localStatus: 'sent',
            editedAt: typeof payload.editedAt === 'number' ? payload.editedAt : undefined,
            deletedAt: typeof payload.deletedAt === 'number' ? payload.deletedAt : undefined,
            deletedBySub: typeof payload.deletedBySub === 'string' ? payload.deletedBySub : undefined,
          };
          if (hiddenMessageIds[msg.id]) return;
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === msg.id);
            if (idx === -1) return [msg, ...prev];
            const existing = prev[idx];
            const shouldPreservePlaintext =
              !!existing.decryptedText || (!!existing.text && existing.text !== ENCRYPTED_PLACEHOLDER);
            const merged: ChatMessage = {
              ...msg,
              decryptedText: existing.decryptedText ?? msg.decryptedText,
              text: shouldPreservePlaintext ? existing.text : msg.text,
              localStatus: 'sent',
            };
            if (sendTimeoutRef.current[msg.id]) {
              clearTimeout(sendTimeoutRef.current[msg.id]);
              delete sendTimeoutRef.current[msg.id];
            }
            const next = prev.slice();
            next[idx] = merged;
            return next;
          });
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
        // Ignore events from stale sockets.
        if (wsRef.current !== ws) return;
      // RN WebSocket doesn't expose much, but log what we can
      // eslint-disable-next-line no-console
        console.log('WS error:', e?.message ?? 'WebSocket error', 'url:', redactWsUrl(ws.url));
      setIsConnecting(false);
      setIsConnected(false);
      setError(e?.message ? `WebSocket error: ${e.message}` : 'WebSocket error');
      scheduleReconnect();
    };
    ws.onclose = (e) => {
        // Ignore events from stale sockets.
        if (wsRef.current !== ws) return;
      // eslint-disable-next-line no-console
        console.log('WS close:', (e as any)?.code, (e as any)?.reason, 'url:', redactWsUrl(ws.url));
      setIsConnected(false);
      scheduleReconnect();
    };
    })();
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

  // Periodically sweep expired typing indicators.
  React.useEffect(() => {
    if (typingCleanupTimerRef.current) return;
    typingCleanupTimerRef.current = setInterval(() => {
      const now = Date.now();
      setTypingByUserExpiresAt((prev) => {
        const entries = Object.entries(prev);
        if (entries.length === 0) return prev;
        let changed = false;
        const next: Record<string, number> = {};
        for (const [u, exp] of entries) {
          if (typeof exp === 'number' && exp > now) next[u] = exp;
          else changed = true;
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => {
      if (typingCleanupTimerRef.current) clearInterval(typingCleanupTimerRef.current);
      typingCleanupTimerRef.current = null;
    };
  }, []);

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
              userSub: typeof it.userSub === 'string' ? it.userSub : undefined,
              userLower:
                typeof it.userLower === 'string'
                  ? normalizeUser(it.userLower)
                  : normalizeUser(String(it.user ?? 'anon')),
              editedAt: typeof it.editedAt === 'number' ? it.editedAt : undefined,
              deletedAt: typeof it.deletedAt === 'number' ? it.deletedAt : undefined,
              deletedBySub: typeof it.deletedBySub === 'string' ? it.deletedBySub : undefined,
              reactions: normalizeReactions((it as any)?.reactions),
              rawText: typeof it.text === 'string' ? String(it.text) : '',
              encrypted: parseEncrypted(typeof it.text === 'string' ? String(it.text) : '') ?? undefined,
              text:
                typeof it.deletedAt === 'number'
                  ? ''
                  : parseEncrypted(typeof it.text === 'string' ? String(it.text) : '')
                ? ENCRYPTED_PLACEHOLDER
                    : (typeof it.text === 'string' ? String(it.text) : ''),
              createdAt: Number(it.createdAt ?? Date.now()),
              expiresAt: typeof it.expiresAt === 'number' ? it.expiresAt : undefined,
              ttlSeconds: typeof it.ttlSeconds === 'number' ? it.ttlSeconds : undefined,
            }))
            .filter(m => m.text.length > 0)
            .sort((a, b) => b.createdAt - a.createdAt);
          // Deduplicate by id (history may overlap with WS delivery)
          const seen = new Set<string>();
          const deduped = normalized
            .filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
            .filter((m) => !hiddenMessageIds[m.id]);
          setMessages(deduped);
        }
      } catch {
        // ignore fetch errors; WS will still populate
      }
    };
    fetchHistory();
  }, [API_URL, activeConversationId, hiddenMessageIds]);

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
    const currentInput = inputRef.current;
    const currentPendingMedia = pendingMediaRef.current;
    if (!currentInput.trim() && !currentPendingMedia) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError('Not connected');
      return;
    }

    // Stop typing indicator on send (best-effort)
    if (isTypingRef.current) {
      try {
        wsRef.current.send(
          JSON.stringify({
            action: 'typing',
            conversationId: activeConversationId,
            user: displayName,
            isTyping: false,
            createdAt: Date.now(),
          })
        );
      } catch {
        // ignore
      }
      isTypingRef.current = false;
    }

    // Snapshot current input/media.
    const originalInput = currentInput;
    const originalPendingMedia = currentPendingMedia;

    let outgoingText = originalInput.trim();

    const clearDraftImmediately = () => {
      // Force-remount the TextInput to fully reset native state.
      // This is the most reliable way to guarantee "instant clear" on Android
      // even if the user keeps typing and spams Send.
      setInputEpoch((v) => v + 1);
      try {
        textInputRef.current?.clear?.();
      } catch {
        // ignore
      }
      setInput('');
      inputRef.current = '';
      setPendingMedia(null);
      pendingMediaRef.current = null;
    };

    const restoreDraftIfUnchanged = () => {
      // Only restore if the user hasn't started typing a new message / attaching new media.
      if ((inputRef.current || '').length === 0 && !pendingMediaRef.current) {
        setInput(originalInput);
        inputRef.current = originalInput;
        setPendingMedia(originalPendingMedia);
        pendingMediaRef.current = originalPendingMedia;
      }
    };

    // Clear immediately (and yield a tick) so the input visually resets before CPU-heavy work (encryption/upload).
    // (We also clear even when editing, like Signal does.)
    clearDraftImmediately();
    await new Promise((r) => setTimeout(r, 0));
    if (isDm) {
      if (!myPrivateKey) {
        Alert.alert('Encryption not ready', 'Missing your private key on this device.');
        restoreDraftIfUnchanged();
        return;
      }
      if (!peerPublicKey) {
        Alert.alert('Encryption not ready', "Can't find the recipient's public key.");
        restoreDraftIfUnchanged();
        return;
      }

      // DM media: encrypt + upload ciphertext, then encrypt the envelope as a normal DM message.
      if (originalPendingMedia) {
        try {
          setIsUploading(true);
          const dmEnv = await uploadPendingMediaDmEncrypted(
            originalPendingMedia,
            activeConversationId,
            myPrivateKey,
            peerPublicKey
          );
          const plaintextEnvelope = JSON.stringify(dmEnv);
          const enc = encryptChatMessageV1(plaintextEnvelope, myPrivateKey, peerPublicKey);
          outgoingText = JSON.stringify(enc);
        } catch (e: any) {
          Alert.alert('Upload failed', e?.message ?? 'Failed to upload media');
          restoreDraftIfUnchanged();
          return;
        } finally {
          setIsUploading(false);
        }
      } else {
        const enc = encryptChatMessageV1(outgoingText, myPrivateKey, peerPublicKey);
        outgoingText = JSON.stringify(enc);
      }
    } else if (originalPendingMedia) {
      try {
        setIsUploading(true);
        const uploaded = await uploadPendingMedia(originalPendingMedia);
        const envelope: ChatEnvelope = {
          type: 'chat',
          text: outgoingText,
          media: uploaded,
        };
        outgoingText = JSON.stringify(envelope);
      } catch (e: any) {
        Alert.alert('Upload failed', e?.message ?? 'Failed to upload media');
        restoreDraftIfUnchanged();
        return;
      } finally {
        setIsUploading(false);
      }
    } else {
      // Plain text global message already cleared above.
    }

    const clientMessageId = `c-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Optimistic UI: show the outgoing message immediately, then let the WS echo dedupe by id.
    // (Backend uses clientMessageId as messageId when provided.)
    if (!originalPendingMedia) {
      const optimisticRaw = outgoingText;
      const optimisticEncrypted = parseEncrypted(optimisticRaw);
      const optimisticPlaintext = originalInput.trim();
      const optimisticMsg: ChatMessage = {
        id: clientMessageId,
        user: displayName,
        userLower: normalizeUser(displayName),
        userSub: myUserId ?? undefined,
        rawText: optimisticRaw,
        encrypted: optimisticEncrypted ?? undefined,
        // If it's an encrypted DM, only show plaintext optimistically when autoDecrypt is enabled.
        decryptedText: isDm && optimisticEncrypted && autoDecrypt ? optimisticPlaintext : undefined,
        text:
          isDm && optimisticEncrypted
            ? (autoDecrypt ? optimisticPlaintext : ENCRYPTED_PLACEHOLDER)
            : optimisticEncrypted
              ? ENCRYPTED_PLACEHOLDER
              : optimisticRaw,
        createdAt: Date.now(),
        ttlSeconds: isDm && TTL_OPTIONS[ttlIdx]?.seconds ? TTL_OPTIONS[ttlIdx].seconds : undefined,
        localStatus: 'sending',
      };
      setMessages((prev) => (prev.some((m) => m.id === optimisticMsg.id) ? prev : [optimisticMsg, ...prev]));

      // If we don't see our own echo within a short window, mark as failed.
      // (We don't show "sending…" for text; we only show a failure state.)
      if (sendTimeoutRef.current[clientMessageId]) {
        clearTimeout(sendTimeoutRef.current[clientMessageId]);
      }
      sendTimeoutRef.current[clientMessageId] = setTimeout(() => {
        setMessages((prev) =>
          prev.map((m) => (m.id === clientMessageId && m.localStatus === 'sending' ? { ...m, localStatus: 'failed' } : m))
        );
        delete sendTimeoutRef.current[clientMessageId];
      }, 5000);
    }

    const outgoing = {
      action: 'message',
      text: outgoingText,
      conversationId: activeConversationId,
      user: displayName,
      clientMessageId,
      createdAt: Date.now(),
      // TTL-from-read: we send a duration, and the countdown starts when the recipient decrypts.
      ttlSeconds: isDm && TTL_OPTIONS[ttlIdx]?.seconds ? TTL_OPTIONS[ttlIdx].seconds : undefined,
    };
    try {
    wsRef.current.send(JSON.stringify(outgoing));
    } catch (e) {
      // Mark optimistic message as failed if send throws (rare, but possible during reconnect).
      setMessages((prev) =>
        prev.map((m) => (m.id === clientMessageId ? { ...m, localStatus: 'failed' } : m))
      );
      setError('Not connected');
      return;
    }
  }, [
    isUploading,
    uploadPendingMedia,
    uploadPendingMediaDmEncrypted,
    displayName,
    activeConversationId,
    isDm,
    myPrivateKey,
    peerPublicKey,
    ttlIdx,
    TTL_OPTIONS,
    myUserId,
    normalizeUser,
  ]);

  const retryFailedMessage = React.useCallback(
    (msg: ChatMessage) => {
      if (!msg || msg.localStatus !== 'failed') return;
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        setError('Not connected');
        return;
      }
      if (!msg.rawText || !msg.rawText.trim()) return;

      // Flip back to sending immediately.
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, localStatus: 'sending' } : m)));

      // Re-arm timeout.
      if (sendTimeoutRef.current[msg.id]) clearTimeout(sendTimeoutRef.current[msg.id]);
      sendTimeoutRef.current[msg.id] = setTimeout(() => {
        setMessages((prev) =>
          prev.map((m) => (m.id === msg.id && m.localStatus === 'sending' ? { ...m, localStatus: 'failed' } : m))
        );
        delete sendTimeoutRef.current[msg.id];
      }, 5000);

      try {
        wsRef.current.send(
          JSON.stringify({
            action: 'message',
            text: msg.rawText,
            conversationId: activeConversationId,
            user: displayName,
            clientMessageId: msg.id, // keep same bubble id
            createdAt: Date.now(),
            ttlSeconds: isDm && msg.ttlSeconds ? msg.ttlSeconds : undefined,
          })
        );
      } catch {
        setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, localStatus: 'failed' } : m)));
      }
    },
    [activeConversationId, displayName, isDm]
  );

  const sendTyping = React.useCallback(
    (nextIsTyping: boolean) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      const now = Date.now();
      // Throttle "typing true" events; always allow "typing false" immediately.
      if (nextIsTyping) {
        const last = lastTypingSentAtRef.current;
        if (now - last < 2000 && isTypingRef.current) return;
        lastTypingSentAtRef.current = now;
      }
      try {
        wsRef.current.send(
          JSON.stringify({
            action: 'typing',
            conversationId: activeConversationId,
            user: displayName,
            isTyping: nextIsTyping,
            createdAt: now,
          })
        );
        isTypingRef.current = nextIsTyping;
      } catch {
        // ignore
      }
    },
    [activeConversationId, displayName]
  );

  const sendJoin = React.useCallback((conversationIdToJoin: string) => {
    if (!conversationIdToJoin) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      pendingJoinConversationIdRef.current = conversationIdToJoin;
      return;
    }
    try {
      wsRef.current.send(
        JSON.stringify({
          action: 'join',
          conversationId: conversationIdToJoin,
          createdAt: Date.now(),
        })
      );
      pendingJoinConversationIdRef.current = null;
    } catch {
      pendingJoinConversationIdRef.current = conversationIdToJoin;
    }
  }, []);

  // Notify backend whenever user switches conversations (enables Query-by-conversation routing).
  React.useEffect(() => {
    sendJoin(activeConversationId);
  }, [activeConversationId, sendJoin]);

  const onChangeInput = React.useCallback(
    (next: string) => {
      setInput(next);
      inputRef.current = next;
      const nextHasText = next.trim().length > 0;
      if (nextHasText) sendTyping(true);
      else if (isTypingRef.current) sendTyping(false);
    },
    [sendTyping]
  );

  const typingIndicatorText = React.useMemo(() => {
    const now = Date.now();
    const users = Object.entries(typingByUserExpiresAt)
      .filter(([, exp]) => typeof exp === 'number' && exp > now)
      .map(([u]) => u);
    if (users.length === 0) return '';
    if (users.length >= 5) return 'Someone is typing';
    if (users.length === 1) return `${users[0]} is typing`;
    if (users.length === 2) return `${users[0]} and ${users[1]} are typing`;
    return `${users.slice(0, -1).join(', ')}, and ${users[users.length - 1]} are typing`;
  }, [typingByUserExpiresAt]);

  const openInfo = React.useCallback((title: string, body: string) => {
    setInfoTitle(title);
    setInfoBody(body);
    setInfoOpen(true);
  }, []);

  const onPressMessage = React.useCallback(
    (msg: ChatMessage) => {
      if (msg.deletedAt) return;
      if (!msg.encrypted) return;
      try {
        const readAt = Math.floor(Date.now() / 1000);
        const plaintext = decryptForDisplay(msg);
        const dmEnv = isDm ? parseDmMediaEnvelope(plaintext) : null;
        const isFromMe = !!myPublicKey && msg.encrypted?.senderPublicKey === myPublicKey;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msg.id
              ? {
                  ...m,
                  decryptedText: plaintext,
                  text: dmEnv ? (dmEnv.caption ?? '') : plaintext,
                  media: dmEnv
                    ? {
                        path: dmEnv.media.path,
                        thumbPath: dmEnv.media.thumbPath,
                        kind: dmEnv.media.kind,
                        contentType: dmEnv.media.contentType,
                        thumbContentType: dmEnv.media.thumbContentType,
                        fileName: dmEnv.media.fileName,
                        size: dmEnv.media.size,
                      }
                    : m.media,
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
        const rawMsg = typeof e?.message === 'string' ? e.message : '';
        const lower = rawMsg.toLowerCase();
        const hint =
          lower.includes('ghash') || lower.includes('tag') || lower.includes('aes')
            ? "This message can't be decrypted on this device. It may have been encrypted with a different key, or the message is corrupted."
            : "This message can't be decrypted right now. Please try again later.";
        openInfo("Couldn't decrypt message", hint);
      }
    },
    [decryptForDisplay, myPublicKey, sendReadReceipt, isDm, markMySeen, openInfo]
  );

  const openMessageActions = React.useCallback(
    (msg: ChatMessage, anchor?: { x: number; y: number }) => {
      if (!msg) return;
      setMessageActionTarget(msg);
      if (anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) setMessageActionAnchor(anchor);
      else setMessageActionAnchor(null);
      setMessageActionOpen(true);
      actionMenuAnim.setValue(0);
      Animated.spring(actionMenuAnim, {
        toValue: 1,
        useNativeDriver: true,
        friction: 9,
        tension: 90,
      }).start();
    },
    [myPublicKey, myUserId, displayName, normalizeUser, actionMenuAnim]
  );

  const closeMessageActions = React.useCallback(() => {
    setMessageActionOpen(false);
    setMessageActionTarget(null);
    setMessageActionAnchor(null);
  }, []);

  const QUICK_REACTIONS = React.useMemo(() => ['❤️', '😂', '👍', '😮', '😢', '😡'], []);
  const MORE_REACTIONS = React.useMemo(
    () => [
      ...QUICK_REACTIONS,
      '🔥','🎉','🙏','👏','✅','❌','🤔','👀','😎','💯','🥹','💀','🤣','😍','😊','😭','😅','😬','🙃','😴','🤯',
      '🤝','💪','🫶','🙌','😤','😈','😇','🤷','🤷‍♂️','🤷‍♀️','🤦','🤦‍♂️','🤦‍♀️','🤍','💙','💚','💛','💜',
    ],
    [QUICK_REACTIONS]
  );

  const beginInlineEdit = React.useCallback(
    (target: ChatMessage) => {
      if (!target) return;
      if (target.deletedAt) return;
      if (target.encrypted && !target.decryptedText) {
        openInfo('Decrypt first', 'Decrypt this message before editing it');
        return;
      }
      const seed = target.encrypted
        ? String(target.decryptedText || '')
        : String(target.rawText ?? target.text ?? '');
      setInlineEditTargetId(target.id);
      setInlineEditDraft(seed);
      closeMessageActions();
    },
    [closeMessageActions, openInfo]
  );

  const cancelInlineEdit = React.useCallback(() => {
    setInlineEditTargetId(null);
    setInlineEditDraft('');
  }, []);

  const hiddenKey = React.useMemo(() => {
    const who = myUserId || normalizeUser(displayName || 'anon');
    return `chat:hidden:${who}:${activeConversationId || 'global'}`;
  }, [myUserId, displayName, activeConversationId, normalizeUser]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(hiddenKey);
        if (cancelled) return;
        if (!raw) {
          setHiddenMessageIds({});
          return;
        }
        const arr = JSON.parse(raw);
        const map: Record<string, true> = {};
        if (Array.isArray(arr)) {
          for (const id of arr) {
            if (typeof id === 'string') map[id] = true;
          }
        }
        setHiddenMessageIds(map);
      } catch {
        if (!cancelled) setHiddenMessageIds({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hiddenKey]);

  const deleteForMe = React.useCallback(
    async (msg: ChatMessage) => {
      if (!msg?.id) return;
      setHiddenMessageIds((prev) => ({ ...prev, [msg.id]: true }));
      try {
        const nextIds = Object.keys({ ...hiddenMessageIds, [msg.id]: true }).slice(0, 500);
        await AsyncStorage.setItem(hiddenKey, JSON.stringify(nextIds));
      } catch {
        // ignore
      }
    },
    [hiddenKey, hiddenMessageIds]
  );


  const commitInlineEdit = React.useCallback(async () => {
    const targetId = inlineEditTargetId;
    if (!targetId) return;
    const target = messages.find((m) => m.id === targetId);
    if (!target) {
      cancelInlineEdit();
      return;
    }
    if (target.deletedAt) {
      cancelInlineEdit();
      return;
    }
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError('Not connected');
      return;
    }
    const nextText = inlineEditDraft.trim();
    if (!nextText) return;

    let outgoingText = nextText;
    const needsEncryption = isDm && !!target.encrypted;
    if (needsEncryption) {
      if (!myPrivateKey || !peerPublicKey) {
        Alert.alert('Encryption not ready', 'Missing keys for editing.');
        return;
      }
      const enc = encryptChatMessageV1(nextText, myPrivateKey, peerPublicKey);
      outgoingText = JSON.stringify(enc);
    }

    try {
      wsRef.current.send(
        JSON.stringify({
          action: 'edit',
          conversationId: activeConversationId,
          messageCreatedAt: target.createdAt,
          text: outgoingText,
          createdAt: Date.now(),
        })
      );
      const now = Date.now();
      setMessages((prev) =>
        prev.map((m) =>
          m.id === targetId
            ? {
                ...m,
                rawText: outgoingText,
                encrypted: parseEncrypted(outgoingText) ?? undefined,
                decryptedText: needsEncryption ? nextText : m.decryptedText,
                text: needsEncryption ? nextText : nextText,
                editedAt: now,
              }
            : m
        )
      );
      cancelInlineEdit();
    } catch (e: any) {
      Alert.alert('Edit failed', e?.message ?? 'Failed to edit message');
    }
  }, [
    inlineEditTargetId,
    inlineEditDraft,
    messages,
    cancelInlineEdit,
    activeConversationId,
    isDm,
    myPrivateKey,
    peerPublicKey,
  ]);

  const sendDelete = React.useCallback(async () => {
    const target = messageActionTarget;
    if (!target) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError('Not connected');
      return;
    }
    try {
      wsRef.current.send(
        JSON.stringify({
          action: 'delete',
          conversationId: activeConversationId,
          messageCreatedAt: target.createdAt,
          createdAt: Date.now(),
        })
      );
      // Optimistic local update
      const now = Date.now();
      setMessages((prev) =>
        prev.map((m) =>
          m.id === target.id
            ? {
                ...m,
                deletedAt: now,
                rawText: '',
                text: '',
                encrypted: undefined,
                decryptedText: undefined,
              }
            : m
        )
      );
      closeMessageActions();
    } catch (e: any) {
      Alert.alert('Delete failed', e?.message ?? 'Failed to delete message');
    }
  }, [messageActionTarget, activeConversationId, closeMessageActions]);

  const sendReaction = React.useCallback(
    (target: ChatMessage, emoji: string) => {
      if (!target) return;
      if (!emoji) return;
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      const all = target.reactions || {};
      let currentEmoji: string | null = null;
      if (myUserId) {
        for (const [e, info] of Object.entries(all)) {
          if (info?.userSubs?.includes(myUserId)) {
            currentEmoji = e;
            break;
          }
        }
      }
      const alreadySame = !!currentEmoji && currentEmoji === emoji;
      const op: 'add' | 'remove' = alreadySame ? 'remove' : 'add';

      // Optimistic UI: toggle locally immediately (best-effort).
      if (myUserId) {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.createdAt !== target.createdAt) return m;
            const next = { ...(m.reactions || {}) };

            // Remove my reaction from all emojis first (single-reaction model)
            for (const [e, info] of Object.entries(next)) {
              const subs = Array.isArray(info?.userSubs) ? info.userSubs : [];
              const filtered = subs.filter((s) => s !== myUserId);
              if (filtered.length === 0) delete next[e];
              else next[e] = { count: filtered.length, userSubs: filtered };
            }

            if (op === 'add') {
              const subs = next[emoji]?.userSubs ? [...next[emoji].userSubs] : [];
              if (!subs.includes(myUserId)) subs.push(myUserId);
              next[emoji] = { count: subs.length, userSubs: subs };
            }

            return { ...m, reactions: Object.keys(next).length ? next : undefined };
          })
        );
      }
      try {
        wsRef.current.send(
          JSON.stringify({
            action: 'react',
            conversationId: activeConversationId,
            messageCreatedAt: target.createdAt,
            emoji,
            op,
            createdAt: Date.now(),
          })
        );
      } catch {
        // ignore
      }
    },
    [activeConversationId, myUserId]
  );

  const openReactionPicker = React.useCallback((target: ChatMessage) => {
    setReactionPickerTarget(target);
    setReactionPickerOpen(true);
  }, []);

  const closeReactionPicker = React.useCallback(() => {
    setReactionPickerOpen(false);
    setReactionPickerTarget(null);
  }, []);

  const openReactionInfo = React.useCallback(
    async (target: ChatMessage, emoji: string, subs: string[]) => {
      setReactionInfoEmoji(emoji);
      setReactionInfoSubs(subs);
      setReactionInfoTarget(target);
      setReactionInfoOpen(true);

      // Best-effort: resolve names by sub when signed in.
      if (!API_URL) return;
      try {
        const { tokens } = await fetchAuthSession().catch(() => ({ tokens: undefined }));
        const idToken = tokens?.idToken?.toString();
        if (!idToken) return;
        const missing = subs.filter((s) => s && !nameBySub[s]);
        if (!missing.length) return;
        await Promise.all(
          missing.slice(0, 25).map(async (sub) => {
            try {
              const res = await fetch(
                `${API_URL.replace(/\/$/, '')}/users?sub=${encodeURIComponent(sub)}`,
                { headers: { Authorization: `Bearer ${idToken}` } }
              );
              if (!res.ok) return;
              const data = await res.json().catch(() => null);
              const display =
                (data && (data.displayName || data.preferred_username || data.username)) ? String(data.displayName || data.preferred_username || data.username) : '';
              if (display) {
                setNameBySub((prev) => ({ ...prev, [sub]: display }));
              }
            } catch {
              // ignore
            }
          })
        );
      } catch {
        // ignore
      }
    },
    [API_URL, nameBySub]
  );

  const formatSeenLabel = React.useCallback((readAtSec: number): string => {
    const dt = new Date(readAtSec * 1000);
    const now = new Date();
    const isToday =
      dt.getFullYear() === now.getFullYear() &&
      dt.getMonth() === now.getMonth() &&
      dt.getDate() === now.getDate();
    const time = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return isToday ? `Seen · ${time}` : `Seen · ${dt.toLocaleDateString()} · ${time}`;
  }, []);

  const getSeenLabelFor = React.useCallback(
    (map: Record<string, number>, messageCreatedAtMs: number): string | null => {
      const direct = map[String(messageCreatedAtMs)];
      if (direct) return formatSeenLabel(direct);
      return null;
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
    <SafeAreaView
      style={[styles.safe, isDark ? styles.safeDark : null]}
      edges={['left', 'right', 'bottom']}
    >
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.select({ ios: 'padding', android: undefined })}
      >
        <View style={[styles.header, isDark ? styles.headerDark : null]}>
          {headerTop ? <View style={styles.headerTopSlot}>{headerTop}</View> : null}
          <View style={styles.titleRow}>
            <Text style={[styles.title, isDark ? styles.titleDark : null]} numberOfLines={1}>
              {peer ? `DM with ${peer}` : 'Global Chat'}
            </Text>
            <Pressable
              style={[styles.summarizeBtn, isDark ? styles.summarizeBtnDark : null]}
              onPress={summarize}
            >
              <Text style={[styles.summarizeBtnText, isDark ? styles.summarizeBtnTextDark : null]}>
                Summarize Chat
              </Text>
            </Pressable>
          </View>
          <Text style={[styles.welcomeText, isDark ? styles.welcomeTextDark : null]}>{`Welcome ${displayName}!`}</Text>
          {isDm ? (
            <View style={styles.decryptRow}>
              <Text style={[styles.decryptLabel, isDark ? styles.decryptLabelDark : null]}>
                Auto-Decrypt
              </Text>
              <Switch
                value={autoDecrypt}
                onValueChange={setAutoDecrypt}
                disabled={!myPrivateKey}
                  trackColor={{
                    false: '#d1d1d6',
                    true: '#d1d1d6',
                  }}
                thumbColor={isDark ? '#2a2a33' : '#ffffff'}
                  ios_backgroundColor="#d1d1d6"
              />
            </View>
          ) : null}
          {isDm ? (
            <View style={styles.decryptRow}>
              <Text style={[styles.decryptLabel, isDark ? styles.decryptLabelDark : null]}>
                Self-Destructing Messages
              </Text>
              <Pressable
                style={[styles.ttlChip, isDark ? styles.ttlChipDark : null]}
                onPress={() => setTtlPickerOpen(true)}
              >
                <Text style={[styles.ttlChipText, isDark ? styles.ttlChipTextDark : null]}>
                  {TTL_OPTIONS[ttlIdx]?.label ?? 'Off'}
                </Text>
              </Pressable>
            </View>
          ) : null}
          {isConnecting ? (
            <View style={styles.statusRow}>
              <ActivityIndicator size="small" />
              <Text style={[styles.statusText, isDark ? styles.statusTextDark : null]}>
                Connecting…
              </Text>
            </View>
          ) : (
            <Text
              style={[
                styles.statusText,
                isDark ? styles.statusTextDark : null,
                isConnected ? styles.ok : styles.err,
              ]}
            >
              {isConnected ? 'Connected' : 'Disconnected'}
            </Text>
          )}
          {error ? (
            <Text style={[styles.error, isDark ? styles.errorDark : null]}>{error}</Text>
          ) : null}
        </View>
        <FlatList
          data={messages}
          keyExtractor={(m) => m.id}
          inverted
          // Perf tuning (especially on Android):
          removeClippedSubviews={Platform.OS === 'android'}
          initialNumToRender={18}
          maxToRenderPerBatch={12}
          updateCellsBatchingPeriod={50}
          windowSize={7}
          renderItem={({ item }) => {
            const timestamp = new Date(item.createdAt);
            const now = new Date();
            const isToday =
              timestamp.getFullYear() === now.getFullYear() &&
              timestamp.getMonth() === now.getMonth() &&
              timestamp.getDate() === now.getDate();
            const time = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const formatted = isToday ? time : `${timestamp.toLocaleDateString()} · ${time}`;
            const expiresIn =
              isDm && typeof item.expiresAt === 'number' ? item.expiresAt - nowSec : null;

          const isEncryptedOutgoing =
            !!item.encrypted && !!myPublicKey && item.encrypted.senderPublicKey === myPublicKey;
          const isPlainOutgoing =
            !item.encrypted &&
            (item.userSub && myUserId
              ? item.userSub === myUserId
              : normalizeUser(item.userLower ?? item.user ?? 'anon') === normalizeUser(displayName));
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
          const isDeleted = typeof item.deletedAt === 'number' && Number.isFinite(item.deletedAt);
          const displayText = isDeleted ? 'This message has been deleted' : captionText;
          const isEdited = !isDeleted && typeof item.editedAt === 'number' && Number.isFinite(item.editedAt);
          const reactionEntries = item.reactions
            ? Object.entries(item.reactions)
                .map(([emoji, info]) => ({ emoji, count: info?.count ?? 0, userSubs: info?.userSubs ?? [] }))
                .filter((r) => r.emoji && r.count > 0)
                .sort((a, b) => b.count - a.count)
            : [];
          const media = envelope?.media ?? item.media;
          const mediaUrl = media?.path ? mediaUrlByPath[media.path] : null;
          const mediaThumbUrl = media?.thumbPath ? mediaUrlByPath[media.thumbPath] : null;
          const dmThumbUri =
            isDm && media?.thumbPath ? dmThumbUriByPath[media.thumbPath] : null;
          const displayThumbUri = isDm ? dmThumbUri : (mediaThumbUrl || mediaUrl);
          const mediaLooksImage =
            !!media &&
            (media.kind === 'image' ||
              (media.kind === 'file' && (media.contentType || '').startsWith('image/')));
          const mediaLooksVideo =
            !!media &&
            (media.kind === 'video' ||
              (media.kind === 'file' && (media.contentType || '').startsWith('video/')));
          // IMPORTANT: if the message is still encrypted (not decrypted yet),
          // always render it as a normal encrypted-text bubble so media placeholders
          // don't appear larger than encrypted text placeholders.
          const hasMedia = !!media?.path && (!item.encrypted || !!item.decryptedText);
          const imageKeyPath = mediaLooksImage ? (media?.thumbPath || media?.path) : undefined;
          const imageAspect =
            imageKeyPath && imageAspectByPath[imageKeyPath] ? imageAspectByPath[imageKeyPath] : undefined;
          const thumbKeyPath =
            mediaLooksImage || mediaLooksVideo ? (media?.thumbPath || media?.path) : undefined;
          const thumbAspect =
            thumbKeyPath && imageAspectByPath[thumbKeyPath] ? imageAspectByPath[thumbKeyPath] : undefined;
          const capped = getCappedMediaSize(thumbAspect);
          const hideMetaUntilDecrypted = !!item.encrypted && !item.decryptedText;
          const canReact = !isDeleted && (!item.encrypted || !!item.decryptedText);
          const reactionEntriesVisible = canReact ? reactionEntries : [];
          const metaPrefix =
            hideMetaUntilDecrypted || isOutgoing ? '' : `${item.user ?? 'anon'} · `;
          const metaLine = hideMetaUntilDecrypted
            ? ''
            : `${metaPrefix}${formatted}${
            expiresIn != null ? ` · disappears in ${formatRemaining(expiresIn)}` : ''
          }`;

            return (           
              <Pressable
                onPress={() => {
                  if (inlineEditTargetId && item.id === inlineEditTargetId) return;
                  onPressMessage(item);
                }}
                onLongPress={(e) => {
                  if (isDeleted) return;
                  openMessageActions(item, {
                    x: (e?.nativeEvent as any)?.pageX ?? 0,
                    y: (e?.nativeEvent as any)?.pageY ?? 0,
                  });
                }}
              >
                <View
                  style={[
                    styles.messageRow,
                    isOutgoing ? styles.messageRowOutgoing : styles.messageRowIncoming,
                  ]}
                >
                  {hasMedia && !isDeleted ? (
                    <View
                      style={[
                        styles.mediaMsg,
                        isOutgoing ? styles.mediaMsgOutgoing : styles.mediaMsgIncoming,
                      ]}
                    >
                      <View
                        style={[
                          styles.mediaCard,
                          isOutgoing
                            ? styles.mediaCardOutgoing
                            : isDark
                              ? styles.mediaCardIncomingDark
                              : styles.mediaCardIncoming,
                          { width: capped.w },
                        ]}
                      >
                        <View
                          style={[
                            styles.mediaHeader,
                            isOutgoing
                              ? styles.mediaHeaderOutgoing
                              : isDark
                                ? styles.mediaHeaderIncomingDark
                                : styles.mediaHeaderIncoming,
                          ]}
                        >
                          {metaLine ? (
                          <Text
                            style={[
                              styles.mediaHeaderMeta,
                              isOutgoing
                                ? styles.mediaHeaderMetaOutgoing
                                : isDark
                                  ? styles.mediaHeaderMetaIncomingDark
                                  : styles.mediaHeaderMetaIncoming,
                            ]}
                          >
                            {metaLine}
                          </Text>
                          ) : null}
                          {captionText?.length ? (
                            <Text
                              style={[
                                styles.mediaHeaderCaption,
                                isOutgoing
                                  ? styles.mediaHeaderCaptionOutgoing
                                  : isDark
                                    ? styles.mediaHeaderCaptionIncomingDark
                                    : styles.mediaHeaderCaptionIncoming,
                              ]}
                            >
                              {captionText}
                            </Text>
                          ) : null}
                        </View>
                        {media?.path ? (
                          displayThumbUri && mediaLooksImage ? (
                            <Pressable
                              onPress={() => {
                                if (isDm) void openDmMediaViewer(item);
                                else openViewer(media as any);
                              }}
                            >
                              {typeof thumbAspect === 'number' ? (
                                <Image
                                  source={{ uri: displayThumbUri }}
                                  style={[styles.mediaCappedImage, { width: capped.w, height: capped.h }]}
                                  // No crop: we size the view to the image aspect ratio.
                                  resizeMode="contain"
                                />
                              ) : (
                                <View style={styles.imageThumbWrap}>
                                  <Image
                                    source={{ uri: displayThumbUri }}
                                    style={styles.mediaFill}
                                    // Fallback while we haven't measured aspect ratio yet.
                                    resizeMode="contain"
                                  />
                                </View>
                              )}
                            </Pressable>
                          ) : displayThumbUri && mediaLooksVideo ? (
                            <Pressable
                              onPress={() => {
                                if (isDm) void openDmMediaViewer(item);
                                else openViewer(media as any);
                              }}
                            >
                              <View style={[styles.videoThumbWrap, { width: capped.w, height: capped.h }]}>
                                <Image
                                  source={{ uri: displayThumbUri }}
                                  style={[styles.mediaFill]}
                                  resizeMode="cover"
                                />
                                <View style={styles.videoPlayOverlay}>
                                  <Text style={styles.videoPlayText}>▶</Text>
                                </View>
                              </View>
                            </Pressable>
                          ) : !isDm && (mediaLooksImage || mediaLooksVideo) ? (
                            // If the thumbnail URL isn't resolved yet, show a compact loading placeholder
                            // (instead of exposing the attachment link text).
                            (() => {
                              const keyPath = (media as any)?.thumbPath || (media as any)?.path;
                              const isResolving =
                                !storageSessionReady ||
                                (keyPath && inFlightMediaUrlRef.current.has(String(keyPath)));
                              if (!isResolving) return null;
                              const textColor = isDark ? '#b7b7c2' : '#555';
                              return (
                                <Pressable
                                  onPress={() => void openMedia(media.path)}
                                  accessibilityRole="button"
                                  accessibilityLabel="Open media"
                                >
                                  <View
                                    style={[
                                      styles.imageThumbWrap,
                                      {
                                        width: capped.w,
                                        height: capped.h,
                                        justifyContent: 'center',
                                        alignItems: 'center',
                                      },
                                    ]}
                                  >
                                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                      <Text style={{ color: textColor, fontWeight: '700', fontSize: 14 }}>Loading</Text>
                                      <AnimatedDots color={textColor} size={16} />
                                    </View>
                                  </View>
                                </Pressable>
                              );
                            })()
                          ) : isDm && mediaLooksImage ? (
                            <Pressable onPress={() => void openDmMediaViewer(item)}>
                              <View style={[styles.imageThumbWrap, { width: capped.w, height: capped.h }]}>
                                <View style={[styles.mediaFill, { backgroundColor: '#ddd' }]} />
                                <View style={styles.videoPlayOverlay}>
                                  <Text style={[styles.attachmentLink, { color: '#555', textDecorationLine: 'none' }]}>
                                    Encrypted media
                                  </Text>
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

                        {reactionEntriesVisible.length ? (
                          <View
                            style={[
                              styles.reactionOverlay,
                              isOutgoing ? styles.reactionOverlayOutgoing : styles.reactionOverlayIncoming,
                            ]}
                            pointerEvents="box-none"
                          >
                            {reactionEntriesVisible.slice(0, 3).map((r, idx) => {
                              const mine = myUserId ? r.userSubs.includes(myUserId) : false;
                              return (
                                <Pressable
                                  key={`ov:${item.id}:${r.emoji}`}
                                  onPress={() => void openReactionInfo(item, r.emoji, r.userSubs)}
                                  onLongPress={() => sendReaction(item, r.emoji)}
                                  disabled={!canReact}
                                  style={({ pressed }) => [
                                    styles.reactionMiniChip,
                                    isDark ? styles.reactionMiniChipDark : null,
                                    mine ? (isDark ? styles.reactionMiniChipMineDark : styles.reactionMiniChipMine) : null,
                                    idx ? styles.reactionMiniChipStacked : null,
                                    pressed ? { opacity: 0.85 } : null,
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.reactionMiniText,
                                      isDark ? styles.reactionMiniTextDark : null,
                                    ]}
                                  >
                                    {r.emoji}
                                    {r.count > 1 ? ` ${r.count}` : ''}
                                  </Text>
                                </Pressable>
                              );
                            })}
                          </View>
                        ) : null}
                      </View>

                      {seenLabel ? (
                        <Text
                          style={[
                            styles.seenText,
                            isOutgoing
                              ? (isDark ? styles.seenTextOutgoing : styles.seenTextOutgoingOnLightSurface)
                              : styles.seenTextIncoming,
                            isOutgoing ? styles.seenTextAlignOutgoing : styles.seenTextAlignIncoming,
                          ]}
                        >
                          {seenLabel}
                        </Text>
                      ) : null}
                    </View>
                  ) : (
                    <View
                      style={[
                        styles.messageBubble,
                        isOutgoing
                          ? styles.messageBubbleOutgoing
                          : isDark
                            ? styles.messageBubbleIncomingDark
                            : styles.messageBubbleIncoming,
                        inlineEditTargetId && item.id === inlineEditTargetId ? styles.messageBubbleEditing : null,
                      ]}
                    >
                      {metaLine ? (
                      <Text
                        style={[
                          styles.messageMeta,
                          isOutgoing
                            ? styles.messageMetaOutgoing
                            : isDark
                              ? styles.messageMetaIncomingDark
                              : styles.messageMetaIncoming,
                        ]}
                      >
                        {metaLine}
                      </Text>
                      ) : null}
                      {displayText?.length ? (
                        <View
                          style={[
                            styles.messageTextRow,
                            isOutgoing ? styles.messageTextRowOutgoing : null,
                          ]}
                        >
                          {inlineEditTargetId && item.id === inlineEditTargetId && !isDeleted ? (
                            <View style={styles.inlineEditWrap}>
                              <TextInput
                                style={[
                                  styles.inlineEditInput,
                                  isOutgoing ? styles.inlineEditInputOutgoing : styles.inlineEditInputIncoming,
                                ]}
                                value={inlineEditDraft}
                                onChangeText={setInlineEditDraft}
                                multiline
                                autoFocus
                                selectionColor={
                                  isOutgoing ? 'rgba(255,255,255,0.95)' : isDark ? '#ffffff' : '#111'
                                }
                                cursorColor={
                                  isOutgoing ? 'rgba(255,255,255,0.95)' : isDark ? '#ffffff' : '#111'
                                }
                              />
                              <View style={styles.inlineEditActions}>
                                <Pressable
                                  onPress={() => void commitInlineEdit()}
                                  style={({ pressed }) => [
                                    styles.inlineEditBtn,
                                    pressed ? styles.inlineEditBtnPressed : null,
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.inlineEditBtnText,
                                      isOutgoing ? styles.inlineEditBtnTextOutgoing : styles.inlineEditBtnTextIncoming,
                                    ]}
                                  >
                                    Save
                                  </Text>
                                </Pressable>
                                <Pressable
                                  onPress={cancelInlineEdit}
                                  style={({ pressed }) => [
                                    styles.inlineEditBtn,
                                    pressed ? styles.inlineEditBtnPressed : null,
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.inlineEditBtnText,
                                      isOutgoing ? styles.inlineEditBtnTextOutgoing : styles.inlineEditBtnTextIncoming,
                                    ]}
                                  >
                                    Cancel
                                  </Text>
                                </Pressable>
                              </View>
                            </View>
                          ) : (
                        <Text
                          style={[
                            styles.messageText,
                            isOutgoing
                              ? styles.messageTextOutgoing
                              : isDark
                                ? styles.messageTextIncomingDark
                                : styles.messageTextIncoming,
                                styles.messageTextFlex,
                                isDeleted ? styles.deletedText : null,
                          ]}
                        >
                              {displayText}
                            </Text>
                          )}
                          {isEdited ? (
                            <Text
                              style={[
                                styles.editedLabel,
                                isOutgoing
                                  ? (isDark ? styles.editedLabelOutgoingDark : styles.editedLabelOutgoing)
                                  : (isDark ? styles.editedLabelIncomingDark : styles.editedLabelIncoming),
                              ]}
                            >
                              {' '}
                              Edited
                        </Text>
                          ) : null}
                          {isOutgoing &&
                          !seenLabel &&
                          item.localStatus !== 'failed' &&
                          item.id === latestOutgoingMessageId ? (
                            <Text
                              style={[
                                styles.sendStatusInline,
                                isOutgoing
                                  ? (isDark ? styles.sendStatusInlineOutgoingDark : styles.sendStatusInlineOutgoing)
                                  : (isDark ? styles.sendStatusInlineIncomingDark : styles.sendStatusInlineIncoming),
                              ]}
                            >
                              {item.localStatus === 'sending' ? '…' : '✓'}
                            </Text>
                          ) : null}
                        </View>
                      ) : null}
                      {isOutgoing && item.localStatus === 'failed' ? (
                        <Pressable
                          onPress={() => retryFailedMessage(item)}
                          accessibilityRole="button"
                          accessibilityLabel="Retry sending message"
                        >
                          <Text
                            style={[
                              styles.sendFailedText,
                              isDark ? styles.sendFailedTextDark : null,
                              isOutgoing ? styles.sendFailedTextAlignOutgoing : null,
                            ]}
                          >
                            Failed · tap to retry
                          </Text>
                        </Pressable>
                      ) : null}
                      {seenLabel ? (
                        <Text
                          style={[
                            styles.seenText,
                            isOutgoing ? styles.seenTextOutgoing : styles.seenTextIncoming,
                            isOutgoing ? styles.seenTextAlignOutgoing : styles.seenTextAlignIncoming,
                          ]}
                        >
                          {seenLabel}
                        </Text>
                      ) : null}

                      {reactionEntriesVisible.length ? (
                        <View
                          style={[
                            styles.reactionOverlay,
                            isOutgoing ? styles.reactionOverlayOutgoing : styles.reactionOverlayIncoming,
                          ]}
                          pointerEvents="box-none"
                        >
                          {reactionEntriesVisible.slice(0, 3).map((r, idx) => {
                            const mine = myUserId ? r.userSubs.includes(myUserId) : false;
                            return (
                              <Pressable
                                key={`ov:${item.id}:${r.emoji}`}
                                onPress={() => void openReactionInfo(item, r.emoji, r.userSubs)}
                                onLongPress={() => sendReaction(item, r.emoji)}
                                disabled={!canReact}
                                style={({ pressed }) => [
                                  styles.reactionMiniChip,
                                  isDark ? styles.reactionMiniChipDark : null,
                                  mine ? (isDark ? styles.reactionMiniChipMineDark : styles.reactionMiniChipMine) : null,
                                  idx ? styles.reactionMiniChipStacked : null,
                                  pressed ? { opacity: 0.85 } : null,
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.reactionMiniText,
                                    isDark ? styles.reactionMiniTextDark : null,
                                  ]}
                                >
                                  {r.emoji}
                                  {r.count > 1 ? ` ${r.count}` : ''}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      ) : null}
                    </View>
                  )}
                </View>
              </Pressable>
            );
          }}
          contentContainerStyle={styles.listContent}
        />
        {pendingMedia ? (
          <Pressable
            style={[styles.attachmentPill, isDark ? styles.attachmentPillDark : null]}
            onPress={() => setPendingMedia(null)}
            disabled={isUploading}
          >
            <Text style={[styles.attachmentPillText, isDark ? styles.attachmentPillTextDark : null]}>
              {`Attached: ${pendingMedia.fileName || pendingMedia.kind} (tap to remove)`}
            </Text>
          </Pressable>
        ) : null}
        {typingIndicatorText ? (
          <View style={styles.typingRow}>
            <TypingIndicator
              text={typingIndicatorText}
              color={isDark ? styles.typingTextDark.color : styles.typingText.color}
            />
          </View>
        ) : null}
        {/* Inline edit happens inside the bubble (Signal-style). */}
        <View style={[styles.inputRow, isDark ? styles.inputRowDark : null]}>
          <Pressable
            style={[
              styles.pickBtn,
              isDark ? styles.pickBtnDark : null,
              isUploading ? (isDark ? styles.btnDisabledDark : styles.btnDisabled) : null,
            ]}
            onPress={handlePickMedia}
            disabled={isUploading}
          >
            <Text style={[styles.pickTxt, isDark ? styles.pickTxtDark : null]}>＋</Text>
          </Pressable>
          <TextInput
            ref={(r) => {
              textInputRef.current = r;
            }}
            key={`chat-input-${inputEpoch}`}
            style={[styles.input, isDark ? styles.inputDark : null]}
            placeholder={pendingMedia ? 'Add a caption (optional)…' : 'Type a message'}
            placeholderTextColor={isDark ? '#8f8fa3' : '#999'}
            selectionColor={isDark ? '#ffffff' : '#111'}
            cursorColor={isDark ? '#ffffff' : '#111'}
            value={input}
            onChangeText={onChangeInput}
            onBlur={() => {
              if (isTypingRef.current) sendTyping(false);
            }}
            onSubmitEditing={sendMessage}
            returnKeyType="send"
          />
          <Pressable
            style={[
              styles.sendBtn,
              isDark ? styles.sendBtnDark : null,
              isUploading ? (isDark ? styles.btnDisabledDark : styles.btnDisabled) : null,
            ]}
            onPress={sendMessage}
            disabled={isUploading}
          >
            <Text style={[styles.sendTxt, isDark ? styles.sendTxtDark : null]}>
              {isUploading ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                  <Text style={{ color: '#fff', fontWeight: '800' }}>Uploading</Text>
                  <AnimatedDots color="#fff" size={18} />
                </View>
              ) : (
                'Send'
              )}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
      <Modal visible={summaryOpen} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.summaryModal, isDark ? styles.summaryModalDark : null]}>
            <Text style={[styles.summaryTitle, isDark ? styles.summaryTitleDark : null]}>Summary</Text>
            {summaryLoading ? (
              <View style={styles.summaryLoadingRow}>
                <ActivityIndicator />
                <Text style={[styles.summaryLoadingText, isDark ? styles.summaryTextDark : null]}>
                  Summarizing…
                </Text>
              </View>
            ) : (
              <ScrollView style={styles.summaryScroll}>
                <Text style={[styles.summaryText, isDark ? styles.summaryTextDark : null]}>
                  {summaryText.length ? summaryText : 'No summary returned.'}
                </Text>
              </ScrollView>
            )}
            <View style={styles.summaryButtons}>
              <Pressable
                style={[styles.toolBtn, isDark ? styles.toolBtnDark : null]}
                onPress={() => {
                  setSummaryOpen(false);
                  setSummaryText('');
                }}
              >
                <Text style={[styles.toolBtnText, isDark ? styles.toolBtnTextDark : null]}>
                  Close
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={messageActionOpen} transparent animationType="fade">
        <View style={styles.actionMenuOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeMessageActions} />
          <Animated.View
            style={[
              styles.actionMenuCard,
              isDark ? styles.actionMenuCardDark : null,
              (() => {
                const w = Dimensions.get('window').width;
                const h = Dimensions.get('window').height;
                const cardW = Math.min(w - 36, 360);
                const left = Math.max(18, (w - cardW) / 2);
                const anchorY = messageActionAnchor?.y ?? h / 2;
                const desiredTop = anchorY - 160;
                const top = Math.max(22, Math.min(h - 360, desiredTop));
                return { position: 'absolute', width: cardW, left, top };
              })(),
              {
                opacity: actionMenuAnim,
                transform: [
                  {
                    scale: actionMenuAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.98, 1],
                    }),
                  },
                  {
                    translateY: actionMenuAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [
                        (messageActionAnchor?.y ?? 0) > Dimensions.get('window').height / 2 ? 10 : -10,
                        0,
                      ],
                    }),
                  },
                ],
              },
            ]}
          >
            {/* Message preview (Signal-style) */}
            {messageActionTarget ? (
              <View style={[styles.actionMenuPreviewRow, isDark ? styles.actionMenuPreviewRowDark : null]}>
                <View style={[styles.messageBubble, styles.messageBubbleOutgoing]}>
                  <Text style={[styles.messageText, styles.messageTextOutgoing]}>
                    {messageActionTarget.deletedAt
                      ? 'This message has been deleted'
                      : messageActionTarget.encrypted
                        ? (messageActionTarget.decryptedText || ENCRYPTED_PLACEHOLDER)
                        : (messageActionTarget.rawText ?? messageActionTarget.text)}
                  </Text>
                </View>
              </View>
            ) : null}

            <View style={styles.actionMenuOptions}>
              {/* Reactions */}
              {messageActionTarget &&
              !messageActionTarget.deletedAt &&
              (!messageActionTarget.encrypted || !!messageActionTarget.decryptedText) ? (
                <View style={styles.reactionQuickRow}>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.reactionQuickScrollContent}
                  >
                    {QUICK_REACTIONS.map((emoji) => {
                      const mine = myUserId
                        ? (messageActionTarget.reactions?.[emoji]?.userSubs || []).includes(myUserId)
                        : false;
                      return (
                        <Pressable
                          key={`quick:${emoji}`}
                          onPress={() => {
                            sendReaction(messageActionTarget, emoji);
                            closeMessageActions();
                          }}
                          style={({ pressed }) => [
                            styles.reactionQuickBtn,
                            isDark ? styles.reactionQuickBtnDark : null,
                            mine ? (isDark ? styles.reactionQuickBtnMineDark : styles.reactionQuickBtnMine) : null,
                            pressed ? { opacity: 0.85 } : null,
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel={`React ${emoji}`}
                        >
                          <Text style={styles.reactionQuickEmoji}>{emoji}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>

                  <Pressable
                    onPress={() => {
                      openReactionPicker(messageActionTarget);
                      closeMessageActions();
                    }}
                    style={({ pressed }) => [
                      styles.reactionQuickMore,
                      isDark ? styles.reactionQuickMoreDark : null,
                      pressed ? { opacity: 0.85 } : null,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="More reactions"
                  >
                    <Text style={[styles.reactionQuickMoreText, isDark ? styles.reactionQuickMoreTextDark : null]}>
                      …
                    </Text>
                  </Pressable>
                </View>
              ) : null}

              {messageActionTarget?.encrypted ? (
                <Pressable
                  onPress={() => {
                    setCipherText(messageActionTarget?.rawText ?? '');
                    setCipherOpen(true);
                    closeMessageActions();
                  }}
                  style={({ pressed }) => [
                    styles.actionMenuRow,
                    pressed ? styles.actionMenuRowPressed : null,
                  ]}
                >
                  <Text style={[styles.actionMenuText, isDark ? styles.actionMenuTextDark : null]}>
                    View Ciphertext
                  </Text>
                </Pressable>
              ) : null}

              {(() => {
                const t = messageActionTarget;
                if (!t) return null;
                const isEncryptedOutgoing =
                  !!t.encrypted && !!myPublicKey && t.encrypted.senderPublicKey === myPublicKey;
                const isPlainOutgoing =
                  !t.encrypted &&
                  (t.userSub && myUserId
                    ? t.userSub === myUserId
                    : normalizeUser(t.userLower ?? t.user ?? 'anon') === normalizeUser(displayName));
                const canEdit = isEncryptedOutgoing || isPlainOutgoing;
                if (!canEdit) return null;
                return (
                  <Pressable
                    onPress={() => {
                      beginInlineEdit(t);
                    }}
                    style={({ pressed }) => [styles.actionMenuRow, pressed ? styles.actionMenuRowPressed : null]}
                  >
                    <Text style={[styles.actionMenuText, isDark ? styles.actionMenuTextDark : null]}>Edit</Text>
                  </Pressable>
                );
              })()}

              <Pressable
                onPress={() => {
                  if (!messageActionTarget) return;
                  void deleteForMe(messageActionTarget);
                  closeMessageActions();
                }}
                style={({ pressed }) => [styles.actionMenuRow, pressed ? styles.actionMenuRowPressed : null]}
              >
                <Text style={[styles.actionMenuText, isDark ? styles.actionMenuTextDark : null]}>
                  Delete for me
                </Text>
              </Pressable>

              {(() => {
                const t = messageActionTarget;
                if (!t) return null;
                const isEncryptedOutgoing =
                  !!t.encrypted && !!myPublicKey && t.encrypted.senderPublicKey === myPublicKey;
                const isPlainOutgoing =
                  !t.encrypted &&
                  (t.userSub && myUserId
                    ? t.userSub === myUserId
                    : normalizeUser(t.userLower ?? t.user ?? 'anon') === normalizeUser(displayName));
                const canDeleteForEveryone = isEncryptedOutgoing || isPlainOutgoing;
                if (!canDeleteForEveryone) return null;
                return (
                  <Pressable
                    onPress={() => {
                      void sendDelete();
                      closeMessageActions();
                    }}
                    style={({ pressed }) => [styles.actionMenuRow, pressed ? styles.actionMenuRowPressed : null]}
                  >
                    <Text style={[styles.actionMenuText, isDark ? styles.actionMenuTextDark : null]}>
                      Delete for everyone
                    </Text>
                  </Pressable>
                );
              })()}
            </View>
          </Animated.View>
        </View>
      </Modal>

      <Modal visible={reactionPickerOpen} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeReactionPicker} />
          <View style={[styles.summaryModal, isDark ? styles.summaryModalDark : null]}>
            <Text style={[styles.summaryTitle, isDark ? styles.summaryTitleDark : null]}>
              React
            </Text>
            <ScrollView style={styles.summaryScroll} contentContainerStyle={styles.reactionPickerGrid}>
              {MORE_REACTIONS.map((emoji) => {
                const target = reactionPickerTarget;
                const mine = target && myUserId
                  ? (target.reactions?.[emoji]?.userSubs || []).includes(myUserId)
                  : false;
                return (
                  <Pressable
                    key={`more:${emoji}`}
                    onPress={() => {
                      if (reactionPickerTarget) sendReaction(reactionPickerTarget, emoji);
                      closeReactionPicker();
                    }}
                    style={({ pressed }) => [
                      styles.reactionPickerBtn,
                      isDark ? styles.reactionPickerBtnDark : null,
                      mine ? (isDark ? styles.reactionPickerBtnMineDark : styles.reactionPickerBtnMine) : null,
                      pressed ? { opacity: 0.85 } : null,
                    ]}
                  >
                    <Text style={styles.reactionPickerEmoji}>{emoji}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <View style={styles.summaryButtons}>
              <Pressable
                style={[styles.toolBtn, isDark ? styles.toolBtnDark : null]}
                onPress={closeReactionPicker}
              >
                <Text style={[styles.toolBtnText, isDark ? styles.toolBtnTextDark : null]}>
                  Close
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={cipherOpen} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.summaryModal, isDark ? styles.summaryModalDark : null]}>
            <Text style={[styles.summaryTitle, isDark ? styles.summaryTitleDark : null]}>
              Encrypted payload
            </Text>
            <ScrollView style={styles.summaryScroll}>
              <Text style={[styles.summaryText, isDark ? styles.summaryTextDark : null]}>
                {cipherText || '(empty)'}
              </Text>
            </ScrollView>
            <View style={styles.summaryButtons}>
              <Pressable
                style={[styles.toolBtn, isDark ? styles.toolBtnDark : null]}
                onPress={() => setCipherOpen(false)}
              >
                <Text style={[styles.toolBtnText, isDark ? styles.toolBtnTextDark : null]}>
                  Close
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={reactionInfoOpen} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.summaryModal, isDark ? styles.summaryModalDark : null]}>
            <Text style={[styles.summaryTitle, isDark ? styles.summaryTitleDark : null]}>
              Reactions {reactionInfoEmoji ? `· ${reactionInfoEmoji}` : ''}
            </Text>
            <ScrollView style={styles.summaryScroll}>
              {reactionInfoSubs.length ? (
                reactionInfoSubs.map((sub) => {
                  const isMe = !!myUserId && sub === myUserId;
                  const label = isMe
                    ? 'You'
                    : nameBySub[sub] || `${String(sub).slice(0, 6)}…${String(sub).slice(-4)}`;
                  return (
                    <Pressable
                      key={sub}
                      onPress={() => {
                        // Signal-like: allow removing your reaction from the reaction list view.
                        if (!isMe) return;
                        if (!reactionInfoTarget || !reactionInfoEmoji) return;
                        sendReaction(reactionInfoTarget, reactionInfoEmoji);
                        setReactionInfoOpen(false);
                        setReactionInfoTarget(null);
                      }}
                      disabled={!isMe}
                      style={({ pressed }) => [pressed && isMe ? { opacity: 0.7 } : null]}
                      accessibilityRole={isMe ? 'button' : undefined}
                      accessibilityLabel={isMe ? 'Remove reaction' : undefined}
                    >
                      <Text
                        style={[
                          styles.summaryText,
                          isDark ? styles.summaryTextDark : null,
                          isMe ? { fontWeight: '800' } : null,
                        ]}
                      >
                        {label}
                      </Text>
                      {isMe ? (
                        <Text
                          style={[
                            styles.summaryText,
                            isDark ? styles.summaryTextDark : null,
                            { opacity: isDark ? 0.85 : 0.7, fontSize: 12, marginTop: 2, fontWeight: '700' },
                          ]}
                        >
                          Tap to remove
                        </Text>
                      ) : null}
                    </Pressable>
                  );
                })
              ) : (
                <Text style={[styles.summaryText, isDark ? styles.summaryTextDark : null]}>
                  No reactions.
                </Text>
              )}
            </ScrollView>
            <View style={styles.summaryButtons}>
              <Pressable
                style={[styles.toolBtn, isDark ? styles.toolBtnDark : null]}
                onPress={() => {
                  setReactionInfoOpen(false);
                  setReactionInfoTarget(null);
                }}
              >
                <Text style={[styles.toolBtnText, isDark ? styles.toolBtnTextDark : null]}>
                  Close
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={infoOpen} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.summaryModal, isDark ? styles.summaryModalDark : null]}>
            <Text style={[styles.summaryTitle, isDark ? styles.summaryTitleDark : null]}>{infoTitle}</Text>
            <Text style={[styles.summaryText, isDark ? styles.summaryTextDark : null]}>{infoBody}</Text>
            <View style={styles.summaryButtons}>
              <Pressable
                style={[styles.toolBtn, isDark ? styles.toolBtnDark : null]}
                onPress={() => setInfoOpen(false)}
              >
                <Text style={[styles.toolBtnText, isDark ? styles.toolBtnTextDark : null]}>OK</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>


      <Modal visible={ttlPickerOpen} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setTtlPickerOpen(false)} />
          <View style={[styles.summaryModal, isDark ? styles.summaryModalDark : null]}>
            <Text style={[styles.summaryTitle, isDark ? styles.summaryTitleDark : null]}>
              Self-Destructing Messages
            </Text>
            <Text style={[styles.summaryText, isDark ? styles.summaryTextDark : null]}>
              Messages will disappear after the selected time from when they are sent.
            </Text>
            <View style={{ height: 12 }} />
            {TTL_OPTIONS.map((opt, idx) => {
              const selected = idx === ttlIdx;
              return (
                <Pressable
                  key={opt.label}
                  style={[
                    styles.ttlOptionRow,
                    isDark ? styles.ttlOptionRowDark : null,
                    selected
                      ? (isDark ? styles.ttlOptionRowSelectedDark : styles.ttlOptionRowSelected)
                      : null,
                  ]}
                  onPress={() => {
                    setTtlIdx(idx);
                  }}
                >
                  <Text style={[styles.ttlOptionLabel, isDark ? styles.ttlOptionLabelDark : null]}>
                    {opt.label}
                  </Text>
                  <Text style={[styles.ttlOptionRadio, isDark ? styles.ttlOptionLabelDark : null]}>
                    {selected ? '◉' : '○'}
                  </Text>
                </Pressable>
              );
            })}
            <View style={styles.summaryButtons}>
              <Pressable
                style={[styles.toolBtn, isDark ? styles.toolBtnDark : null]}
                onPress={() => setTtlPickerOpen(false)}
              >
                <Text style={[styles.toolBtnText, isDark ? styles.toolBtnTextDark : null]}>
                  Done
                </Text>
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
  safeDark: { backgroundColor: '#0b0b0f' },
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e3e3e3',
    backgroundColor: '#fafafa',
  },
  headerDark: {
    backgroundColor: '#121218',
    borderBottomColor: '#2a2a33',
  },
  headerTopSlot: {
    marginBottom: 10,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  title: { fontSize: 20, fontWeight: '600', color: '#222' },
  titleDark: { color: '#fff' },
  welcomeText: { fontSize: 14, color: '#555', marginTop: 4, fontWeight: '700' },
  welcomeTextDark: { color: '#b7b7c2' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  statusText: { fontSize: 12, color: '#666', marginTop: 6 },
  statusTextDark: { color: '#a7a7b4' },
  decryptRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  decryptLabel: { fontSize: 12, color: '#555', fontWeight: '600' },
  decryptLabelDark: { color: '#b7b7c2' },
  ttlChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#eee',
  },
  ttlChipText: { fontSize: 12, color: '#333', fontWeight: '700' },
  ttlChipDark: {
    backgroundColor: '#2a2a33',
  },
  ttlChipTextDark: {
    color: '#fff',
  },
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
  ttlOptionRowDark: {
    backgroundColor: '#1c1c22',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2a2a33',
  },
  ttlOptionRowSelectedDark: {
    backgroundColor: '#2a2a33',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#3a3a46',
  },
  ttlOptionLabel: { color: '#222', fontWeight: '600' },
  ttlOptionRadio: { color: '#222', fontSize: 18, fontWeight: '800' },
  ttlOptionLabelDark: { color: '#fff' },
  summarizeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
  },
  summarizeBtnDark: {
    backgroundColor: '#2a2a33',
    borderWidth: 0,
    borderColor: 'transparent',
  },
  summarizeBtnText: { color: '#111', fontWeight: '700', fontSize: 13 },
  summarizeBtnTextDark: { color: '#fff' },
  // kept for other modals using the same visual language
  toolBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
  },
  toolBtnDark: {
    backgroundColor: '#2a2a33',
    borderWidth: 0,
    borderColor: 'transparent',
  },
  toolBtnText: { color: '#111', fontWeight: '700', fontSize: 13 },
  toolBtnTextDark: { color: '#fff' },
  ok: { color: '#2e7d32' },
  err: { color: '#b00020' },
  error: { color: '#b00020', marginTop: 6 },
  errorDark: { color: '#ff6b6b' },
  listContent: { padding: 12 },
  messageRow: {
    marginBottom: 8,
    flexDirection: 'row',
  },
  messageRowIncoming: { justifyContent: 'flex-start' },
  messageRowOutgoing: { justifyContent: 'flex-end' },
  messageBubble: {
    maxWidth: '82%',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
  },
  // Media thumbnails should be allowed to be much wider (like typical chat apps),
  // while keeping text-only bubbles tighter.
  // (legacy) media bubble styles removed in favor of mediaCard layout
  messageBubbleIncoming: { backgroundColor: '#f1f1f1' },
  messageBubbleIncomingDark: { backgroundColor: '#1c1c22' },
  messageBubbleOutgoing: { backgroundColor: '#1976d2' },
  messageBubbleEditing: { maxWidth: '96%', width: '96%' },
  sendFailedText: { marginTop: 6, fontSize: 12, color: '#b00020', fontStyle: 'italic' },
  sendFailedTextDark: { color: '#ff6b6b' },
  sendFailedTextAlignOutgoing: { textAlign: 'right' },
  messageTextRow: { flexDirection: 'row', alignItems: 'flex-end' },
  messageTextRowOutgoing: { justifyContent: 'flex-end' },
  messageTextFlex: { flexGrow: 1, flexShrink: 1 },
  sendStatusInline: { marginLeft: 6, fontSize: 12 },
  sendStatusInlineOutgoing: { color: 'rgba(255,255,255,0.9)' }, // readable on blue bubble (light mode)
  sendStatusInlineOutgoingDark: { color: 'rgba(255,255,255,0.85)' }, // readable on blue bubble (dark mode)
  sendStatusInlineIncoming: { color: '#555' }, // readable on light bubble
  sendStatusInlineIncomingDark: { color: '#a7a7b4' }, // readable on dark bubble

  editedLabel: { marginLeft: 6, fontSize: 12, fontStyle: 'italic' },
  editedLabelOutgoing: { color: 'rgba(255,255,255,0.9)' },
  editedLabelOutgoingDark: { color: 'rgba(255,255,255,0.85)' },
  editedLabelIncoming: { color: '#555' },
  editedLabelIncomingDark: { color: '#a7a7b4' },
  deletedText: { fontStyle: 'italic', opacity: 0.9 },
  inlineEditWrap: { flex: 1, width: '100%' },
  inlineEditInput: {
    fontSize: 16,
    paddingVertical: 0,
    paddingHorizontal: 0,
    marginTop: 1,
    fontWeight: '400',
  },
  inlineEditInputIncoming: { color: '#222' },
  inlineEditInputOutgoing: { color: '#fff' },
  inlineEditActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 8,
    width: '100%',
  },
  inlineEditBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.08)' },
  inlineEditBtnPressed: { opacity: 0.75 },
  inlineEditBtnText: { fontWeight: '700' },
  inlineEditBtnTextIncoming: { color: '#111' },
  inlineEditBtnTextOutgoing: { color: '#fff' },
  messageMeta: { fontSize: 12, marginBottom: 1, fontWeight: '700' },
  messageMetaIncoming: { color: '#555' },
  messageMetaIncomingDark: { color: '#b7b7c2' },
  messageMetaOutgoing: { color: 'rgba(255,255,255,0.9)', textAlign: 'right' },
  messageText: { fontSize: 16, marginTop: 1, fontWeight: '400' },
  messageTextIncoming: { color: '#222' },
  messageTextIncomingDark: { color: '#fff' },
  messageTextOutgoing: { color: '#fff' },
  attachmentLink: {
    marginTop: 6,
    fontSize: 13,
    color: '#1976d2',
    fontWeight: '400',
    textDecorationLine: 'underline',
  },
  mediaAlignIncoming: { alignSelf: 'flex-start' },
  mediaAlignOutgoing: { alignSelf: 'flex-end' },
  imagePreview: {
    marginTop: 8,
    width: '100%',
    borderRadius: 16,
    backgroundColor: '#e9e9e9',
  },
  imageThumbWrap: {
    width: '100%',
    height: 220,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    overflow: 'hidden',
    // For resizeMode="contain", let the parent `mediaCard` provide the background.
    // This avoids a visible dark seam between the header and the media in light mode.
    backgroundColor: 'transparent',
  },
  mediaAutoImage: {
    width: '100%',
    backgroundColor: 'transparent',
  },
  mediaCappedImage: {
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    // Let the parent provide letterbox background.
    backgroundColor: 'transparent',
  },
  mediaFrame: {
    marginTop: 8,
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
    // Match the message bubble background so "contain" letterboxing doesn't show as white.
    backgroundColor: '#000',
  },
  mediaFill: {
    width: '100%',
    height: '100%',
    backgroundColor: 'transparent',
  },
  mediaThumb: {
    width: '100%',
    height: 220,
    backgroundColor: '#000',
  },
  imageFrame: {
    // Prefer showing the entire image (no cropping). Slightly shorter so tall images don't dominate.
    height: 180,
  },
  videoThumbWrap: {
    width: '100%',
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  mediaMsg: {
    width: '96%',
  },
  mediaMsgIncoming: { alignItems: 'flex-start' },
  mediaMsgOutgoing: { alignItems: 'flex-end' },
  mediaCard: {
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
  },
  mediaCardIncoming: { backgroundColor: '#f1f1f1' },
  mediaCardIncomingDark: { backgroundColor: '#1c1c22' },
  // Outgoing media uses "contain" sometimes → avoid blue letterbox edges by using neutral bg.
  mediaCardOutgoing: { backgroundColor: '#000' },
  mediaHeader: {
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 4,
  },
  mediaHeaderIncoming: { backgroundColor: '#f1f1f1' },
  mediaHeaderIncomingDark: { backgroundColor: '#1c1c22' },
  mediaHeaderOutgoing: { backgroundColor: '#1976d2' },
  mediaHeaderMeta: { fontSize: 12, fontWeight: '700' },
  mediaHeaderMetaIncoming: { color: '#555' },
  mediaHeaderMetaIncomingDark: { color: '#b7b7c2' },
  mediaHeaderMetaOutgoing: { color: 'rgba(255,255,255,0.9)', textAlign: 'right' },
  mediaHeaderCaption: { marginTop: 4, fontSize: 16, fontWeight: '400' },
  mediaHeaderCaptionIncoming: { color: '#222' },
  mediaHeaderCaptionIncomingDark: { color: '#fff' },
  mediaHeaderCaptionOutgoing: { color: '#fff' },
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
    fontStyle: 'italic',
    fontWeight: '600',
  },
  seenTextAlignIncoming: { alignSelf: 'flex-start', textAlign: 'left' },
  seenTextAlignOutgoing: { alignSelf: 'flex-end', textAlign: 'right' },
  seenTextIncoming: { color: '#1976d2' },
  seenTextOutgoing: { color: 'rgba(255,255,255,0.9)' },
  // For outgoing MEDIA messages the seen label is rendered on the screen background (not inside the blue bubble),
  // so use a readable light-mode color.
  seenTextOutgoingOnLightSurface: { color: '#1976d2' },
  inputRow: {
    flexDirection: 'row',
    padding: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e3e3e3',
    backgroundColor: '#f2f2f7',
  },
  inputRowDark: {
    backgroundColor: '#1c1c22',
    borderTopColor: '#2a2a33',
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
  attachmentPillDark: {
    backgroundColor: '#1c1c22',
    borderColor: '#2a2a33',
  },
  attachmentPillTextDark: { color: '#fff' },
  pickBtn: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  pickBtnDark: {
    backgroundColor: '#2a2a33',
    borderWidth: 0,
    borderColor: 'transparent',
  },
  pickTxt: { color: '#111', fontWeight: '800', fontSize: 18, lineHeight: 18 },
  pickTxtDark: { color: '#fff' },
  input: {
    flex: 1,
    height: 44,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    backgroundColor: '#fff',
    color: '#111',
  },
  inputDark: {
    backgroundColor: '#14141a',
    borderColor: '#2a2a33',
    color: '#fff',
  },
  typingRow: {
    paddingHorizontal: 12,
    paddingBottom: 6,
  },
  editingBar: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f2f2f7',
  },
  editingBarDark: { backgroundColor: '#1c1c22' },
  editingBarText: { color: '#444', fontWeight: '600' },
  editingBarTextDark: { color: '#d7d7e0' },
  editingBarCancelBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: '#e6e6ef',
  },
  editingBarCancelText: { color: '#111', fontWeight: '700' },
  editingBarCancelTextDark: { color: '#fff' },
  typingIndicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  typingDotsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingLeft: 2,
  },
  typingText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '600',
    fontStyle: 'italic',
  },
  typingTextDark: {
    color: '#a7a7b4',
  },
  typingDot: {
    fontSize: 18,
    fontWeight: '900',
    lineHeight: 18,
  },
  sendBtn: {
    marginLeft: 8,
    height: 44,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
  },
  sendBtnDark: {
    backgroundColor: '#2a2a33',
    borderWidth: 0,
    borderColor: 'transparent',
  },
  sendTxt: { color: '#111', fontWeight: '700' },
  sendTxtDark: { color: '#fff' },
  btnDisabled: {
    backgroundColor: '#f2f2f7',
    borderColor: '#ddd',
    opacity: 0.8,
  },
  btnDisabledDark: {
    backgroundColor: '#444',
    borderWidth: 0,
    borderColor: 'transparent',
    opacity: 0.6,
  },

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
  summaryModalDark: { backgroundColor: '#14141a' },
  summaryTitleDark: { color: '#fff' },
  summaryTextDark: { color: '#d7d7e0' },
  actionMenuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  actionMenuCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  actionMenuCardDark: { backgroundColor: '#14141a' },
  actionMenuPreviewRow: { padding: 14, borderBottomWidth: 1, borderBottomColor: '#eee' },
  actionMenuPreviewRowDark: { borderBottomColor: '#2a2a33' },
  actionMenuOptions: { paddingVertical: 6 },
  reactionOverlay: {
    position: 'absolute',
    bottom: -12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  reactionOverlayIncoming: { left: 10 },
  reactionOverlayOutgoing: { right: 10, flexDirection: 'row-reverse' },
  reactionMiniChip: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e3e3e3',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  reactionMiniChipStacked: {
    marginLeft: -10,
  },
  reactionMiniChipDark: {
    backgroundColor: '#1c1c22',
    borderColor: '#2a2a33',
    shadowOpacity: 0,
    elevation: 0,
  },
  reactionMiniChipMine: {
    backgroundColor: 'rgba(25,118,210,0.12)',
    borderColor: 'rgba(25,118,210,0.35)',
  },
  reactionMiniChipMineDark: {
    backgroundColor: 'rgba(25,118,210,0.22)',
    borderColor: 'rgba(25,118,210,0.45)',
  },
  reactionMiniText: { color: '#111', fontWeight: '800', fontSize: 12 },
  reactionMiniTextDark: { color: '#fff' },

  reactionQuickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 10,
    paddingTop: 6,
    gap: 10,
  },
  reactionQuickScrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 6,
  },
  reactionQuickBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f2f2f7',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e3e3e3',
  },
  reactionQuickBtnDark: {
    backgroundColor: '#1c1c22',
    borderColor: '#2a2a33',
  },
  reactionQuickBtnMine: {
    backgroundColor: 'rgba(25,118,210,0.15)',
    borderColor: 'rgba(25,118,210,0.35)',
  },
  reactionQuickBtnMineDark: {
    backgroundColor: 'rgba(25,118,210,0.25)',
    borderColor: 'rgba(25,118,210,0.45)',
  },
  reactionQuickEmoji: { fontSize: 18 },
  reactionQuickMore: {
    height: 38,
    paddingHorizontal: 12,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e3e3e3',
  },
  reactionQuickMoreDark: {
    backgroundColor: '#1c1c22',
    borderColor: '#2a2a33',
  },
  reactionQuickMoreText: { color: '#111', fontWeight: '800' },
  reactionQuickMoreTextDark: { color: '#fff' },
  reactionPickerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingVertical: 10,
  },
  reactionPickerBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f2f2f7',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e3e3e3',
  },
  reactionPickerBtnDark: {
    backgroundColor: '#1c1c22',
    borderColor: '#2a2a33',
  },
  reactionPickerBtnMine: {
    backgroundColor: 'rgba(25,118,210,0.15)',
    borderColor: 'rgba(25,118,210,0.35)',
  },
  reactionPickerBtnMineDark: {
    backgroundColor: 'rgba(25,118,210,0.25)',
    borderColor: 'rgba(25,118,210,0.45)',
  },
  reactionPickerEmoji: { fontSize: 20 },
  actionMenuRow: { paddingHorizontal: 16, paddingVertical: 12 },
  actionMenuRowPressed: { opacity: 0.75 },
  actionMenuText: { fontSize: 16, color: '#111', fontWeight: '600' },
  actionMenuTextDark: { color: '#fff' },

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


