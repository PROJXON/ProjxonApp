import { MaterialIcons } from '@expo/vector-icons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Image, Platform, Pressable, Text, TextInput, View } from 'react-native';

import { AnimatedDots } from '../../../components/AnimatedDots';
import type { ChatScreenStyles } from '../../../screens/ChatScreen.styles';
import { APP_COLORS, PALETTE } from '../../../theme/colors';
import type { MediaItem } from '../../../types/media';
import { fileBrandColorForMedia, fileIconNameForMedia } from '../../../utils/mediaKinds';
import type { PendingMediaItem } from '../attachments';
import { normalizeChatMediaList, parseChatEnvelope } from '../parsers';
import type { ChatMessage } from '../types';
import { VoiceClipMicButton } from './VoiceClipMicButton';

type ReplyTarget = null | {
  id: string;
  createdAt: number;
  user?: string;
  userSub?: string;
  preview: string;
  mediaKind?: 'image' | 'video' | 'file';
  mediaCount?: number;
  mediaThumbUri?: string | null;
  mediaContentType?: string;
  mediaFileName?: string;
};

function formatMmSs(ms: number | null | undefined): string {
  const v = typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 ? ms : 0;
  const totalSec = Math.floor(v / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function ChatComposer(props: {
  styles: ChatScreenStyles;
  isDark: boolean;
  myUserId: string | null;
  isDm: boolean;
  isGroup: boolean;
  isEncryptedChat: boolean;
  groupMeta: null | { groupId: string; groupName?: string; meIsAdmin: boolean; meStatus: string };

  // Inline edit bar
  inlineEditTargetId: string | null;
  inlineEditUploading: boolean;
  cancelInlineEdit: () => void;

  // Attachment pill
  pendingMedia: PendingMediaItem[];
  setPendingMedia: (next: PendingMediaItem[]) => void;
  isUploading: boolean;

  // Reply pill
  replyTarget: ReplyTarget;
  setReplyTarget: (v: ReplyTarget) => void;
  messages: ChatMessage[];
  openViewer: (mediaList: MediaItem[], startIdx: number) => void;

  // Typing indicator
  typingIndicatorText: string;
  TypingIndicator: React.ComponentType<{ text: string; color: string }>;
  typingColor: string;

  // Mention suggestions
  mentionSuggestions: string[];
  insertMention: (u: string) => void;

  // Composer container styles
  composerSafeAreaStyle: StyleProp<ViewStyle>;
  composerHorizontalInsetsStyle: StyleProp<ViewStyle>;
  // Android-only: height of the bottom system inset to paint behind the composer.
  // This should NOT affect layout height; it's only for background coverage.
  composerBottomInsetBgHeight?: number;
  // Android-only: remaining keyboard overlap to lift composer by.
  androidKeyboardLift?: number;
  isWideChatLayout: boolean;

  // Input
  textInputRef: React.MutableRefObject<TextInput | null>;
  inputEpoch: number;
  input: string;
  onChangeInput: (t: string) => void;
  isTypingRef: React.MutableRefObject<boolean>;
  sendTyping: (isTyping: boolean) => void;
  sendMessage: () => void;

  // Media picker
  handlePickMedia: () => void;

  // Alerts + playback coordination (voice recording)
  showAlert: (title: string, message: string) => void;
  stopAudioPlayback: () => void | Promise<void>;
}): React.JSX.Element {
  const {
    styles,
    isDark,
    myUserId,
    isDm,
    isGroup,
    isEncryptedChat,
    groupMeta,
    inlineEditTargetId,
    inlineEditUploading: _inlineEditUploading,
    cancelInlineEdit: _cancelInlineEdit,
    pendingMedia,
    setPendingMedia,
    isUploading,
    replyTarget,
    setReplyTarget,
    messages,
    openViewer,
    typingIndicatorText,
    TypingIndicator,
    typingColor,
    mentionSuggestions,
    insertMention,
    composerSafeAreaStyle,
    composerHorizontalInsetsStyle,
    composerBottomInsetBgHeight,
    androidKeyboardLift,
    isWideChatLayout,
    textInputRef,
    inputEpoch,
    input,
    onChangeInput,
    isTypingRef,
    sendTyping,
    sendMessage,
    handlePickMedia,
    showAlert,
    stopAudioPlayback,
  } = props;

  const replyToLabel = React.useMemo(() => {
    if (!replyTarget) return '';
    const sub = typeof replyTarget.userSub === 'string' ? replyTarget.userSub.trim() : '';
    const origin = messages.find((m) => m && m.id === replyTarget.id);
    const originSub = origin?.userSub ? String(origin.userSub) : '';
    const replyingToMe =
      !!myUserId && (!!sub || !!originSub)
        ? String(myUserId) === sub || String(myUserId) === originSub
        : false;
    if (replyingToMe) return 'yourself';
    const direct = typeof replyTarget.user === 'string' ? replyTarget.user.trim() : '';
    if (direct) return direct;
    const fromOrigin = typeof origin?.user === 'string' ? origin.user.trim() : '';
    if (fromOrigin) return fromOrigin;
    if (sub) return `User ${sub.slice(0, 6)}`;
    return 'Unknown user';
  }, [messages, myUserId, replyTarget]);

  const replyFileMeta = React.useMemo(() => {
    if (!replyTarget) return null;
    if (replyTarget.mediaKind !== 'file') return null;
    return {
      kind: 'file' as const,
      contentType: replyTarget.mediaContentType,
      fileName: replyTarget.mediaFileName,
    };
  }, [replyTarget]);
  const replyFileIcon = replyFileMeta ? fileIconNameForMedia(replyFileMeta) : null;
  const replyFileIconColor =
    (replyFileMeta ? fileBrandColorForMedia(replyFileMeta) : null) ||
    (isDark ? PALETTE.white : APP_COLORS.light.brand.primary);

  const MIN_INPUT_HEIGHT = 44;
  const MAX_INPUT_HEIGHT = 140;
  const [inputHeight, setInputHeight] = React.useState<number>(MIN_INPUT_HEIGHT);

  // All platforms use inputHeight from onContentSizeChange. On iOS we avoid a fixed height in style
  // (use only minHeight/maxHeight) so the native view can size by content and fire onContentSizeChange.
  const effectiveInputHeight = inputHeight;

  const isMobileWeb = React.useMemo(() => {
    if (Platform.OS !== 'web') return false;
    try {
      const w = typeof window !== 'undefined' ? window : undefined;
      const coarse =
        !!w?.matchMedia?.('(hover: none) and (pointer: coarse)')?.matches ||
        !!w?.matchMedia?.('(pointer: coarse)')?.matches;
      const narrow = typeof w?.innerWidth === 'number' ? w.innerWidth < 768 : false;
      return coarse || narrow;
    } catch {
      return false;
    }
  }, []);

  const webInputFocusedRef = React.useRef(false);
  const webPendingPickRestoreRef = React.useRef(false);
  const webPendingPickActiveRef = React.useRef(false);

  const webKeyboardVisibleRef = React.useRef<boolean>(false);
  React.useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (!isMobileWeb) return;
    try {
      const w = typeof window !== 'undefined' ? window : undefined;
      const vv = (w as any)?.visualViewport as
        | undefined
        | { height?: number; addEventListener?: any; removeEventListener?: any };
      if (!w || !vv || typeof vv.addEventListener !== 'function') return;

      const update = () => {
        const viewportH =
          typeof vv.height === 'number' && Number.isFinite(vv.height) ? vv.height : 0;
        const windowH =
          typeof w.innerHeight === 'number' && Number.isFinite(w.innerHeight) ? w.innerHeight : 0;
        // If visual viewport is significantly shorter than the layout viewport, assume the keyboard is open.
        // (Threshold tuned to avoid false positives from URL bars.)
        webKeyboardVisibleRef.current =
          windowH > 0 && viewportH > 0 ? windowH - viewportH > 80 : false;
      };

      update();
      vv.addEventListener('resize', update);
      vv.addEventListener('scroll', update);
      w.addEventListener?.('resize', update);
      return () => {
        vv.removeEventListener?.('resize', update);
        vv.removeEventListener?.('scroll', update);
        w.removeEventListener?.('resize', update);
      };
    } catch {
      // ignore
    }
  }, [isMobileWeb]);

  const focusWebInputSoon = React.useCallback(() => {
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
  }, [textInputRef]);

  // If the attachment picker steals focus, restore it when the browser returns.
  React.useEffect(() => {
    if (Platform.OS !== 'web') return;
    // Mobile web: never auto-restore focus after attachment UI closes, to avoid popping
    // the keyboard back up and causing layout/viewport glitches.
    if (isMobileWeb) return;
    try {
      const w = typeof window !== 'undefined' ? window : undefined;
      if (!w || typeof w.addEventListener !== 'function') return;

      const onWindowFocus = () => {
        if (!webPendingPickActiveRef.current) return;
        webPendingPickActiveRef.current = false;

        // Desktop web: always restore focus after closing/canceling the picker.
        // Mobile web: only restore if the input was focused when the picker opened.
        if (!isMobileWeb || webPendingPickRestoreRef.current) {
          focusWebInputSoon();
        }
        webPendingPickRestoreRef.current = false;
      };

      w.addEventListener('focus', onWindowFocus);
      return () => {
        w.removeEventListener('focus', onWindowFocus);
      };
    } catch {
      // ignore
    }
  }, [focusWebInputSoon, isMobileWeb]);

  const restoreWebInputFocusIfAppropriate = React.useCallback(() => {
    if (Platform.OS !== 'web') return;
    // Mobile web: never auto-restore focus (avoids keyboard popping up over the UI).
    if (isMobileWeb) return;
    // Desktop web: always restore (expected chat UX).
    focusWebInputSoon();
  }, [focusWebInputSoon, isMobileWeb]);

  const webKeepInputFocusedProps = React.useMemo(() => {
    if (Platform.OS !== 'web') return null;
    // Web: prevent pointer/touch interactions from taking focus away from the TextInput.
    // - Desktop web: always keep focus in the composer (expected chat UX).
    // - Mobile web: only keep focus if the keyboard is currently visible (so we don't pop it back up
    //   after the user swipes it down).
    const preventIfAllowed = (e: unknown) => {
      if (isMobileWeb && !webKeyboardVisibleRef.current) return;
      (e as { preventDefault?: () => void })?.preventDefault?.();
    };
    return {
      onMouseDown: preventIfAllowed,
      onTouchStart: preventIfAllowed,
    } as const;
  }, [isMobileWeb]);

  React.useEffect(() => {
    // Reset back to 1-row height when the draft is cleared (send/cancel/edit reset).
    setInputHeight(MIN_INPUT_HEIGHT);
  }, [inputEpoch]);

  const [voiceRecUi, setVoiceRecUi] = React.useState<{ isRecording: boolean; elapsedMs: number }>({
    isRecording: false,
    elapsedMs: 0,
  });
  const [voiceRecBlinkOn, setVoiceRecBlinkOn] = React.useState(true);
  React.useEffect(() => {
    if (!voiceRecUi.isRecording) {
      setVoiceRecBlinkOn(true);
      return;
    }
    const id = setInterval(() => setVoiceRecBlinkOn((v) => !v), 450);
    return () => clearInterval(id);
  }, [voiceRecUi.isRecording]);

  const pickVisuallyDisabled =
    isUploading || !!inlineEditTargetId || (isGroup && groupMeta?.meStatus !== 'active');
  const pickDisabled = pickVisuallyDisabled || voiceRecUi.isRecording;

  const onClipReady = React.useCallback(
    (clip: PendingMediaItem) => {
      setPendingMedia([clip]);
      restoreWebInputFocusIfAppropriate();
    },
    [restoreWebInputFocusIfAppropriate, setPendingMedia],
  );

  // When attachments are added via the picker (which can steal focus on web),
  // restore focus *after* the attachment state actually updates.
  const prevPendingMediaCountRef = React.useRef<number>(pendingMedia.length);
  React.useEffect(() => {
    const prev = prevPendingMediaCountRef.current;
    const next = pendingMedia.length;
    prevPendingMediaCountRef.current = next;
    if (Platform.OS !== 'web') return;
    if (isMobileWeb) return;
    if (next <= prev) return;
    restoreWebInputFocusIfAppropriate();
  }, [isMobileWeb, pendingMedia.length, restoreWebInputFocusIfAppropriate]);

  return (
    <>
      {pendingMedia.length ? (
        <View
          style={[
            isWideChatLayout ? styles.chatContentColumn : null,
            composerHorizontalInsetsStyle,
          ]}
        >
          <Pressable
            style={[
              styles.attachmentPill,
              isDark ? styles.attachmentPillDark : null,
              // This pill is rendered outside the composer row; constrain it like the composer controls.
              { marginHorizontal: 0 },
            ]}
            onPress={() => setPendingMedia([])}
            disabled={isUploading}
          >
            <Text
              style={[styles.attachmentPillText, isDark ? styles.attachmentPillTextDark : null]}
            >
              {pendingMedia.length === 1
                ? (() => {
                    const it = pendingMedia[0];
                    const label = it.displayName || it.fileName || it.kind;
                    const dur =
                      typeof it.durationMs === 'number' &&
                      Number.isFinite(it.durationMs) &&
                      it.durationMs > 0
                        ? ` (${formatMmSs(it.durationMs)})`
                        : '';
                    return `Attached: ${label}${dur} (tap to remove)`;
                  })()
                : `Attached: ${pendingMedia.length} items (tap to remove)`}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {replyTarget ? (
        <View
          style={[
            isWideChatLayout ? styles.chatContentColumn : null,
            composerHorizontalInsetsStyle,
          ]}
        >
          <View
            style={[
              styles.attachmentPill,
              isDark ? styles.attachmentPillDark : null,
              { flexDirection: 'row', alignItems: 'center', marginHorizontal: 0 },
            ]}
          >
            {replyTarget.mediaCount ? (
              <Pressable
                onPress={() => {
                  // Best-effort: open the original target if it's in memory.
                  const t = messages.find((m) => m && m.id === replyTarget.id);
                  if (!t) return;
                  const raw = String(t.rawText ?? t.text ?? '');
                  const env =
                    !t.encrypted && !t.groupEncrypted && !isDm ? parseChatEnvelope(raw) : null;
                  const envList = env ? normalizeChatMediaList(env.media) : [];
                  if (!envList.length) return;
                  openViewer(envList, 0);
                }}
                style={({ pressed }) => [
                  styles.replyThumbWrap,
                  { marginRight: 10 },
                  pressed ? { opacity: 0.9 } : null,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Open replied media"
              >
                {replyTarget.mediaThumbUri ? (
                  <Image source={{ uri: replyTarget.mediaThumbUri }} style={styles.replyThumb} />
                ) : (
                  <View style={[styles.replyThumb, styles.replyThumbPlaceholder]}>
                    {replyTarget.mediaKind === 'file' ? (
                      <MaterialCommunityIcons
                        name={(replyFileIcon || 'file-outline') as never}
                        size={24}
                        color={replyFileIconColor}
                      />
                    ) : (
                      <Text style={styles.replyThumbPlaceholderText}>
                        {replyTarget.mediaKind === 'image' ? 'Photo' : 'Video'}
                      </Text>
                    )}
                  </View>
                )}
                {(replyTarget.mediaCount || 0) > 1 ? (
                  <View style={styles.replyThumbCountBadge}>
                    <Text
                      style={styles.replyThumbCountText}
                    >{`+${(replyTarget.mediaCount || 0) - 1}`}</Text>
                  </View>
                ) : null}
              </Pressable>
            ) : null}
            <View style={{ flex: 1 }}>
              <Text
                style={[styles.attachmentPillText, isDark ? styles.attachmentPillTextDark : null]}
                numberOfLines={2}
              >
                {`Replying to ${replyToLabel}: ${replyTarget.preview || ''}`}
              </Text>
            </View>
            <Pressable
              onPress={() => setReplyTarget(null)}
              style={({ pressed }) => [
                {
                  marginLeft: 10,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Cancel reply"
            >
              <Text
                style={[styles.attachmentPillText, isDark ? styles.attachmentPillTextDark : null]}
              >
                Cancel
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {typingIndicatorText ? (
        <View style={styles.typingRow}>
          <TypingIndicator text={typingIndicatorText} color={typingColor} />
        </View>
      ) : null}

      {mentionSuggestions.length && !isEncryptedChat && !inlineEditTargetId ? (
        <View
          style={[
            isWideChatLayout ? styles.chatContentColumn : null,
            composerHorizontalInsetsStyle,
            { marginTop: 8, marginBottom: 2 },
          ]}
        >
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {mentionSuggestions.map((u) => (
              <Pressable
                key={`mention-suggest:${u}`}
                onPress={() => insertMention(u)}
                style={({ pressed }) => ({
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 999,
                  backgroundColor: isDark ? PALETTE.slate750 : PALETTE.mist,
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <Text
                  style={{
                    color: isDark ? APP_COLORS.dark.text.primary : APP_COLORS.light.text.primary,
                    fontWeight: '800',
                  }}
                >
                  @{u}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      <View
        style={[
          styles.inputRow,
          isDark ? styles.inputRowDark : null,
          // Fill the safe area with the bar background, but keep the inner content vertically centered.
          composerSafeAreaStyle,
          { position: 'relative' },
          Platform.OS === 'android' && androidKeyboardLift && androidKeyboardLift > 0
            ? { marginBottom: androidKeyboardLift }
            : null,
        ]}
      >
        {composerBottomInsetBgHeight && composerBottomInsetBgHeight > 0 ? (
          <View
            {...(Platform.OS === 'web' ? {} : { pointerEvents: 'none' as const })}
            style={[
              {
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: -composerBottomInsetBgHeight,
                height: composerBottomInsetBgHeight,
                backgroundColor: isDark ? APP_COLORS.dark.bg.header : APP_COLORS.light.bg.header,
              },
              ...(Platform.OS === 'web' ? [{ pointerEvents: 'none' as const }] : []),
            ]}
          />
        ) : null}
        <View
          style={[
            styles.inputRowInner,
            isWideChatLayout ? styles.chatContentColumn : null,
            // Ensure the content never hugs the screen edges (safe area + consistent gutter).
            composerHorizontalInsetsStyle,
            // When the input grows, keep controls visually anchored to the bottom.
            { alignItems: 'flex-end' },
          ]}
        >
          <Pressable
            style={[
              styles.pickBtn,
              isDark ? styles.pickBtnDark : null,
              // While recording, widen the button for icon+timer, but don't add left padding
              // (users perceive it as "mysterious space" before the mic).
              voiceRecUi.isRecording ? { width: 72, paddingLeft: 0, paddingRight: 8 } : null,
              pickVisuallyDisabled ? (isDark ? styles.btnDisabledDark : styles.btnDisabled) : null,
            ]}
            onPress={() => {
              try {
                if (Platform.OS === 'web') {
                  // Mobile web: opening the attachment UI should dismiss the keyboard and
                  // we should not auto-restore it on close (prevents keyboard covering UI).
                  if (isMobileWeb) {
                    webPendingPickActiveRef.current = false;
                    webPendingPickRestoreRef.current = false;
                    webInputFocusedRef.current = false;
                    try {
                      textInputRef.current?.blur?.();
                    } catch {
                      // ignore
                    }
                  } else {
                    // Desktop web: we restore focus after picker completes/closes.
                    webPendingPickActiveRef.current = true;
                    webPendingPickRestoreRef.current = webInputFocusedRef.current;
                  }
                }
                const res = handlePickMedia() as unknown;
                // Desktop web: if a promise is returned, wait for it (better for file pickers).
                if (!isMobileWeb) {
                  if (res && typeof (res as any)?.finally === 'function') {
                    (res as Promise<unknown>).finally(() => restoreWebInputFocusIfAppropriate());
                  } else {
                    restoreWebInputFocusIfAppropriate();
                  }
                }
              } catch {
                if (!isMobileWeb) restoreWebInputFocusIfAppropriate();
              }
            }}
            // On Android, keep the TextInput focused (don't steal focus).
            focusable={Platform.OS === 'android' ? false : undefined}
            disabled={pickDisabled}
          >
            {voiceRecUi.isRecording ? (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 0,
                }}
              >
                <MaterialIcons
                  name="keyboard-voice"
                  size={24}
                  color={PALETTE.dangerRed}
                  // Make the flash feel "bold": strong on-state, very faint off-state.
                  style={{ opacity: voiceRecBlinkOn ? 1 : 0.5 }}
                />
                <Text
                  style={[
                    styles.pickTxt,
                    isDark ? styles.pickTxtDark : null,
                    { fontSize: 13, lineHeight: 13, fontWeight: '900' },
                  ]}
                >
                  {formatMmSs(voiceRecUi.elapsedMs)}
                </Text>
              </View>
            ) : (
              <Text style={[styles.pickTxt, isDark ? styles.pickTxtDark : null]}>＋</Text>
            )}
          </Pressable>

          <TextInput
            ref={(r) => {
              textInputRef.current = r;
            }}
            key="chat-input"
            style={[
              styles.input,
              isDark ? styles.inputDark : null,
              // iOS: no fixed height so the native view can size by content and fire onContentSizeChange.
              Platform.OS === 'ios'
                ? { minHeight: MIN_INPUT_HEIGHT, maxHeight: MAX_INPUT_HEIGHT }
                : { height: effectiveInputHeight, maxHeight: MAX_INPUT_HEIGHT },
            ]}
            allowFontScaling={false}
            underlineColorAndroid="transparent"
            placeholder={
              inlineEditTargetId
                ? 'Finish editing above…'
                : isGroup && groupMeta?.meStatus !== 'active'
                  ? 'Read‑only (left group)'
                  : pendingMedia.length
                    ? 'Add a caption (optional)…'
                    : 'Type a message'
            }
            placeholderTextColor={isDark ? PALETTE.slate400 : PALETTE.slate350}
            selectionColor={isDark ? APP_COLORS.dark.text.primary : APP_COLORS.light.text.primary}
            cursorColor={isDark ? APP_COLORS.dark.text.primary : APP_COLORS.light.text.primary}
            value={input}
            onChangeText={onChangeInput}
            multiline
            blurOnSubmit={false}
            scrollEnabled={Platform.OS === 'ios' ? true : effectiveInputHeight >= MAX_INPUT_HEIGHT}
            onContentSizeChange={(e) => {
              const hRaw = e?.nativeEvent?.contentSize?.height;
              const h =
                typeof hRaw === 'number' && Number.isFinite(hRaw) ? hRaw : Number(hRaw) || 0;
              if (!h) return;
              const next = Math.max(MIN_INPUT_HEIGHT, Math.min(MAX_INPUT_HEIGHT, Math.ceil(h)));
              setInputHeight((prev) => (prev === next ? prev : next));
            }}
            editable={
              !inlineEditTargetId && !isUploading && !(isGroup && groupMeta?.meStatus !== 'active')
            }
            onFocus={() => {
              if (Platform.OS === 'web') webInputFocusedRef.current = true;
            }}
            onBlur={() => {
              if (Platform.OS === 'web') webInputFocusedRef.current = false;
              if (isTypingRef.current) sendTyping(false);
            }}
            {...(Platform.OS === 'web'
              ? ({
                  onKeyPress: (e: unknown) => {
                    const ev = e as {
                      nativeEvent?: { key?: string; shiftKey?: boolean };
                      preventDefault?: () => void;
                      stopPropagation?: () => void;
                    };
                    const key = String(ev?.nativeEvent?.key ?? '');
                    const shift = !!ev?.nativeEvent?.shiftKey;
                    const isComposing = !!(
                      ev &&
                      typeof ev === 'object' &&
                      typeof (ev as { nativeEvent?: unknown }).nativeEvent === 'object' &&
                      (ev as { nativeEvent?: { isComposing?: unknown } }).nativeEvent?.isComposing
                    );
                    if (key === 'Enter' && !shift && !isComposing && !isMobileWeb) {
                      ev.preventDefault?.();
                      ev.stopPropagation?.();
                      sendMessage();
                    }
                  },
                } as const)
              : null)}
          />

          <VoiceClipMicButton
            styles={styles}
            isDark={isDark}
            disabled={
              isUploading || !!inlineEditTargetId || (isGroup && groupMeta?.meStatus !== 'active')
            }
            showAlert={showAlert}
            stopAudioPlayback={stopAudioPlayback}
            onClipReady={onClipReady}
            onRecordingUiState={setVoiceRecUi}
          />

          <Pressable
            style={[
              styles.sendBtn,
              isDark ? styles.sendBtnDark : null,
              isUploading
                ? isDark
                  ? styles.sendBtnUploadingDark
                  : styles.sendBtnUploading
                : inlineEditTargetId || (isGroup && groupMeta?.meStatus !== 'active')
                  ? isDark
                    ? styles.btnDisabledDark
                    : styles.btnDisabled
                  : null,
            ]}
            onPress={() => {
              sendMessage();
            }}
            // On Android, keep the TextInput focused (don't steal focus).
            focusable={Platform.OS === 'android' ? false : undefined}
            // On mobile web, avoid focusing the button (keep desktop web keyboard-nav intact).
            {...(Platform.OS === 'web' && isMobileWeb ? ({ tabIndex: -1 } as const) : null)}
            {...(webKeepInputFocusedProps || null)}
            disabled={
              isUploading || !!inlineEditTargetId || (isGroup && groupMeta?.meStatus !== 'active')
            }
          >
            {isUploading ? (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 2,
                }}
              >
                <Text style={{ color: APP_COLORS.dark.text.primary, fontWeight: '800' }}>
                  Uploading
                </Text>
                <AnimatedDots color={APP_COLORS.dark.text.primary} size={18} />
              </View>
            ) : (
              <Text style={[styles.sendTxt, isDark ? styles.sendTxtDark : null]}>Send</Text>
            )}
          </Pressable>
        </View>
      </View>
    </>
  );
}
