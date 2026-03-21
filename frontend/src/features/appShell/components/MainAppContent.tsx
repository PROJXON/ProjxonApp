import { fetchAuthSession } from '@aws-amplify/auth';
import { useAuthenticator } from '@aws-amplify/ui-react-native/dist';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { deleteUser, fetchUserAttributes } from 'aws-amplify/auth';
import React, { useState } from 'react';
import type { Pressable } from 'react-native';
import { useWindowDimensions, View } from 'react-native';

import { styles } from '../../../../App.styles';
import { AVATAR_DEFAULT_COLORS } from '../../../components/AvatarBubble';
import { API_URL, CDN_URL } from '../../../config/env';
import { useCdnUrlCache } from '../../../hooks/useCdnUrlCache';
import { useMenuAnchor } from '../../../hooks/useMenuAnchor';
import { useStoredTheme } from '../../../hooks/useStoredTheme';
import { useViewportWidth } from '../../../hooks/useViewportWidth';
import { useUiPrompt } from '../../../providers/UiPromptProvider';
import ChatScreen from '../../../screens/ChatScreen';
import { getAppThemeColors } from '../../../theme/colors';
import type { AmplifyUiUser } from '../../../types/amplifyUi';
import { formatChatActivityDate } from '../../../utils/chatDates';
import {
  decryptPrivateKey,
  derivePublicKey,
  encryptPrivateKey,
  generateKeypair,
  loadKeyPair,
  storeKeyPair,
} from '../../../utils/crypto';
import { GLOBAL_ABOUT_VERSION } from '../../../utils/globalAbout';
import {
  registerForDmPushNotifications,
  setForegroundNotificationPolicy,
  unregisterDmPushNotifications,
} from '../../../utils/pushNotifications';
import { useGlobalAboutOncePerVersion } from '../../globalAbout/useGlobalAboutOncePerVersion';
import { useAuthApiHelpers } from '../hooks/useAuthApiHelpers';
import { useBlocklistData } from '../hooks/useBlocklistData';
import { useChannelsFlow } from '../hooks/useChannelsFlow';
import { useChatBackgroundSettings } from '../hooks/useChatBackgroundSettings';
import { useChatsInboxData } from '../hooks/useChatsInboxData';
import { useConversationNavigation } from '../hooks/useConversationNavigation';
import { useConversationTitleChanged } from '../hooks/useConversationTitleChanged';
import { useDeleteAccountFlow } from '../hooks/useDeleteAccountFlow';
import { useDeleteConversationFromList } from '../hooks/useDeleteConversationFromList';
import { useDmUnreadsAndPush } from '../hooks/useDmUnreadsAndPush';
import { useLastChannelConversation } from '../hooks/useLastChannelConversation';
import { useLastConversation } from '../hooks/useLastConversation';
import { useLastDmConversation } from '../hooks/useLastDmConversation';
import { useMyAvatarSettings } from '../hooks/useMyAvatarSettings';
import { usePassphrasePrompt } from '../hooks/usePassphrasePrompt';
import { useRecoveryFlow } from '../hooks/useRecoveryFlow';
import { useSignedInBootstrap } from '../hooks/useSignedInBootstrap';
import { useStartDmFlow } from '../hooks/useStartDmFlow';
import { MainAppAvatarModal } from './MainAppAvatarModal';
import { MainAppBackgroundModal } from './MainAppBackgroundModal';
import { MainAppBlocklistModal } from './MainAppBlocklistModal';
import { MainAppChannelsModals } from './MainAppChannelsModals';
import { MainAppChatsAndRecoveryModals } from './MainAppChatsAndRecoveryModals';
import { MainAppHeaderTop } from './MainAppHeaderTop';
import { MainAppMenuAndAboutOverlays } from './MainAppMenuAndAboutOverlays';
import { MainAppPassphrasePromptModal } from './MainAppPassphrasePromptModal';

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || 'unknown error';
  if (typeof err === 'string') return err || 'unknown error';
  if (!err) return 'unknown error';
  try {
    const rec = err as Record<string, unknown>;
    const msg = rec?.message;
    return typeof msg === 'string' && msg ? msg : 'unknown error';
  } catch {
    return 'unknown error';
  }
}

