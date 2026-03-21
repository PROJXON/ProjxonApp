import Feather from '@expo/vector-icons/Feather';
import React from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { AppStyles } from '../../../../App.styles';
import { AnimatedDots } from '../../../components/AnimatedDots';
import { AppTextInput } from '../../../components/AppTextInput';
import {
  calcCenteredModalBottomPadding,
  useKeyboardOverlap,
} from '../../../hooks/useKeyboardOverlap';
import { APP_COLORS } from '../../../theme/colors';

/** iOS: avoid Modal + UiPromptModal (unblock confirm) stacking native modals. */
const BLOCKLIST_IOS_OVERLAY_Z = 50000;

export function MainAppBlocklistModal({
  styles,
  isDark,
  blocklistOpen,
  setBlocklistOpen,
  blockUsername,
  setBlockUsername,
  blockError,
  setBlockError,
  addBlockByUsername,
  blocklistLoading,
  blockedUsers,
  unblockUser,
}: {
  styles: AppStyles;
  isDark: boolean;

  blocklistOpen: boolean;
  setBlocklistOpen: (v: boolean) => void;
  blockUsername: string;
  setBlockUsername: (v: string) => void;
  blockError: string | null;
  setBlockError: (v: string | null) => void;
  addBlockByUsername: () => void | Promise<void>;

  blocklistLoading: boolean;
  blockedUsers: Array<{
    blockedSub: string;
    blockedDisplayName?: string;
    blockedUsernameLower?: string;
  }>;
  unblockUser: (sub: string, label?: string) => void | Promise<void>;
}): React.JSX.Element {
  const kb = useKeyboardOverlap({ enabled: blocklistOpen });
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
  const sheet = (
    <>
      <View
        style={[
          styles.modalOverlay,
          Platform.OS !== 'web' && bottomPad > 0 ? { paddingBottom: bottomPad } : null,
        ]}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setBlocklistOpen(false)} />
        <View
          style={[
            styles.blocksCard,
            isDark ? styles.blocksCardDark : null,
            Platform.OS !== 'web' && kb.keyboardVisible
              ? { maxHeight: kb.availableHeightAboveKeyboard, minHeight: 0 }
              : null,
          ]}
          onLayout={(e) => {
            const h = e?.nativeEvent?.layout?.height;
            if (typeof h === 'number' && Number.isFinite(h) && h > 0) setSheetHeight(h);
          }}
        >
          <View style={styles.blocksTopRow}>
            <Text style={[styles.modalTitle, isDark ? styles.modalTitleDark : null]}>
              Blocklist
            </Text>
          </View>

          <View style={styles.blocksSearchRow}>
            <AppTextInput
              isDark={isDark}
              value={blockUsername}
              onChangeText={(v) => {
                setBlockUsername(v);
                setBlockError(null);
              }}
              placeholder="Username to block"
              autoCapitalize="none"
              autoCorrect={false}
              baseStyle={styles.blocksInput}
              darkStyle={styles.blocksInputDark}
              returnKeyType="done"
              onSubmitEditing={() => void Promise.resolve(addBlockByUsername())}
            />
            <Pressable
              onPress={() => void Promise.resolve(addBlockByUsername())}
              style={({ pressed }) => [
                styles.blocksBtn,
                isDark ? styles.blocksBtnDark : null,
                pressed ? { opacity: 0.9 } : null,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Block user"
            >
              <Text style={[styles.blocksBtnText, isDark ? styles.blocksBtnTextDark : null]}>
                Block
              </Text>
            </Pressable>
          </View>

          {blockError ? (
            <Text style={[styles.errorText, isDark ? styles.errorTextDark : null]}>
              {blockError}
            </Text>
          ) : null}

          <ScrollView style={styles.blocksScroll}>
            {blocklistLoading ? (
              <View style={styles.chatsLoadingRow}>
                <Text
                  style={[
                    styles.modalHelperText,
                    isDark ? styles.modalHelperTextDark : null,
                    styles.chatsLoadingText,
                  ]}
                >
                  Loading
                </Text>
                <View style={styles.chatsLoadingDotsWrap}>
                  <AnimatedDots
                    color={isDark ? APP_COLORS.dark.text.primary : APP_COLORS.light.text.primary}
                    size={18}
                  />
                </View>
              </View>
            ) : blockedUsers.length ? (
              blockedUsers
                .slice()
                .sort((a, b) =>
                  String(a.blockedDisplayName || a.blockedUsernameLower || '').localeCompare(
                    String(b.blockedDisplayName || b.blockedUsernameLower || ''),
                  ),
                )
                .map((b) => (
                  <View
                    key={`blocked:${b.blockedSub}`}
                    style={[styles.blockRow, isDark ? styles.blockRowDark : null]}
                  >
                    <Text
                      style={[styles.blockRowName, isDark ? styles.blockRowNameDark : null]}
                      numberOfLines={1}
                    >
                      {b.blockedDisplayName || b.blockedUsernameLower || b.blockedSub}
                    </Text>
                    <Pressable
                      onPress={() =>
                        void Promise.resolve(
                          unblockUser(b.blockedSub, b.blockedDisplayName || b.blockedUsernameLower),
                        )
                      }
                      style={({ pressed }) => [
                        styles.blockActionBtn,
                        isDark ? styles.blockActionBtnDark : null,
                        pressed ? { opacity: 0.85 } : null,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel="Unblock user"
                    >
                      <Feather
                        name="user-check"
                        size={16}
                        color={
                          isDark ? APP_COLORS.dark.text.primary : APP_COLORS.light.text.primary
                        }
                      />
                    </Pressable>
                  </View>
                ))
            ) : (
              <Text style={[styles.modalHelperText, isDark ? styles.modalHelperTextDark : null]}>
                No blocked users
              </Text>
            )}
          </ScrollView>
          <View style={styles.modalButtons}>
            <Pressable
              style={[
                styles.modalButton,
                styles.modalButtonSmall,
                isDark ? styles.modalButtonDark : null,
              ]}
              onPress={() => setBlocklistOpen(false)}
            >
              <Text style={[styles.modalButtonText, isDark ? styles.modalButtonTextDark : null]}>
                Close
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </>
  );

  // iOS: Modal + UiPromptModal (unblock confirm) stacks native modals and can freeze / swallow updates.
  // Render as an in-tree overlay (MainAppContent places this last so z-order is above chat).
  if (Platform.OS === 'ios') {
    if (!blocklistOpen) return null;
    return (
      <View
        pointerEvents="box-none"
        style={[StyleSheet.absoluteFillObject, { zIndex: BLOCKLIST_IOS_OVERLAY_Z }]}
      >
        {sheet}
      </View>
    );
  }

  return (
    <Modal
      visible={blocklistOpen}
      transparent
      animationType="fade"
      onRequestClose={() => setBlocklistOpen(false)}
    >
      {sheet}
    </Modal>
  );
}
