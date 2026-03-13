import React from 'react';
import type { TextInput } from 'react-native';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppTextInput } from '../../../components/AppTextInput';
import { GroupMembersSectionList } from '../../../components/GroupMembersSectionList';
import {
  calcCenteredModalBottomPadding,
  useKeyboardOverlap,
} from '../../../hooks/useKeyboardOverlap';
import type { ChatScreenStyles } from '../../../screens/ChatScreen.styles';
import { APP_COLORS } from '../../../theme/colors';
import type { MemberRow } from '../../../types/members';

type Props = {
  visible: boolean;
  isDark: boolean;
  styles: ChatScreenStyles;
  busy: boolean;

  meIsAdmin: boolean;
  addMembersDraft: string;
  onChangeAddMembersDraft: (t: string) => void;
  onAddMembers: () => void | Promise<void>;
  addMembersInputRef: React.MutableRefObject<TextInput | null>;

  members: MemberRow[];
  mySub: string;
  kickCooldownUntilBySub: Record<string, number>;
  avatarUrlByPath: Record<string, string>;

  onKick: (memberSub: string) => void;
  onUnban: (memberSub: string) => void;
  onToggleAdmin: (args: { memberSub: string; isAdmin: boolean }) => void;
  onBan: (args: { memberSub: string; label: string }) => void | Promise<void>;

  onClose: () => void;
};

