import { fetchAuthSession } from '@aws-amplify/auth';
import { useAuthenticator } from '@aws-amplify/ui-react-native/dist';
import { gcm } from '@noble/ciphers/aes.js';
import { hexToBytes } from '@noble/hashes/utils.js';
import { fromByteArray } from 'base64-js';
import { getRandomBytes } from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import React from 'react';
import type { AppStateStatus, TextInput } from 'react-native';
import { AppState, Keyboard, Platform, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AI_API_URL, API_URL, CDN_URL, WS_URL } from '../config/env';
import { applyOptimisticSendForTextOnly } from '../features/chat/applyOptimisticSend';
import {
  pendingMediaFromDocumentPickerAssets,
  pendingMediaFromImagePickerAssets,
  pendingMediaFromInAppCameraCapture,
} from '../features/chat/attachments';
import { useChatAudioPlaybackForRender } from '../features/chat/audioPlaybackForRender';
import {
  audioTitleFromFileName,
  buildAudioQueueFromMessages,
  isAudioContentType,
  makeAudioKey,
} from '../features/chat/audioPlaybackQueue';
import { buildChatScreenMainProps } from '../features/chat/buildChatScreenMainProps';
import { buildChatScreenOverlaysProps } from '../features/chat/buildChatScreenOverlaysProps';
import type { ResolvedChatBg } from '../features/chat/components/ChatBackgroundLayer';
import { ChatScreenMain } from '../features/chat/components/ChatScreenMain';
import { ChatScreenOverlays } from '../features/chat/components/ChatScreenOverlays';
import { TypingIndicator } from '../features/chat/components/TypingIndicator';
import { getCopyableMessageText } from '../features/chat/getCopyableMessageText';
import { isVisibleMemberRow, toMemberRow } from '../features/chat/memberRows';
import {
  normalizeChatMediaList,
  normalizeDmMediaItems,
  normalizeGroupMediaItems,
  normalizeReactions,
  parseChatEnvelope,
  parseDmMediaEnvelope,
  parseGroupMediaEnvelope,
} from '../features/chat/parsers';
// (history fetching extracted to useChatHistory)
import {
  encryptGroupOutgoingEncryptedText,
  prepareDmOutgoingEncryptedText,
  prepareGroupMediaPlaintext,
} from '../features/chat/prepareOutgoingEncryptedText';
import { MORE_REACTIONS, QUICK_REACTIONS } from '../features/chat/reactionEmojis';
import { sortReactionSubs } from '../features/chat/reactionsUi';
import { renderChatListItem } from '../features/chat/renderChatListItem';
import type { ChatMessage } from '../features/chat/types';
import { MAX_ATTACHMENTS_PER_MESSAGE } from '../features/chat/uploads';
import { useAiConsentGate } from '../features/chat/useAiConsentGate';
import { useAiHelper } from '../features/chat/useAiHelper';
import { useAiSummary } from '../features/chat/useAiSummary';
import { useChannelAboutModalActions } from '../features/chat/useChannelAboutModalActions';
import { useChannelMembersModalActions } from '../features/chat/useChannelMembersModalActions';
import { useChannelNameModalActions } from '../features/chat/useChannelNameModalActions';
import { useChannelPasswordModalActions } from '../features/chat/useChannelPasswordModalActions';
import { useChannelRoster } from '../features/chat/useChannelRoster';
import { useChannelSettingsPanelActions } from '../features/chat/useChannelSettingsPanelActions';
import { useChatAdminOps } from '../features/chat/useChatAdminOps';
import { useChatAttachmentPickers } from '../features/chat/useChatAttachmentPickers';
import { useChatAttachments } from '../features/chat/useChatAttachments';
import { useChatAudioPlayback } from '../features/chat/useChatAudioPlayback';
import { useChatAutoDecrypt } from '../features/chat/useChatAutoDecrypt';
import { useChatCdnMediaPrefetch } from '../features/chat/useChatCdnMediaPrefetch';
import { useChatChannelUiState } from '../features/chat/useChatChannelUiState';
import { useChatCipherState } from '../features/chat/useChatCipherState';
import { useChatComposerInput } from '../features/chat/useChatComposerInput';
import { useChatConversationJoin } from '../features/chat/useChatConversationJoin';
import { useChatCopyToClipboard } from '../features/chat/useChatCopyToClipboard';
import { useChatDecryptors } from '../features/chat/useChatDecryptors';
import { useChatEncryptedMediaViewer } from '../features/chat/useChatEncryptedMediaViewer';
import { useChatGroupUiState } from '../features/chat/useChatGroupUiState';
import { useChatHistory } from '../features/chat/useChatHistory';
import { useChatImageAspectPrefetch } from '../features/chat/useChatImageAspectPrefetch';
import { useChatInfoModal } from '../features/chat/useChatInfoModal';
import { useChatInlineEditActions } from '../features/chat/useChatInlineEditActions';
import { useChatKickActions } from '../features/chat/useChatKickActions';
import { useChatMediaDecryptCache } from '../features/chat/useChatMediaDecryptCache';
import { useChatMessageListState } from '../features/chat/useChatMessageListState';
import { useChatMessageOps } from '../features/chat/useChatMessageOps';
import { useChatMyKeys } from '../features/chat/useChatMyKeys';
import { useChatPressToDecrypt } from '../features/chat/useChatPressToDecrypt';
import { useChatReadReceipts } from '../features/chat/useChatReadReceipts';
import { useChatReplyActions } from '../features/chat/useChatReplyActions';
import { useChatReport } from '../features/chat/useChatReport';
import { useChatScreenRefSync } from '../features/chat/useChatScreenRefSync';
import { useChatSendActions } from '../features/chat/useChatSendActions';
import { useChatTtlPickerState } from '../features/chat/useChatTtlPickerState';
import { useChatTyping } from '../features/chat/useChatTyping';
import { useChatUploadHandlers } from '../features/chat/useChatUploadHandlers';
import { useChatWsConnection } from '../features/chat/useChatWsConnection';
import { useChatWsMessageHandler } from '../features/chat/useChatWsMessageHandler';
import { useDisplayNameBySub } from '../features/chat/useDisplayNameBySub';
import { useGroupMembersModalActions } from '../features/chat/useGroupMembersModalActions';
import { useGroupMembersUi } from '../features/chat/useGroupMembersUi';
import { useGroupNameModalActions } from '../features/chat/useGroupNameModalActions';
import {
  useGroupReadOnlyRefreshTicker,
  useRefreshGroupRosterOnMembersModalOpen,
} from '../features/chat/useGroupRefreshTriggers';
import { useHydrateDmReads } from '../features/chat/useHydrateDmReads';
import { useHydrateGroupRoster } from '../features/chat/useHydrateGroupRoster';
import { useLatestOutgoingMessageId } from '../features/chat/useLatestOutgoingMessageId';
import {
  useLazyDecryptDmViewerPages,
  useLazyDecryptGroupViewerPages,
} from '../features/chat/useLazyDecryptViewerPages';
import { useMentions } from '../features/chat/useMentions';
import { useMessageActionMenu } from '../features/chat/useMessageActionMenu';
import { useHydratePeerPublicKey } from '../features/chat/usePeerPublicKey';
import {
  usePrefetchDmDecryptedThumbs,
  usePrefetchGroupDecryptedThumbs,
} from '../features/chat/usePrefetchDecryptedThumbs';
import { usePushGroupTitleToParent } from '../features/chat/usePushGroupTitleToParent';
import { useRecoverPendingImagePicker } from '../features/chat/useRecoverPendingImagePicker';
import type { ChatMediaViewerState } from '../features/chat/viewerTypes';
import { useCdnUrlCache } from '../hooks/useCdnUrlCache';
import { useChannelHeaderCache } from '../hooks/useChannelHeaderCache';
import { useConfirmLinkModal } from '../hooks/useConfirmLinkModal';
import { useHiddenMessageIds } from '../hooks/useHiddenMessageIds';
import { useMediaViewer } from '../hooks/useMediaViewer';
import { useOpenGlobalViewer } from '../hooks/useOpenGlobalViewer';
import { usePersistedBool } from '../hooks/usePersistedBool';
import { usePersistedNumberMinMap } from '../hooks/usePersistedNumberMinMap';
import { usePruneExpiredMessages } from '../hooks/usePruneExpiredMessages';
import { usePublicAvatarProfiles } from '../hooks/usePublicAvatarProfiles';
import { useReactionInfo } from '../hooks/useReactionInfo';
import { useStorageSessionReady } from '../hooks/useStorageSessionReady';
import { useToast } from '../hooks/useToast';
import { useTtlNowSec } from '../hooks/useTtlNowSec';
import { useUiPromptHelpers } from '../hooks/useUiPromptHelpers';
import { useViewportWidth } from '../hooks/useViewportWidth';
import type { MemberRow } from '../types/members';
import { markChannelAboutSeen } from '../utils/channelAboutSeen';
import { getChatHeaderTitle } from '../utils/conversationTitles';
import {
  aesGcmDecryptBytes,
  decryptChatMessageV1,
  deriveChatKeyBytesV1,
  encryptChatMessageV1,
} from '../utils/crypto';
import { getDmMediaSignedUrl } from '../utils/dmSignedUrl';
import { formatRemaining } from '../utils/formatRemaining';
import { timestampId } from '../utils/ids';
import { getPreviewKind } from '../utils/mediaKinds';
import { calcCappedMediaSize } from '../utils/mediaSizing';
import { normalizeUser } from '../utils/normalizeUser';
import { openExternalFile } from '../utils/openExternalFile';
import { saveMediaUrlToDevice } from '../utils/saveMediaToDevice';
import { getSeenLabelForCreatedAt } from '../utils/seenLabels';
import { styles } from './ChatScreen.styles';

type ChatScreenProps = {
  conversationId?: string | null;
  peer?: string | null;
  displayName: string;
  myAvatarOverride?: { bgColor?: string; textColor?: string; imagePath?: string } | null;
  onNewDmNotification?: (conversationId: string, user: string, userSub?: string) => void;
  // Called when a system membership event arrives (e.g. "added to group") so the app shell can
  // refresh the unread inbox immediately.
  refreshUnreads?: () => void | Promise<void>;
  onKickedFromConversation?: (conversationId: string) => void;
  // Notify the parent (Chats list) that the current conversation's title changed.
  onConversationTitleChanged?: (conversationId: string, title: string) => void;
  // App-level Settings dropdown can request opening the current channel's About modal (view-only).
  channelAboutRequestEpoch?: number;
  headerTop?: React.ReactNode;
  theme?: 'light' | 'dark';
  chatBackground?: {
    mode: 'default' | 'color' | 'image';
    color?: string;
    uri?: string;
    blur?: number;
    opacity?: number;
  };
  chatBackgroundImageScaleMode?: 'fill' | 'fit';
  blockedUserSubs?: string[];
  // Bump this when keys are generated/recovered/reset so ChatScreen reloads them from storage.
  keyEpoch?: number;
  onBlockUserSub?: (blockedSub: string, label?: string) => void | Promise<void>;
};

