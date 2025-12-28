import React from 'react';
import { Animated, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';

export type HeaderMenuItem = {
  key: string;
  label: string;
  onPress?: () => void;
  right?: React.ReactNode;
  disabled?: boolean;
  // Render as a non-pressable row (useful for embedded controls like Switch).
  staticRow?: boolean;
};

export function HeaderMenuModal({
  open,
  onClose,
  title,
  items,
  isDark = false,
  cardWidth = 220,
  headerRight,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  items: HeaderMenuItem[];
  isDark?: boolean;
  cardWidth?: number;
  headerRight?: React.ReactNode;
}): React.JSX.Element {
  const anim = React.useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = React.useState<boolean>(open);

  React.useEffect(() => {
    if (open) {
      setMounted(true);
      Animated.timing(anim, {
        toValue: 1,
        duration: 160,
        useNativeDriver: true,
      }).start();
      return;
    }

    if (!mounted) return;
    Animated.timing(anim, {
      toValue: 0,
      duration: 160,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [open, anim, mounted]);

  const opacity = anim;
  // Slide in from the right (no diagonal motion).
  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] });

  // Match ChatScreen/GuestGlobalScreen surface colors.
  const cardBg = isDark ? '#0b0b0f' : '#f2f2f7';
  const border = isDark ? '#2a2a33' : '#e3e3e3';
  const divider = isDark ? '#2a2a33' : '#e9e9ee';
  const text = isDark ? '#fff' : '#111';
  const pressedBg = isDark ? '#1c1c22' : '#e9e9ee';

  // Match the app's "tool button" look (Summarize / AI Helper).
  const btnBg = isDark ? '#2a2a33' : '#fff';
  const btnBorder = isDark ? '#2a2a33' : '#ddd';
  const btnBorderWidth = isDark ? 0 : StyleSheet.hairlineWidth;

  return (
    <Modal visible={mounted} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.overlay, { paddingTop: insets.top + 10, paddingRight: 10 }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View
          style={[
            styles.card,
            {
              opacity,
              transform: [{ translateX }],
              backgroundColor: cardBg,
              borderColor: border,
              width: cardWidth,
            },
          ]}
        >
          <View style={styles.topRightCloseRow}>
            {headerRight ? <View style={styles.headerRightSlot}>{headerRight}</View> : null}
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [
                styles.closeIconBtn,
                {
                  backgroundColor: btnBg,
                  borderColor: btnBorder,
                  borderWidth: btnBorderWidth,
                },
                pressed ? { opacity: 0.88 } : null,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Close menu"
            >
              <Feather name="menu" size={18} color={text} />
            </Pressable>
          </View>
          {title ? <Text style={[styles.title, { color: text, borderBottomColor: divider }]}>{title}</Text> : null}
          <View style={styles.list}>
            {items.map((it) => (
              it.staticRow ? (
                // Static rows are used for embedded controls (like the theme toggle).
                // Keep them visually “in” the menu, but don’t wrap them in a button border.
                <View key={it.key} style={styles.row}>
                  {it.label ? (
                    <Text style={[styles.rowText, { color: text }]} numberOfLines={1} ellipsizeMode="tail">
                      {it.label}
                    </Text>
                  ) : null}
                  {it.right ? <View style={styles.rowRight}>{it.right}</View> : null}
                </View>
              ) : (
                <Pressable
                  key={it.key}
                  onPress={() => {
                    if (it.disabled) return;
                    it.onPress?.();
                  }}
                  style={({ pressed }) => [
                    styles.row,
                    styles.rowBtn,
                    { backgroundColor: btnBg, borderColor: btnBorder, borderWidth: btnBorderWidth },
                    !it.right ? styles.rowCenter : null,
                    it.disabled ? styles.rowDisabled : null,
                    pressed && !it.disabled ? { backgroundColor: pressedBg } : null,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={it.label}
                >
                  <Text
                    style={[
                      styles.rowText,
                      { color: text },
                      !it.right ? styles.rowTextCenter : null,
                    ]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {it.label}
                  </Text>
                  {it.right ? <View style={styles.rowRight}>{it.right}</View> : null}
                </Pressable>
              )
            ))}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
  },
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  topRightCloseRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingTop: 8,
    paddingHorizontal: 8,
    gap: 8,
  },
  headerRightSlot: { flexDirection: 'row', alignItems: 'center' },
  closeIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontWeight: '900',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  list: {
    padding: 8,
    gap: 6,
  },
  row: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowCenter: { justifyContent: 'center' },
  rowBtn: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowDisabled: { opacity: 0.5 },
  rowText: { fontWeight: '800' },
  rowTextCenter: { textAlign: 'center' },
  rowRight: { marginLeft: 12, flexShrink: 0 },
});


