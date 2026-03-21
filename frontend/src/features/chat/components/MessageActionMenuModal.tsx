import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React from 'react';
import {
  Animated,
  Dimensions,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { RichText } from '../../../components/RichText';
import type { ChatScreenStyles } from '../../../screens/ChatScreen.styles';
import { PALETTE, withAlpha } from '../../../theme/colors';
import {
  attachmentLabelForMedia,
  fileBadgeForMedia,
  fileBrandColorForMedia,
  fileIconNameForMedia,
} from '../../../utils/mediaKinds';
import { getCopyableMessageText } from '../getCopyableMessageText';
import {
  normalizeChatMediaList,
  normalizeDmMediaItems,
  normalizeGroupMediaItems,
  parseChatEnvelope,
  parseDmMediaEnvelope,
  parseEncryptedTextEnvelope,
  parseGroupMediaEnvelope,
} from '../parsers';
import type { ChatMessage } from '../types';
import type { ChatCopyToClipboardOptions } from '../useChatCopyToClipboard';

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || 'Unknown error';
  if (typeof err === 'string') return err || 'Unknown error';
  if (!err) return 'Unknown error';
  try {
    const rec = err as Record<string, unknown>;
    const msg = rec?.message;
    return typeof msg === 'string' && msg ? msg : 'Unknown error';
  } catch {
    return 'Unknown error';
  }
}

type Props = {
  visible: boolean;
  isDark: boolean;
  styles: ChatScreenStyles;

  insets: { top: number; bottom: number };
  anchor: { x: number; y: number } | null;

  anim: Animated.Value;
  measuredH: number;
  measuredHRef: React.MutableRefObject<number>;
  onMeasuredH: (h: number) => void;

  target: ChatMessage | null;
  myUserId: string | null | undefined;
  myPublicKey: string | null | undefined;
  displayName: string;
  isDm: boolean;

  encryptedPlaceholder: string;
  normalizeUser: (v: unknown) => string;

  mediaUrlByPath: Record<string, string>;
  dmThumbUriByPath: Record<string, string>;

  quickReactions: string[];
  nameBySub: Record<string, string>;
  messageListData: ChatMessage[];

  blockedSubsSet: Set<string>;
  onBlockUserSub?: ((blockedSub: string, label?: string) => void | Promise<void>) | undefined;
  uiConfirm: (
    title: string,
    message: string,
    opts: {
      confirmText: string;
      cancelText: string;
      destructive?: boolean;
      dontShowAgain?: { storageKey: string; label?: string };
    },
  ) => Promise<boolean>;
  uiChoice3: (
    title: string,
    message: string,
    opts: {
      primaryText: string;
      secondaryText: string;
      tertiaryText: string;
      primaryVariant?: 'default' | 'primary' | 'danger';
      secondaryVariant?: 'default' | 'primary' | 'danger';
      tertiaryVariant?: 'default' | 'primary' | 'danger';
    },
  ) => Promise<'primary' | 'secondary' | 'tertiary'>;
  showAlert: (title: string, body: string) => void;

  close: () => void;
  copyToClipboard: (text: string, opts?: ChatCopyToClipboardOptions) => Promise<boolean>;
  selectionActive: boolean;
  onSelectMessage?: (msg: ChatMessage) => void;
  sendReaction: (msg: ChatMessage, emoji: string) => void;
  openReactionPicker: (msg: ChatMessage) => void;

  setCipherText: (t: string) => void;
  setCipherOpen: (v: boolean) => void;

  beginReply: (msg: ChatMessage) => void;
  beginInlineEdit: (msg: ChatMessage) => void;
  setInlineEditAttachmentMode: (m: 'keep' | 'replace' | 'remove') => void;
  handlePickMedia: () => void;
  clearPendingMedia: () => void;

  deleteForMe: (msg: ChatMessage) => void | Promise<void>;
  sendDeleteForEveryone: () => void | Promise<void>;
  openReportForMessage: (msg: ChatMessage) => void;
};

