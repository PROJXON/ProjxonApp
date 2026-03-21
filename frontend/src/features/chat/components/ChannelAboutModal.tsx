import React from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppTextInput } from '../../../components/AppTextInput';
import { RichText } from '../../../components/RichText';
import {
  calcCenteredModalBottomPadding,
  useKeyboardOverlap,
} from '../../../hooks/useKeyboardOverlap';
import type { ChatScreenStyles } from '../../../screens/ChatScreen.styles';
import { APP_COLORS } from '../../../theme/colors';

type Props = {
  visible: boolean;
  isDark: boolean;
  styles: ChatScreenStyles;
  title: string;

  edit: boolean;
  draft: string;
  busy: boolean;
  canEdit: boolean;

  onChangeDraft: (next: string) => void;
  onOpenUrl: (url: string) => void;

  onRequestClose: () => void;
  onBackdropPress: () => void;

  onPreview: () => void;
  onSave: () => void | Promise<void>;
  onCancelEdit: () => void;
  onGotIt: () => void | Promise<void>;
  onEdit: () => void;
};

export function ChannelAboutModal({
  visible,
  isDark,
  styles,
  title,
  edit,
  draft,
  busy,
  canEdit,
  onChangeDraft,
  onOpenUrl,
  onRequestClose,
  onBackdropPress,
  onPreview,
  onSave,
  onCancelEdit,
  onGotIt,
  onEdit,
}: Props) {
  const kb = useKeyboardOverlap({ enabled: visible });
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

  const overlayContent = (
    <View
      style={[
        styles.modalOverlay,
        Platform.OS !== 'web' && bottomPad > 0 ? { paddingBottom: bottomPad } : null,
      ]}
    >
      <Pressable style={StyleSheet.absoluteFill} onPress={onBackdropPress} />
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
        <Text style={[styles.summaryTitle, isDark ? styles.summaryTitleDark : null]}>{title}</Text>

        {edit ? (
          <>
            <Text
              style={[
                styles.summaryText,
                isDark ? styles.summaryTextDark : null,
                { marginBottom: 8 },
              ]}
            >
              Supports **bold**, *italics*, and links. Max 4000 chars.
            </Text>
            <AppTextInput
              isDark={isDark}
              value={draft}
              onChangeText={onChangeDraft}
              placeholder="Write channel info / rules…"
              multiline
              autoFocus
              textAlignVertical="top"
              style={{
                width: '100%',
                minHeight: 160,
                maxHeight: 320,
                paddingHorizontal: 12,
                paddingVertical: 10,
                borderWidth: 1,
                borderRadius: 10,
                backgroundColor: isDark ? APP_COLORS.dark.bg.header : APP_COLORS.light.bg.surface2,
                borderColor: isDark
                  ? APP_COLORS.dark.border.default
                  : APP_COLORS.light.border.subtle,
                color: isDark ? APP_COLORS.dark.text.primary : APP_COLORS.light.text.primary,
                fontSize: 15,
              }}
            />
            <Text
              style={[styles.summaryText, isDark ? styles.summaryTextDark : null, { marginTop: 6 }]}
            >
              {`${String(draft || '').length}/4000`}
            </Text>
          </>
        ) : (
          <ScrollView style={styles.summaryScroll}>
            {String(draft || '').trim() ? (
              <RichText
                text={String(draft || '')}
                isDark={isDark}
                style={[styles.summaryText, ...(isDark ? [styles.summaryTextDark] : [])]}
                enableMentions={false}
                variant="neutral"
                onOpenUrl={onOpenUrl}
              />
            ) : (
              <Text style={[styles.summaryText, isDark ? styles.summaryTextDark : null]}>
                Welcome to {title}
              </Text>
            )}
          </ScrollView>
        )}

        <View style={styles.summaryButtons}>
          {edit ? (
            <>
              <Pressable
                style={[
                  styles.toolBtn,
                  isDark ? styles.toolBtnDark : null,
                  busy ? { opacity: 0.6 } : null,
                  { marginRight: 'auto' },
                ]}
                disabled={busy}
                onPress={onPreview}
              >
                <Text style={[styles.toolBtnText, isDark ? styles.toolBtnTextDark : null]}>
                  Preview
                </Text>
              </Pressable>
              <Pressable
                style={[
                  styles.toolBtn,
                  isDark ? styles.toolBtnDark : null,
                  busy ? { opacity: 0.6 } : null,
                ]}
                disabled={busy}
                onPress={() => void Promise.resolve(onSave())}
              >
                <Text style={[styles.toolBtnText, isDark ? styles.toolBtnTextDark : null]}>
                  Save
                </Text>
              </Pressable>
              <Pressable
                style={[styles.toolBtn, isDark ? styles.toolBtnDark : null]}
                disabled={busy}
                onPress={onCancelEdit}
              >
                <Text style={[styles.toolBtnText, isDark ? styles.toolBtnTextDark : null]}>
                  Cancel
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable
                style={[styles.toolBtn, isDark ? styles.toolBtnDark : null]}
                onPress={() => void Promise.resolve(onGotIt())}
              >
                <Text style={[styles.toolBtnText, isDark ? styles.toolBtnTextDark : null]}>
                  Got it
                </Text>
              </Pressable>
              {canEdit ? (
                <Pressable
                  style={[styles.toolBtn, isDark ? styles.toolBtnDark : null]}
                  onPress={onEdit}
                >
                  <Text style={[styles.toolBtnText, isDark ? styles.toolBtnTextDark : null]}>
                    Edit
                  </Text>
                </Pressable>
              ) : null}
            </>
          )}
        </View>
      </View>
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onRequestClose}>
      {overlayContent}
    </Modal>
  );
}
