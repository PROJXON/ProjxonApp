import React from 'react';
import {
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { APP_COLORS, PALETTE, withAlpha } from '../theme/colors';
import { AppBrandIcon } from './AppBrandIcon';

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
  anchor,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  items: HeaderMenuItem[];
  isDark?: boolean;
  cardWidth?: number;
  headerRight?: React.ReactNode;
  anchor?: { x: number; y: number; width: number; height: number } | null;
}): React.JSX.Element {
  const anim = React.useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [mounted, setMounted] = React.useState<boolean>(open);

  React.useEffect(() => {
    if (open) {
      setMounted(true);
      Animated.timing(anim, {
        toValue: 1,
        duration: 160,
        useNativeDriver: Platform.OS !== 'web',
      }).start();
      return;
    }

    if (!mounted) return;
    Animated.timing(anim, {
      toValue: 0,
      duration: 160,
      useNativeDriver: Platform.OS !== 'web',
    }).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [open, anim, mounted]);

  const opacity = anim;
  // Slide down from above (no diagonal motion).
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] });

  // Match ChatScreen/GuestGlobalScreen surface colors.
  const cardBg = isDark ? APP_COLORS.dark.bg.app : APP_COLORS.light.bg.app;
  const border = isDark ? APP_COLORS.dark.border.subtle : APP_COLORS.light.border.subtle;
  const divider = isDark ? APP_COLORS.dark.border.subtle : PALETTE.mist;
  const text = isDark ? APP_COLORS.dark.text.primary : APP_COLORS.light.text.primary;
  const pressedBg = isDark ? APP_COLORS.dark.bg.header : PALETTE.mist;

  // Match the app's "tool button" look (Summarize / AI Helper).
  const btnBg = isDark ? APP_COLORS.dark.border.subtle : APP_COLORS.light.bg.surface2;
  const btnBorder = isDark ? APP_COLORS.dark.border.subtle : APP_COLORS.light.border.subtle;
  const btnBorderWidth = isDark ? 0 : StyleSheet.hairlineWidth;

  const hasAnchor = !!anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y);
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  // For wide/web, we want the menu to feel like it "belongs" to the hamburger, but not sit
  // far below it. Position it *on top of* the hamburger area (slightly above), and clamp to
  // a small safe-area gap from the top.
  const ANCHOR_OVERLAP_PX = 2;
  // Guard against weird edge cases (e.g. anchor near/under the status bar).
  const anchorTopMin = Math.max(2, insets.top + 2);
  const anchorTop = hasAnchor
    ? Math.max(anchorTopMin, Math.round(anchor!.y - ANCHOR_OVERLAP_PX))
    : insets.top + 10;
  const cardLeft = hasAnchor
    ? clamp(anchor!.x + anchor!.width - cardWidth, 10, Math.max(10, windowWidth - cardWidth - 10))
    : 0;
  const maxCardH = Math.max(160, Math.floor(windowHeight - anchorTop - 12));

  const cardContent = (
    <>
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
          <AppBrandIcon
            isDark={isDark}
            fit="contain"
            slotWidth={32}
            slotHeight={32}
            accessible={false}
          />
        </Pressable>
      </View>
      {title ? (
        <Text style={[styles.title, { color: text, borderBottomColor: divider }]}>{title}</Text>
      ) : null}
      <ScrollView style={styles.listScroll} contentContainerStyle={styles.list} bounces={false}>
        {items.map((it) =>
          it.staticRow ? (
            <View key={it.key} style={styles.row}>
              {it.label ? (
                <Text
                  style={[styles.rowText, { color: text }]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
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
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
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
                style={[styles.rowText, { color: text }, !it.right ? styles.rowTextCenter : null]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {it.label}
              </Text>
              {it.right ? <View style={styles.rowRight}>{it.right}</View> : null}
            </Pressable>
          ),
        )}
      </ScrollView>
    </>
  );

  const cardStyle = [
    styles.card,
    {
      backgroundColor: cardBg,
      borderColor: border,
      width: cardWidth,
      ...(hasAnchor
        ? {
            position: 'absolute' as const,
            top: anchorTop,
            left: cardLeft,
            maxHeight: maxCardH,
          }
        : null),
    },
  ];

  // On iOS, render the menu as a View overlay so closing it doesn't leave a Modal in the tree.
  // The next screen (Chats, About, etc.) can then use a Modal and present immediately.
  // Use explicit window dimensions and top:0, left:0 so the overlay matches Modal positioning.
  if (Platform.OS === 'ios') {
    if (!open) return <></>;
    return (
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            zIndex: 10000,
            width: windowWidth,
            height: windowHeight,
            top: 0,
            left: 0,
          },
        ]}
      >
        <View
          style={[
            styles.overlay,
            hasAnchor ? styles.overlayAnchored : null,
            hasAnchor
              ? null
              : {
                  // Use minimal top so panel aligns with header; avoid double safe-area.
                  paddingTop: 8,
                  paddingRight: 10,
                },
          ]}
        >
          <View style={[cardStyle, { zIndex: 1 }]}>{cardContent}</View>
          <Pressable style={[StyleSheet.absoluteFill, { zIndex: 0 }]} onPress={onClose} />
        </View>
      </View>
    );
  }

  return (
    <Modal visible={mounted} transparent animationType="fade" onRequestClose={onClose}>
      <View
        style={[
          styles.overlay,
          hasAnchor ? styles.overlayAnchored : null,
          hasAnchor ? null : { paddingTop: insets.top + 10, paddingRight: 10 },
        ]}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View
          style={[
            styles.card,
            {
              opacity,
              transform: [{ translateY }],
              backgroundColor: cardBg,
              borderColor: border,
              width: cardWidth,
              ...(hasAnchor
                ? {
                    position: 'absolute' as const,
                    top: anchorTop,
                    left: cardLeft,
                    maxHeight: maxCardH,
                  }
                : null),
            },
          ]}
        >
          {cardContent}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: withAlpha(PALETTE.black, 0.25),
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
  },
  overlayAnchored: {
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
  },
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    ...(Platform.OS === 'web'
      ? { boxShadow: `0px 8px 16px ${withAlpha(PALETTE.black, 0.18)}` }
      : {
          shadowColor: PALETTE.black,
          shadowOpacity: 0.18,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 8 },
        }),
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
    width: 44,
    height: 44,
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
  listScroll: {
    // Limit scrolling region when we have a maxHeight on the card.
    flexGrow: 0,
  },
  list: {
    padding: 8,
    gap: 10,
  },
  row: {
    paddingHorizontal: 12,
    paddingVertical: 13,
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
