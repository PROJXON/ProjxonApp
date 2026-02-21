import React from 'react';
import type {
  FlatList,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from 'react-native';
import type { StyleProp, TextInput, ViewStyle } from 'react-native';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  LayoutAnimation,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native';
import { useWindowDimensions } from 'react-native';

import type { PublicAvatarProfileLite } from '../../../hooks/usePublicAvatarProfiles';
import type { ChatScreenStyles } from '../../../screens/ChatScreen.styles';
import { APP_COLORS, getAppThemeColors } from '../../../theme/colors';
import type { MediaItem } from '../../../types/media';
import { getNativeEventNumber } from '../../../utils/nativeEvent';
import type { PendingMediaItem } from '../attachments';
import type { ChatMessage } from '../types';
import { ChannelSettingsPanel } from './ChannelSettingsPanel';
import type { ResolvedChatBg } from './ChatBackgroundLayer';
import { ChatBackgroundLayer } from './ChatBackgroundLayer';
import { ChatComposer } from './ChatComposer';
import { ChatHeaderStatusRow } from './ChatHeaderStatusRow';
import { ChatHeaderTitleRow } from './ChatHeaderTitleRow';
import { ChatMessageList } from './ChatMessageList';
import { DmSettingsPanel } from './DmSettingsPanel';

type WebPinnedState = {
  ready: boolean;
  onLayout?: (e: LayoutChangeEvent) => void;
  onContentSizeChange?: (w: number, h: number) => void;
  onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
};

type ChatScreenMainProps = {
  styles: ChatScreenStyles;
  isDark: boolean;
  isWideChatLayout: boolean;

  header: {
    headerTop?: React.ReactNode;
    headerTitle: string;
    onPressSummarize: () => void;
    onPressAiHelper: () => void;

    displayName: string;
    myUserId: string | null;
    avatarProfileBySub: Record<string, PublicAvatarProfileLite>;
    avatarUrlByPath: Record<string, string>;
    myAvatarOverride?: { bgColor?: string; textColor?: string; imagePath?: string } | null;
    isConnecting: boolean;
    isConnected: boolean;

    isEncryptedChat: boolean;
    isChannel: boolean;

    dmSettingsOpen: boolean;
    setDmSettingsOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
    channelSettingsOpen: boolean;
    setChannelSettingsOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
    dmSettingsCompact: boolean;

    // DM settings panel
    isDm: boolean;
    isGroup: boolean;
    myPrivateKeyReady: boolean;
    autoDecrypt: boolean;
    setAutoDecrypt: (v: boolean) => void;
    ttlLabel: string;
    onOpenTtlPicker: () => void;
    sendReadReceipts: boolean;
    onToggleReadReceipts: (v: boolean) => void;
    groupMembersCountLabel: string;
    groupActionBusy: boolean;
    groupMeIsAdmin: boolean;
    onOpenGroupMembers: () => void;
    onOpenGroupName: () => void;
    onLeaveGroup: () => void;

    // Channel settings panel
    channelBusy: boolean;
    channelMeIsAdmin: boolean;
    channelIsPublic: boolean;
    channelHasPassword: boolean;
    channelMembersCountLabel: string;
    onOpenChannelMembers: () => void;
    onOpenChannelAbout: () => void;
    onOpenChannelName: () => void;
    onLeaveChannel: () => void;
    channelOnTogglePublic: (next: boolean) => void;
    channelOnPressPassword: () => void;

    error: string | null;
  };

  body: { resolvedChatBg: ResolvedChatBg };

  list: {
    API_URL: string;
    isGroup: boolean;
    groupStatus?: string;
    visibleMessagesCount: number;
    messageListData: ChatMessage[];
    webPinned: WebPinnedState;
    listRef: React.RefObject<FlatList<ChatMessage> | null>;
    historyHasMore: boolean;
    historyLoading: boolean;
    loadOlderHistory: () => void | Promise<void>;
    renderItem: (args: { item: ChatMessage; index: number }) => React.ReactElement | null;
  };

  composer: {
    isDm: boolean;
    isGroup: boolean;
    isEncryptedChat: boolean;
    groupMeta: React.ComponentProps<typeof ChatComposer>['groupMeta'];
    inlineEditTargetId: string | null;
    inlineEditUploading: boolean;
    cancelInlineEdit: () => void;
    pendingMedia: PendingMediaItem[];
    setPendingMedia: (items: PendingMediaItem[]) => void;
    isUploading: boolean;
    replyTarget: React.ComponentProps<typeof ChatComposer>['replyTarget'];
    setReplyTarget: React.ComponentProps<typeof ChatComposer>['setReplyTarget'];
    messages: ChatMessage[];
    openViewer: (mediaList: MediaItem[], startIdx: number) => void;
    typingIndicatorText: string;
    TypingIndicator: React.ComponentProps<typeof ChatComposer>['TypingIndicator'];
    typingColor: string;
    mentionSuggestions: string[];
    insertMention: (v: string) => void;
    composerSafeAreaStyle: StyleProp<ViewStyle>;
    composerHorizontalInsetsStyle: StyleProp<ViewStyle>;
    composerBottomInsetBgHeight?: number;
    textInputRef: React.MutableRefObject<TextInput | null>;
    inputEpoch: number;
    input: string;
    onChangeInput: (v: string) => void;
    isTypingRef: React.MutableRefObject<boolean>;
    sendTyping: (isTyping: boolean) => void;
    sendMessage: () => void;
    handlePickMedia: () => void;
    showAlert: (title: string, message: string) => void;
    stopAudioPlayback: () => void | Promise<void>;
  };

  selection: {
    active: boolean;
    count: number;
    canCopy: boolean;
    canDeleteForEveryone: boolean;
    onCancel: () => void;
    onCopy: () => void;
    onDelete: () => void;
    onDeleteForEveryone: () => void;
  };
};

export function ChatScreenMain({
  styles,
  isDark,
  isWideChatLayout,
  header,
  body,
  list,
  composer,
  selection,
}: ChatScreenMainProps): React.JSX.Element {
  const { height: windowHeight } = useWindowDimensions();
  const appColors = getAppThemeColors(isDark);
  const [androidKeyboardVisible, setAndroidKeyboardVisible] = React.useState(false);
  const [androidKeyboardHeight, setAndroidKeyboardHeight] = React.useState<number>(0);
  const heightBeforeKeyboardRef = React.useRef<number>(windowHeight);
  const [androidWindowHeightDelta, setAndroidWindowHeightDelta] = React.useState<number>(0);

  React.useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subShow = Keyboard.addListener('keyboardDidShow', (e) => {
      setAndroidKeyboardVisible(true);
      const hRaw =
        e &&
        typeof e === 'object' &&
        typeof (e as { endCoordinates?: unknown }).endCoordinates === 'object'
          ? (e as { endCoordinates?: { height?: unknown } }).endCoordinates?.height
          : 0;
      const h = typeof hRaw === 'number' && Number.isFinite(hRaw) ? hRaw : Number(hRaw) || 0;
      setAndroidKeyboardHeight(h > 0 ? h : 0);
    });
    const subHide = Keyboard.addListener('keyboardDidHide', () => {
      setAndroidKeyboardVisible(false);
      setAndroidKeyboardHeight(0);
      setAndroidWindowHeightDelta(0);
    });
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, []);

  React.useEffect(() => {
    if (Platform.OS !== 'android') return;
    if (!androidKeyboardVisible) {
      // Capture baseline height while keyboard is hidden.
      heightBeforeKeyboardRef.current = windowHeight;
      setAndroidWindowHeightDelta(0);
      return;
    }
    // Keyboard is visible: track how much the OS already shrank the window.
    // We'll subtract this from our own keyboard avoidance so we don't "double adjust".
    const before = heightBeforeKeyboardRef.current;
    const after = windowHeight;
    if (!(before > 0 && after > 0)) return;
    const delta = Math.max(0, before - after);
    // Wait for a stable non-trivial measurement.
    if (delta < 6) return;
    setAndroidWindowHeightDelta(delta);
  }, [androidKeyboardVisible, windowHeight]);

  // Android keyboard behavior varies:
  // - adjustResize: window shrinks by ~keyboard height (no extra lift needed)
  // - adjustPan / partial resize (emulators/IMEs): window shrinks a bit (need to lift the remainder)
  // Use the "remaining overlap" as an explicit composer lift so the input clears the whole keyboard,
  // including the suggestion/action bar.
  const androidKeyboardLift = React.useMemo(() => {
    if (Platform.OS !== 'android') return 0;
    if (!androidKeyboardVisible) return 0;
    const remaining = Math.max(0, androidKeyboardHeight - androidWindowHeightDelta);
    // Small buffer so we're never 1px under the IME chrome.
    return remaining > 0 ? remaining + 8 : 0;
  }, [androidKeyboardHeight, androidKeyboardVisible, androidWindowHeightDelta]);

  // Avoid a brief "blank list" flash on first mount (web pinned list uses opacity: 0 until ready).
  // Also show a spinner while the initial history load is in-flight and we have nothing to render yet.
  const showListLoadingOverlay =
    (Platform.OS === 'web' && list.visibleMessagesCount > 0 && !list.webPinned.ready) ||
    (list.visibleMessagesCount === 0 && !!list.API_URL && list.historyLoading);

  // iOS: A positive keyboardVerticalOffset makes KeyboardAvoidingView add less padding, so the
  // composer sits lower and the input stays just above the keyboard (visible gap). Zero or negative
  // offset adds more padding and the keyboard can cover the input.
  const iosKeyboardVerticalOffset = 10;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      // iOS: use padding to lift input above keyboard.
      // Android: edge-to-edge can prevent the window from resizing reliably in release builds,
      // so use a KeyboardAvoidingView fallback here as well.
      behavior={Platform.select({ ios: 'padding', android: 'height' })}
      // On Android we do an explicit composer lift (below) based on keyboard + window resize.
      // Keeping KAV enabled on Android can create double-adjust gaps depending on IME settings.
      enabled={Platform.OS === 'ios'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? iosKeyboardVerticalOffset : 0}
    >
      {/* Stage 3 loader: center relative to the full screen (same as root spinners),
          not just the message-list area below the header. */}
      {showListLoadingOverlay ? (
        <View
          {...(Platform.OS === 'web' ? {} : { pointerEvents: 'none' as const })}
          style={[
            {
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              right: 0,
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 50,
            },
            ...(Platform.OS === 'web' ? [{ pointerEvents: 'none' as const }] : []),
          ]}
        >
          <ActivityIndicator size="large" color={appColors.appForeground} />
        </View>
      ) : null}

      <View
        style={[
          styles.header,
          isDark ? styles.headerDark : null,
          !(header.isEncryptedChat || header.isChannel) ? styles.headerNoSubRow : null,
        ]}
      >
        <View style={isWideChatLayout ? styles.chatContentColumn : null}>
          {header.headerTop ? <View style={styles.headerTopSlot}>{header.headerTop}</View> : null}
          <ChatHeaderTitleRow
            styles={styles}
            isDark={isDark}
            displayName={header.displayName}
            myUserId={header.myUserId}
            avatarProfileBySub={header.avatarProfileBySub}
            avatarUrlByPath={header.avatarUrlByPath}
            myAvatarOverride={header.myAvatarOverride}
            isConnecting={header.isConnecting}
            isConnected={header.isConnected}
            onPressSummarize={header.onPressSummarize}
            onPressAiHelper={header.onPressAiHelper}
          />
          <ChatHeaderStatusRow
            styles={styles}
            isDark={isDark}
            showCaret={!!(header.isEncryptedChat || header.isChannel)}
            caretExpanded={
              !!(header.isEncryptedChat ? header.dmSettingsOpen : header.channelSettingsOpen)
            }
            caretA11yLabel={
              header.isEncryptedChat
                ? header.dmSettingsOpen
                  ? 'Hide message options'
                  : 'Show message options'
                : header.channelSettingsOpen
                  ? 'Hide channel options'
                  : 'Show channel options'
            }
            onPressCaret={() => {
              try {
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              } catch {
                // ignore
              }
              if (header.isEncryptedChat) header.setDmSettingsOpen((v) => !v);
              else header.setChannelSettingsOpen((v) => !v);
            }}
          />

          {header.isEncryptedChat ? (
            header.dmSettingsOpen ? (
              <DmSettingsPanel
                isDark={isDark}
                styles={styles}
                compact={!!header.dmSettingsCompact}
                isDm={header.isDm}
                isGroup={header.isGroup}
                myPrivateKeyReady={header.myPrivateKeyReady}
                autoDecrypt={header.autoDecrypt}
                onToggleAutoDecrypt={header.setAutoDecrypt}
                ttlLabel={header.ttlLabel}
                onOpenTtlPicker={header.onOpenTtlPicker}
                sendReadReceipts={header.sendReadReceipts}
                onToggleReadReceipts={(v) => header.onToggleReadReceipts(!!v)}
                groupMembersCountLabel={header.groupMembersCountLabel}
                groupActionBusy={!!header.groupActionBusy}
                groupMeIsAdmin={!!header.groupMeIsAdmin}
                onOpenGroupMembers={header.onOpenGroupMembers}
                onOpenGroupName={header.onOpenGroupName}
                onLeaveGroup={header.onLeaveGroup}
              />
            ) : null
          ) : header.isChannel ? (
            header.channelSettingsOpen ? (
              <ChannelSettingsPanel
                isDark={isDark}
                styles={styles}
                compact={false}
                busy={!!header.channelBusy}
                meIsAdmin={!!header.channelMeIsAdmin}
                isPublic={!!header.channelIsPublic}
                hasPassword={!!header.channelHasPassword}
                membersCountLabel={header.channelMembersCountLabel}
                onOpenMembers={header.onOpenChannelMembers}
                onOpenAbout={header.onOpenChannelAbout}
                onOpenName={header.onOpenChannelName}
                onLeave={header.onLeaveChannel}
                onTogglePublic={header.channelOnTogglePublic}
                onPressPassword={header.channelOnPressPassword}
              />
            ) : null
          ) : null}

          {__DEV__ && header.error ? (
            <Text style={[styles.error, isDark ? styles.errorDark : null]}>{header.error}</Text>
          ) : null}
        </View>
      </View>

      <View style={styles.chatBody}>
        <ChatBackgroundLayer styles={styles} isDark={isDark} resolvedChatBg={body.resolvedChatBg} />

        {/* Keep the scroll container full-width so the web scrollbar stays at the window edge.
            Center the *content* via FlatList.contentContainerStyle instead. */}
        <View style={styles.chatBodyInner}>
          <ChatMessageList
            styles={styles}
            isDark={isDark}
            isWideChatLayout={isWideChatLayout}
            API_URL={list.API_URL}
            isGroup={list.isGroup}
            groupStatus={list.groupStatus}
            visibleMessagesCount={list.visibleMessagesCount}
            messageListData={list.messageListData}
            webReady={list.webPinned.ready}
            webOnLayout={list.webPinned.onLayout}
            webOnContentSizeChange={list.webPinned.onContentSizeChange}
            webOnScrollSync={(e) => {
              if (list.webPinned.onScroll) list.webPinned.onScroll(e);
              if (!list.API_URL) return;
              if (!list.historyHasMore) return;
              if (list.historyLoading) return;
              const y = getNativeEventNumber(e, ['nativeEvent', 'contentOffset', 'y']);
              if (y <= 40) list.loadOlderHistory();
            }}
            listRef={list.listRef}
            historyHasMore={list.historyHasMore}
            historyLoading={list.historyLoading}
            loadOlderHistory={list.loadOlderHistory}
            renderItem={list.renderItem}
          />

          {selection.active ? (
            <View
              style={[
                // Match the composer container exactly (height/spacing/background).
                styles.inputRow,
                isDark ? styles.inputRowDark : null,
                composer.composerSafeAreaStyle,
                { position: 'relative' },
                Platform.OS === 'android' && androidKeyboardLift && androidKeyboardLift > 0
                  ? { marginBottom: androidKeyboardLift }
                  : null,
              ]}
            >
              {composer.composerBottomInsetBgHeight && composer.composerBottomInsetBgHeight > 0 ? (
                <View
                  {...(Platform.OS === 'web' ? {} : { pointerEvents: 'none' as const })}
                  style={[
                    {
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      bottom: -composer.composerBottomInsetBgHeight,
                      height: composer.composerBottomInsetBgHeight,
                      backgroundColor: isDark
                        ? APP_COLORS.dark.bg.header
                        : APP_COLORS.light.bg.header,
                    },
                    ...(Platform.OS === 'web' ? [{ pointerEvents: 'none' as const }] : []),
                  ]}
                />
              ) : null}
              <View
                style={[
                  // Match the composer inner row exactly (height/spacing).
                  styles.inputRowInner,
                  isWideChatLayout ? styles.chatContentColumn : null,
                  composer.composerHorizontalInsetsStyle,
                  // Match the composer's tallest control (pick/send buttons are 44px).
                  { minHeight: 44 },
                ]}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    gap: 10,
                  }}
                >
                  {selection.canCopy ? (
                    <Pressable
                      onPress={selection.onCopy}
                      style={({ pressed }) => [
                        { height: 44, justifyContent: 'center', paddingHorizontal: 10 },
                        pressed ? { opacity: 0.85 } : null,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel="Copy selected messages"
                    >
                      <Text
                        style={{
                          color: isDark
                            ? APP_COLORS.dark.text.primary
                            : APP_COLORS.light.text.primary,
                          fontWeight: '900',
                        }}
                      >
                        Copy
                      </Text>
                    </Pressable>
                  ) : null}

                  {selection.canDeleteForEveryone ? (
                    <Pressable
                      onPress={selection.onDeleteForEveryone}
                      style={({ pressed }) => [
                        { height: 44, justifyContent: 'center', paddingHorizontal: 10 },
                        pressed ? { opacity: 0.85 } : null,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel="Delete selected messages for everyone"
                    >
                      <Text
                        style={{
                          color: isDark
                            ? APP_COLORS.dark.text.primary
                            : APP_COLORS.light.text.primary,
                          fontWeight: '900',
                        }}
                      >
                        Delete for everyone
                      </Text>
                    </Pressable>
                  ) : null}

                  <Pressable
                    onPress={selection.onDelete}
                    style={({ pressed }) => [
                      { height: 44, justifyContent: 'center', paddingHorizontal: 10 },
                      pressed ? { opacity: 0.85 } : null,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Delete selected messages for me"
                  >
                    <Text
                      style={{
                        color: isDark
                          ? APP_COLORS.dark.text.primary
                          : APP_COLORS.light.text.primary,
                        fontWeight: '900',
                      }}
                    >
                      Delete for me
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={selection.onCancel}
                    style={({ pressed }) => [
                      { height: 44, justifyContent: 'center', paddingHorizontal: 10 },
                      pressed ? { opacity: 0.85 } : null,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel selection"
                  >
                    <Text
                      style={{
                        color: isDark
                          ? APP_COLORS.dark.text.primary
                          : APP_COLORS.light.text.primary,
                        fontWeight: '900',
                      }}
                    >
                      Cancel
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>
          ) : (
            <ChatComposer
              styles={styles}
              isDark={isDark}
              myUserId={header.myUserId}
              isDm={composer.isDm}
              isGroup={composer.isGroup}
              isEncryptedChat={composer.isEncryptedChat}
              groupMeta={composer.groupMeta}
              inlineEditTargetId={composer.inlineEditTargetId}
              inlineEditUploading={composer.inlineEditUploading}
              cancelInlineEdit={composer.cancelInlineEdit}
              pendingMedia={composer.pendingMedia}
              setPendingMedia={composer.setPendingMedia}
              isUploading={composer.isUploading}
              replyTarget={composer.replyTarget}
              setReplyTarget={composer.setReplyTarget}
              messages={composer.messages}
              openViewer={composer.openViewer}
              typingIndicatorText={composer.typingIndicatorText}
              TypingIndicator={composer.TypingIndicator}
              typingColor={composer.typingColor}
              mentionSuggestions={composer.mentionSuggestions}
              insertMention={composer.insertMention}
              composerSafeAreaStyle={composer.composerSafeAreaStyle}
              composerHorizontalInsetsStyle={composer.composerHorizontalInsetsStyle}
              composerBottomInsetBgHeight={composer.composerBottomInsetBgHeight}
              androidKeyboardLift={androidKeyboardLift}
              isWideChatLayout={isWideChatLayout}
              textInputRef={composer.textInputRef}
              inputEpoch={composer.inputEpoch}
              input={composer.input}
              onChangeInput={composer.onChangeInput}
              isTypingRef={composer.isTypingRef}
              sendTyping={composer.sendTyping}
              sendMessage={composer.sendMessage}
              handlePickMedia={composer.handlePickMedia}
              showAlert={composer.showAlert}
              stopAudioPlayback={composer.stopAudioPlayback}
            />
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