export function GroupMembersModal({
  visible,
  isDark,
  styles,
  busy,
  meIsAdmin,
  addMembersDraft,
  onChangeAddMembersDraft,
  onAddMembers,
  addMembersInputRef,
  members,
  mySub,
  kickCooldownUntilBySub,
  avatarUrlByPath,
  onKick,
  onUnban,
  onToggleAdmin,
  onBan,
  onClose,
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

  if (Platform.OS === 'ios') {
    if (!visible) return <></>;
    return (
      <View style={[StyleSheet.absoluteFillObject, { zIndex: 10000 }]}>
        <View style={[styles.modalOverlay, bottomPad > 0 ? { paddingBottom: bottomPad } : null]}>
          <View
            style={[
              styles.summaryModal,
              isDark ? styles.summaryModalDark : null,
              kb.keyboardVisible
                ? { maxHeight: kb.availableHeightAboveKeyboard, minHeight: 0 }
                : null,
            ]}
            onLayout={(e) => {
              const h = e?.nativeEvent?.layout?.height;
              if (typeof h === 'number' && Number.isFinite(h) && h > 0) setSheetHeight(h);
            }}
          >
            {/* existing content below remains unchanged */}
            <Text style={[styles.summaryTitle, isDark ? styles.summaryTitleDark : null]}>
              Members
            </Text>

            {meIsAdmin ? (
              <View style={{ marginTop: 10 }}>
                <AppTextInput
                  isDark={isDark}
                  ref={(r) => {
                    addMembersInputRef.current = r;
                  }}
                  value={addMembersDraft}
                  onChangeText={onChangeAddMembersDraft}
                  onSubmitEditing={() => {
                    if (busy) return;
                    void Promise.resolve(onAddMembers());
                  }}
                  placeholder="Add usernames (comma/space separated)"
                  style={{
                    width: '100%',
                    height: 48,
                    paddingHorizontal: 12,
                    borderWidth: 1,
                    borderRadius: 10,
                    backgroundColor: isDark
                      ? APP_COLORS.dark.bg.header
                      : APP_COLORS.light.bg.surface2,
                    borderColor: isDark
                      ? APP_COLORS.dark.border.default
                      : APP_COLORS.light.border.subtle,
                    color: isDark ? APP_COLORS.dark.text.primary : APP_COLORS.light.text.primary,
                    fontSize: 16,
                  }}
                  editable
                  returnKeyType="done"
                />
                <View style={[styles.summaryButtons, { justifyContent: 'flex-end' }]}>
                  <Pressable
                    style={[
                      styles.toolBtn,
                      isDark ? styles.toolBtnDark : null,
                      busy ? { opacity: 0.6 } : null,
                    ]}
                    disabled={busy}
                    onPress={() => void Promise.resolve(onAddMembers())}
                  >
                    <Text style={[styles.toolBtnText, isDark ? styles.toolBtnTextDark : null]}>
                      Add
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            <ScrollView
              style={{ marginTop: 0, maxHeight: 360 }}
              contentContainerStyle={{ paddingTop: 0 }}
              keyboardShouldPersistTaps="handled"
            >
              <GroupMembersSectionList
                members={members}
                mySub={mySub}
                isDark={!!isDark}
                styles={styles}
                meIsAdmin={!!meIsAdmin}
                groupActionBusy={!!busy}
                kickCooldownUntilBySub={kickCooldownUntilBySub}
                avatarUrlByPath={avatarUrlByPath}
                onKick={onKick}
                onUnban={onUnban}
                onToggleAdmin={onToggleAdmin}
                onBan={onBan}
              />
            </ScrollView>

            <View style={styles.summaryButtons}>
              <Pressable
                style={[styles.toolBtn, isDark ? styles.summaryModalDark : null]}
                onPress={onClose}
              >
                <Text style={[styles.toolBtnText, isDark ? styles.toolBtnTextDark : null]}>
                  Close
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View
        style={[
          styles.modalOverlay,
          Platform.OS !== 'web' && bottomPad > 0 ? { paddingBottom: bottomPad } : null,
        ]}
      >
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
          <Text style={[styles.summaryTitle, isDark ? styles.summaryTitleDark : null]}>
            Members
          </Text>

          {meIsAdmin ? (
            <View style={{ marginTop: 10 }}>
              <AppTextInput
                isDark={isDark}
                ref={(r) => {
                  addMembersInputRef.current = r;
                }}
                value={addMembersDraft}
                onChangeText={onChangeAddMembersDraft}
                onSubmitEditing={() => {
                  if (busy) return;
                  void Promise.resolve(onAddMembers());
                }}
                placeholder="Add usernames (comma/space separated)"
                // Use a fully explicit style here (avoid theme/style collisions in Android modals).
                style={{
                  width: '100%',
                  height: 48,
                  paddingHorizontal: 12,
                  borderWidth: 1,
                  borderRadius: 10,
                  // Off-color (so it stands out from the modal background).
                  backgroundColor: isDark
                    ? APP_COLORS.dark.bg.header
                    : APP_COLORS.light.bg.surface2,
                  borderColor: isDark
                    ? APP_COLORS.dark.border.default
                    : APP_COLORS.light.border.subtle,
                  color: isDark ? APP_COLORS.dark.text.primary : APP_COLORS.light.text.primary,
                  fontSize: 16,
                }}
                // Keep focusable even while requests are running; only the Add button is disabled.
                editable
                returnKeyType="done"
              />
              <View style={[styles.summaryButtons, { justifyContent: 'flex-end' }]}>
                <Pressable
                  style={[
                    styles.toolBtn,
                    isDark ? styles.toolBtnDark : null,
                    busy ? { opacity: 0.6 } : null,
                  ]}
                  disabled={busy}
                  onPress={() => void Promise.resolve(onAddMembers())}
                >
                  <Text style={[styles.toolBtnText, isDark ? styles.toolBtnTextDark : null]}>
                    Add
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          <ScrollView
            style={{ marginTop: 0, maxHeight: 360 }}
            contentContainerStyle={{ paddingTop: 0 }}
            keyboardShouldPersistTaps="handled"
          >
            <GroupMembersSectionList
              members={members}
              mySub={mySub}
              isDark={!!isDark}
              styles={styles}
              meIsAdmin={!!meIsAdmin}
              groupActionBusy={!!busy}
              kickCooldownUntilBySub={kickCooldownUntilBySub}
              avatarUrlByPath={avatarUrlByPath}
              onKick={onKick}
              onUnban={onUnban}
              onToggleAdmin={onToggleAdmin}
              onBan={onBan}
            />
          </ScrollView>

          <View style={styles.summaryButtons}>
            <Pressable
              style={[styles.toolBtn, isDark ? styles.toolBtnDark : null]}
              onPress={onClose}
            >
              <Text style={[styles.toolBtnText, isDark ? styles.toolBtnTextDark : null]}>
                Close
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
