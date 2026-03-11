import Feather from '@expo/vector-icons/Feather';
import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Platform, Pressable, Switch, View } from 'react-native';

import { APP_COLORS } from '../theme/colors';

export type ThemeToggleRowStyles = {
  themeToggle: StyleProp<ViewStyle>;
  themeToggleDark?: StyleProp<ViewStyle>;
  webToggleTrack: StyleProp<ViewStyle>;
  webToggleTrackOn?: StyleProp<ViewStyle>;
  webToggleThumb: StyleProp<ViewStyle>;
  webToggleThumbOn?: StyleProp<ViewStyle>;
};

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
    <View
      style={[
        styles.themeToggle,
        isDark && styles.themeToggleDark,
        // iOS: native Switch is larger; use tighter padding so row fits and left padding can show.
        Platform.OS === 'ios' && { paddingHorizontal: 6, marginLeft: 8 },
      ]}
    >
      <Feather
        name={isDark ? 'moon' : 'sun'}
        size={16}
        color={isDark ? APP_COLORS.dark.text.primary : APP_COLORS.light.text.primary}
      />
      {Platform.OS === 'web' ? (
        <Pressable
          onPress={() => onSetTheme(isDark ? 'light' : 'dark')}
          accessibilityRole="button"
          accessibilityLabel="Toggle theme"
          style={({ pressed }) => [
            styles.webToggleTrack,
            isDark ? styles.webToggleTrackOn : null,
            pressed ? { opacity: 0.9 } : null,
          ]}
        >
          <View style={[styles.webToggleThumb, isDark ? styles.webToggleThumbOn : null]} />
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
