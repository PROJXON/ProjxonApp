import React from 'react';
import type { TextInput } from 'react-native';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppTextInput } from '../../../components/AppTextInput';
import { ChannelMembersSectionList } from '../../../components/ChannelMembersSectionList';
import type { ChatScreenStyles } from '../../../screens/ChatScreen.styles';
import { APP_COLORS } from '../../../theme/colors';
import type { MemberRow } from '../../../types/members';

type Props = {
  visible: boolean;
  isDark: boolean;
  styles: ChatScreenStyles;
  canAddMembers: boolean;
  addMembersDraft: string;
  onChangeAddMembersDraft: (t: string) => void;
  onAddMembers: () => void | Promise<void>;
  addMembersInputRef: React.MutableRefObject<TextInput | null>;
  members: MemberRow[];
  mySub: string;
  meIsAdmin: boolean;
  actionBusy: boolean;
  kickCooldownUntilBySub: Record<string, number>;
  avatarUrlByPath: Record<string, string>;
  onBan: (args: { memberSub: string; label: string }) => void | Promise<void>;
  onUnban: (memberSub: string) => void;
  onKick: (memberSub: string) => void;
  onToggleAdmin: (args: { memberSub: string; isAdmin: boolean }) => void;
  onClose: () => void;
};

export function ChannelMembersModal({
  visible,
  isDark,
  styles,
  canAddMembers,
  addMembersDraft,
  onChangeAddMembersDraft,
  onAddMembers,
  addMembersInputRef,
  members,
  mySub,
  meIsAdmin,
  actionBusy,
  kickCooldownUntilBySub,
  avatarUrlByPath,
  onBan,
  onUnban,
  onKick,
  onToggleAdmin,
  onClose,
}: Props) {
  if (Platform.OS === 'ios') {
    if (!visible) return <></>;
    return (
      <View style={[StyleSheet.absoluteFillObject, { zIndex: 10000 }]}>
        <View style={styles.modalOverlay}>
          <View style={[styles.summaryModal, isDark ? styles.summaryModalDark : null]}>
            <Text style={[styles.summaryTitle, isDark ? styles.summaryTitleDark : null]}>
              Members
            </Text>
            {meIsAdmin && canAddMembers ? (
              <View style={{ marginTop: 10 }}>
                <AppTextInput
                  isDark={isDark}
                  ref={(r) => {
                    addMembersInputRef.current = r;
                  }}
                  value={addMembersDraft}
                  onChangeText={onChangeAddMembersDraft}
                  onSubmitEditing={() => {
                    if (actionBusy) return;
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
                      actionBusy ? { opacity: 0.6 } : null,
                    ]}
                    disabled={actionBusy}
                    onPress={() => void Promise.resolve(onAddMembers())}
                  >
                    <Text style={[styles.toolBtnText, isDark ? styles.toolBtnTextDark : null]}>
                      Add
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
            <ScrollView style={{ maxHeight: 520, alignSelf: 'stretch' }}>
              <ChannelMembersSectionList
                members={members}
                mySub={mySub}
                isDark={isDark}
                styles={styles}
                meIsAdmin={meIsAdmin}
                actionBusy={actionBusy}
                kickCooldownUntilBySub={kickCooldownUntilBySub}
                avatarUrlByPath={avatarUrlByPath}
                onBan={onBan}
                onUnban={onUnban}
                onKick={onKick}
                onToggleAdmin={onToggleAdmin}
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
      </View>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.summaryModal, isDark ? styles.summaryModalDark : null]}>
          <Text style={[styles.summaryTitle, isDark ? styles.summaryTitleDark : null]}>
            Members
          </Text>
          {meIsAdmin && canAddMembers ? (
            <View style={{ marginTop: 10 }}>
              <AppTextInput
                isDark={isDark}
                ref={(r) => {
                  addMembersInputRef.current = r;
                }}
                value={addMembersDraft}
                onChangeText={onChangeAddMembersDraft}
                onSubmitEditing={() => {
                  if (actionBusy) return;
                  void Promise.resolve(onAddMembers());
                }}
                placeholder="Add usernames (comma/space separated)"
                // Use explicit style (modal on Android can be finicky).
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
                    actionBusy ? { opacity: 0.6 } : null,
                  ]}
                  disabled={actionBusy}
                  onPress={() => void Promise.resolve(onAddMembers())}
                >
                  <Text style={[styles.toolBtnText, isDark ? styles.toolBtnTextDark : null]}>
                    Add
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}
          <ScrollView style={{ maxHeight: 520, alignSelf: 'stretch' }}>
            <ChannelMembersSectionList
              members={members}
              mySub={mySub}
              isDark={isDark}
              styles={styles}
              meIsAdmin={meIsAdmin}
              actionBusy={actionBusy}
              kickCooldownUntilBySub={kickCooldownUntilBySub}
              avatarUrlByPath={avatarUrlByPath}
              onBan={onBan}
              onUnban={onUnban}
              onKick={onKick}
              onToggleAdmin={onToggleAdmin}
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
