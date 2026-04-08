import * as React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TERMS_OF_USE_URL } from '../../config/legalUrls';
import type { SemanticAppColors } from '../../theme/colors';

type Props = {
  colors: SemanticAppColors;
  onAccept: () => void | Promise<void>;
};

export function IosCommunityTermsFirstRun({ colors, onAccept }: Props): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const text = colors.text.primary;
  const muted = colors.text.muted;
  const border = colors.border.subtle;
  const accent = colors.brand.primary;

  const openTerms = React.useCallback(() => {
    void Linking.openURL(TERMS_OF_USE_URL).catch(() => {});
  }, []);

  return (
    <View
      style={[styles.root, { backgroundColor: colors.bg.app, paddingBottom: insets.bottom + 16 }]}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: Math.max(insets.top, 20) + 8, paddingHorizontal: 20 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.title, { color: text }]}>Before you continue</Text>
        <Text style={[styles.body, { color: muted }]}>
          OrkaChat includes messages and media from other people. By continuing, you agree to our
          Terms of Use and community rules.
        </Text>
        <Text style={[styles.body, { color: muted, marginTop: 12 }]}>
          There is <Text style={{ fontWeight: '600', color: text }}>no tolerance</Text> for
          objectionable content or abusive behavior. You can report content and block users from the
          app. We review reports and take action, including removing content and restricting
          accounts when appropriate.
        </Text>
        <Pressable
          onPress={openTerms}
          style={({ pressed }) => [pressed && styles.pressed]}
          accessibilityRole="link"
          accessibilityLabel="Open full Terms of Use in browser"
        >
          <Text style={[styles.link, { color: accent }]}>Read full Terms of Use</Text>
        </Pressable>
      </ScrollView>
      <View style={[styles.footer, { borderTopColor: border, paddingHorizontal: 20 }]}>
        <Pressable
          onPress={() => void onAccept()}
          style={({ pressed }) => [
            styles.primaryBtn,
            { backgroundColor: accent, opacity: pressed ? 0.88 : 1 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Agree and continue"
        >
          <Text style={styles.primaryBtnText}>I agree</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 12,
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
  },
  link: {
    fontSize: 16,
    marginTop: 20,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  pressed: {
    opacity: 0.85,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 16,
    backgroundColor: 'transparent',
  },
  primaryBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
});
