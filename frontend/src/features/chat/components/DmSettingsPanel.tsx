import React from 'react';
import { Animated, Easing, Platform, Pressable, Switch, Text, View } from 'react-native';

import type { ChatScreenStyles } from '../../../screens/ChatScreen.styles';
import { APP_COLORS } from '../../../theme/colors';

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
  const slide = React.useRef(new Animated.Value(value ? 10 : 0)).current;

  React.useEffect(() => {
    Animated.timing(slide, {
      toValue: value ? 10 : 0,
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
  isDark: boolean;
  styles: ChatScreenStyles;
  compact: boolean;

  isDm: boolean;
  isGroup: boolean;

  myPrivateKeyReady: boolean;

  autoDecrypt: boolean;
  onToggleAutoDecrypt: (v: boolean) => void;

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
};

export function DmSettingsPanel({
  isDark,
  styles,
  compact,
  isDm,
  isGroup,
  myPrivateKeyReady,
  autoDecrypt,
  onToggleAutoDecrypt,
  ttlLabel,
  onOpenTtlPicker,
  sendReadReceipts,
  onToggleReadReceipts,
  groupMembersCountLabel,
  groupActionBusy,
  groupMeIsAdmin,
  onOpenGroupMembers,
  onOpenGroupName,
  onLeaveGroup,
}: Props) {
  return (
    <>
      {isDm ? (
        compact ? (
          <View
            style={[
              styles.dmSettingsRow,
              { flexDirection: 'column', alignItems: 'stretch', gap: 6 },
            ]}
          >
            <View
              style={{
                width: '100%',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'flex-start',
                columnGap: 14,
              }}
            >
              <View style={[styles.dmSettingGroup, { minWidth: 0 }]}>
                <Text
                  style={[
                    styles.decryptLabel,
                    isDark ? styles.decryptLabelDark : null,
                    styles.dmSettingLabel,
                    styles.dmSettingLabelCompact,
                  ]}
                  numberOfLines={1}
                >
                  Auto‑Decrypt
                </Text>
                <MiniToggle
                  value={autoDecrypt}
                  onValueChange={onToggleAutoDecrypt}
                  disabled={!myPrivateKeyReady}
                  isDark={isDark}
                  styles={styles}
                />
              </View>
              <View style={[styles.dmSettingGroup, { minWidth: 0, marginLeft: 'auto' }]}>
                <Text
                  style={[
                    styles.decryptLabel,
                    isDark ? styles.decryptLabelDark : null,
                    styles.dmSettingLabel,
                    styles.dmSettingLabelCompact,
                  ]}
                  numberOfLines={1}
                >
                  Self‑Destruct
                </Text>
                <Pressable
                  style={[
                    styles.ttlChip,
                    isDark ? styles.ttlChipDark : null,
                    styles.ttlChipCompact,
                  ]}
                  onPress={onOpenTtlPicker}
                >
                  <Text
                    style={[
                      styles.ttlChipText,
                      isDark ? styles.ttlChipTextDark : null,
                      String(ttlLabel).trim().toLowerCase() === 'off'
                        ? styles.ttlChipTextOff
                        : null,
                    ]}
                  >
                    {ttlLabel}
                  </Text>
                </Pressable>
              </View>
            </View>
            <View
              style={{
                width: '100%',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'flex-end',
              }}
            >
              <View style={[styles.dmSettingGroup, { minWidth: 0 }]}>
                <Text
                  style={[
                    styles.decryptLabel,
                    isDark ? styles.decryptLabelDark : null,
                    styles.dmSettingLabel,
                    styles.dmSettingLabelCompact,
                  ]}
                  numberOfLines={1}
                >
                  Read Receipts
                </Text>
                <MiniToggle
                  value={sendReadReceipts}
                  isDark={isDark}
                  styles={styles}
                  onValueChange={onToggleReadReceipts}
                />
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.dmSettingsRow}>
            <View style={styles.dmSettingSlotLeft}>
              <View style={styles.dmSettingGroup}>
                <Text
                  style={[
                    styles.decryptLabel,
                    isDark ? styles.decryptLabelDark : null,
                    styles.dmSettingLabel,
                  ]}
                  numberOfLines={1}
                >
                  Auto‑Decrypt
                </Text>
                {Platform.OS === 'web' || Platform.OS === 'ios' ? (
                  <MiniToggle
                    value={autoDecrypt}
                    onValueChange={onToggleAutoDecrypt}
                    disabled={!myPrivateKeyReady}
                    isDark={isDark}
                    styles={styles}
                  />
                ) : (
                  <Switch
                    value={autoDecrypt}
                    onValueChange={onToggleAutoDecrypt}
                    disabled={!myPrivateKeyReady}
                    trackColor={{
                      false: APP_COLORS.light.border.default,
                      true: APP_COLORS.light.border.default,
                    }}
                    thumbColor={isDark ? APP_COLORS.dark.border.subtle : APP_COLORS.light.bg.app}
                    ios_backgroundColor={APP_COLORS.light.border.default}
                  />
                )}
              </View>
            </View>

            <View style={styles.dmSettingSlotCenter}>
              <View style={styles.dmSettingGroup}>
                <Text
                  style={[
                    styles.decryptLabel,
                    isDark ? styles.decryptLabelDark : null,
                    styles.dmSettingLabel,
                  ]}
                  numberOfLines={1}
                >
                  Self‑Destruct
                </Text>
                <Pressable
                  style={[styles.ttlChip, isDark ? styles.ttlChipDark : null]}
                  onPress={onOpenTtlPicker}
                >
                  <Text
                    style={[
                      styles.ttlChipText,
                      isDark ? styles.ttlChipTextDark : null,
                      String(ttlLabel).trim().toLowerCase() === 'off'
                        ? styles.ttlChipTextOff
                        : null,
                    ]}
                  >
                    {ttlLabel}
                  </Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.dmSettingSlotRight}>
              <View style={styles.dmSettingGroup}>
                <Text
                  style={[
                    styles.decryptLabel,
                    isDark ? styles.decryptLabelDark : null,
                    styles.dmSettingLabel,
                  ]}
                  numberOfLines={1}
                >
                  Read Receipts
                </Text>
                {Platform.OS === 'web' || Platform.OS === 'ios' ? (
                  <MiniToggle
                    value={sendReadReceipts}
                    isDark={isDark}
                    styles={styles}
                    onValueChange={onToggleReadReceipts}
                  />
                ) : (
                  <Switch
                    value={sendReadReceipts}
                    onValueChange={onToggleReadReceipts}
                    trackColor={{
                      false: APP_COLORS.light.border.default,
                      true: APP_COLORS.light.border.default,
                    }}
                    thumbColor={isDark ? APP_COLORS.dark.border.subtle : APP_COLORS.light.bg.app}
                    ios_backgroundColor={APP_COLORS.light.border.default}
                  />
                )}
              </View>
            </View>
          </View>
        )
      ) : null}

      {isGroup ? (
        <View
          style={[
            styles.dmSettingsRow,
            styles.groupSettingsRow,
            // In compact mode, don't "three-column center" Auto‑Decrypt; align settings naturally
            // so we don't leave a big empty gap when the Members label is hidden.
            compact ? { justifyContent: 'flex-start' } : null,
          ]}
        >
          <View style={[styles.dmSettingSlotLeft, compact ? { flex: 0 } : null]}>
            <View style={styles.dmSettingGroup}>
              {!compact ? (
                <Text
                  style={[
                    styles.decryptLabel,
                    isDark ? styles.decryptLabelDark : null,
                    styles.dmSettingLabel,
                    compact ? styles.dmSettingLabelCompact : null,
                  ]}
                  numberOfLines={1}
                >
                  Members
                </Text>
              ) : null}
              <Pressable
                style={[
                  styles.toolBtn,
                  isDark ? styles.toolBtnDark : null,
                  groupActionBusy ? { opacity: 0.6 } : null,
                  // When the "Members" label is hidden (compact screens), shrink the chip slightly
                  // instead of introducing extra vertical spacing above this row.
                  compact ? { paddingVertical: 4 } : null,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Members"
                disabled={groupActionBusy}
                onPress={onOpenGroupMembers}
              >
                <Text style={[styles.toolBtnText, isDark ? styles.toolBtnTextDark : null]}>
                  {groupMembersCountLabel}
                </Text>
              </Pressable>
            </View>
          </View>

          <View
            style={[
              styles.dmSettingSlotCenter,
              // In compact mode, let Auto‑Decrypt sit more centered between
              // the Members count (left) and Name/Leave (right).
              compact ? { flex: 1, alignItems: 'center', paddingHorizontal: 8 } : null,
            ]}
          >
            <View style={styles.dmSettingGroup}>
              <Text
                style={[
                  styles.decryptLabel,
                  isDark ? styles.decryptLabelDark : null,
                  styles.dmSettingLabel,
                  compact ? styles.dmSettingLabelCompact : null,
                ]}
                numberOfLines={1}
              >
                Auto‑Decrypt
              </Text>
              {compact ? (
                <MiniToggle
                  value={autoDecrypt}
                  onValueChange={onToggleAutoDecrypt}
                  disabled={!myPrivateKeyReady}
                  isDark={isDark}
                  styles={styles}
                />
              ) : Platform.OS === 'web' ? (
                <MiniToggle
                  value={autoDecrypt}
                  onValueChange={onToggleAutoDecrypt}
                  disabled={!myPrivateKeyReady}
                  isDark={isDark}
                  styles={styles}
                />
              ) : (
                <Switch
                  value={autoDecrypt}
                  onValueChange={onToggleAutoDecrypt}
                  disabled={!myPrivateKeyReady}
                  trackColor={{
                    false: APP_COLORS.light.border.default,
                    true: APP_COLORS.light.border.default,
                  }}
                  thumbColor={isDark ? APP_COLORS.dark.border.subtle : APP_COLORS.light.bg.app}
                  ios_backgroundColor={APP_COLORS.light.border.default}
                />
              )}
            </View>
          </View>

          <View
            style={[styles.dmSettingSlotRight, compact ? { flex: 0, marginLeft: 'auto' } : null]}
          >
            <View style={[styles.dmSettingGroup, { justifyContent: 'flex-end', gap: 10 }]}>
              {groupMeIsAdmin ? (
                <Pressable
                  style={[
                    styles.toolBtn,
                    isDark ? styles.toolBtnDark : null,
                    groupActionBusy ? { opacity: 0.6 } : null,
                  ]}
                  disabled={groupActionBusy}
                  onPress={onOpenGroupName}
                >
                  <Text style={[styles.toolBtnText, isDark ? styles.toolBtnTextDark : null]}>
                    Name
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                style={[
                  styles.toolBtn,
                  isDark ? styles.toolBtnDark : null,
                  groupActionBusy ? { opacity: 0.6 } : null,
                ]}
                disabled={groupActionBusy}
                onPress={onLeaveGroup}
              >
                <Text style={[styles.toolBtnText, isDark ? styles.toolBtnTextDark : null]}>
                  Leave
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
    </>
  );
}
