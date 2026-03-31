import Feather from '@expo/vector-icons/Feather';
import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Animated, Easing, Platform, Pressable, Switch, View } from 'react-native';

import { APP_COLORS } from '../theme/colors';

/** Horizontal travel for custom toggle thumb (track inner width minus thumb). */
const WEB_TOGGLE_THUMB_TRAVEL_PX = 18;

export type ThemeToggleRowStyles = {
  themeToggle: StyleProp<ViewStyle>;
  themeToggleDark?: StyleProp<ViewStyle>;
  webToggleTrack: StyleProp<ViewStyle>;
  webToggleTrackOn?: StyleProp<ViewStyle>;
  webToggleThumb: StyleProp<ViewStyle>;
  webToggleThumbOn?: StyleProp<ViewStyle>;
};

function AnimatedCustomToggleThumb({
  isDark,
  styles,
}: {
  isDark: boolean;
  styles: ThemeToggleRowStyles;
}): React.JSX.Element {
  const slide = React.useRef(
    new Animated.Value(isDark ? WEB_TOGGLE_THUMB_TRAVEL_PX : 0),
  ).current;

  React.useEffect(() => {
    Animated.timing(slide, {
      toValue: isDark ? WEB_TOGGLE_THUMB_TRAVEL_PX : 0,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [isDark, slide]);

  return (
    <Animated.View
      style={[
        styles.webToggleThumb,
        isDark ? styles.webToggleThumbOn : null,
        { transform: [{ translateX: slide }] },
      ]}
    />
  );
}

export function ThemeToggleRow({
  isDark,
  onSetTheme,
  styles,
}: {
  isDark: boolean;
  onSetTheme: (theme: 'light' | 'dark') => void;
  styles: ThemeToggleRowStyles;
}): React.JSX.Element {
  return (
    <View style={[styles.themeToggle, isDark && styles.themeToggleDark]}>
      <Feather
        name={isDark ? 'moon' : 'sun'}
        size={16}
        color={isDark ? APP_COLORS.dark.text.primary : APP_COLORS.light.text.primary}
      />
      {/* Web + iOS: custom track + circle thumb. Native UISwitch thumb can look oversized on recent iOS. */}
      {Platform.OS === 'web' || Platform.OS === 'ios' ? (
        <Pressable
          onPress={() => onSetTheme(isDark ? 'light' : 'dark')}
          accessibilityRole="switch"
          accessibilityState={{ checked: isDark }}
          accessibilityLabel="Toggle theme"
          style={({ pressed }) => [
            styles.webToggleTrack,
            isDark ? styles.webToggleTrackOn : null,
            pressed ? { opacity: 0.9 } : null,
          ]}
        >
          <AnimatedCustomToggleThumb isDark={isDark} styles={styles} />
        </Pressable>
      ) : (
        <Switch
          value={isDark}
          onValueChange={(v) => onSetTheme(v ? 'dark' : 'light')}
          trackColor={{
            false: APP_COLORS.light.border.default,
            true: APP_COLORS.light.border.default,
          }}
          thumbColor={isDark ? APP_COLORS.dark.border.subtle : APP_COLORS.light.bg.app}
        />
      )}
    </View>
  );
}