const ENCRYPTED_PLACEHOLDER = 'Encrypted Message (Tap to Decrypt)';

const EMPTY_URI_BY_PATH: Record<string, string> = {};
const HISTORY_PAGE_SIZE = 50;
const CHAT_MEDIA_MAX_HEIGHT = 240; // dp
const CHAT_MEDIA_MAX_HEIGHT_PORTRAIT = 360; // dp (portrait thumbs can be taller without feeling "tiny")
const CHAT_MEDIA_MAX_WIDTH_FRACTION = 0.86; // fraction of screen width (roughly bubble width)

export default function ChatScreen({
  conversationId,
  peer,
  displayName,
  myAvatarOverride,
  onNewDmNotification,
  refreshUnreads,
  onKickedFromConversation,
  onConversationTitleChanged,
  channelAboutRequestEpoch,
  headerTop,
  theme = 'light',
  chatBackground,
  chatBackgroundImageScaleMode = 'fill',
  blockedUserSubs = [],
  keyEpoch,
  onBlockUserSub,
}: ChatScreenProps): React.JSX.Element {
  const isDark = theme === 'dark';
  const insets = useSafeAreaInsets();
  const { user } = useAuthenticator();
  const { width: windowWidth } = useWindowDimensions();
  const { isWide: isWideChatLayout, viewportWidth: chatViewportWidth } = useViewportWidth(
    windowWidth,
    {
      wideBreakpointPx: 900,
      maxContentWidthPx: 1040,
    },
  );
  const ANDROID_COMPOSER_BOTTOM_PAD_MAX = 16;
  // Android can report different bottom insets when an input is focused / keyboard shows.
  // Cache a stable bottom inset so the composer doesn't "jump" or change height.
  const [androidBottomInsetStable, setAndroidBottomInsetStable] = React.useState<number>(0);
  // Track whether the iOS keyboard is visible so we can adjust padding separately
  // for "idle" vs "keyboard-up" states.
  const [iosKeyboardVisible, setIosKeyboardVisible] = React.useState(false);
  React.useEffect(() => {
    if (Platform.OS !== 'android') return;
    const b =
      typeof insets.bottom === 'number' && Number.isFinite(insets.bottom) ? insets.bottom : 0;
    // Keep the maximum seen value (gesture/nav area). When the keyboard shows, some devices report 0.
    if (b > androidBottomInsetStable) setAndroidBottomInsetStable(b);
  }, [androidBottomInsetStable, insets.bottom, iosKeyboardVisible]);

  React.useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const showSub = Keyboard.addListener('keyboardDidShow', () => setIosKeyboardVisible(true));
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setIosKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const composerSafeAreaStyle = React.useMemo(() => {
    if (Platform.OS === 'android') {
      const bottomInset = Math.min(androidBottomInsetStable, ANDROID_COMPOSER_BOTTOM_PAD_MAX);
      return { paddingBottom: bottomInset };
    }
    if (Platform.OS === 'ios') {
      const raw =
        typeof insets.bottom === 'number' && Number.isFinite(insets.bottom) ? insets.bottom : 0;
      if (iosKeyboardVisible) {
        // When keyboard is up, respect the full inset and add a small buffer so
        // the keyboard doesn't visually touch the bottom of the input.
        return { paddingBottom: raw };
      }
      // When keyboard is hidden, reduce the inset so the idle gap is smaller (tighter than before).
      const IOS_REDUCE_PX = 20;
      const bottomInset = Math.max(0, raw - IOS_REDUCE_PX);
      return { paddingBottom: bottomInset };
    }
    // Web and any other platforms: preserve original behavior.
    return { paddingBottom: insets.bottom };
  }, [androidBottomInsetStable, insets.bottom, iosKeyboardVisible]);
  const composerBottomInsetBgHeight = Platform.OS === 'android' ? androidBottomInsetStable : 0;
  const composerHorizontalInsetsStyle = React.useMemo(
    () => ({ paddingLeft: 12 + insets.left, paddingRight: 12 + insets.right }),
    [insets.left, insets.right],
  );
  const dmSettingsCompact = windowWidth < 420;
  const [dmSettingsOpen, setDmSettingsOpen] = React.useState<boolean>(true);
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const blockedSubsSet = React.useMemo(
    () => new Set((blockedUserSubs || []).filter(Boolean)),
    [blockedUserSubs],
  );
  const { visibleMessages, messageListData, webPinned } = useChatMessageListState({
    messages,
    blockedSubsSet,
  });
  const AVATAR_SIZE = 44;
  const AVATAR_GAP = 8;
  const AVATAR_GUTTER = AVATAR_SIZE + AVATAR_GAP;
  const [input, setInput] = React.useState<string>('');
  const inputRef = React.useRef<string>('');
  const textInputRef = React.useRef<TextInput | null>(null);
  const [inputEpoch, setInputEpoch] = React.useState<number>(0);
  const [replyTarget, setReplyTarget] = React.useState<null | {
    id: string;
    createdAt: number;
    user?: string;
    userSub?: string;
    preview: string;
    mediaKind?: 'image' | 'video' | 'file';
    mediaCount?: number;
    mediaThumbUri?: string | null;
  }>(null);
  const sendTimeoutRef = React.useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [typingByUserExpiresAt, setTypingByUserExpiresAt] = React.useState<Record<string, number>>(
    {},
  ); // user -> expiresAtMs
  const [error, setError] = React.useState<string | null>(null);
  const appStateRef = React.useRef<AppStateStatus>(AppState.currentState);
  const activeConversationIdRef = React.useRef<string>('global');
  const displayNameRef = React.useRef<string>('');
  const myPublicKeyRef = React.useRef<string | null>(null);
  const onNewDmNotificationRef = React.useRef<typeof onNewDmNotification | undefined>(undefined);
  const refreshUnreadsRef = React.useRef<typeof refreshUnreads | undefined>(undefined);
  const onKickedFromConversationRef = React.useRef<typeof onKickedFromConversation | undefined>(
    undefined,
  );
  const pendingJoinConversationIdRef = React.useRef<string | null>(null);
  const { myUserId, myPrivateKey, myPublicKey } = useChatMyKeys({ user, keyEpoch });
  const [peerPublicKey, setPeerPublicKey] = React.useState<string | null>(null);
  const {
    parseEncrypted,
    parseGroupEncrypted,
    decryptGroupForDisplay,
    decryptForDisplay,
    buildDmMediaKey,
  } = useChatDecryptors({
    myPrivateKey,
    myPublicKey,
    peerPublicKey,
    myUserId,
    decryptChatMessageV1,
    aesGcmDecryptBytes,
    deriveChatKeyBytesV1,
    hexToBytes,
  });
  const groupUi = useChatGroupUiState();
  const {
    groupMeta,
    setGroupMeta,
    groupMembers,
    setGroupMembers,
    groupPublicKeyBySub,
    setGroupPublicKeyBySub,
    groupMembersOpen,
    setGroupMembersOpen,
    groupRefreshNonce,
    setGroupRefreshNonce,
    groupNameEditOpen,
    setGroupNameEditOpen,
    groupNameDraft,
    setGroupNameDraft,
    groupAddMembersDraft,
    setGroupAddMembersDraft,
    groupAddMembersInputRef,
    groupActionBusy,
    setGroupActionBusy,
  } = groupUi;
  const { groupMembersVisible, groupMembersActiveCount, computeDefaultGroupTitleForMe } =
    useGroupMembersUi({
      groupMembers,
      myUserId,
    });
  const [autoDecrypt, setAutoDecrypt] = React.useState<boolean>(false);
  const { cipherOpen, setCipherOpen, cipherText, setCipherText } = useChatCipherState();
  const { nameBySub, ensureNames: ensureNameBySub } = useDisplayNameBySub(API_URL);
  const [reactionPickerOpen, setReactionPickerOpen] = React.useState<boolean>(false);
  const [reactionPickerTarget, setReactionPickerTarget] = React.useState<ChatMessage | null>(null);
  const messageActionMenu = useMessageActionMenu<ChatMessage>();
  const messageActionTarget = messageActionMenu.target;
  const openMessageActions = messageActionMenu.openMenu;
  const closeMessageActions = messageActionMenu.closeMenu;
  const [selectionActive, setSelectionActive] = React.useState<boolean>(false);
  const [selectedMessageIds, setSelectedMessageIds] = React.useState<string[]>([]);
  const selectedIdSet = React.useMemo(
    () => new Set((selectedMessageIds || []).filter(Boolean)),
    [selectedMessageIds],
  );

  // Reset selection when switching conversations.
  React.useEffect(() => {
    setSelectionActive(false);
    setSelectedMessageIds([]);
  }, [conversationId]);

  // Keep selection clean if messages are removed.
  React.useEffect(() => {
    if (!selectionActive) return;
    if (!selectedMessageIds.length) return;
    const ids = new Set(messages.map((m) => String(m.id)));
    setSelectedMessageIds((prev) => prev.filter((id) => ids.has(String(id))));
  }, [messages, selectedMessageIds.length, selectionActive]);

  const toggleSelectedMessageId = React.useCallback((id: string) => {
    const key = String(id || '').trim();
    if (!key) return;
    setSelectedMessageIds((prev) => {
      const has = prev.includes(key);
      if (has) return prev.filter((x) => x !== key);
      return [...prev, key];
    });
  }, []);

  const exitSelectionMode = React.useCallback(() => {
    setSelectionActive(false);
    setSelectedMessageIds([]);
  }, []);

  const enterSelectionModeForMessage = React.useCallback(
    (msg: ChatMessage) => {
      if (!msg?.id) return;
      setSelectionActive(true);
      setSelectedMessageIds((prev) => {
        const id = String(msg.id);
        return prev.includes(id) ? prev : [...prev, id];
      });
      // Avoid leaving the actions menu open behind selection UI.
      closeMessageActions();
      // Avoid inline edit conflicts.
      setInlineEditTargetId(null);
      setInlineEditDraft('');
      setInlineEditAttachmentMode('keep');
    },
    [closeMessageActions],
  );
  const [inlineEditTargetId, setInlineEditTargetId] = React.useState<string | null>(null);
  const [inlineEditDraft, setInlineEditDraft] = React.useState<string>('');
  const [inlineEditAttachmentMode, setInlineEditAttachmentMode] = React.useState<
    'keep' | 'replace' | 'remove'
  >('keep');
  const [inlineEditUploading, setInlineEditUploading] = React.useState<boolean>(false);
  const hiddenKey = React.useMemo(() => {
    // Keep key stable per-account (prefer sub) and match existing normalization (trim + lowercase).
    const who = myUserId
      ? String(myUserId)
      : String(displayName || 'anon')
          .trim()
          .toLowerCase();
    const convKey = conversationId && conversationId.length > 0 ? conversationId : 'global';
    return `chat:hidden:${who}:${convKey}`;
  }, [myUserId, displayName, conversationId]);
  const { hiddenMessageIds, hideMessageId } = useHiddenMessageIds(hiddenKey);

  const { historyHasMore, historyLoading, loadOlderHistory } = useChatHistory({
    apiUrl: API_URL,
    activeConversationId: conversationId && conversationId.length > 0 ? conversationId : 'global',
    hiddenMessageIds,
    setMessages,
    setError,
    encryptedPlaceholder: ENCRYPTED_PLACEHOLDER,
    parseEncrypted,
    parseGroupEncrypted,
    normalizeUser,
    normalizeReactions,
    pageSize: HISTORY_PAGE_SIZE,
  });
  const infoModal = useChatInfoModal();
  const { infoOpen, setInfoOpen, infoTitle, infoBody, openInfo, setInfoTitle, setInfoBody } =
    infoModal;
  const wsRef = React.useRef<WebSocket | null>(null);
  const {
    TTL_OPTIONS,
    ttlIdx,
    setTtlIdx,
    ttlIdxDraft,
    setTtlIdxDraft,
    ttlPickerOpen,
    setTtlPickerOpen,
  } = useChatTtlPickerState();

  // NOTE: We intentionally do NOT call `UIManager.setLayoutAnimationEnabledExperimental` here.
  // In React Native New Architecture (Fabric), it's a no-op and spams Metro warnings.

  // Persist DM settings visibility per-device, per-account.
  usePersistedBool({
    enabled: !!myUserId,
    storageKey: `chat:dmSettingsOpen:${String(myUserId || '')}`,
    value: dmSettingsOpen,
    setValue: setDmSettingsOpen,
  });

  const { uiAlert, uiConfirm, uiChoice3, showAlert } = useUiPromptHelpers();

  const [isUploading, setIsUploading] = React.useState(false);
  const {
    pendingMedia,
    pendingMediaRef,
    setPendingMediaItems,
    clearPendingMedia,
    addPickedMediaItems,
    mergeRecoveredPickerItems,
  } = useChatAttachments({
    inlineEditAttachmentMode,
    maxAttachmentsPerMessage: MAX_ATTACHMENTS_PER_MESSAGE,
    showAlert,
  });

  // Leaving a chat (DM / channel / group) should end inline edit, reply, and attachment-replace
  // flows so another conversation doesn't show stale UI ("Finish editing…", open editor, etc.).
  React.useEffect(() => {
    setInlineEditTargetId(null);
    setInlineEditDraft('');
    setInlineEditAttachmentMode('keep');
    setInlineEditUploading(false);
    clearPendingMedia();
    setReplyTarget(null);
    closeMessageActions();
  }, [conversationId, clearPendingMedia, closeMessageActions]);

  const cdnMedia = useCdnUrlCache(CDN_URL);
  const mediaUrlByPath = cdnMedia.urlByPath;
  const cdnAvatar = useCdnUrlCache(CDN_URL);
  const avatarUrlByPath = cdnAvatar.urlByPath;
  useStorageSessionReady({ user, fetchAuthSession });
  const {
    imageAspectByPath,
    setImageAspectByPath,
    dmThumbUriByPath,
    dmFileUriByPath,
    decryptDmThumbToDataUri,
    decryptDmFileToCacheUri,
    decryptGroupThumbToDataUri,
    decryptGroupFileToCacheUri,
  } = useChatMediaDecryptCache({
    aesGcmDecryptBytes,
    hexToBytes,
    gcm,
    fromByteArray,
    getDmMediaSignedUrl,
    buildDmMediaKey,
  });
  // When we receive a message from a sender, refresh their avatar profile (throttled),
  // so profile changes propagate quickly without global polling.
  const AVATAR_REFETCH_ON_MESSAGE_COOLDOWN_MS = 15_000;
  const lastAvatarRefetchAtBySubRef = React.useRef<Record<string, number>>({});
  const wantedAvatarSubs = React.useMemo(() => {
    const subs: string[] = [];
    if (myUserId) subs.push(String(myUserId));
    for (const m of messages) {
      const sub = m?.userSub ? String(m.userSub) : '';
      if (sub) subs.push(sub);
    }
    return subs;
  }, [messages, myUserId]);
  const {
    avatarProfileBySub,
    invalidate: invalidateAvatarProfile,
    upsertMany: upsertAvatarProfiles,
  } = usePublicAvatarProfiles({
    apiUrl: API_URL,
    subs: wantedAvatarSubs,
    // Chat flow refetches by invalidating on new messages; otherwise only fetch missing.
    ttlMs: Number.POSITIVE_INFINITY,
    // IMPORTANT: don't reset on conversation switches, otherwise the header avatar can
    // briefly fall back to the seeded default color before profiles rehydrate.
    resetKey: myUserId || undefined,
    cdn: cdnAvatar,
  });

  // Optimistic: when the user updates their avatar via Settings, update the header immediately.
  // Otherwise, with ttl=Infinity, we'd only see the new avatar after a conversation switch or message event.
  React.useEffect(() => {
    const sub = String(myUserId || '').trim();
    if (!sub) return;
    const o = myAvatarOverride && typeof myAvatarOverride === 'object' ? myAvatarOverride : null;
    if (!o) return;
    const imagePath =
      typeof o.imagePath === 'string' && o.imagePath.trim().length ? o.imagePath.trim() : undefined;
    upsertAvatarProfiles([
      {
        sub,
        profile: {
          displayName,
          avatarBgColor: typeof o.bgColor === 'string' ? o.bgColor : undefined,
          avatarTextColor: typeof o.textColor === 'string' ? o.textColor : undefined,
          avatarImagePath: imagePath,
        },
      },
    ]);
    if (imagePath) {
      try {
        cdnAvatar.ensure([imagePath]);
      } catch {
        // ignore
      }
    }
  }, [
    cdnAvatar,
    displayName,
    myAvatarOverride,
    myAvatarOverride?.bgColor,
    myAvatarOverride?.imagePath,
    myAvatarOverride?.textColor,
    myUserId,
    upsertAvatarProfiles,
  ]);

  const { toast, anim: toastAnim, showToast } = useToast();
  const viewerOpenRef = React.useRef(false);
  const pendingViewerSaveToastRef = React.useRef<null | {
    kind: 'success' | 'error';
    message: string;
  }>(null);

  const onViewerSavePermissionDenied = React.useCallback(() => {
    if (Platform.OS === 'ios' && viewerOpenRef.current) {
      pendingViewerSaveToastRef.current = {
        kind: 'error',
        message: 'Allow Photos permission to save.',
      };
      return;
    }
    showToast('Allow Photos permission to save.', 'error');
  }, [showToast]);
  const onViewerSaveSuccess = React.useCallback(() => {
    if (Platform.OS === 'ios' && viewerOpenRef.current) {
      pendingViewerSaveToastRef.current = { kind: 'success', message: 'Media saved' };
      return;
    }
    showToast('Media saved', 'success');
  }, [showToast]);
  const onViewerSaveError = React.useCallback(
    (msg: string) => {
      const m = String(msg || '');
      const clipped = m.length > 120 ? `${m.slice(0, 120)}…` : m;
      if (Platform.OS === 'ios' && viewerOpenRef.current) {
        pendingViewerSaveToastRef.current = { kind: 'error', message: clipped };
        return;
      }
      showToast(clipped, 'error');
    },
    [showToast],
  );

  const viewerBase = useMediaViewer<NonNullable<ChatMediaViewerState>>({
    getSaveItem: (vs) => {
      if (!vs) return null;
      if (vs.mode === 'global') return vs.globalItems?.[vs.index] ?? null;
      if (vs.mode === 'dm') {
        const it = vs.dmItems?.[vs.index];
        if (!it?.media?.path) return null;
        const url = dmFileUriByPath[it.media.path];
        if (!url) return null;
        const kind =
          it.media.kind === 'video' ? 'video' : it.media.kind === 'image' ? 'image' : 'file';
        return { url, kind, fileName: it.media.fileName };
      }
      if (vs.mode === 'gdm') {
        const it = vs.gdmItems?.[vs.index];
        if (!it?.media?.path) return null;
        const url = dmFileUriByPath[it.media.path];
        if (!url) return null;
        const kind =
          it.media.kind === 'video' ? 'video' : it.media.kind === 'image' ? 'image' : 'file';
        return { url, kind, fileName: it.media.fileName };
      }
      return null;
    },
    onPermissionDenied: onViewerSavePermissionDenied,
    onSuccess: onViewerSaveSuccess,
    onError: onViewerSaveError,
  });

  // Ensure Save works for encrypted DM/GDM even if the page hasn't been decrypted yet.
  const [viewerSaving, setViewerSaving] = React.useState(false);
  const saveViewerToDevice = React.useCallback(async () => {
    if (viewerSaving) return;
    const vs = viewerBase.state;
    if (!vs) {
      onViewerSaveError('No media selected to save.');
      return;
    }

    setViewerSaving(true);
    try {
      if (vs.mode === 'global') {
        const it = vs.globalItems?.[vs.index];
        if (!it?.url) {
          onViewerSaveError('Could not resolve media URL for save.');
          return;
        }
        await saveMediaUrlToDevice({
          url: it.url,
          kind: it.kind,
          fileName: it.fileName,
          onPermissionDenied: onViewerSavePermissionDenied,
          onSuccess: onViewerSaveSuccess,
          onError: onViewerSaveError,
        });
        return;
      }

      if (vs.mode === 'dm') {
        const msg = vs.dmMsg;
        const it = vs.dmItems?.[vs.index];
        const key = it?.media?.path;
        if (!msg || !it || !key) {
          onViewerSaveError('Could not resolve encrypted media for save.');
          return;
        }
        const uri =
          dmFileUriByPath[key] ||
          (await decryptDmFileToCacheUri(
            msg,
            it as unknown as Parameters<typeof decryptDmFileToCacheUri>[1],
          ).catch(() => ''));
        if (!uri) {
          onViewerSaveError('Could not decrypt media for save.');
          return;
        }
        const kind =
          it.media.kind === 'video' ? 'video' : it.media.kind === 'image' ? 'image' : 'file';
        await saveMediaUrlToDevice({
          url: uri,
          kind,
          fileName: it.media.fileName,
          onPermissionDenied: onViewerSavePermissionDenied,
          onSuccess: onViewerSaveSuccess,
          onError: onViewerSaveError,
        });
        return;
      }

      if (vs.mode === 'gdm') {
        const msg = vs.gdmMsg;
        const it = vs.gdmItems?.[vs.index];
        const key = it?.media?.path;
        if (!msg || !it || !key) {
          onViewerSaveError('Could not resolve group media for save.');
          return;
        }
        const uri =
          dmFileUriByPath[key] ||
          (await decryptGroupFileToCacheUri(
            msg,
            it as unknown as Parameters<typeof decryptGroupFileToCacheUri>[1],
          ).catch(() => ''));
        if (!uri) {
          onViewerSaveError('Could not decrypt group media for save.');
          return;
        }
        const kind =
          it.media.kind === 'video' ? 'video' : it.media.kind === 'image' ? 'image' : 'file';
        await saveMediaUrlToDevice({
          url: uri,
          kind,
          fileName: it.media.fileName,
          onPermissionDenied: onViewerSavePermissionDenied,
          onSuccess: onViewerSaveSuccess,
          onError: onViewerSaveError,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err || 'Unknown save failure');
      onViewerSaveError(msg);
    } finally {
      setViewerSaving(false);
    }
  }, [
    decryptDmFileToCacheUri,
    decryptGroupFileToCacheUri,
    dmFileUriByPath,
    onViewerSaveError,
    onViewerSavePermissionDenied,
    onViewerSaveSuccess,
    viewerBase.state,
    viewerSaving,
  ]);

  const viewer = React.useMemo(
    () => ({
      ...viewerBase,
      saving: viewerSaving || viewerBase.saving,
      saveToDevice: saveViewerToDevice,
    }),
    [saveViewerToDevice, viewerBase, viewerSaving],
  );
  React.useEffect(() => {
    viewerOpenRef.current = !!viewer.open;
    if (Platform.OS !== 'ios') return;
    if (viewer.open) return;
    const pending = pendingViewerSaveToastRef.current;
    if (!pending) return;
    pendingViewerSaveToastRef.current = null;
    showToast(pending.message, pending.kind);
  }, [showToast, viewer.open]);
  // DM media caches + decrypt helpers are managed by useChatMediaDecryptCache().
  const inFlightDmViewerDecryptRef = React.useRef<Set<string>>(new Set());
  const [attachOpen, setAttachOpen] = React.useState<boolean>(false);
  const [cameraOpen, setCameraOpen] = React.useState<boolean>(false);
  const isDesktopWeb = React.useMemo(() => {
    if (Platform.OS !== 'web') return false;
    try {
      const w = typeof window !== 'undefined' ? window : undefined;
      const coarse =
        !!w?.matchMedia?.('(hover: none) and (pointer: coarse)')?.matches ||
        !!w?.matchMedia?.('(pointer: coarse)')?.matches;
      // Treat narrow screens as "mobile web" for keyboard behavior.
      const narrow = typeof windowWidth === 'number' ? windowWidth < 768 : false;
      return !(coarse || narrow);
    } catch {
      const narrow = typeof windowWidth === 'number' ? windowWidth < 768 : false;
      return !narrow;
    }
  }, [windowWidth]);
  const prevOverlayOpenRef = React.useRef<{ attachOpen: boolean; cameraOpen: boolean }>({
    attachOpen: false,
    cameraOpen: false,
  });
  React.useEffect(() => {
    if (!isDesktopWeb) return;
    const prev = prevOverlayOpenRef.current;
    const prevAny = prev.attachOpen || prev.cameraOpen;
    const nowAny = attachOpen || cameraOpen;
    prevOverlayOpenRef.current = { attachOpen, cameraOpen };
    if (!prevAny || nowAny) return;
    // Attach/camera overlays just closed: restore focus so the user can keep typing.
    const tryFocus = () => {
      try {
        textInputRef.current?.focus?.();
      } catch {
        // ignore
      }
    };
    setTimeout(tryFocus, 0);
    setTimeout(tryFocus, 150);
    setTimeout(tryFocus, 400);
  }, [attachOpen, cameraOpen, isDesktopWeb, textInputRef]);
  const activeConversationId = React.useMemo(
    () => (conversationId && conversationId.length > 0 ? conversationId : 'global'),
    [conversationId],
  );
  // Per-message "Seen" state for outgoing messages (keyed by message createdAt ms)
  const { map: peerSeenAtByCreatedAt, setMap: setPeerSeenAtByCreatedAt } = usePersistedNumberMinMap(
    `chat:peerSeen:${activeConversationId}`,
  );
  const { setMap: setMySeenAtByCreatedAt } = usePersistedNumberMinMap(
    `chat:seen:${activeConversationId}`,
  );
  const isDm = React.useMemo(() => activeConversationId.startsWith('dm#'), [activeConversationId]);
  const isGroup = React.useMemo(
    () => activeConversationId.startsWith('gdm#'),
    [activeConversationId],
  );
  const isChannel = React.useMemo(
    () => activeConversationId.startsWith('ch#'),
    [activeConversationId],
  );
  const isEncryptedChat = isDm || isGroup;

  // If we restore into a conversation we can no longer access (banned/kicked/unauthorized),
  // default back to Global without prompting.
  // - For live kicks, WS already emits {type:'kicked'} which routes through onKickedFromConversation.
  // - For boot-time restore, the HTTP history fetch often provides the first clear 401/403 signal.
  const lastAccessDeniedConvRef = React.useRef<string>('');
  React.useEffect(() => {
    const cid = String(activeConversationId || '').trim() || 'global';
    if (!(cid.startsWith('ch#') || cid.startsWith('gdm#') || cid.startsWith('dm#'))) return;
    const msg = String(error || '').trim();
    if (!msg) return;
    const m = msg.toLowerCase();
    const looksLikeDenied =
      (m.includes('history fetch failed') && (m.includes('(403)') || m.includes('(401)'))) ||
      (/\bhistory fetch failed\b/.test(m) && (/\b403\b/.test(m) || /\b401\b/.test(m)));
    if (!looksLikeDenied) return;
    if (lastAccessDeniedConvRef.current === cid) return;
    lastAccessDeniedConvRef.current = cid;
    try {
      onKickedFromConversationRef.current?.(cid);
    } catch {
      // ignore
    }
  }, [activeConversationId, error]);

  const groupMembersCountLabel = React.useMemo(() => {
    if (!isGroup) return '-';
    // Until roster hydrates, avoid flashing "0" (group always has at least 1 member once loaded).
    if (!groupMembersVisible.length) return '-';
    return `${groupMembersActiveCount || 0}`;
  }, [groupMembersActiveCount, groupMembersVisible.length, isGroup]);

  const { kickCooldownUntilBySub, groupKick, channelKick } = useChatKickActions({
    wsRef,
    activeConversationId,
    isGroup,
    isChannel,
    showAlert,
  });

  const aiSummary = useAiSummary({
    // Prefer a dedicated AI base URL if configured (e.g. streaming-capable endpoint); fall back to API_URL.
    apiUrl: AI_API_URL || API_URL,
    activeConversationId,
    peer,
    messages,
    fetchAuthSession,
    showAlert,
    openInfo,
  });

  const aiHelper = useAiHelper({
    // Prefer a dedicated AI base URL if configured (e.g. streaming-capable endpoint); fall back to API_URL.
    apiUrl: AI_API_URL || API_URL,
    activeConversationId,
    peer,
    messages,
    isDm,
    mediaUrlByPath,
    cdnResolve: (p) => cdnMedia.resolve(p),
    fetchAuthSession,
    openInfo,
  });

  const aiConsentGate = useAiConsentGate(isEncryptedChat);

  const runAiAction = React.useCallback(
    (action: 'summary' | 'helper') => {
      if (action === 'summary') void aiSummary.summarize();
      else aiHelper.openHelper();
    },
    [aiHelper, aiSummary],
  );
  const { sendReadReceipts, onToggleReadReceipts, sendReadReceipt, flushPendingRead } =
    useChatReadReceipts({
      enabled: isEncryptedChat,
      myUserId,
      conversationIdForStorage:
        conversationId && conversationId.length > 0 ? conversationId : 'global',
      activeConversationId,
      displayName,
      wsRef,
    });
  useHydratePeerPublicKey({
    enabled: isDm,
    apiUrl: API_URL,
    activeConversationId,
    myUserId,
    peer,
    setPeerPublicKey,
  });
  const activeChannelId = React.useMemo(
    () => (isChannel ? String(activeConversationId).slice('ch#'.length).trim() : ''),
    [isChannel, activeConversationId],
  );
  const channelHeaderCache = useChannelHeaderCache({
    enabled: isChannel,
    channelId: activeChannelId,
  });
  const channelUi = useChatChannelUiState();
  const {
    channelMeta,
    setChannelMeta,
    channelRosterChannelId,
    setChannelRosterChannelId,
    channelMembers,
    setChannelMembers,
    channelMembersActiveCountHint,
    setChannelMembersActiveCountHint,
    channelMembersOpen,
    setChannelMembersOpen,
    channelSettingsOpen,
    setChannelSettingsOpen,
    channelActionBusy,
    setChannelActionBusy,
    channelAddMembersDraft,
    setChannelAddMembersDraft,
    channelAddMembersInputRef,
    channelNameEditOpen,
    setChannelNameEditOpen,
    channelNameDraft,
    setChannelNameDraft,
    channelAboutOpen,
    setChannelAboutOpen,
    channelAboutEdit,
    setChannelAboutEdit,
    channelAboutDraft,
    setChannelAboutDraft,
    channelPasswordEditOpen,
    setChannelPasswordEditOpen,
    channelPasswordDraft,
    setChannelPasswordDraft,
  } = channelUi;
  const channelRosterMatchesActive =
    !!activeChannelId && channelRosterChannelId === activeChannelId;
  const channelMembersForUi = React.useMemo(
    () => (channelRosterMatchesActive ? channelMembers : []),
    [channelMembers, channelRosterMatchesActive],
  );
  const channelMembersVisible = React.useMemo(() => {
    const rows: MemberRow[] = [];
    for (const m of channelMembersForUi) {
      if (!isVisibleMemberRow(m)) continue;
      const row = toMemberRow(m);
      if (!row) continue;
      if (row.status !== 'active' && row.status !== 'banned') continue;
      rows.push(row);
    }
    return rows;
  }, [channelMembersForUi]);
  const channelMembersActiveCount = React.useMemo(
    () => channelMembersForUi.reduce((acc, m) => (m && m.status === 'active' ? acc + 1 : acc), 0),
    [channelMembersForUi],
  );
  const channelMembersCountLabel = React.useMemo(() => {
    // When roster is loaded for this channel, show the real active count.
    if (channelRosterMatchesActive && channelMembersForUi.length)
      return `${channelMembersActiveCount || 0}`;
    // Otherwise, show cached hint if we have one; else a neutral placeholder.
    if (
      typeof channelMembersActiveCountHint === 'number' &&
      Number.isFinite(channelMembersActiveCountHint)
    ) {
      const n = Math.max(0, Math.floor(channelMembersActiveCountHint));
      // Treat 0 as "unknown" for the hint so we don't flash 0 before roster hydrates.
      if (n > 0) return `${n}`;
    }
    return '-';
  }, [
    channelRosterMatchesActive,
    channelMembersForUi.length,
    channelMembersActiveCount,
    channelMembersActiveCountHint,
  ]);
  const { requestOpenLink, requestOpenFile, confirmLinkModal } = useConfirmLinkModal(isDark);
  const { refreshChannelRoster } = useChannelRoster({
    apiUrl: API_URL,
    enabled: isChannel,
    activeConversationId,
    activeChannelId,
    channelHeaderCache,
    channelMembersOpen,
    channelAboutRequestEpoch: channelAboutRequestEpoch ?? 0,
    uiAlert,
    onConversationTitleChanged,
    channelMeta,
    setChannelMeta,
    setChannelRosterChannelId,
    setChannelMembers,
    setChannelMembersActiveCountHint,
    setChannelAboutDraft,
    setChannelAboutEdit,
    setChannelAboutOpen,
  });

  const { mentionSuggestions, insertMention } = useMentions({
    enabled: !isEncryptedChat,
    input,
    setInput,
    inputRef,
    textInputRef,
    messages,
    myUserId,
    mentionTextStyle: styles.mentionText,
  });

  const chatReport = useChatReport({ apiUrl: API_URL, activeConversationId });

  const reactionInfo = useReactionInfo<ChatMessage>({
    sortSubs: (subs) => sortReactionSubs({ subs, myUserId, nameBySub }),
    ensureNamesBySub: async (subs) => {
      await ensureNameBySub(subs);
    },
  });

  usePushGroupTitleToParent({
    enabled: isGroup,
    activeConversationId,
    groupName: groupMeta?.groupName,
    computeDefaultTitle: computeDefaultGroupTitleForMe,
    onConversationTitleChanged,
  });
  const resolvedChatBg: ResolvedChatBg = React.useMemo(() => {
    const bg = chatBackground;
    if (!bg || bg.mode === 'default') return { mode: 'default' as const };
    if (bg.mode === 'color' && typeof bg.color === 'string' && bg.color.trim()) {
      return { mode: 'color' as const, color: bg.color.trim() };
    }
    if (bg.mode === 'image' && typeof bg.uri === 'string' && bg.uri.trim()) {
      const blurRaw = typeof bg.blur === 'number' ? bg.blur : 0;
      const opacityRaw = typeof bg.opacity === 'number' ? bg.opacity : 1;
      const blur = Math.max(0, Math.min(10, Math.round(blurRaw)));
      const opacity = Math.max(0.2, Math.min(1, Math.round(opacityRaw * 100) / 100));
      return {
        mode: 'image' as const,
        uri: bg.uri.trim(),
        blur,
        opacity,
        scaleMode: chatBackgroundImageScaleMode,
      };
    }
    return { mode: 'default' as const };
  }, [chatBackground, chatBackgroundImageScaleMode]);

  const headerTitle = React.useMemo(() => {
    const cachedChannelName =
      isChannel && channelHeaderCache.cached?.name
        ? String(channelHeaderCache.cached.name).trim()
        : '';
    return getChatHeaderTitle({
      isChannel,
      channelName: cachedChannelName || channelMeta?.name,
      peer,
      isGroup,
      groupName: groupMeta?.groupName,
    });
  }, [
    isChannel,
    channelHeaderCache.cached?.name,
    channelMeta?.name,
    peer,
    isGroup,
    groupMeta?.groupName,
  ]);

  useChatScreenRefSync({
    activeConversationId,
    activeConversationIdRef,
    cdnAvatarReset: cdnAvatar.reset,
    displayName,
    displayNameRef,
    input,
    inputRef,
    myPublicKey,
    myPublicKeyRef,
    onNewDmNotification,
    onNewDmNotificationRef,
    refreshUnreads,
    refreshUnreadsRef,
    onKickedFromConversation,
    onKickedFromConversationRef,
  });

  // Avatar profiles are fetched via shared hook (usePublicAvatarProfiles).

  const latestOutgoingMessageId = useLatestOutgoingMessageId({
    messages,
    myUserId,
    myPublicKey,
    displayName,
    normalizeUser,
  });

  const getCappedMediaSize = React.useCallback(
    (aspect: number | undefined, availableWidth?: number) =>
      calcCappedMediaSize({
        aspect,
        availableWidth:
          typeof availableWidth === 'number' &&
          Number.isFinite(availableWidth) &&
          availableWidth > 0
            ? availableWidth
            : windowWidth,
        maxWidthFraction: CHAT_MEDIA_MAX_WIDTH_FRACTION,
        // Portrait phone photos otherwise become very narrow once capped by height.
        // Allow a taller cap for portrait to keep thumbnails reasonably sized.
        maxHeight:
          typeof aspect === 'number' && Number.isFinite(aspect) && aspect > 0 && aspect < 0.95
            ? CHAT_MEDIA_MAX_HEIGHT_PORTRAIT
            : CHAT_MEDIA_MAX_HEIGHT,
        minMaxWidth: 220,
        minW: 140,
        minH: 120,
        rounding: 'floor',
      }),
    [windowWidth],
  );

  useRecoverPendingImagePicker({
    trigger: inlineEditAttachmentMode,
    getPendingResultAsync: ImagePicker.getPendingResultAsync,
    pendingMediaFromImagePickerAssets,
    mergeRecoveredPickerItems,
  });

  const { pickFromLibrary, pickDocument, openCamera, handleInAppCameraCaptured } =
    useChatAttachmentPickers({
      showAlert,
      addPickedMediaItems,
      pendingMediaFromImagePickerAssets,
      pendingMediaFromDocumentPickerAssets,
      pendingMediaFromInAppCameraCapture,
      setCameraOpen,
    });

  // Attachments: Global = plaintext S3; DM = E2EE (client-side encryption before upload)
  const handlePickMedia = React.useCallback(() => {
    if (isDm) {
      if (!myPrivateKey) {
        showAlert('Encryption not ready', 'Missing your private key on this device.');
        return;
      }
      if (!peerPublicKey) {
        showAlert('Encryption not ready', "Can't find the recipient's public key.");
        return;
      }
    }
    setAttachOpen(true);
  }, [isDm, myPrivateKey, peerPublicKey, showAlert]);

  const { uploadPendingMedia, uploadPendingMediaDmEncrypted, uploadPendingMediaGroupEncrypted } =
    useChatUploadHandlers({
      activeConversationId,
      input,
    });

  // storageSessionReady is managed by useStorageSessionReady()

  useChatCdnMediaPrefetch({
    enabled: !isDm,
    messages,
    mediaUrlByPath,
    ensure: cdnMedia.ensure,
  });

  useChatImageAspectPrefetch({
    enabled: !isDm,
    messages,
    mediaUrlByPath,
    imageAspectByPath,
    setImageAspectByPath,
  });

  const openViewer = useOpenGlobalViewer<NonNullable<typeof viewer.state>>({
    resolveUrlForPath: (path) =>
      mediaUrlByPath[String(path)] ? mediaUrlByPath[String(path)] : null,
    // Chat: images/videos open in our viewer; files (PDF/DOCX/HTML/audio/etc) open externally.
    includeFilesInViewer: false,
    openExternalIfFile: true,
    openExternalUrl: ({ url, fileName, contentType }) =>
      openExternalFile({
        url,
        fileName,
        contentType,
        // Web: confirm before opening (prevents surprise downloads).
        requestOpenFile: Platform.OS === 'web' ? requestOpenFile : undefined,
      }),
    viewer,
    buildGlobalState: ({ index, items }) => ({
      mode: 'global' as const,
      index,
      globalItems: items,
    }),
  });

  // Fetch persisted read state so "Seen" works even if sender was offline when peer decrypted.
  useHydrateDmReads({
    enabled: !!isDm,
    apiUrl: API_URL,
    activeConversationId,
    myUserId,
    displayName,
    normalizeUser,
    setPeerSeenAtByCreatedAt,
  });

  // Seen maps are persisted via usePersistedNumberMinMap().

  // Persist autoDecrypt per-conversation, per-account so it doesn't bleed across users on the same device.
  usePersistedBool({
    storageKey: `chat:autoDecrypt:${String(myUserId || 'anon')}:${activeConversationId}`,
    value: autoDecrypt,
    setValue: setAutoDecrypt,
  });

  // ttlIdx is UI state for the disappearing-message setting.
  const nowSec = useTtlNowSec({ enabled: isDm, messages });

  // DM/group media decrypt helpers + caches come from useChatMediaDecryptCache().

  usePrefetchDmDecryptedThumbs({
    enabled: isDm,
    messages,
    dmThumbUriByPath,
    decryptDmThumbToDataUri,
  });
  usePrefetchGroupDecryptedThumbs({
    enabled: isGroup,
    messages,
    dmThumbUriByPath,
    decryptGroupThumbToDataUri,
  });

  const { openDmMediaViewer, openGroupMediaViewer } = useChatEncryptedMediaViewer({
    isDm,
    isGroup,
    openExternalUrl: ({ url, fileName, contentType }) =>
      openExternalFile({
        url,
        fileName,
        contentType,
        requestOpenFile: Platform.OS === 'web' ? requestOpenFile : undefined,
      }),
    viewer,
    showAlert,
    parseDmMediaEnvelope: (raw: unknown) => parseDmMediaEnvelope(String(raw ?? '')),
    parseGroupMediaEnvelope: (raw: unknown) => parseGroupMediaEnvelope(String(raw ?? '')),
    normalizeDmMediaItems,
    normalizeGroupMediaItems,
    decryptDmFileToCacheUri,
    decryptGroupFileToCacheUri,
  });

  useLazyDecryptDmViewerPages({
    viewerOpen: viewer.open,
    viewerState: viewer.state,
    dmFileUriByPath,
    inFlightRef: inFlightDmViewerDecryptRef,
    decryptDmFileToCacheUri,
  });

  useLazyDecryptGroupViewerPages({
    viewerOpen: viewer.open,
    viewerState: viewer.state,
    dmFileUriByPath,
    inFlightRef: inFlightDmViewerDecryptRef,
    decryptGroupFileToCacheUri,
  });

  // ---- Inline audio playback (Signal-style) ----
  const audioQueue = React.useMemo(() => {
    return buildAudioQueueFromMessages(messages, {
      getCreatedAt: (msg) => Number(msg?.createdAt) || 0,
      getSenderKey: (msg) => {
        return msg.userSub
          ? `sub:${String(msg.userSub)}`
          : msg.userLower
            ? `user:${normalizeUser(msg.userLower)}`
            : msg.user
              ? `user:${normalizeUser(msg.user)}`
              : 'anon';
      },
      getAudioItemsForMessage: (msg) => {
        const isStillEncrypted = (!!msg.encrypted || !!msg.groupEncrypted) && !msg.decryptedText;
        if (isStillEncrypted) {
          // Important: encrypted-but-not-decrypted messages should still count as an "interrupt"
          // for consecutive autoplay, otherwise the run won't break until the user decrypts.
          return [];
        }

        // Match renderer logic: plaintext chats can store attachments in a JSON envelope in rawText/text.
        const env =
          !msg.encrypted && !msg.groupEncrypted && !isDm
            ? parseChatEnvelope(msg.rawText ?? msg.text)
            : null;
        const envMediaList = env ? normalizeChatMediaList(env.media) : [];
        const list =
          env && envMediaList.length
            ? envMediaList
            : msg.mediaList
              ? msg.mediaList
              : msg.media
                ? [msg.media]
                : [];
        if (!list.length) return [];

        const out: Array<{
          key: string;
          idx: number;
          title: string;
          resolveUri: () => Promise<string>;
        }> = [];

        for (let i = 0; i < list.length; i++) {
          const m = list[i];
          if (!isAudioContentType(m?.contentType)) continue;

          const key = makeAudioKey(msg.id, m.path, i);
          const title = audioTitleFromFileName(m.fileName, 'Audio');

          if (isDm) {
            out.push({
              key,
              idx: i,
              title,
              resolveUri: async () => {
                const env = parseDmMediaEnvelope(String(msg.decryptedText || ''));
                const arr = normalizeDmMediaItems(env);
                const it = arr[i];
                if (!it) throw new Error('Missing audio attachment');
                return await decryptDmFileToCacheUri(msg, it);
              },
            });
            continue;
          }

          if (isGroup) {
            out.push({
              key,
              idx: i,
              title,
              resolveUri: async () => {
                const env = parseGroupMediaEnvelope(String(msg.decryptedText || ''));
                const arr = normalizeGroupMediaItems(env);
                const it = arr[i];
                if (!it) throw new Error('Missing audio attachment');
                return await decryptGroupFileToCacheUri(msg, it);
              },
            });
            continue;
          }

          out.push({
            key,
            idx: i,
            title,
            resolveUri: async () => {
              const url = mediaUrlByPath[String(m.path || '')];
              if (!url) throw new Error('Missing media URL');
              return url;
            },
          });
        }

        return out;
      },
    });
  }, [
    decryptDmFileToCacheUri,
    decryptGroupFileToCacheUri,
    isDm,
    isGroup,
    mediaUrlByPath,
    messages,
  ]);

  const audioPlayback = useChatAudioPlayback({ queue: audioQueue });
  const audioPlaybackForRender = useChatAudioPlaybackForRender(audioPlayback, showAlert);

  const markMySeen = React.useCallback(
    (messageCreatedAt: number, readAt: number) => {
      setMySeenAtByCreatedAt((prev) => ({
        ...prev,
        [String(messageCreatedAt)]: prev[String(messageCreatedAt)]
          ? Math.min(prev[String(messageCreatedAt)], readAt)
          : readAt,
      }));
    },
    [setMySeenAtByCreatedAt],
  );

  // Keypair + myUserId hydration is handled by useChatMyKeys().

  useChatAutoDecrypt({
    autoDecrypt,
    myPrivateKey,
    myUserId,
    myPublicKey,
    peerPublicKey,
    isDm,
    isGroup,
    messages,
    setMessages,
    decryptForDisplay,
    decryptGroupForDisplay,
    parseDmMediaEnvelope,
    parseGroupMediaEnvelope,
    normalizeDmMediaItems,
    normalizeGroupMediaItems,
    markMySeen,
    sendReadReceipt,
  });

  // Peer public key hydration (DM) is handled by useHydratePeerPublicKey().

  const lastGroupRosterRefreshAtRef = React.useRef<number>(0);
  const lastChannelRosterRefreshAtRef = React.useRef<number>(0);

  // ws event handlers should always call the latest roster refresher.
  const refreshChannelRosterRef = React.useRef<null | (() => Promise<void>)>(null);
  React.useEffect(() => {
    refreshChannelRosterRef.current = refreshChannelRoster;
  }, [refreshChannelRoster]);

  useHydrateGroupRoster({
    enabled: isGroup,
    apiUrl: API_URL,
    activeConversationId,
    groupRefreshNonce,
    setGroupMeta,
    setGroupMembers,
    setGroupPublicKeyBySub,
    upsertAvatarProfiles,
  });

  useGroupReadOnlyRefreshTicker({
    enabled: isGroup,
    meStatus: groupMeta?.meStatus,
    tickMs: 4000,
    setGroupRefreshNonce,
  });
  // group UI state comes from useChatGroupUiState()

  // Don't auto-focus the "Add usernames" input when opening the Members modal.
  // This prevents the keyboard from sliding up unnecessarily on mobile.
  // (Users can tap the input when they actually want to add members.)

  useRefreshGroupRosterOnMembersModalOpen({
    enabled: isGroup,
    groupMembersOpen,
    lastGroupRosterRefreshAtRef,
    setGroupRefreshNonce,
  });

  const { channelUpdate, channelLeave, groupUpdate, groupLeave } = useChatAdminOps({
    apiUrl: API_URL,
    activeConversationId,
    isChannel,
    isGroup,
    myUserId,
    wsRef,
    showAlert,
    uiConfirm,
    showToast,
    refreshChannelRoster,
    setChannelActionBusy,
    setGroupActionBusy,
    channelMetaMeIsAdmin: !!channelMeta?.meIsAdmin,
    channelMembers,
    setChannelMembers,
    setChannelMeta,
    setChannelMembersOpen,
    onKickedFromConversation: onKickedFromConversationRef.current,
    groupMetaMeIsAdmin: !!groupMeta?.meIsAdmin,
    groupMembers,
    setGroupMeta,
    bumpGroupRefreshNonce: () => setGroupRefreshNonce((v) => v + 1),
  });

  const groupMembersModalActions = useGroupMembersModalActions({
    groupAddMembersDraft,
    setGroupAddMembersDraft,
    groupUpdate,
    uiConfirm,
    wsRef,
    activeConversationId,
    setGroupMembersOpen,
  });
  const channelMembersModalActions = useChannelMembersModalActions({
    channelAddMembersDraft,
    setChannelAddMembersDraft,
    uiConfirm,
    wsRef,
    activeConversationId,
    channelUpdate,
    setChannelMembers,
    setChannelMembersOpen,
  });

  const channelSettingsPanelActions = useChannelSettingsPanelActions({
    channelMeta,
    setChannelMeta,
    setChannelActionBusy,
    channelUpdate,
    showToast,
    uiAlert,
    uiChoice3,
    setChannelPasswordDraft,
    setChannelPasswordEditOpen,
  });

  const groupNameModalActions = useGroupNameModalActions({
    wsRef,
    activeConversationId,
    groupNameDraft,
    setGroupNameDraft,
    setGroupNameEditOpen,
    groupUpdate,
    setGroupMeta,
    computeDefaultGroupTitleForMe,
    onConversationTitleChanged,
  });

  const channelAboutModalActions = useChannelAboutModalActions({
    activeConversationId,
    channelMeta,
    channelAboutEdit,
    channelAboutDraft,
    setChannelAboutDraft,
    setChannelAboutEdit,
    setChannelAboutOpen,
    channelUpdate,
    markChannelAboutSeen,
    wsRef,
  });

  const channelNameModalActions = useChannelNameModalActions({
    wsRef,
    activeConversationId,
    channelNameDraft,
    setChannelMeta,
    setChannelNameEditOpen,
    channelUpdate,
  });

  const channelPasswordModalActions = useChannelPasswordModalActions({
    channelPasswordDraft,
    channelUpdate,
    setChannelMeta,
    setChannelPasswordEditOpen,
    setChannelPasswordDraft,
    showAlert,
  });

  const onWsMessage = useChatWsMessageHandler({
    activeConversationIdRef,
    displayNameRef,
    myUserId,
    myPublicKeyRef,
    blockedSubsSet,
    hiddenMessageIds,
    encryptedPlaceholder: ENCRYPTED_PLACEHOLDER,
    avatarRefetchCooldownMs: AVATAR_REFETCH_ON_MESSAGE_COOLDOWN_MS,
    lastAvatarRefetchAtBySubRef,
    invalidateAvatarProfile,
    onNewDmNotification: onNewDmNotificationRef.current,
    refreshUnreads: refreshUnreadsRef.current,
    onKickedFromConversation: onKickedFromConversationRef.current,
    openInfo,
    showAlert,
    showToast,
    refreshChannelRoster: refreshChannelRosterRef.current || undefined,
    lastGroupRosterRefreshAtRef,
    lastChannelRosterRefreshAtRef,
    bumpGroupRefreshNonce: () => setGroupRefreshNonce((n) => n + 1),
    setGroupMeStatus: (meStatus) => setGroupMeta((prev) => (prev ? { ...prev, meStatus } : prev)),
    setMessages,
    setPeerSeenAtByCreatedAt,
    setTypingByUserExpiresAt,
    sendTimeoutRef,
    parseEncrypted,
    parseGroupEncrypted,
    decryptForDisplay,
    decryptGroupForDisplay,
    parseDmMediaEnvelope,
    parseGroupMediaEnvelope,
    normalizeUser,
    normalizeReactions,
  });

  const { isConnecting, isConnected } = useChatWsConnection({
    user,
    wsUrl: WS_URL,
    wsRef,
    appStateRef,
    activeConversationIdRef,
    pendingJoinConversationIdRef,
    flushPendingRead,
    setError,
    onMessage: onWsMessage,
  });

  const { isTypingRef, sendTyping, typingIndicatorText } = useChatTyping({
    wsRef,
    activeConversationId,
    displayName,
    typingByUserExpiresAt,
    setTypingByUserExpiresAt,
  });

  // Client-side hiding of expired DM messages (server-side TTL still required for real deletion).
  usePruneExpiredMessages({ enabled: isDm, setMessages, intervalMs: 10_000 });

  const { sendMessage, retryFailedMessage } = useChatSendActions({
    wsRef,
    activeConversationId,
    displayName,
    myUserId,
    isDm,
    isGroup,
    isChannel,
    inputRef,
    pendingMediaRef,
    textInputRef,
    setError,
    setMessages,
    setInput,
    setInputEpoch,
    setPendingMediaItems,
    clearPendingMedia,
    replyTarget,
    setReplyTarget,
    inlineEditTargetId,
    isUploading,
    setIsUploading,
    onBlockedByInlineEdit: () => {
      // NOTE: openInfo is declared later in this file, so avoid referencing it here.
      setInfoTitle('Finish editing');
      setInfoBody('Save or cancel the edit before sending a new message.');
      setInfoOpen(true);
    },
    isTypingRef,
    groupMeta,
    groupMembers,
    groupPublicKeyBySub,
    maxAttachmentsPerMessage: MAX_ATTACHMENTS_PER_MESSAGE,
    myPrivateKey,
    peerPublicKey,
    getRandomBytes,
    encryptChatMessageV1,
    prepareDmOutgoingEncryptedText,
    prepareGroupMediaPlaintext,
    encryptGroupOutgoingEncryptedText,
    uploadPendingMedia,
    uploadPendingMediaDmEncrypted,
    uploadPendingMediaGroupEncrypted,
    timestampId,
    applyOptimisticSendForTextOnly,
    sendTimeoutRef,
    autoDecrypt,
    encryptedPlaceholder: ENCRYPTED_PLACEHOLDER,
    ttlSeconds: isDm && TTL_OPTIONS[ttlIdx]?.seconds ? TTL_OPTIONS[ttlIdx].seconds : undefined,
    parseEncrypted,
    parseGroupEncrypted,
    normalizeUser,
    showAlert,
  });

  useChatConversationJoin({ activeConversationId, wsRef, pendingJoinConversationIdRef });

  const { onChangeInput } = useChatComposerInput({ setInput, inputRef, isTypingRef, sendTyping });
  const { copyToClipboard } = useChatCopyToClipboard({
    openInfo,
    onCopied: () => showToast('Copied', 'success'),
  });

  const onPressMessage = useChatPressToDecrypt({
    isDm,
    isGroup,
    encryptedPlaceholder: ENCRYPTED_PLACEHOLDER,
    myUserId,
    myPublicKey,
    decryptForDisplay,
    decryptGroupForDisplay,
    parseDmMediaEnvelope,
    parseGroupMediaEnvelope,
    normalizeDmMediaItems,
    normalizeGroupMediaItems,
    setMessages,
    sendReadReceipt,
    markMySeen,
    openInfo,
  });

  // reaction emoji lists live in features/chat/reactionEmojis

  const { beginReply } = useChatReplyActions({
    isDm,
    encryptedPlaceholder: ENCRYPTED_PLACEHOLDER,
    dmThumbUriByPath,
    mediaUrlByPath,
    closeMessageActions,
    focusComposer: () => {
      textInputRef.current?.focus?.();
    },
    setReplyTarget,
    getPreviewKind,
  });

  const { beginInlineEdit, cancelInlineEdit, commitInlineEdit } = useChatInlineEditActions({
    wsRef,
    activeConversationId,
    isDm,
    isGroup,
    messages,
    setMessages,
    setError,
    inlineEditTargetId,
    setInlineEditTargetId,
    inlineEditDraft,
    setInlineEditDraft,
    inlineEditAttachmentMode,
    setInlineEditAttachmentMode,
    inlineEditUploading,
    setInlineEditUploading,
    pendingMediaRef,
    clearPendingMedia,
    myUserId,
    groupMembers,
    groupPublicKeyBySub,
    getRandomBytes,
    myPrivateKey,
    peerPublicKey,
    encryptChatMessageV1,
    parseEncrypted,
    parseGroupEncrypted,
    prepareGroupMediaPlaintext,
    encryptGroupOutgoingEncryptedText,
    parseChatEnvelope,
    parseDmMediaEnvelope,
    parseGroupMediaEnvelope,
    normalizeDmMediaItems,
    normalizeGroupMediaItems,
    uploadPendingMedia,
    uploadPendingMediaDmEncrypted,
    uploadPendingMediaGroupEncrypted,
    openInfo,
    showAlert,
    closeMessageActions,
  });

  const messageOps = useChatMessageOps({
    wsRef,
    activeConversationId,
    myUserId,
    messageActionTarget,
    closeMessageActions,
    setError,
    setMessages,
    hideMessageId,
    setReactionPickerOpen,
    setReactionPickerTarget,
    openReactionInfo: reactionInfo.openReactionInfo,
    showAlert,
  });
  const deleteForMe = messageOps.deleteForMe;
  const selectedMessages = React.useMemo(() => {
    if (!selectionActive) return [];
    if (!selectedMessageIds.length) return [];
    const byId = new Map(messages.map((m) => [String(m.id), m] as const));
    return selectedMessageIds
      .map((id) => byId.get(String(id)) || null)
      .filter(Boolean) as ChatMessage[];
  }, [messages, selectedMessageIds, selectionActive]);

  const selectedCopyText = React.useMemo(() => {
    if (!selectionActive) return null;
    const parts = selectedMessages
      .map((m) => getCopyableMessageText({ msg: m, isDm }))
      .filter((t): t is string => !!t);
    return parts.length ? parts.join('\n\n') : null;
  }, [isDm, selectedMessages, selectionActive]);

  const copySelectedMessages = React.useCallback(async () => {
    if (!selectedCopyText) return;
    await copyToClipboard(selectedCopyText);
    exitSelectionMode();
  }, [copyToClipboard, exitSelectionMode, selectedCopyText]);

  const deleteSelectedMessagesForMe = React.useCallback(async () => {
    if (!selectionActive) return;
    if (!selectedMessages.length) return;
    const ok = await uiConfirm(
      'Delete Selected Messages?',
      'This will only delete the messages for you',
      {
        confirmText: 'Delete',
        cancelText: 'Cancel',
        destructive: true,
      },
    );
    if (!ok) return;
    // Delete best-effort; ignore failures per-message.
    for (const m of selectedMessages) {
      try {
        // Skip already deleted.
        if (m.deletedAt) continue;
        await Promise.resolve(deleteForMe(m));
      } catch {
        // ignore
      }
    }
    exitSelectionMode();
  }, [deleteForMe, exitSelectionMode, selectedMessages, selectionActive, uiConfirm]);

  const selectionCanDeleteForEveryone = React.useMemo(() => {
    if (!selectionActive) return false;
    if (!selectedMessages.length) return false;
    return selectedMessages.every((m) => {
      if (!m || m.deletedAt) return false;
      const isOutgoingByUserSub =
        !!myUserId && !!m.userSub && String(m.userSub) === String(myUserId);
      const isEncryptedOutgoing =
        !!m.encrypted && !!myPublicKey && m.encrypted.senderPublicKey === myPublicKey;
      const isPlainOutgoing =
        !m.encrypted &&
        (isOutgoingByUserSub
          ? true
          : normalizeUser(m.userLower ?? m.user ?? 'anon') === normalizeUser(displayName));
      return isOutgoingByUserSub || isEncryptedOutgoing || isPlainOutgoing;
    });
  }, [displayName, myPublicKey, myUserId, selectedMessages, selectionActive]);

  const deleteSelectedMessagesForEveryone = React.useCallback(async () => {
    if (!selectionActive) return;
    if (!selectedMessages.length) return;
    if (!selectionCanDeleteForEveryone) return;

    const ok = await uiConfirm(
      'Delete Selected Messages?',
      'This will delete the messages for everyone',
      {
        confirmText: 'Delete',
        cancelText: 'Cancel',
        destructive: true,
      },
    );
    if (!ok) return;

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError('Not connected');
      return;
    }

    const now = Date.now();
    const idsToDelete = new Set(selectedMessages.map((m) => String(m.id)));

    // Optimistic local update (single pass).
    setMessages((prev) =>
      prev.map((m) =>
        idsToDelete.has(String(m.id))
          ? {
              ...m,
              deletedAt: now,
              rawText: '',
              text: '',
              encrypted: undefined,
              decryptedText: undefined,
            }
          : m,
      ),
    );

    // Best-effort server deletes (ignore per-message failures).
    for (const m of selectedMessages) {
      try {
        if (m.deletedAt) continue;
        wsRef.current.send(
          JSON.stringify({
            action: 'delete',
            conversationId: activeConversationId,
            messageCreatedAt: m.createdAt,
            createdAt: Date.now(),
          }),
        );
      } catch {
        // ignore
      }
    }

    exitSelectionMode();
  }, [
    activeConversationId,
    exitSelectionMode,
    selectedMessages,
    selectionActive,
    selectionCanDeleteForEveryone,
    setError,
    setMessages,
    uiConfirm,
  ]);
  const sendDelete = messageOps.sendDeleteForEveryone;
  const sendReaction = messageOps.sendReaction;
  const openReactionPicker = messageOps.openReactionPicker;
  const closeReactionPicker = messageOps.closeReactionPicker;
  const openReactionInfo = messageOps.openReactionInfoFor;

  const getSeenLabelFor = React.useCallback(getSeenLabelForCreatedAt, []);

  const onPressSummarize = React.useCallback(
    () => aiConsentGate.request('summary', runAiAction),
    [aiConsentGate, runAiAction],
  );
  const onPressAiHelper = React.useCallback(
    () => aiConsentGate.request('helper', runAiAction),
    [aiConsentGate, runAiAction],
  );
  const onOpenTtlPicker = React.useCallback(() => {
    setTtlIdxDraft(ttlIdx);
    setTtlPickerOpen(true);
  }, [setTtlIdxDraft, setTtlPickerOpen, ttlIdx]);

  const listRenderItem = React.useCallback(
    ({ item, index }: { item: ChatMessage; index: number }) =>
      renderChatListItem({
        styles,
        item,
        index,
        messageListData,
        visibleMessages,
        isDark,
        isDm,
        isGroup,
        isEncryptedChat,
        myUserId,
        myPublicKey,
        displayName,
        nameBySub,
        avatarProfileBySub,
        avatarUrlByPath,
        peerSeenAtByCreatedAt,
        getSeenLabelFor,
        normalizeUser,
        nowSec,
        formatRemaining,
        showToast,
        mediaUrlByPath,
        dmThumbUriByPath,
        imageAspectByPath,
        setImageAspectByPath,
        EMPTY_URI_BY_PATH,
        AVATAR_GUTTER,
        chatViewportWidth,
        getCappedMediaSize,
        inlineEditTargetId,
        inlineEditDraft,
        setInlineEditDraft,
        inlineEditUploading,
        inlineEditAttachmentMode,
        pendingMedia,
        commitInlineEdit,
        cancelInlineEdit,
        openReactionInfo,
        sendReaction,
        openViewer,
        openDmMediaViewer,
        openGroupMediaViewer,
        requestOpenLink,
        decryptDmFileToCacheUri,
        decryptGroupFileToCacheUri,
        audioPlayback: audioPlaybackForRender,
        onPressMessage,
        openMessageActions: selectionActive ? (_m, _a) => {} : openMessageActions,
        latestOutgoingMessageId,
        retryFailedMessage,
        selectionActive,
        selectedIdSet,
        toggleSelectedMessageId,
      }),
    [
      AVATAR_GUTTER,
      cancelInlineEdit,
      chatViewportWidth,
      commitInlineEdit,
      decryptDmFileToCacheUri,
      decryptGroupFileToCacheUri,
      displayName,
      dmThumbUriByPath,
      getCappedMediaSize,
      getSeenLabelFor,
      imageAspectByPath,
      setImageAspectByPath,
      inlineEditAttachmentMode,
      inlineEditDraft,
      inlineEditTargetId,
      inlineEditUploading,
      isDark,
      isDm,
      isEncryptedChat,
      isGroup,
      latestOutgoingMessageId,
      mediaUrlByPath,
      messageListData,
      myPublicKey,
      myUserId,
      nameBySub,
      nowSec,
      onPressMessage,
      openDmMediaViewer,
      openGroupMediaViewer,
      openMessageActions,
      openReactionInfo,
      openViewer,
      audioPlaybackForRender,
      peerSeenAtByCreatedAt,
      pendingMedia,
      requestOpenLink,
      retryFailedMessage,
      sendReaction,
      setInlineEditDraft,
      showToast,
      avatarProfileBySub,
      avatarUrlByPath,
      visibleMessages,
      selectionActive,
      selectedIdSet,
      toggleSelectedMessageId,
    ],
  );

  const mainProps = buildChatScreenMainProps({
    styles,
    isDark,
    isWideChatLayout,
    headerTop,
    headerTitle,
    onPressSummarize,
    onPressAiHelper,
    displayName,
    myUserId,
    avatarProfileBySub,
    avatarUrlByPath,
    myAvatarOverride,
    isConnecting,
    isConnected,
    isEncryptedChat,
    isChannel,
    dmSettingsOpen,
    setDmSettingsOpen,
    channelSettingsOpen,
    setChannelSettingsOpen,
    dmSettingsCompact: !!dmSettingsCompact,
    isDm,
    isGroup,
    myPrivateKeyReady: !!myPrivateKey,
    autoDecrypt,
    setAutoDecrypt,
    ttlLabel: TTL_OPTIONS[ttlIdx]?.label ?? 'Off',
    onOpenTtlPicker,
    sendReadReceipts,
    onToggleReadReceipts: (v) => onToggleReadReceipts(!!v),
    groupMembersCountLabel,
    groupActionBusy: !!groupActionBusy,
    groupMeIsAdmin: !!groupMeta?.meIsAdmin,
    onOpenGroupMembers: () => setGroupMembersOpen(true),
    onOpenGroupName: () => {
      setGroupNameDraft(groupMeta?.groupName || '');
      setGroupNameEditOpen(true);
    },
    onLeaveGroup: () => void groupLeave(),
    channelBusy: !!channelActionBusy,
    channelMeIsAdmin: !!channelMeta?.meIsAdmin,
    channelIsPublic: !!channelMeta?.isPublic,
    channelHasPassword: !!channelMeta?.hasPassword,
    channelMembersCountLabel,
    onOpenChannelMembers: () => setChannelMembersOpen(true),
    onOpenChannelAbout: () => {
      setChannelAboutDraft(String(channelMeta?.aboutText || ''));
      setChannelAboutEdit(true);
      setChannelAboutOpen(true);
    },
    onOpenChannelName: () => {
      setChannelNameDraft(channelMeta?.name || '');
      setChannelNameEditOpen(true);
    },
    onLeaveChannel: () => void channelLeave(),
    channelOnTogglePublic: channelSettingsPanelActions.onTogglePublic,
    channelOnPressPassword: channelSettingsPanelActions.onPressPassword,
    error,
    resolvedChatBg,
    apiUrl: API_URL,
    listIsGroup: isGroup,
    groupStatus: groupMeta?.meStatus,
    visibleMessagesCount: visibleMessages.length,
    messageListData,
    webPinned,
    listRef: webPinned.listRef,
    historyHasMore,
    historyLoading,
    loadOlderHistory,
    renderItem: listRenderItem,
    composerIsDm: isDm,
    composerIsGroup: isGroup,
    composerIsEncryptedChat: isEncryptedChat,
    composerGroupMeta: groupMeta,
    inlineEditTargetId,
    inlineEditUploading,
    cancelInlineEdit,
    pendingMedia,
    setPendingMedia: setPendingMediaItems,
    isUploading,
    replyTarget,
    setReplyTarget,
    messages,
    openViewer,
    typingIndicatorText,
    TypingIndicator,
    typingColor: isDark ? styles.typingTextDark.color : styles.typingText.color,
    mentionSuggestions,
    insertMention,
    composerSafeAreaStyle,
    composerHorizontalInsetsStyle,
    composerBottomInsetBgHeight,
    textInputRef,
    inputEpoch,
    input,
    onChangeInput,
    isTypingRef,
    sendTyping,
    sendMessage,
    handlePickMedia,
    showAlert,
    stopAudioPlayback: () => void audioPlayback.stopAll(),
    selectionActive,
    selectionCount: selectedMessageIds.length,
    selectionCanCopy: !!selectedCopyText,
    selectionCanDeleteForEveryone,
    selectionOnCancel: exitSelectionMode,
    selectionOnCopy: () => void copySelectedMessages(),
    selectionOnDelete: () => void deleteSelectedMessagesForMe(),
    selectionOnDeleteForEveryone: () => void deleteSelectedMessagesForEveryone(),
  });

  const overlaysProps = buildChatScreenOverlaysProps({
    isDark,
    styles,
    insets: { top: insets.top, bottom: insets.bottom },
    aiSummary,
    isEncryptedChatForAiConsent: isEncryptedChat,
    aiConsentGate,
    runAiAction,
    attach: {
      open: attachOpen,
      setOpen: setAttachOpen,
      pickFromLibrary,
      openCamera,
      pickDocument,
    },
    camera: {
      open: cameraOpen,
      setOpen: setCameraOpen,
      showAlert,
      onCaptured: handleInAppCameraCaptured,
    },
    aiHelper,
    copyToClipboard,
    setInput,
    report: chatReport,
    cdnMedia,
    messageActionMenu,
    selectionActive,
    onSelectMessage: enterSelectionModeForMessage,
    myUserId,
    myPublicKey,
    displayName,
    isDm,
    encryptedPlaceholder: ENCRYPTED_PLACEHOLDER,
    normalizeUser,
    mediaUrlByPath,
    dmThumbUriByPath,
    messageListData,
    quickReactions: [...QUICK_REACTIONS],
    blockedSubsSet,
    onBlockUserSub,
    uiConfirm,
    uiChoice3,
    messageOps: {
      deleteForMe,
      sendDeleteForEveryone: sendDelete,
      sendReaction,
      openReactionPicker,
      setCipherText,
      setCipherOpen,
      beginReply,
      beginInlineEdit,
      setInlineEditAttachmentMode,
      handlePickMedia,
      clearPendingMedia,
      openReportModalForMessage: chatReport.openReportModalForMessage,
    },
    reactionPickerOpen,
    reactionPickerTarget,
    emojis: [...MORE_REACTIONS],
    closeReactionPicker,
    cipher: { open: cipherOpen, text: cipherText, setOpen: setCipherOpen, setText: setCipherText },
    reactionInfo,
    nameBySub,
    info: { infoOpen, infoTitle, infoBody, setInfoOpen },
    ttl: {
      ttlPickerOpen,
      TTL_OPTIONS,
      ttlIdx,
      ttlIdxDraft,
      setTtlIdxDraft,
      setTtlPickerOpen,
      setTtlIdx,
    },
    groupNameEditOpen,
    groupActionBusy,
    groupNameDraft,
    setGroupNameDraft,
    groupNameModalActions,
    groupMembersOpen,
    groupMeta,
    groupAddMembersDraft,
    setGroupAddMembersDraft,
    groupMembersModalActions,
    groupAddMembersInputRef,
    groupMembersVisible,
    kickCooldownUntilBySub,
    avatarUrlByPath,
    groupKick,
    groupUpdate,
    channelMembersOpen,
    channelMembersVisible,
    channelMeta,
    channelActionBusy,
    channelMembersModalActions,
    channelAddMembersDraft,
    setChannelAddMembersDraft,
    channelAddMembersInputRef,
    channelUpdate,
    channelKick,
    channelAboutOpen,
    channelAboutEdit,
    channelAboutDraft,
    setChannelAboutDraft,
    setChannelAboutEdit,
    channelAboutModalActions,
    requestOpenLink,
    channelNameEditOpen,
    channelNameDraft,
    setChannelNameDraft,
    channelNameModalActions,
    channelPasswordEditOpen,
    channelPasswordDraft,
    setChannelPasswordDraft,
    channelPasswordModalActions,
    viewer,
    dmFileUriByPath,
    confirmLinkModal,
    toast,
    toastAnim,
  });

  return (
    <SafeAreaView
      style={[styles.safe, isDark ? styles.safeDark : null]}
      // Web: ignore safe-area left/right insets (they can be misreported as ~42px and flip with rotation).
      edges={Platform.OS === 'web' ? [] : ['left', 'right']}
    >
      <ChatScreenMain {...mainProps} />
      <ChatScreenOverlays {...overlaysProps} />
    </SafeAreaView>
  );
}