export function MessageActionMenuModal({
  visible,
  isDark,
  styles,
  insets,
  anchor,
  anim,
  measuredH,
  measuredHRef,
  onMeasuredH,
  target,
  myUserId,
  myPublicKey,
  displayName,
  isDm,
  encryptedPlaceholder,
  normalizeUser,
  mediaUrlByPath,
  dmThumbUriByPath,
  quickReactions,
  nameBySub,
  messageListData,
  blockedSubsSet,
  onBlockUserSub,
  uiConfirm,
  uiChoice3,
  showAlert,
  close,
  copyToClipboard,
  selectionActive,
  onSelectMessage,
  sendReaction,
  openReactionPicker,
  setCipherText,
  setCipherOpen,
  beginReply,
  beginInlineEdit,
  setInlineEditAttachmentMode,
  handlePickMedia,
  clearPendingMedia,
  deleteForMe,
  sendDeleteForEveryone,
  openReportForMessage,
}: Props) {
  const copyText = React.useMemo(() => {
    return target ? getCopyableMessageText({ msg: target, isDm }) : null;
  }, [isDm, target]);

  // On iOS render as View overlay so UiPromptModal (delete confirm etc.) can show without stacking modals.
  const card = (
    <Animated.View
      style={[
        styles.actionMenuCard,
        isDark ? styles.actionMenuCardDark : null,
        (() => {
          type VisualViewportLike = { width?: number; height?: number };
          const vv =
            Platform.OS === 'web' && typeof window !== 'undefined' && 'visualViewport' in window
              ? ((window as { visualViewport?: VisualViewportLike }).visualViewport ?? null)
              : null;
          // On web, prefer the *visual viewport* (handles mobile browser toolbars/URL bar correctly).
          const w =
            (vv && typeof vv.width === 'number' ? vv.width : null) ??
            Dimensions.get('window').width;
          const h =
            (vv && typeof vv.height === 'number' ? vv.height : null) ??
            Dimensions.get('window').height;
          const cardW = Math.min(w - 36, 360);
          const left = Math.max(18, (w - cardW) / 2);
          const anchorY = anchor?.y ?? h / 2;
          const safeTop = Math.max(12, 12 + (insets.top || 0));
          // Web often reports 0 bottom insets; keep a comfortable bottom margin anyway.
          // On iOS, add a bit more so the card doesn't sit flush with the bottom edge.
          const iosExtraBottom = Platform.OS === 'ios' ? 24 : 0;
          const safeBottom = Math.max(
            12,
            12 + (insets.bottom || 0) + (Platform.OS === 'web' ? 16 : 0) + iosExtraBottom,
          );
          // Reposition-only (no scrolling): clamp the card so it stays fully visible.
          // Use a best-effort measured height when available, otherwise fall back to a conservative estimate.
          const cardH = Math.max(220, Math.floor(measuredH || measuredHRef.current || 360));
          const desiredTop = anchorY - 160;
          const minTop = safeTop;
          const maxTop = Math.max(minTop, Math.floor(h - safeBottom - cardH));
          const top = Math.max(minTop, Math.min(maxTop, desiredTop));
          const maxH = Math.max(220, Math.floor(h - safeTop - safeBottom));
          return { position: 'absolute', width: cardW, left, top, maxHeight: maxH };
        })(),
        {
          opacity: anim,
          transform: [
            {
              scale: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [0.98, 1],
              }),
            },
            {
              translateY: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [(anchor?.y ?? 0) > Dimensions.get('window').height / 2 ? 10 : -10, 0],
              }),
            },
          ],
        },
      ]}
      onLayout={(e) => {
        try {
          const h = Number(e?.nativeEvent?.layout?.height ?? 0);
          if (Number.isFinite(h) && h > 0) onMeasuredH(h);
        } catch {
          // ignore
        }
      }}
    >
      {/* Message preview (Signal-style) */}
      {target ? (
        <View
          style={[styles.actionMenuPreviewRow, isDark ? styles.actionMenuPreviewRowDark : null]}
        >
          {(() => {
            const t = target;
            const isOutgoingByUserSub =
              !!myUserId && !!t.userSub && String(t.userSub) === String(myUserId);
            const isEncryptedOutgoing =
              !!t.encrypted && !!myPublicKey && t.encrypted.senderPublicKey === myPublicKey;
            const isPlainOutgoing =
              !t.encrypted &&
              (isOutgoingByUserSub
                ? true
                : normalizeUser(t.userLower ?? t.user ?? 'anon') === normalizeUser(displayName));
            const isOutgoing = isOutgoingByUserSub || isEncryptedOutgoing || isPlainOutgoing;
            const bubbleStyle = isOutgoing
              ? styles.messageBubbleOutgoing
              : isDark
                ? styles.messageBubbleIncomingDark
                : styles.messageBubbleIncoming;
            const textStyle = isOutgoing
              ? styles.messageTextOutgoing
              : isDark
                ? styles.messageTextIncomingDark
                : styles.messageTextIncoming;
            if (t.deletedAt) {
              return (
                <View style={[styles.messageBubble, bubbleStyle]}>
                  <Text style={[styles.messageText, textStyle]}>This message has been deleted</Text>
                </View>
              );
            }

            let caption = '';
            let thumbUri: string | null = null;
            let kind: 'image' | 'video' | 'file' | null = null;
            let fileName: string | undefined;
            let contentType: string | undefined;
            let hasMedia = false;
            let mediaCount = 0;

            if (t.encrypted || t.groupEncrypted) {
              if (!t.decryptedText) {
                return (
                  <View style={[styles.messageBubble, bubbleStyle]}>
                    <Text style={[styles.messageText, textStyle]}>{encryptedPlaceholder}</Text>
                  </View>
                );
              }
              const plain = String(t.decryptedText || '');
              const encText = parseEncryptedTextEnvelope(plain);
              const dmEnv = parseDmMediaEnvelope(plain);
              const dmItems = dmEnv ? normalizeDmMediaItems(dmEnv) : [];
              const gEnv = parseGroupMediaEnvelope(plain);
              const gItems = gEnv ? normalizeGroupMediaItems(gEnv) : [];
              if (dmItems.length || gItems.length) {
                hasMedia = true;
                mediaCount = dmItems.length || gItems.length || 0;
                caption = String((dmEnv?.caption ?? gEnv?.caption) || '');
                const first = dmItems[0]?.media ?? gItems[0]?.media;
                const firstRec =
                  typeof first === 'object' && first != null
                    ? (first as Record<string, unknown>)
                    : null;
                const k = firstRec && typeof firstRec.kind === 'string' ? firstRec.kind : null;
                kind = k === 'image' || k === 'video' ? k : 'file';
                fileName =
                  firstRec && typeof firstRec.fileName === 'string'
                    ? String(firstRec.fileName)
                    : undefined;
                contentType =
                  firstRec && typeof firstRec.contentType === 'string'
                    ? String(firstRec.contentType)
                    : undefined;
                // Reuse decrypted thumb cache so message options show actual previews.
                const thumbKey =
                  firstRec &&
                  (typeof firstRec.thumbPath === 'string' || typeof firstRec.thumbPath === 'number')
                    ? String(firstRec.thumbPath)
                    : null;
                if (kind !== 'file' && thumbKey && dmThumbUriByPath[thumbKey]) {
                  thumbUri = dmThumbUriByPath[thumbKey];
                } else {
                  thumbUri = null;
                }
              } else {
                caption = encText ? String(encText.text || '') : plain;
              }
            } else {
              const raw = String(t.rawText ?? t.text ?? '');
              const env = !isDm ? parseChatEnvelope(raw) : null;
              const envList = env ? normalizeChatMediaList(env.media) : [];
              if (envList.length) {
                hasMedia = true;
                mediaCount = envList.length || 0;
                caption = String(env?.text || '');
                const first = envList[0];
                kind = first.kind === 'image' || first.kind === 'video' ? first.kind : 'file';
                fileName = typeof first.fileName === 'string' ? String(first.fileName) : undefined;
                contentType =
                  typeof first.contentType === 'string' ? String(first.contentType) : undefined;
                const key = String(first.thumbPath || first.path);
                // Only show a thumbnail for actual images/videos.
                thumbUri = kind !== 'file' && mediaUrlByPath[key] ? mediaUrlByPath[key] : null;
              } else {
                caption = raw;
              }
            }

            if (!hasMedia) {
              const showReply =
                !t.deletedAt &&
                !!t.replyToMessageId &&
                String(t.replyToPreview || '').trim().length > 0;
              const replyKind =
                t.replyToMediaKind === 'image' ||
                t.replyToMediaKind === 'video' ||
                t.replyToMediaKind === 'file'
                  ? t.replyToMediaKind
                  : null;
              const replyCount =
                typeof t.replyToMediaCount === 'number' && Number.isFinite(t.replyToMediaCount)
                  ? Math.max(0, Math.floor(t.replyToMediaCount))
                  : 0;
              const replyLabel = (() => {
                const origin =
                  t.replyToMessageId && messageListData && messageListData.length
                    ? messageListData.find((m) => m && m.id === t.replyToMessageId)
                    : null;
                const sub =
                  (typeof t.replyToUserSub === 'string' ? t.replyToUserSub : '') ||
                  (origin?.userSub ? String(origin.userSub) : '');
                const replyingToMe = !!sub && !!myUserId && String(sub) === String(myUserId);
                if (replyingToMe) return isOutgoing ? 'yourself' : 'You';
                const fromMaps = sub ? nameBySub[String(sub)] : '';
                if (fromMaps) return fromMaps;
                const fromOrigin = origin?.user ? String(origin.user).trim() : '';
                if (fromOrigin) return fromOrigin;
                if (sub) return `User ${String(sub).slice(0, 6)}`;
                return 'Unknown user';
              })();

              return (
                <View style={[styles.messageBubble, bubbleStyle]}>
                  {showReply ? (
                    <View
                      style={[
                        styles.replySnippet,
                        { flexDirection: 'row', gap: 10, marginTop: 0 },
                        isOutgoing
                          ? styles.replySnippetOutgoing
                          : isDark
                            ? styles.replySnippetIncomingDark
                            : styles.replySnippetIncoming,
                      ]}
                    >
                      {replyKind ? (
                        <View
                          style={[
                            styles.replyThumbWrap,
                            { marginBottom: 0, marginRight: 0, alignSelf: 'center' },
                          ]}
                        >
                          {replyKind === 'file' ? (
                            <View style={[styles.replyThumb, styles.replyThumbPlaceholder]}>
                              <MaterialCommunityIcons
                                name={
                                  (fileIconNameForMedia({
                                    kind: 'file',
                                    contentType: t.replyToMediaContentType,
                                    fileName: t.replyToMediaFileName,
                                  }) || 'file-outline') as never
                                }
                                size={24}
                                color={
                                  isOutgoing
                                    ? withAlpha(PALETTE.white, 0.92)
                                    : fileBrandColorForMedia({
                                        kind: 'file',
                                        contentType: t.replyToMediaContentType,
                                        fileName: t.replyToMediaFileName,
                                      }) ||
                                      (isDark
                                        ? styles.replySnippetLabelIncomingDark?.color
                                        : styles.replySnippetLabelIncoming?.color)
                                }
                              />
                            </View>
                          ) : (
                            <View style={[styles.replyThumb, styles.replyThumbPlaceholder]}>
                              <Text style={styles.replyThumbPlaceholderText}>
                                {replyKind === 'image' ? 'Photo' : 'Video'}
                              </Text>
                            </View>
                          )}
                          {replyCount > 1 ? (
                            <View style={styles.replyThumbCountBadge}>
                              <Text style={styles.replyThumbCountText}>{`+${replyCount - 1}`}</Text>
                            </View>
                          ) : null}
                        </View>
                      ) : null}

                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text
                          style={[
                            styles.replySnippetLabel,
                            isOutgoing
                              ? styles.replySnippetLabelOutgoing
                              : isDark
                                ? styles.replySnippetLabelIncomingDark
                                : styles.replySnippetLabelIncoming,
                          ]}
                          numberOfLines={1}
                        >
                          {`Replying to ${replyLabel}`}
                        </Text>
                        <Text
                          style={[
                            styles.replySnippetText,
                            isOutgoing
                              ? styles.replySnippetTextOutgoing
                              : isDark
                                ? styles.replySnippetTextIncomingDark
                                : styles.replySnippetTextIncoming,
                          ]}
                          numberOfLines={2}
                        >
                          {String(t.replyToPreview || '').trim()}
                        </Text>
                      </View>
                    </View>
                  ) : null}

                  <RichText
                    text={String(caption || '')}
                    isDark={isDark}
                    enableMentions={!isDm}
                    variant={isOutgoing ? 'outgoing' : 'incoming'}
                    style={[styles.messageText, textStyle]}
                  />
                </View>
              );
            }

            const label = attachmentLabelForMedia({
              kind: kind === 'image' || kind === 'video' ? kind : 'file',
              contentType,
              fileName,
            });
            const multiLabel = mediaCount > 1 ? `${label} · ${mediaCount} attachments` : label;
            const isFile = kind === 'file';
            const displayFileName = String(fileName || '').trim() || label;
            const fileIconName = fileIconNameForMedia({
              kind: 'file',
              contentType,
              fileName,
            });
            const fileBadge = fileBadgeForMedia({ kind: 'file', contentType, fileName });
            const fileColor =
              fileBrandColorForMedia({ kind: 'file', contentType, fileName }) ||
              (isDark ? styles.actionMenuMediaMetaDark?.color : undefined);
            return (
              <View style={styles.actionMenuMediaPreview}>
                {isFile ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={styles.actionMenuMediaThumbWrap}>
                      {fileIconName ? (
                        <MaterialCommunityIcons
                          name={fileIconName as never}
                          size={36}
                          color={
                            fileColor ||
                            (isDark
                              ? styles.actionMenuMediaMetaDark?.color
                              : styles.actionMenuMediaMeta?.color)
                          }
                        />
                      ) : (
                        <Text
                          style={[
                            styles.actionMenuMediaThumbPlaceholderText,
                            {
                              paddingHorizontal: 10,
                              paddingVertical: 6,
                              borderRadius: 999,
                              backgroundColor: 'transparent',
                            },
                          ]}
                        >
                          {fileBadge}
                        </Text>
                      )}
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text
                        style={[
                          styles.actionMenuMediaCaption,
                          isDark ? styles.actionMenuMediaCaptionDark : null,
                          { fontWeight: '800' },
                        ]}
                        numberOfLines={1}
                        ellipsizeMode="middle"
                      >
                        {displayFileName}
                      </Text>
                      <Text
                        style={[
                          styles.actionMenuMediaMeta,
                          isDark ? styles.actionMenuMediaMetaDark : null,
                        ]}
                        numberOfLines={1}
                      >
                        {multiLabel}
                      </Text>
                    </View>
                  </View>
                ) : (
                  <View style={styles.actionMenuMediaThumbWrap}>
                    {thumbUri ? (
                      <Image
                        source={{ uri: thumbUri }}
                        style={styles.actionMenuMediaThumb}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={styles.actionMenuMediaThumbPlaceholder}>
                        <Text style={styles.actionMenuMediaThumbPlaceholderText}>{label}</Text>
                      </View>
                    )}
                  </View>
                )}
                {!isFile ? (
                  <Text
                    style={[
                      styles.actionMenuMediaMeta,
                      isDark ? styles.actionMenuMediaMetaDark : null,
                    ]}
                  >
                    {multiLabel}
                  </Text>
                ) : null}
                {caption.trim().length ? (
                  <RichText
                    text={caption.trim()}
                    isDark={isDark}
                    enableMentions={!isDm}
                    variant={isOutgoing ? 'outgoing' : 'incoming'}
                    style={[
                      styles.actionMenuMediaCaption,
                      isDark ? styles.actionMenuMediaCaptionDark : null,
                    ]}
                  />
                ) : null}
              </View>
            );
          })()}
        </View>
      ) : null}

      <ScrollView
        style={styles.actionMenuOptionsScroll}
        contentContainerStyle={styles.actionMenuOptionsContent}
        showsVerticalScrollIndicator
        keyboardShouldPersistTaps="handled"
      >
        {/* Reactions */}
        {target && !target.deletedAt && (!target.encrypted || !!target.decryptedText) ? (
          <View style={styles.reactionQuickRow}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.reactionQuickScrollContent}
            >
              {quickReactions.map((emoji) => {
                const mine = myUserId
                  ? (target.reactions?.[emoji]?.userSubs || []).includes(myUserId)
                  : false;
                return (
                  <Pressable
                    key={`quick:${emoji}`}
                    onPress={() => {
                      sendReaction(target, emoji);
                      close();
                    }}
                    style={({ pressed }) => [
                      styles.reactionQuickBtn,
                      isDark ? styles.reactionQuickBtnDark : null,
                      mine
                        ? isDark
                          ? styles.reactionQuickBtnMineDark
                          : styles.reactionQuickBtnMine
                        : null,
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
                openReactionPicker(target);
                close();
              }}
              style={({ pressed }) => [
                styles.reactionQuickMore,
                isDark ? styles.reactionQuickMoreDark : null,
                pressed ? { opacity: 0.85 } : null,
              ]}
              accessibilityRole="button"
              accessibilityLabel="More reactions"
            >
              <Text
                style={[
                  styles.reactionQuickMoreText,
                  isDark ? styles.reactionQuickMoreTextDark : null,
                ]}
              >
                …
              </Text>
            </Pressable>
          </View>
        ) : null}

        {target?.encrypted || target?.groupEncrypted ? (
          <Pressable
            onPress={() => {
              setCipherText(String(target?.rawText ?? target?.text ?? ''));
              setCipherOpen(true);
              close();
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

        {target && !target.deletedAt ? (
          <Pressable
            onPress={() => beginReply(target)}
            style={({ pressed }) => [
              styles.actionMenuRow,
              pressed ? styles.actionMenuRowPressed : null,
            ]}
          >
            <Text style={[styles.actionMenuText, isDark ? styles.actionMenuTextDark : null]}>
              Reply
            </Text>
          </Pressable>
        ) : null}

        {target &&
        !target.deletedAt &&
        !selectionActive &&
        typeof onSelectMessage === 'function' ? (
          <Pressable
            onPress={() => {
              onSelectMessage(target);
              close();
            }}
            style={({ pressed }) => [
              styles.actionMenuRow,
              pressed ? styles.actionMenuRowPressed : null,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Select message"
          >
            <Text style={[styles.actionMenuText, isDark ? styles.actionMenuTextDark : null]}>
              Select
            </Text>
          </Pressable>
        ) : null}

        {copyText ? (
          <Pressable
            onPress={() => {
              void copyToClipboard(copyText);
              close();
            }}
            style={({ pressed }) => [
              styles.actionMenuRow,
              pressed ? styles.actionMenuRowPressed : null,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Copy message"
          >
            <Text style={[styles.actionMenuText, isDark ? styles.actionMenuTextDark : null]}>
              Copy
            </Text>
          </Pressable>
        ) : null}

        {(() => {
          const t = target;
          if (!t) return null;
          const isOutgoingByUserSub =
            !!myUserId && !!t.userSub && String(t.userSub) === String(myUserId);
          const isEncryptedOutgoing =
            !!t.encrypted && !!myPublicKey && t.encrypted.senderPublicKey === myPublicKey;
          const isPlainOutgoing =
            !t.encrypted &&
            !t.groupEncrypted &&
            (isOutgoingByUserSub
              ? true
              : normalizeUser(t.userLower ?? t.user ?? 'anon') === normalizeUser(displayName));
          const canEdit = isOutgoingByUserSub || isEncryptedOutgoing || isPlainOutgoing;
          if (!canEdit) return null;
          const hasMedia = (() => {
            if (t.deletedAt) return false;
            if (t.encrypted) {
              if (!t.decryptedText) return false;
              const dmEnv = parseDmMediaEnvelope(String(t.decryptedText));
              return !!(dmEnv && normalizeDmMediaItems(dmEnv).length);
            }
            if (t.groupEncrypted) {
              if (!t.decryptedText) return false;
              const gEnv = parseGroupMediaEnvelope(String(t.decryptedText));
              return !!(gEnv && normalizeGroupMediaItems(gEnv).length);
            }
            if (isDm) return false;
            const env = parseChatEnvelope(String(t.rawText ?? t.text ?? ''));
            return !!(env && normalizeChatMediaList(env.media).length);
          })();
          return (
            <>
              {!hasMedia ? (
                <Pressable
                  onPress={() => {
                    setInlineEditAttachmentMode('replace');
                    beginInlineEdit(t);
                    handlePickMedia();
                  }}
                  style={({ pressed }) => [
                    styles.actionMenuRow,
                    pressed ? styles.actionMenuRowPressed : null,
                  ]}
                >
                  <Text style={[styles.actionMenuText, isDark ? styles.actionMenuTextDark : null]}>
                    Add attachment
                  </Text>
                </Pressable>
              ) : null}

              {hasMedia ? (
                <Pressable
                  onPress={() => {
                    setInlineEditAttachmentMode('replace');
                    beginInlineEdit(t);
                    handlePickMedia();
                  }}
                  style={({ pressed }) => [
                    styles.actionMenuRow,
                    pressed ? styles.actionMenuRowPressed : null,
                  ]}
                >
                  <Text style={[styles.actionMenuText, isDark ? styles.actionMenuTextDark : null]}>
                    Replace attachment
                  </Text>
                </Pressable>
              ) : null}

              {hasMedia ? (
                <Pressable
                  onPress={() => {
                    setInlineEditAttachmentMode('remove');
                    clearPendingMedia();
                    beginInlineEdit(t);
                  }}
                  style={({ pressed }) => [
                    styles.actionMenuRow,
                    pressed ? styles.actionMenuRowPressed : null,
                  ]}
                >
                  <Text style={[styles.actionMenuText, isDark ? styles.actionMenuTextDark : null]}>
                    Remove attachment
                  </Text>
                </Pressable>
              ) : null}

              <Pressable
                onPress={() => {
                  setInlineEditAttachmentMode('keep');
                  beginInlineEdit(t);
                }}
                style={({ pressed }) => [
                  styles.actionMenuRow,
                  pressed ? styles.actionMenuRowPressed : null,
                ]}
              >
                <Text style={[styles.actionMenuText, isDark ? styles.actionMenuTextDark : null]}>
                  Edit
                </Text>
              </Pressable>
            </>
          );
        })()}

        {(() => {
          const t = target;
          if (!t || t.deletedAt) return null;
          // Determine whether "delete for everyone" would be allowed.
          const isOutgoingByUserSub =
            !!myUserId && !!t.userSub && String(t.userSub) === String(myUserId);
          const isEncryptedOutgoing =
            !!t.encrypted && !!myPublicKey && t.encrypted.senderPublicKey === myPublicKey;
          const isPlainOutgoing =
            !t.encrypted &&
            (isOutgoingByUserSub
              ? true
              : normalizeUser(t.userLower ?? t.user ?? 'anon') === normalizeUser(displayName));
          const canDeleteForEveryone =
            isOutgoingByUserSub || isEncryptedOutgoing || isPlainOutgoing;

          return (
            <Pressable
              onPress={() => {
                void (async () => {
                  const choice = await uiChoice3('Delete Message?', '', {
                    primaryText: 'Delete for Me',
                    secondaryText: 'Delete for Everyone',
                    tertiaryText: 'Cancel',
                    primaryVariant: 'danger',
                    secondaryVariant: 'danger',
                    tertiaryVariant: 'default',
                  });

                  if (choice === 'tertiary') return;
                  close();

                  if (choice === 'primary') {
                    await Promise.resolve(deleteForMe(t));
                    return;
                  }

                  // secondary
                  if (!canDeleteForEveryone) {
                    showAlert(
                      'Cannot delete for everyone',
                      'Only your own messages can be deleted for everyone.',
                    );
                    return;
                  }
                  await Promise.resolve(sendDeleteForEveryone());
                })();
              }}
              style={({ pressed }) => [
                styles.actionMenuRow,
                pressed ? styles.actionMenuRowPressed : null,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Delete"
            >
              <Text style={[styles.actionMenuText, isDark ? styles.actionMenuTextDark : null]}>
                Delete…
              </Text>
            </Pressable>
          );
        })()}

        {(() => {
          const t = target;
          const sub = t?.userSub ? String(t.userSub) : '';
          const label = t?.user ? String(t.user) : '';
          const isMe = !!myUserId && !!sub && String(sub) === String(myUserId);
          const alreadyBlocked = !!sub && blockedSubsSet.has(sub);
          if (!t || !sub || isMe || alreadyBlocked || typeof onBlockUserSub !== 'function')
            return null;
          return (
            <Pressable
              onPress={async () => {
                close();
                try {
                  const ok = await uiConfirm(
                    'Block user?',
                    `Block ${label ? `"${label}"` : 'this user'}?\n\nYou won’t see their messages, and they won’t be able to DM you.\n\nYou can unblock them later from your Blocklist.`,
                    { confirmText: 'Block', cancelText: 'Cancel', destructive: true },
                  );
                  if (!ok) return;
                  await Promise.resolve(onBlockUserSub(sub, label));
                  showAlert('Blocked', 'User blocked. Their messages will be hidden.');
                } catch (e: unknown) {
                  showAlert('Block failed', getErrorMessage(e) || 'Failed to block user');
                }
              }}
              style={({ pressed }) => [
                styles.actionMenuRow,
                pressed ? styles.actionMenuRowPressed : null,
              ]}
            >
              <Text style={[styles.actionMenuText, isDark ? styles.actionMenuTextDark : null]}>
                Block user
              </Text>
            </Pressable>
          );
        })()}

        <Pressable
          onPress={() => {
            if (!target) return;
            openReportForMessage(target);
            close();
          }}
          style={({ pressed }) => [
            styles.actionMenuRow,
            pressed ? styles.actionMenuRowPressed : null,
          ]}
        >
          <Text style={[styles.actionMenuText, isDark ? styles.actionMenuTextDark : null]}>
            Report…
          </Text>
        </Pressable>
      </ScrollView>
    </Animated.View>
  );

  if (Platform.OS === 'ios') {
    if (!visible) return <></>;
    return (
      <View style={[StyleSheet.absoluteFill, { zIndex: 10000 }]}>
        <View style={styles.actionMenuOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} />
          {card}
        </View>
      </View>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.actionMenuOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        {card}
      </View>
    </Modal>
  );
}
