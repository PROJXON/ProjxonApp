import { icons } from '@aws-amplify/ui-react-native/dist/assets';
import React from 'react';
import type { TextInput } from 'react-native';
import { Image, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import type { AppStyles } from '../../../../App.styles';
import { AppTextInput } from '../../../components/AppTextInput';
import {
  calcCenteredModalBottomPadding,
  useKeyboardOverlap,
} from '../../../hooks/useKeyboardOverlap';
import { APP_COLORS, PALETTE } from '../../../theme/colors';

type PassphrasePromptMode = 'setup' | 'restore' | 'change' | 'reset';

export function MainAppPassphrasePromptModal({
  styles,
  isDark,
  visible,
  label,
  mode,

  passphraseVisible,
  setPassphraseVisible,
  passphraseInput,
  setPassphraseInput,
  passphraseConfirmInput,
  setPassphraseConfirmInput,
  passphraseError,
  setPassphraseError,

  processing,
  onSubmit,
  onCancel,

  skipRecoveryConfirmVisible,
  onConfirmSkipRecovery,
  onDismissSkipRecovery,
}: {
  styles: AppStyles;
  isDark: boolean;
  visible: boolean;
  label: string;
  mode: PassphrasePromptMode | null | undefined;

  passphraseVisible: boolean;
  setPassphraseVisible: React.Dispatch<React.SetStateAction<boolean>>;
  passphraseInput: string;
  setPassphraseInput: (v: string) => void;
  passphraseConfirmInput: string;
  setPassphraseConfirmInput: (v: string) => void;
  passphraseError: string | null;
  setPassphraseError: (v: string | null) => void;

  processing: boolean;
  onSubmit: () => void;
  onCancel: () => void | Promise<void>;

  skipRecoveryConfirmVisible: boolean;
  onConfirmSkipRecovery: () => void;
  onDismissSkipRecovery: () => void;
}): React.JSX.Element {
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
  const requiresConfirm = mode === 'setup' || mode === 'change' || mode === 'reset';
  const submitDisabled =
    processing || !passphraseInput.trim() || (requiresConfirm && !passphraseConfirmInput.trim());

  const confirmRef = React.useRef<TextInput | null>(null);
  const handlePassphraseSubmit = React.useCallback(() => {
    if (processing) return;
    if (requiresConfirm) {
      confirmRef.current?.focus?.();
      return;
    }
    if (!passphraseInput.trim()) return;
    onSubmit();
  }, [onSubmit, passphraseInput, processing, requiresConfirm]);

  const handleConfirmSubmit = React.useCallback(() => {
    if (submitDisabled) return;
    onSubmit();
  }, [onSubmit, submitDisabled]);

  const helperText =
    mode === 'setup'
      ? 'Make sure you remember your passphrase for future device recovery - we do not store it.'
      : mode === 'change'
        ? 'Choose a new passphrase you’ll remember - we do not store it'
        : mode === 'reset'
          ? 'Set a new recovery passphrase for your account - we do not store it'
          : null;

  const busyLabel =
    mode === 'restore'
      ? 'Decrypting'
      : mode === 'change'
        ? 'Updating'
        : mode === 'reset'
          ? 'Resetting'
          : 'Encrypting';

  const content = (
    <View
      style={[
        styles.modalContent,
        isDark ? styles.modalContentDark : null,
        Platform.OS === 'ios' && skipRecoveryConfirmVisible
          ? {
              borderWidth: 0,
              overflow: 'hidden',
            }
          : null,
      ]}
    >
      <Text style={[styles.modalTitle, isDark ? styles.modalTitleDark : null]}>{label}</Text>
      {helperText ? (
        <Text style={[styles.modalHelperText, isDark ? styles.modalHelperTextDark : null]}>
          {helperText}
        </Text>
      ) : null}

      <Text style={[styles.passphraseLabel, isDark ? styles.passphraseLabelDark : null]}>
        Enter Passphrase
      </Text>
      <View style={styles.passphraseFieldWrapper}>
        <AppTextInput
          isDark={isDark}
          style={[
            styles.modalInput,
            styles.passphraseInput,
            { width: '100%' },
            isDark ? styles.modalInputDark : styles.modalInputLight,
            processing ? styles.modalInputDisabled : null,
            isDark && processing ? styles.modalInputDisabledDark : null,
          ]}
          secureTextEntry={!passphraseVisible}
          value={passphraseInput}
          onChangeText={(t) => {
            setPassphraseInput(t);
            if (passphraseError) setPassphraseError(null);
          }}
          placeholder="Enter Passphrase"
          autoFocus
          editable={!processing}
          returnKeyType={requiresConfirm ? 'next' : 'done'}
          blurOnSubmit={!requiresConfirm}
          onSubmitEditing={handlePassphraseSubmit}
        />
        <Pressable
          style={[styles.passphraseEyeBtn, processing && { opacity: 0.5 }]}
          onPress={() => setPassphraseVisible((v) => !v)}
          disabled={processing}
          accessibilityRole="button"
          accessibilityLabel={passphraseVisible ? 'Hide passphrase' : 'Show passphrase'}
        >
          <Image
            source={passphraseVisible ? icons.visibilityOn : icons.visibilityOff}
            tintColor={isDark ? PALETTE.slate400 : PALETTE.slate450}
            style={{
              width: 18,
              height: 18,
            }}
          />
        </Pressable>
      </View>

      {requiresConfirm ? (
        <>
          <Text style={[styles.passphraseLabel, isDark ? styles.passphraseLabelDark : null]}>
            Confirm Passphrase
          </Text>
          <View style={styles.passphraseFieldWrapper}>
            <AppTextInput
              isDark={isDark}
              ref={(r) => {
                confirmRef.current = r;
              }}
              style={[
                styles.modalInput,
                styles.passphraseInput,
                { width: '100%' },
                isDark ? styles.modalInputDark : styles.modalInputLight,
                processing ? styles.modalInputDisabled : null,
                isDark && processing ? styles.modalInputDisabledDark : null,
              ]}
              secureTextEntry={!passphraseVisible}
              value={passphraseConfirmInput}
              onChangeText={(t) => {
                setPassphraseConfirmInput(t);
                if (passphraseError) setPassphraseError(null);
              }}
              placeholder="Confirm Passphrase"
              editable={!processing}
              returnKeyType="done"
              onSubmitEditing={handleConfirmSubmit}
            />
            <Pressable
              style={[styles.passphraseEyeBtn, processing && { opacity: 0.5 }]}
              onPress={() => setPassphraseVisible((v) => !v)}
              disabled={processing}
              accessibilityRole="button"
              accessibilityLabel={passphraseVisible ? 'Hide passphrase' : 'Show passphrase'}
            >
              <Image
                source={passphraseVisible ? icons.visibilityOn : icons.visibilityOff}
                tintColor={isDark ? PALETTE.slate400 : PALETTE.slate450}
                style={{
                  width: 18,
                  height: 18,
                }}
              />
            </Pressable>
          </View>
        </>
      ) : null}

      {passphraseError ? (
        <Text style={[styles.passphraseErrorText, isDark ? styles.passphraseErrorTextDark : null]}>
          {passphraseError}
        </Text>
      ) : null}

      <View style={styles.modalButtons}>
        <Pressable
          style={[
            styles.modalButton,
            styles.modalButtonCta,
            isDark ? styles.modalButtonCtaDark : null,
            submitDisabled && { opacity: 0.45 },
          ]}
          onPress={onSubmit}
          disabled={submitDisabled || skipRecoveryConfirmVisible}
        >
          {processing ? (
            <Text style={[styles.modalButtonText, styles.modalButtonCtaText, { textAlign: 'center' }]}>
              {busyLabel}
            </Text>
          ) : (
            <Text style={[styles.modalButtonText, styles.modalButtonCtaText]}>Submit</Text>
          )}
        </Pressable>

        <Pressable
          style={[
            styles.modalButton,
            isDark ? styles.modalButtonDark : null,
            processing && { opacity: 0.45 },
          ]}
          onPress={() => void Promise.resolve(onCancel())}
          disabled={processing || skipRecoveryConfirmVisible}
        >
          <Text style={[styles.modalButtonText, isDark ? styles.modalButtonTextDark : null]}>
            Cancel
          </Text>
        </Pressable>
      </View>

      {Platform.OS === 'ios' && skipRecoveryConfirmVisible && mode === 'setup' ? (
        <View
          style={[
            StyleSheet.absoluteFillObject,
            {
              borderRadius: 12,
              overflow: 'hidden',
              backgroundColor: 'rgba(0,0,0,0.45)',
              justifyContent: 'center',
              alignItems: 'center',
              zIndex: 999,
              padding: 12,
            },
          ]}
        >
          <View
            style={{
              width: '100%',
              maxWidth: 360,
              borderRadius: 14,
              padding: 16,
              backgroundColor: isDark ? APP_COLORS.dark.bg.surface : APP_COLORS.light.bg.app,
            }}
          >
            <Text style={[styles.modalTitle, isDark ? styles.modalTitleDark : null]}>
              Skip Recovery Setup?
            </Text>
            <Text style={[styles.modalHelperText, isDark ? styles.modalHelperTextDark : null]}>
              {
                "If you don't set a recovery passphrase, you won't be able to restore older encrypted messages if you switch devices.\n\nWe do NOT store your passphrase, so make sure you remember it."
              }
            </Text>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: 14,
                gap: 8,
                width: '100%',
              }}
            >
              <Pressable
                style={[
                  styles.modalButton,
                  styles.modalButtonSmall,
                  styles.modalButtonCta,
                  isDark ? styles.modalButtonCtaDark : null,
                ]}
                onPress={onConfirmSkipRecovery}
                accessibilityRole="button"
                accessibilityLabel="Skip for now"
              >
                <Text style={[styles.modalButtonText, styles.modalButtonCtaText]}>
                  Skip for now
                </Text>
              </Pressable>
              <Pressable
                style={[
                  styles.modalButton,
                  styles.modalButtonSmall,
                  isDark ? styles.modalButtonDark : null,
                ]}
                onPress={onDismissSkipRecovery}
                accessibilityRole="button"
                accessibilityLabel="Go back"
              >
                <Text style={[styles.modalButtonText, isDark ? styles.modalButtonTextDark : null]}>
                  Go back
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View
        style={[
          styles.modalOverlay,
          Platform.OS !== 'web' && bottomPad > 0 ? { paddingBottom: bottomPad } : null,
        ]}
      >
        {Platform.OS === 'web' ? (
          // Web: keep password inputs inside a <form> to satisfy browser heuristics.
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit();
            }}
            // Center the modal content within the overlay.
            style={{ width: '100%', display: 'flex', justifyContent: 'center' }}
          >
            {content}
          </form>
        ) : (
          <View
            style={[
              // Provide an explicit width context for percentage-based sheet sizing.
              // Without this, the sheet can "shrink-wrap" on native and inputs appear sized-to-content.
              { width: '100%', alignItems: 'center' },
              // Constrain height on Android when keyboard is open.
              kb.keyboardVisible
                ? { maxHeight: kb.availableHeightAboveKeyboard, minHeight: 0 }
                : null,
            ]}
            onLayout={(e) => {
              const h = e?.nativeEvent?.layout?.height;
              if (typeof h === 'number' && Number.isFinite(h) && h > 0) setSheetHeight(h);
            }}
          >
            {content}
          </View>
        )}
      </View>
    </Modal>
  );
}