function getUsernameFromAuthenticatorUser(user: AmplifyUiUser): string | undefined {
  if (!user || typeof user !== 'object') return undefined;
  const u = 'username' in user ? (user as { username?: unknown }).username : undefined;
  return typeof u === 'string' && u.trim() ? u.trim() : undefined;
}

function readCachedDisplayNameSync(): string {
  // Web-only: localStorage is synchronous; use it to avoid flashing "anon" before bootstrap finishes.
  try {
    const raw = globalThis?.localStorage?.getItem?.('ui:lastDisplayName:device');
    const v = typeof raw === 'string' ? raw.trim() : '';
    return v || '';
  } catch {
    return '';
  }
}

function looksLikeOpaqueCognitoUsername(s: string): boolean {
  const v = String(s || '').trim();
  if (!v) return false;
  // Common Cognito username format for some setups: UUID.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return true;
  // Generic "opaque id" heuristic: long + lots of dashes.
  if (v.length >= 28 && (v.match(/-/g) || []).length >= 3) return true;
  return false;
}

type LastChannelLabelCache = { conversationId: string; label: string };
const LAST_CHANNEL_LABEL_CACHE_KEY = 'ui:lastChannelLabel:device';

export const MainAppContent = ({
  onSignedOut,
  onRehydrateReady,
}: {
  onSignedOut?: () => void;
  onRehydrateReady?: (ready: boolean) => void;
}) => {
  const { user } = useAuthenticator();
  const { signOut } = useAuthenticator();
  const {
    alert: promptAlert,
    confirm: promptConfirm,
    choice3: promptChoice3,
    isOpen: uiPromptOpen,
  } = useUiPrompt();
  const cdn = useCdnUrlCache(CDN_URL);
  const [displayName, setDisplayName] = useState<string>(() => readCachedDisplayNameSync());
  const [myUserSub, setMyUserSub] = React.useState<string | null>(null);
  // Bump this whenever we change/recover/reset keys so ChatScreen reloads them from storage.
  const [keyEpoch, setKeyEpoch] = React.useState<number>(0);

  const {
    avatarOpen,
    setAvatarOpen,
    avatarSaving,
    setAvatarSaving,
    avatarSavingRef,
    avatarError,
    setAvatarError,
    myAvatar,
    setMyAvatar,
    avatarDraft,
    setAvatarDraft,
    avatarDraftImageUri,
    setAvatarDraftImageUri,
    avatarDraftRemoveImage,
    setAvatarDraftRemoveImage,
    saveAvatarToStorageAndServer,
  } = useMyAvatarSettings({
    userSub: myUserSub,
    apiUrl: API_URL,
    fetchAuthSession,
    cdn,
  });

  const {
    chatBackground,
    setChatBackground,
    chatBackgroundImageScaleMode,
    setChatBackgroundImageScaleMode,
    backgroundOpen,
    setBackgroundOpen,
    backgroundSaving,
    setBackgroundSaving,
    backgroundSavingRef,
    backgroundError,
    setBackgroundError,
    backgroundDraft,
    setBackgroundDraft,
    backgroundDraftImageUri,
    setBackgroundDraftImageUri,
    bgEffectBlur,
    setBgEffectBlur,
    bgEffectOpacity,
    setBgEffectOpacity,
    bgImageScaleModeDraft,
    setBgImageScaleModeDraft,
  } = useChatBackgroundSettings();

  const [hasRecoveryBlob, setHasRecoveryBlob] = useState(false);
  // hasRecoveryBlob defaults false; track whether we've actually checked the server this session.
  const [recoveryBlobKnown, setRecoveryBlobKnown] = useState(false);
  const [recoveryLocked, setRecoveryLocked] = React.useState<boolean>(false);
  const {
    promptPassphrase,
    closePrompt,
    setProcessing,
    modalProps: passphraseModalProps,
  } = usePassphrasePrompt({
    uiPromptOpen,
    promptConfirm,
    promptChoice3: promptChoice3 as (...args: unknown[]) => Promise<unknown>,
  });

  const { deleteMyAccount } = useDeleteAccountFlow({
    apiUrl: API_URL,
    myUserSub,
    promptAlert,
    promptConfirm,
    unregisterDmPushNotifications,
    fetchAuthSession,
    deleteUser,
    signOut: () => Promise.resolve(signOut()),
    onSignedOut,
    getErrorMessage,
  });

  const applyRecoveryBlobExists = (exists: boolean) => {
    setRecoveryBlobKnown(true);
    setHasRecoveryBlob(exists);
  };

  const { uploadRecoveryBlob, checkRecoveryBlobExists, getIdTokenWithRetry, uploadPublicKey } =
    useAuthApiHelpers({
      apiUrl: API_URL,
      fetchAuthSession,
      encryptPrivateKey,
    });

  useSignedInBootstrap({
    user,
    apiUrl: API_URL,
    fetchAuthSession,
    fetchUserAttributes,
    getUsernameFromAuthenticatorUser,
    setForegroundNotificationPolicy,
    setHasRecoveryBlob,
    setRecoveryBlobKnown,
    setRecoveryLocked,
    setProcessing,
    setMyUserSub: (v) => setMyUserSub(v),
    setDisplayName,
    loadKeyPair,
    storeKeyPair,
    derivePublicKey,
    decryptPrivateKey,
    generateKeypair,
    uploadPublicKey,
    uploadRecoveryBlob,
    checkRecoveryBlobExists,
    applyRecoveryBlobExists,
    getIdTokenWithRetry,
    promptPassphrase,
    closePrompt,
    bumpKeyEpoch: () => setKeyEpoch((v) => v + 1),
    promptAlert,
  });

  // Mobile-only: hydrate cached display name ASAP so we don't flash an opaque Cognito username.
  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('ui:lastDisplayName:device');
        const v = typeof raw === 'string' ? raw.trim() : '';
        if (!mounted) return;
        if (!v) return;
        setDisplayName((prev) => (String(prev || '').trim() ? prev : v));
      } catch {
        // ignore
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Mobile-only: hydrate cached "home channel label" ASAP so we don't flash the generic "Channel".
  const [lastChannelLabelCache, setLastChannelLabelCache] =
    React.useState<LastChannelLabelCache | null>(null);
  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(LAST_CHANNEL_LABEL_CACHE_KEY);
        const rec = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
        const conversationId =
          rec && typeof rec.conversationId === 'string' ? rec.conversationId.trim() : '';
        const label = rec && typeof rec.label === 'string' ? rec.label.trim() : '';
        if (!mounted) return;
        if (!conversationId || !label) return;
        if (conversationId !== 'global' && !conversationId.startsWith('ch#')) return;
        setLastChannelLabelCache({ conversationId, label });
      } catch {
        // ignore
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const effectiveDisplayName = (() => {
    const a = String(displayName || '').trim();
    if (a) return a;
    const b = String(getUsernameFromAuthenticatorUser(user) || '').trim();
    // Avoid showing a UUID-like Cognito username in the UI while we hydrate.
    if (looksLikeOpaqueCognitoUsername(b)) return 'anon';
    return b || 'anon';
  })();
  const currentUsername = effectiveDisplayName;

  const [conversationId, setConversationId] = useState<string>('global');
  const [peer, setPeer] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState<boolean>(false); // DM search
  const [peerInput, setPeerInput] = useState<string>('');
  const [searchError, setSearchError] = useState<string | null>(null);
  const [chatsOpen, setChatsOpen] = React.useState<boolean>(false);

  const {
    unreadDmMap,
    setUnreadDmMap,
    setDmThreads,
    serverConversations,
    setServerConversations,
    chatsLoading,
    titleOverrideByConvIdRef,
    upsertDmThread,
    dmThreadsList,
    chatsList,
    fetchUnreads,
  } = useChatsInboxData({ apiUrl: API_URL, fetchAuthSession, chatsOpen });

  const isDmMode = conversationId.startsWith('dm#') || conversationId.startsWith('gdm#');
  const isChannelMode = !isDmMode;
  const { channelRestoreDone, lastChannelConversationIdRef } = useLastChannelConversation({
    userSub: myUserSub,
    conversationId,
    setConversationId,
  });
  const { conversationRestoreDone } = useLastConversation({
    userSub: myUserSub,
    conversationId,
    setConversationId,
    setPeer,
    serverConversations,
    unreadDmMap,
  });
  const { lastDmConversationIdRef } = useLastDmConversation({
    userSub: myUserSub,
    conversationId,
  });

  const rehydrateReady = channelRestoreDone && conversationRestoreDone;
  React.useEffect(() => {
    onRehydrateReady?.(rehydrateReady);
  }, [onRehydrateReady, rehydrateReady]);

  const getIdToken = React.useCallback(async (): Promise<string | null> => {
    return await getIdTokenWithRetry({ maxAttempts: 10, delayMs: 200 });
  }, [getIdTokenWithRetry]);

  const {
    channelsOpen,
    setChannelsOpen,
    myChannelsLoading,
    myChannelsError,
    setMyChannelsError,
    myChannels,
    leaveChannelFromSettings,
    getLeaveChannelDecisionForIos,
    leaveChannelFromSettingsIosConfirmed,
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
    channelSearchOpen,
    setChannelSearchOpen,
    channelsQuery,
    setChannelsQuery,
    channelsLoading,
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
    channelNameById,
    setChannelNameById,
    enterChannelConversation,
  } = useChannelsFlow({
    apiUrl: API_URL,
    getIdToken,
    promptAlert,
    promptConfirm,
    currentConversationId: conversationId,
    setConversationId,
    setPeer,
    setSearchOpen,
    setPeerInput,
    setSearchError,
  });

  const { theme, setTheme, isDark } = useStoredTheme({
    storageKey: 'ui:theme',
    defaultTheme: 'light',
  });
  const appColors = getAppThemeColors(isDark);
  const [menuOpen, setMenuOpen] = React.useState<boolean>(false);
  const menu = useMenuAnchor<React.ElementRef<typeof Pressable>>();
  const { width: windowWidth } = useWindowDimensions();
  const { isWide: isWideUi } = useViewportWidth(windowWidth, {
    wideBreakpointPx: 900,
    maxContentWidthPx: 1040,
  });
  const [channelAboutRequestEpoch, setChannelAboutRequestEpoch] = React.useState<number>(0);
  const { globalAboutOpen, setGlobalAboutOpen, dismissGlobalAbout } =
    useGlobalAboutOncePerVersion(GLOBAL_ABOUT_VERSION);
  const [blocklistOpen, setBlocklistOpen] = React.useState<boolean>(false);
  const [recoveryOpen, setRecoveryOpen] = React.useState<boolean>(false);

  const {
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
  } = useBlocklistData({ apiUrl: API_URL, fetchAuthSession, promptConfirm, blocklistOpen });

  const { enterRecoveryPassphrase, setupRecovery, changeRecoveryPassphrase, resetRecovery } =
    useRecoveryFlow({
      apiUrl: API_URL,
      myUserSub,
      getIdToken,
      promptAlert,
      promptConfirm,
      promptPassphrase,
      closePrompt,
      decryptPrivateKey,
      derivePublicKey,
      storeKeyPair,
      loadKeyPair,
      generateKeypair,
      uploadPublicKey,
      uploadRecoveryBlob,
      bumpKeyEpoch: () => setKeyEpoch((v) => v + 1),
      setHasRecoveryBlob,
      setRecoveryBlobKnown,
      setRecoveryLocked,
    });

  const { handleConversationTitleChanged } = useConversationTitleChanged({
    conversationId,
    setPeer,
    setChannelNameById,
    titleOverrideByConvIdRef,
    setServerConversations,
    setUnreadDmMap,
    upsertDmThread,
  });

  const { deleteConversationFromList } = useDeleteConversationFromList({
    apiUrl: API_URL,
    fetchAuthSession,
    promptConfirm,
    setServerConversations,
    setDmThreads,
    setUnreadDmMap,
  });

  const { startDM } = useStartDmFlow({
    apiUrl: API_URL,
    peerInput,
    currentUsername,
    blockedSubs,
    fetchAuthSession,
    fetchUserAttributes,
    setPeer,
    setConversationId,
    upsertDmThread,
    setSearchOpen,
    setPeerInput,
    setSearchError,
  });

  const getChannelIdFromConversationId = React.useCallback((cid: string): string | null => {
    const s = String(cid || '').trim();
    if (!s.startsWith('ch#')) return null;
    const id = s.slice('ch#'.length).trim();
    return id || null;
  }, []);

  const activeChannelConversationId = React.useMemo(() => {
    if (!isDmMode) return conversationId || 'global';
    return lastChannelConversationIdRef.current || 'global';
  }, [conversationId, isDmMode, lastChannelConversationIdRef]);

  const activeChannelLabel = React.useMemo(() => {
    if (activeChannelConversationId === 'global') return 'Global';
    const id = getChannelIdFromConversationId(activeChannelConversationId);
    if (!id) return 'Global';
    const fromMap = String(channelNameById[id] || '').trim();
    if (fromMap) return fromMap;
    // If channels map hasn't hydrated yet, fall back to cached label (mobile).
    if (lastChannelLabelCache?.conversationId === activeChannelConversationId) {
      const cached = String(lastChannelLabelCache.label || '').trim();
      if (cached) return cached;
    }
    return 'Channel';
  }, [
    activeChannelConversationId,
    channelNameById,
    getChannelIdFromConversationId,
    lastChannelLabelCache,
  ]);

  // Persist last known home channel label (best-effort; used to avoid "Channel" flash on mobile).
  React.useEffect(() => {
    const convId = String(activeChannelConversationId || '').trim();
    if (!(convId === 'global' || convId.startsWith('ch#'))) return;
    // Don't persist generic placeholders.
    const label = String(activeChannelLabel || '').trim();
    if (!label || label === 'Channel') return;
    const payload: LastChannelLabelCache = { conversationId: convId, label };
    try {
      void AsyncStorage.setItem(LAST_CHANNEL_LABEL_CACHE_KEY, JSON.stringify(payload)).catch(
        () => {},
      );
    } catch {
      // ignore
    }
    // Keep local state in sync (so we can use it immediately for fallback).
    setLastChannelLabelCache(payload);
  }, [activeChannelConversationId, activeChannelLabel]);

  const activeDmLabel = React.useMemo(() => {
    // Prefer the current DM title when you're in a DM.
    if (isDmMode) {
      const t = typeof peer === 'string' ? peer.trim() : '';
      return t || 'DM';
    }
    // Otherwise show the last DM label (if we have one).
    const cid = String(lastDmConversationIdRef.current || '').trim();
    if (!(cid.startsWith('dm#') || cid.startsWith('gdm#'))) return 'DM';
    const fromChats = chatsList.find((c) => c.conversationId === cid);
    const t = String(fromChats?.peer || unreadDmMap[cid]?.user || '').trim();
    return t || 'DM';
  }, [chatsList, isDmMode, lastDmConversationIdRef, peer, unreadDmMap]);

  const { goToConversation } = useConversationNavigation({
    serverConversations,
    unreadDmMap,
    dmThreadsList,
    titleOverrideByConvIdRef,
    peer,
    upsertDmThread,
    setConversationId,
    setPeer,
    setSearchOpen,
    setPeerInput,
    setSearchError,
    setChannelsOpen,
    setChannelSearchOpen,
    setChannelsError,
    setChannelJoinError,
    setChannelsQuery,
  });

  const { hasUnreadDms, unreadEntries, handleNewDmNotification } = useDmUnreadsAndPush({
    user,
    conversationId,
    setConversationId,
    setPeer,
    setSearchOpen,
    setPeerInput,
    setSearchError,
    setChannelNameById,
    unreadDmMap,
    setUnreadDmMap,
    upsertDmThread,
    fetchUnreads,
    registerForDmPushNotifications,
  });

  const openFindChannels = React.useCallback(() => {
    setChannelsError(null);
    setChannelJoinError(null);
    setChannelsQuery('');
    setChannelSearchOpen(true);
  }, [setChannelJoinError, setChannelSearchOpen, setChannelsError, setChannelsQuery]);

  const goToLastChannel = React.useCallback(() => {
    const target = String(activeChannelConversationId || '').trim() || 'global';
    if (!target) return;
    if (!isDmMode && target === conversationId) return; // already there
    goToConversation(target);
  }, [activeChannelConversationId, conversationId, goToConversation, isDmMode]);

  const goToLastDmOrOpenDmSearch = React.useCallback(() => {
    // If you're already in a DM, treat the big pill as a "return to DM view":
    // close the Enter Names row if it's open.
    if (isDmMode) {
      setSearchOpen(false);
      setPeerInput('');
      setSearchError(null);
      return;
    }
    const v = String(lastDmConversationIdRef.current || '').trim();
    if (v.startsWith('dm#') || v.startsWith('gdm#')) {
      goToConversation(v);
      return;
    }
    // First-time / no last DM: fallback to showing Enter Names row.
    setSearchOpen(true);
  }, [
    goToConversation,
    isDmMode,
    lastDmConversationIdRef,
    setPeerInput,
    setSearchError,
    setSearchOpen,
  ]);

  const toggleDmSearchRow = React.useCallback(() => {
    setSearchOpen((prev) => !prev);
  }, [setSearchOpen]);

  const headerTop = (
    <MainAppHeaderTop
      styles={styles}
      isDark={isDark}
      isWideUi={isWideUi}
      activeChannelLabel={activeChannelLabel}
      activeDmLabel={activeDmLabel}
      isChannelMode={isChannelMode}
      isDmMode={isDmMode}
      hasUnreadDms={hasUnreadDms}
      peerInput={peerInput}
      setPeerInput={setPeerInput}
      searchOpen={searchOpen}
      setSearchOpen={setSearchOpen}
      searchError={searchError}
      setSearchError={setSearchError}
      unreadEntries={unreadEntries}
      goToConversation={goToConversation}
      menuRef={menu.ref}
      openMenu={() => {
        menu.openFromRef({ enabled: isWideUi, onOpen: () => setMenuOpen(true) });
      }}
      onPressChannelNav={goToLastChannel}
      onPressChannelSearch={openFindChannels}
      onPressDmNav={goToLastDmOrOpenDmSearch}
      onPressDmSearch={toggleDmSearchRow}
      onStartDm={startDM}
    />
  );

  return (
    <View style={[styles.appContent, isDark ? styles.appContentDark : null]}>
      <MainAppMenuAndAboutOverlays
        styles={styles}
        isDark={isDark}
        isWideUi={isWideUi}
        menuAnchor={menu.anchor}
        menuOpen={menuOpen}
        setMenuOpen={setMenuOpen}
        onSetTheme={setTheme}
        activeChannelConversationId={activeChannelConversationId}
        isDmMode={isDmMode}
        setGlobalAboutOpen={setGlobalAboutOpen}
        setChannelAboutRequestEpoch={setChannelAboutRequestEpoch}
        setChatsOpen={setChatsOpen}
        setMyChannelsError={setMyChannelsError}
        setCreateChannelError={setCreateChannelError}
        setCreateChannelOpen={setCreateChannelOpen}
        setCreateChannelName={setCreateChannelName}
        setCreateChannelPassword={setCreateChannelPassword}
        setCreateChannelIsPublic={setCreateChannelIsPublic}
        setChannelSearchOpen={setChannelSearchOpen}
        setChannelsError={setChannelsError}
        setChannelJoinError={setChannelJoinError}
        setChannelsQuery={setChannelsQuery}
        setChannelsOpen={setChannelsOpen}
        setAvatarError={setAvatarError}
        setAvatarOpen={setAvatarOpen}
        setBackgroundError={setBackgroundError}
        setBackgroundOpen={setBackgroundOpen}
        setRecoveryOpen={setRecoveryOpen}
        getIdTokenWithRetry={getIdTokenWithRetry}
        checkRecoveryBlobExists={checkRecoveryBlobExists}
        applyRecoveryBlobExists={applyRecoveryBlobExists}
        setBlocklistOpen={setBlocklistOpen}
        deleteMyAccount={deleteMyAccount}
        unregisterDmPushNotifications={unregisterDmPushNotifications}
        signOut={signOut}
        onSignedOut={onSignedOut}
        globalAboutOpen={globalAboutOpen}
        dismissGlobalAbout={dismissGlobalAbout}
      />

      <MainAppAvatarModal
        styles={styles}
        isDark={isDark}
        myUserSub={myUserSub}
        displayName={displayName}
        avatarOpen={avatarOpen}
        setAvatarOpen={setAvatarOpen}
        avatarSaving={avatarSaving}
        setAvatarSaving={setAvatarSaving}
        avatarSavingRef={avatarSavingRef}
        avatarError={avatarError}
        setAvatarError={setAvatarError}
        myAvatar={myAvatar}
        setMyAvatar={setMyAvatar}
        avatarDraft={avatarDraft}
        setAvatarDraft={setAvatarDraft}
        avatarDraftImageUri={avatarDraftImageUri}
        setAvatarDraftImageUri={setAvatarDraftImageUri}
        avatarDraftRemoveImage={avatarDraftRemoveImage}
        setAvatarDraftRemoveImage={setAvatarDraftRemoveImage}
        saveAvatarToStorageAndServer={saveAvatarToStorageAndServer}
      />

      <MainAppBackgroundModal
        styles={styles}
        isDark={isDark}
        avatarDefaultColors={AVATAR_DEFAULT_COLORS}
        backgroundOpen={backgroundOpen}
        setBackgroundOpen={setBackgroundOpen}
        backgroundSaving={backgroundSaving}
        setBackgroundSaving={setBackgroundSaving}
        backgroundSavingRef={backgroundSavingRef}
        chatBackground={chatBackground}
        setChatBackground={setChatBackground}
        chatBackgroundImageScaleMode={chatBackgroundImageScaleMode}
        setChatBackgroundImageScaleMode={setChatBackgroundImageScaleMode}
        backgroundDraft={backgroundDraft}
        setBackgroundDraft={setBackgroundDraft}
        backgroundDraftImageUri={backgroundDraftImageUri}
        setBackgroundDraftImageUri={setBackgroundDraftImageUri}
        backgroundError={backgroundError}
        setBackgroundError={setBackgroundError}
        bgEffectBlur={bgEffectBlur}
        setBgEffectBlur={setBgEffectBlur}
        bgEffectOpacity={bgEffectOpacity}
        setBgEffectOpacity={setBgEffectOpacity}
        bgImageScaleModeDraft={bgImageScaleModeDraft}
        setBgImageScaleModeDraft={setBgImageScaleModeDraft}
      />

      <MainAppChatsAndRecoveryModals
        styles={styles}
        isDark={isDark}
        recoveryOpen={recoveryOpen}
        setRecoveryOpen={setRecoveryOpen}
        recoveryLocked={recoveryLocked}
        recoveryBlobKnown={recoveryBlobKnown}
        hasRecoveryBlob={hasRecoveryBlob}
        enterRecoveryPassphrase={enterRecoveryPassphrase}
        setupRecovery={setupRecovery}
        changeRecoveryPassphrase={changeRecoveryPassphrase}
        resetRecovery={resetRecovery}
        chatsOpen={chatsOpen}
        setChatsOpen={setChatsOpen}
        chatsLoading={chatsLoading}
        chatsList={chatsList}
        goToConversation={goToConversation}
        deleteConversationFromList={deleteConversationFromList}
        formatChatActivityDate={formatChatActivityDate}
      />

      <MainAppChannelsModals
        styles={styles}
        isDark={isDark}
        channelsOpen={channelsOpen}
        setChannelsOpen={setChannelsOpen}
        myChannelsLoading={myChannelsLoading}
        myChannelsError={myChannelsError}
        myChannels={myChannels}
        enterChannelConversation={enterChannelConversation}
        leaveChannelFromSettings={leaveChannelFromSettings}
        getLeaveChannelDecisionForIos={getLeaveChannelDecisionForIos}
        leaveChannelFromSettingsIosConfirmed={leaveChannelFromSettingsIosConfirmed}
        createChannelOpen={createChannelOpen}
        setCreateChannelOpen={setCreateChannelOpen}
        createChannelName={createChannelName}
        setCreateChannelName={setCreateChannelName}
        createChannelPassword={createChannelPassword}
        setCreateChannelPassword={setCreateChannelPassword}
        createChannelIsPublic={createChannelIsPublic}
        setCreateChannelIsPublic={setCreateChannelIsPublic}
        createChannelLoading={createChannelLoading}
        setCreateChannelLoading={setCreateChannelLoading}
        createChannelError={createChannelError}
        setCreateChannelError={setCreateChannelError}
        submitCreateChannelInline={submitCreateChannelInline}
        channelSearchOpen={channelSearchOpen}
        setChannelSearchOpen={setChannelSearchOpen}
        // Keep the "home/last channel" pinned at the top of Find Channels consistently
        // (otherwise "Global" appears first when you're already in a channel).
        showPinnedChannelInSearch
        pinnedChannelConversationId={activeChannelConversationId}
        pinnedChannelLabel={activeChannelLabel}
        channelsQuery={channelsQuery}
        setChannelsQuery={setChannelsQuery}
        channelsLoading={channelsLoading}
        channelsError={channelsError}
        setChannelsError={setChannelsError}
        channelJoinError={channelJoinError}
        setChannelJoinError={setChannelJoinError}
        globalUserCount={globalUserCount}
        channelsResults={channelsResults}
        fetchChannelsSearch={fetchChannelsSearch}
        joinChannel={joinChannel}
        channelPasswordPrompt={channelPasswordPrompt}
        setChannelPasswordPrompt={setChannelPasswordPrompt}
        channelPasswordInput={channelPasswordInput}
        setChannelPasswordInput={setChannelPasswordInput}
        channelPasswordSubmitting={channelPasswordSubmitting}
        submitChannelPassword={submitChannelPassword}
      />

      <MainAppPassphrasePromptModal styles={styles} isDark={isDark} {...passphraseModalProps} />

      <View style={{ flex: 1 }}>
        {rehydrateReady ? (
          <ChatScreen
            conversationId={conversationId}
            peer={peer}
            displayName={effectiveDisplayName}
            myAvatarOverride={{
              bgColor: myAvatar?.bgColor,
              textColor: myAvatar?.textColor,
              imagePath: myAvatar?.imagePath,
            }}
            onNewDmNotification={handleNewDmNotification}
            refreshUnreads={fetchUnreads}
            onKickedFromConversation={(convId) => {
              if (!convId) return;
              if (conversationId !== convId) return;
              setConversationId('global');
              setPeer(null);
            }}
            onConversationTitleChanged={handleConversationTitleChanged}
            channelAboutRequestEpoch={channelAboutRequestEpoch}
            headerTop={headerTop}
            theme={theme}
            chatBackground={chatBackground}
            chatBackgroundImageScaleMode={chatBackgroundImageScaleMode}
            blockedUserSubs={blockedSubs}
            keyEpoch={keyEpoch}
            onBlockUserSub={addBlockBySub}
          />
        ) : (
          // Root-level overlay spinner (App.tsx) stays visible during rehydrate.
          <View style={{ flex: 1, backgroundColor: appColors.appBackground }} />
        )}
      </View>

      {/* After main chat so iOS blocklist overlay (View, not Modal) paints above the thread. */}
      <MainAppBlocklistModal
        styles={styles}
        isDark={isDark}
        blocklistOpen={blocklistOpen}
        setBlocklistOpen={setBlocklistOpen}
        blockUsername={blockUsername}
        setBlockUsername={setBlockUsername}
        blockError={blockError}
        setBlockError={setBlockError}
        addBlockByUsername={addBlockByUsername}
        blocklistLoading={blocklistLoading}
        blockedUsers={blockedUsers}
        unblockUser={unblockUser}
      />
    </View>
  );
};
