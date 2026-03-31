import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React from 'react';
import {
  Animated,
  Easing,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { AppTextInput } from '../../../components/AppTextInput';
import { RichText } from '../../../components/RichText';
import type { CdnUrlCacheApi } from '../../../hooks/useCdnUrlCache';
import {
  calcCenteredModalBottomPadding,
  useKeyboardOverlap,
} from '../../../hooks/useKeyboardOverlap';
import type { ChatScreenStyles } from '../../../screens/ChatScreen.styles';
import { APP_COLORS, PALETTE } from '../../../theme/colors';
import type { MediaItem } from '../../../types/media';
import {
  attachmentLabelForMedia,
  fileBadgeForMedia,
  fileBrandColorForMedia,
  fileIconNameForMedia,
  getPreviewKind,
} from '../../../utils/mediaKinds';
import {
  normalizeChatMediaList,
  normalizeDmMediaItems,
  normalizeGroupMediaItems,
  parseChatEnvelope,
  parseDmMediaEnvelope,
  parseGroupMediaEnvelope,
} from '../parsers';
import type { ChatMessage } from '../types';

type ReportNotice = { type: 'success' | 'error'; message: string };
const MINI_TOGGLE_THUMB_TRAVEL_PX = 10;

function MiniToggle({
  value,
  onValueChange,
  disabled,
  isDark,
  styles,
}: {
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
  isDark: boolean;
  styles: ChatScreenStyles;
}): React.JSX.Element {
  const slide = React.useRef(new Animated.Value(value ? MINI_TOGGLE_THUMB_TRAVEL_PX : 0)).current;
  React.useEffect(() => {
    Animated.timing(slide, {
      toValue: value ? MINI_TOGGLE_THUMB_TRAVEL_PX : 0,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [slide, value]);

  return (
    <Pressable
      onPress={() => {
        if (disabled) return;
        onValueChange(!value);
      }}
      hitSlop={{ top: 8, bottom: 8, left: 10, right: 10 }}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: !!disabled }}
      style={({ pressed }) => [
        styles.miniToggleTrack,
        isDark ? styles.miniToggleTrackDark : null,
        value ? styles.miniToggleTrackOn : null,
        value && isDark ? styles.miniToggleTrackOnDark : null,
        disabled ? styles.miniToggleDisabled : null,
        pressed && !disabled ? styles.miniTogglePressed : null,
      ]}
    >
      <Animated.View
        style={[
          styles.miniToggleThumb,
          isDark ? styles.miniToggleThumbDark : null,
          { transform: [{ translateX: slide }] },
        ]}
      />
    </Pressable>
  );
}

type Props = {
  visible: boolean;
  isDark: boolean;
  styles: ChatScreenStyles;
  submitting: boolean;
  notice: ReportNotice | null;
  reportKind: 'message' | 'user';
  reportCategory: string;
  reportTargetMessage: ChatMessage | null;
  reportTargetUserSub: string | null | undefined;
  reportTargetUserLabel: string | null | undefined;
  reportDetails: string;
  cdnMedia: CdnUrlCacheApi;
  onClose: () => void;
  onSubmit: () => void;
  onToggleKind: (nextIsUser: boolean) => void;
  onSelectCategory: (key: string) => void;
  onChangeDetails: (t: string) => void;
};

export function ReportModal({
  visible,
  isDark,
  styles,
  submitting,
  notice,
  reportKind,
  reportCategory,
  reportTargetMessage,
  reportTargetUserSub,
  reportTargetUserLabel,
  reportDetails,
  cdnMedia,
  onClose,
  onSubmit,
  onToggleKind,
  onSelectCategory,
  onChangeDetails,
}: Props) {
  const kb = useKeyboardOverlap({ enabled: visible });
  const ensureThumbUrl = cdnMedia.ensure;
  const [detailsFocused, setDetailsFocused] = React.useState(false);
  const [sheetHeight, setSheetHeight] = React.useState<number>(0);
  const bottomPad = React.useMemo(
    () =>
      calcCenteredModalBottomPadding(
        {
          keyboardVisible: kb.keyboardVisible,
          remainingOverlap: kb.remainingOverlap,
          windowHeight: kb.windowHeight,
        },
        sheetHeight,
        12,
      ),
    [kb.keyboardVisible, kb.remainingOverlap, kb.windowHeight, sheetHeight],
  );

  // If the modal is dismissed while focused, ensure we don't keep the "focused" ring
  // when it reopens.
  React.useEffect(() => {
    if (!visible) setDetailsFocused(false);
  }, [visible]);

  // Prefetch thumb URLs so we don't call cdnMedia.resolve() during render (which would set state).
  React.useEffect(() => {
    if (!visible) return;
    if (reportKind !== 'message') return;
    try {
      const t = reportTargetMessage;
      if (!t || t.deletedAt) return;

      const rawText =
        typeof t.decryptedText === 'string' && t.decryptedText.trim()
          ? t.decryptedText.trim()
          : typeof t.text === 'string' && t.text.trim()
            ? t.text.trim()
            : '';

      // Only attempt to parse plaintext/global messages for thumbs; encrypted attachments are .enc and not CDN-previewable here.
      const env = !t.encrypted && !t.groupEncrypted ? parseChatEnvelope(rawText) : null;
      const envMediaList: MediaItem[] = env ? normalizeChatMediaList(env.media) : [];
      const fallbackList: MediaItem[] =
        Array.isArray(t.mediaList) && t.mediaList.length ? t.mediaList : t.media ? [t.media] : [];
      const previewMediaList: MediaItem[] = envMediaList.length ? envMediaList : fallbackList;
      const media: MediaItem | undefined = previewMediaList[0];
      const thumbPath = String(media?.thumbPath || media?.path || '').trim();
      if (!thumbPath) return;
      if (thumbPath.includes('.enc')) return;

      ensureThumbUrl([thumbPath]);
    } catch {
      // ignore prefetch errors
    }
  }, [ensureThumbUrl, reportKind, reportTargetMessage, visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View
        style={[
          styles.modalOverlay,
          Platform.OS !== 'web' && bottomPad > 0 ? { paddingBottom: bottomPad } : null,
        ]}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} disabled={submitting} />
        <View
          style={[
            styles.summaryModal,
            isDark ? styles.summaryModalDark : null,
            Platform.OS !== 'web' && kb.keyboardVisible
              ? { maxHeight: kb.availableHeightAboveKeyboard, minHeight: 0 }
              : null,
          ]}
          onLayout={(e) => {
            const h = e?.nativeEvent?.layout?.height;
            if (typeof h === 'number' && Number.isFinite(h) && h > 0) setSheetHeight(h);
          }}
        >
          <Text style={[styles.summaryTitle, isDark ? styles.summaryTitleDark : null]}>Report</Text>
          <View style={{ flexGrow: 1, flexShrink: 1, minHeight: 0 }}>
            <ScrollView style={styles.summaryScroll} contentContainerStyle={{ paddingBottom: 8 }}>
              <Text style={[styles.summaryText, isDark ? styles.summaryTextDark : null]}>
                Reports are sent to the developer for review. Add an optional note to help us
                understand the issue.
              </Text>

              {notice ? (
                <View
                  style={[
                    styles.reportNoticeBox,
                    notice.type === 'success'
                      ? styles.reportNoticeBoxSuccess
                      : styles.reportNoticeBoxError,
                    isDark ? styles.reportNoticeBoxDark : null,
                    notice.type === 'success'
                      ? isDark
                        ? styles.reportNoticeBoxSuccessDark
                        : null
                      : isDark
                        ? styles.reportNoticeBoxErrorDark
                        : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.reportNoticeText,
                      notice.type === 'success'
                        ? styles.reportNoticeTextSuccess
                        : styles.reportNoticeTextError,
                      isDark ? styles.reportNoticeTextDark : null,
                      notice.type === 'success'
                        ? isDark
                          ? styles.reportNoticeTextSuccessDark
                          : null
                        : isDark
                          ? styles.reportNoticeTextErrorDark
                          : null,
                    ]}
                  >
                    {notice.message}
                  </Text>
                </View>
              ) : null}

              <View style={styles.reportTargetSwitchWrap}>
                <Text
                  style={[
                    styles.reportTargetToggleLabel,
                    isDark ? styles.reportTargetToggleLabelDark : null,
                  ]}
                >
                  Message
                </Text>
                {Platform.OS === 'android' ? (
                  <Switch
                    value={reportKind === 'user'}
                    disabled={submitting}
                    onValueChange={onToggleKind}
                    trackColor={{
                      false: APP_COLORS.light.border.default,
                      true: APP_COLORS.light.border.default,
                    }}
                    thumbColor={isDark ? APP_COLORS.dark.border.subtle : APP_COLORS.light.bg.app}
                  />
                ) : (
                  <MiniToggle
                    value={reportKind === 'user'}
                    disabled={submitting}
                    isDark={isDark}
                    styles={styles}
                    onValueChange={onToggleKind}
                  />
                )}
                <Text
                  style={[
                    styles.reportTargetToggleLabel,
                    isDark ? styles.reportTargetToggleLabelDark : null,
                  ]}
                >
                  User
                </Text>
              </View>

              <View style={styles.reportCategoryWrap}>
                {[
                  { key: 'spam', label: 'Spam' },
                  { key: 'harassment', label: 'Harassment' },
                  { key: 'hate', label: 'Hate' },
                  { key: 'impersonation', label: 'Impersonation' },
                  { key: 'illegal', label: 'Illegal' },
                  { key: 'other', label: 'Other' },
                ].map((c) => {
                  const active = reportCategory === c.key;
                  return (
                    <Pressable
                      key={c.key}
                      disabled={submitting}
                      onPress={() => onSelectCategory(c.key)}
                      style={({ pressed }) => [
                        styles.reportChip,
                        isDark ? styles.reportChipDark : null,
                        active ? styles.reportChipActive : null,
                        active && isDark ? styles.reportChipActiveDark : null,
                        pressed ? { opacity: 0.9 } : null,
                      ]}
                    >
                      <Text
                        style={[
                          styles.reportChipText,
                          isDark ? styles.reportChipTextDark : null,
                          active
                            ? isDark
                              ? styles.reportChipTextActiveDark
                              : styles.reportChipTextActive
                            : null,
                        ]}
                      >
                        {c.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {reportKind === 'message' ? (
                <View
                  style={[styles.reportPreviewBox, isDark ? styles.reportPreviewBoxDark : null]}
                >
                  <Text
                    style={[
                      styles.reportPreviewLabel,
                      isDark ? styles.reportPreviewLabelDark : null,
                    ]}
                  >
                    Message Preview
                  </Text>
                  {(() => {
                    const t = reportTargetMessage;
                    if (!t) {
                      return (
                        <Text
                          style={[
                            styles.reportPreviewText,
                            isDark ? styles.reportPreviewTextDark : null,
                          ]}
                        >
                          (no message selected)
                        </Text>
                      );
                    }
                    if (t.deletedAt) {
                      return (
                        <Text
                          style={[
                            styles.reportPreviewText,
                            isDark ? styles.reportPreviewTextDark : null,
                          ]}
                        >
                          (deleted)
                        </Text>
                      );
                    }

                    const rawText =
                      typeof t.decryptedText === 'string' && t.decryptedText.trim()
                        ? t.decryptedText.trim()
                        : typeof t.text === 'string' && t.text.trim()
                          ? t.text.trim()
                          : '';

                    // Global/channel media messages often store a JSON chat envelope in `text`.
                    // If we render that raw string, the report preview becomes unreadable.
                    const env =
                      !t.encrypted && !t.groupEncrypted ? parseChatEnvelope(rawText) : null;
                    const envMediaList: MediaItem[] = env ? normalizeChatMediaList(env.media) : [];

                    // Encrypted DM/GDM media messages store a JSON media envelope in decryptedText.
                    // Render a friendly summary instead of the raw JSON string.
                    const dmEnv = t.encrypted ? parseDmMediaEnvelope(rawText) : null;
                    const gdmEnv = t.groupEncrypted ? parseGroupMediaEnvelope(rawText) : null;
                    const dmItems = dmEnv ? normalizeDmMediaItems(dmEnv) : [];
                    const gdmItems = gdmEnv ? normalizeGroupMediaItems(gdmEnv) : [];
                    const encItems = dmItems.length ? dmItems : gdmItems;
                    const encMediaList: MediaItem[] = encItems.map((it) => ({
                      path: it.media.path,
                      thumbPath: it.media.thumbPath,
                      kind: it.media.kind,
                      contentType: it.media.contentType,
                      thumbContentType: it.media.thumbContentType,
                      fileName: it.media.fileName,
                      size: it.media.size,
                    }));
                    const fallbackList =
                      Array.isArray(t.mediaList) && t.mediaList.length
                        ? t.mediaList
                        : t.media
                          ? [t.media]
                          : [];
                    const previewMediaList: MediaItem[] = envMediaList.length
                      ? envMediaList
                      : encMediaList.length
                        ? encMediaList
                        : fallbackList;
                    const media: MediaItem | undefined = previewMediaList[0];
                    const mediaCount = previewMediaList.length;
                    const mediaFileNames = (() => {
                      const names = previewMediaList
                        .map((m) =>
                          typeof m.fileName === 'string' ? String(m.fileName).trim() : '',
                        )
                        .filter(Boolean);
                      // Keep order, de-dupe.
                      const seen = new Set<string>();
                      const uniq: string[] = [];
                      for (const n of names) {
                        if (seen.has(n)) continue;
                        seen.add(n);
                        uniq.push(n);
                      }
                      return uniq;
                    })();
                    const mediaFileNamesLines = (() => {
                      if (!mediaFileNames.length) return '';
                      const max = 4;
                      const shown = mediaFileNames.slice(0, max);
                      const extra = mediaFileNames.length - shown.length;
                      return shown.join('\n') + (extra > 0 ? `\n+${extra} more` : '');
                    })();

                    const attachmentTypeLabel = (m: MediaItem): string => {
                      const kind = getPreviewKind(m);
                      if (kind === 'file') {
                        return fileBadgeForMedia({
                          kind: m.kind,
                          contentType: m.contentType,
                          fileName: m.fileName,
                        });
                      }
                      return attachmentLabelForMedia({
                        kind: m.kind ?? 'file',
                        contentType: typeof m.contentType === 'string' ? m.contentType : undefined,
                        fileName: typeof m.fileName === 'string' ? m.fileName : undefined,
                      });
                    };

                    const mediaTypesLabel = (() => {
                      if (!previewMediaList.length) return '';
                      const raw = previewMediaList
                        .map((m) => attachmentTypeLabel(m))
                        .filter(Boolean);
                      if (!raw.length) return '';
                      // Keep order, de-dupe.
                      const seen = new Set<string>();
                      const uniq: string[] = [];
                      for (const t of raw) {
                        if (seen.has(t)) continue;
                        seen.add(t);
                        uniq.push(t);
                      }
                      const max = 3;
                      const shown = uniq.slice(0, max);
                      const extra = uniq.length - shown.length;
                      return shown.join(', ') + (extra > 0 ? ` +${extra} more` : '');
                    })();

                    const mediaMetaLabel =
                      mediaCount > 1
                        ? `${mediaTypesLabel || 'Attachments'} · ${mediaCount} attachments`
                        : mediaCount === 1
                          ? mediaTypesLabel || 'Attachment'
                          : '';

                    const text = (() => {
                      const msgText =
                        env?.text && typeof env.text === 'string' ? env.text.trim() : '';
                      if (msgText) return msgText;
                      const encCaption =
                        (dmEnv && typeof dmEnv.caption === 'string' ? dmEnv.caption.trim() : '') ||
                        (gdmEnv && typeof gdmEnv.caption === 'string' ? gdmEnv.caption.trim() : '');
                      if (encCaption) return encCaption;
                      // Fall back to the raw text ONLY if it doesn't look like a chat envelope.
                      if (
                        rawText.startsWith('{') &&
                        rawText.includes('"type"') &&
                        rawText.includes('"chat"')
                      )
                        return '';
                      // Also hide raw encrypted media envelopes (dm_media_v*/gdm_media_v*).
                      if (
                        rawText.startsWith('{') &&
                        rawText.includes('"type"') &&
                        (rawText.includes('"dm_media_') || rawText.includes('"gdm_media_'))
                      )
                        return '';
                      return rawText;
                    })();

                    const thumbPath = media?.thumbPath || media?.path || '';
                    const isEnc = typeof thumbPath === 'string' && thumbPath.includes('.enc');
                    const previewKind = media ? getPreviewKind(media) : 'file';
                    const thumbUrl =
                      !isEnc && previewKind !== 'file' && thumbPath ? cdnMedia.get(thumbPath) : '';

                    if (thumbUrl) {
                      return (
                        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                          <Image
                            source={{ uri: thumbUrl }}
                            style={{
                              width: 56,
                              height: 56,
                              borderRadius: 10,
                              backgroundColor: isDark
                                ? APP_COLORS.dark.bg.header
                                : PALETTE.paper240,
                            }}
                            resizeMode="cover"
                          />
                          <View style={{ flex: 1, minWidth: 0 }}>
                            {mediaMetaLabel ? (
                              <Text
                                style={[
                                  styles.reportPreviewText,
                                  isDark ? styles.reportPreviewTextDark : null,
                                  { opacity: 0.75, marginBottom: 2 },
                                ]}
                                numberOfLines={2}
                                ellipsizeMode="tail"
                              >
                                {mediaMetaLabel}
                              </Text>
                            ) : null}
                            {text ? (
                              <RichText
                                text={text.slice(0, 200)}
                                isDark={isDark}
                                enableMentions={false}
                                variant="neutral"
                                style={[
                                  styles.reportPreviewText,
                                  isDark ? styles.reportPreviewTextDark : null,
                                ]}
                                linkStyle={{ textDecorationLine: 'underline' }}
                                numberOfLines={3}
                                ellipsizeMode="tail"
                              />
                            ) : null}
                            {mediaFileNames.length ? (
                              <Text
                                style={[
                                  styles.reportPreviewText,
                                  isDark ? styles.reportPreviewTextDark : null,
                                  { opacity: 0.75, marginTop: 4 },
                                ]}
                                numberOfLines={4}
                              >
                                {mediaFileNamesLines}
                              </Text>
                            ) : null}
                          </View>
                        </View>
                      );
                    }

                    if (media?.path) {
                      const captionSnippet = text ? text.slice(0, 200) : '';
                      const encSuffix = isEnc ? ' (encrypted attachment)' : '';
                      const hasCaptionLine = !!`${captionSnippet}${encSuffix}`.trim();
                      const badge = fileBadgeForMedia({
                        kind: media.kind,
                        contentType: media.contentType,
                        fileName: media.fileName,
                      });
                      const iconName = fileIconNameForMedia({
                        kind: media.kind,
                        contentType: media.contentType,
                        fileName: media.fileName,
                      });
                      const brandColor = fileBrandColorForMedia({
                        kind: media.kind,
                        contentType: media.contentType,
                        fileName: media.fileName,
                      });
                      return (
                        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                          <View
                            style={{
                              width: 50,
                              height: 50,
                              alignItems: 'center',
                              justifyContent: 'center',
                              backgroundColor: 'transparent',
                            }}
                          >
                            {iconName ? (
                              <MaterialCommunityIcons
                                name={iconName as never}
                                size={50}
                                color={
                                  brandColor ||
                                  (isDark
                                    ? APP_COLORS.dark.text.primary
                                    : APP_COLORS.light.text.primary)
                                }
                              />
                            ) : (
                              <View
                                style={{
                                  paddingHorizontal: 8,
                                  paddingVertical: 5,
                                  borderRadius: 999,
                                  backgroundColor: isDark
                                    ? APP_COLORS.dark.bg.header
                                    : PALETTE.paper240,
                                }}
                              >
                                <Text
                                  style={[
                                    styles.reportPreviewText,
                                    isDark ? styles.reportPreviewTextDark : null,
                                    { fontWeight: '900' },
                                  ]}
                                >
                                  {badge}
                                </Text>
                              </View>
                            )}
                          </View>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            {mediaMetaLabel ? (
                              <Text
                                style={[
                                  styles.reportPreviewText,
                                  isDark ? styles.reportPreviewTextDark : null,
                                  { opacity: 0.75, marginBottom: 2 },
                                ]}
                                numberOfLines={2}
                                ellipsizeMode="tail"
                              >
                                {mediaMetaLabel}
                              </Text>
                            ) : null}
                            {captionSnippet || encSuffix ? (
                              <RichText
                                text={`${captionSnippet}${encSuffix}`.trim()}
                                isDark={isDark}
                                enableMentions={false}
                                variant="neutral"
                                style={[
                                  styles.reportPreviewText,
                                  isDark ? styles.reportPreviewTextDark : null,
                                ]}
                                linkStyle={{ textDecorationLine: 'underline' }}
                                numberOfLines={2}
                                ellipsizeMode="tail"
                              />
                            ) : isEnc ? (
                              <Text
                                style={[
                                  styles.reportPreviewText,
                                  isDark ? styles.reportPreviewTextDark : null,
                                ]}
                                numberOfLines={2}
                              >
                                (encrypted attachment)
                              </Text>
                            ) : null}
                            {mediaFileNamesLines ? (
                              <Text
                                style={[
                                  styles.reportPreviewText,
                                  isDark ? styles.reportPreviewTextDark : null,
                                  { opacity: 0.75, marginTop: hasCaptionLine ? 4 : 0 },
                                ]}
                                numberOfLines={4}
                              >
                                {mediaFileNamesLines}
                              </Text>
                            ) : null}
                          </View>
                        </View>
                      );
                    }

                    return (
                      <RichText
                        text={text ? text.slice(0, 200) : '(no text)'}
                        isDark={isDark}
                        enableMentions={false}
                        variant="neutral"
                        style={[
                          styles.reportPreviewText,
                          isDark ? styles.reportPreviewTextDark : null,
                        ]}
                        linkStyle={{ textDecorationLine: 'underline' }}
                        numberOfLines={6}
                        ellipsizeMode="tail"
                      />
                    );
                  })()}
                </View>
              ) : (
                <View
                  style={[styles.reportPreviewBox, isDark ? styles.reportPreviewBoxDark : null]}
                >
                  <Text
                    style={[
                      styles.reportPreviewLabel,
                      isDark ? styles.reportPreviewLabelDark : null,
                    ]}
                  >
                    Reporting User
                  </Text>
                  <Text
                    style={[styles.reportPreviewText, isDark ? styles.reportPreviewTextDark : null]}
                  >
                    {(() => {
                      const label = String(reportTargetUserLabel || '').trim();
                      if (label) return label.slice(0, 120);
                      const sub = String(reportTargetUserSub || '').trim();
                      return sub ? `User ID: ${sub}` : '(unknown user)';
                    })()}
                  </Text>
                </View>
              )}

              <AppTextInput
                isDark={isDark}
                value={reportDetails}
                onChangeText={onChangeDetails}
                placeholder="Optional note (e.g. harassment, spam, impersonation)…"
                placeholderTextColor={isDark ? PALETTE.slate400 : PALETTE.slate370}
                multiline
                onFocus={() => setDetailsFocused(true)}
                onBlur={() => setDetailsFocused(false)}
                style={[
                  styles.reportInput,
                  isDark ? styles.reportInputDark : null,
                  detailsFocused
                    ? isDark
                      ? styles.reportInputFocusedDark
                      : styles.reportInputFocused
                    : null,
                ]}
                editable={!submitting}
                maxLength={900}
              />
            </ScrollView>
          </View>

          <View style={styles.summaryButtons}>
            <Pressable
              style={[
                styles.reportBtnDanger,
                isDark ? styles.reportBtnDangerDark : null,
                submitting ? (isDark ? styles.btnDisabledDark : styles.btnDisabled) : null,
              ]}
              disabled={submitting}
              onPress={onSubmit}
            >
              <Text style={[styles.reportBtnDangerText]}>
                {submitting ? 'Reporting…' : 'Report'}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.toolBtn, isDark ? styles.toolBtnDark : null]}
              disabled={submitting}
              onPress={onClose}
            >
              <Text style={[styles.toolBtnText, isDark ? styles.toolBtnTextDark : null]}>
                Cancel
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
