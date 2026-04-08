import * as React from 'react';
import { Alert, Platform } from 'react-native';

type PassphrasePromptMode = 'setup' | 'restore' | 'change' | 'reset';

type PromptConfirmOptions = { confirmText?: string; cancelText?: string; destructive?: boolean };
type PromptConfirm = (
  title: string,
  message: string,
  opts?: PromptConfirmOptions,
) => Promise<boolean>;

type Choice3Result = 'primary' | 'secondary' | 'tertiary';
// `useUiPrompt().choice3` is typed with multiple call signatures; accept a flexible shape
// and invoke it with the object-based API we use throughout the app.
type PromptChoice3 = (...args: unknown[]) => Promise<unknown>;

type PassphrasePromptState = {
  mode: PassphrasePromptMode;
  resolve: (value: string) => void;
  reject: (reason?: unknown) => void;
} | null;

export function usePassphrasePrompt({
  uiPromptOpen,
  promptConfirm,
  promptChoice3,
}: {
  uiPromptOpen: boolean;
  promptConfirm: PromptConfirm;
  promptChoice3: PromptChoice3;
}): {
  promptPassphrase: (mode: PassphrasePromptMode) => Promise<string>;
  closePrompt: () => void;
  processing: boolean;
  setProcessing: React.Dispatch<React.SetStateAction<boolean>>;
  modalProps: {
    visible: boolean;
    label: string;
    mode: PassphrasePromptMode | null;
    passphraseVisible: boolean;
    setPassphraseVisible: React.Dispatch<React.SetStateAction<boolean>>;
    passphraseInput: string;
    setPassphraseInput: React.Dispatch<React.SetStateAction<string>>;
    passphraseConfirmInput: string;
    setPassphraseConfirmInput: React.Dispatch<React.SetStateAction<string>>;
    passphraseError: string | null;
    setPassphraseError: React.Dispatch<React.SetStateAction<string | null>>;
    processing: boolean;
    onSubmit: () => void;
    onCancel: () => void;
    /** iOS: skip confirmation uses a View overlay instead of `promptConfirm` (nested native Modal freeze). */
    skipRecoveryConfirmVisible: boolean;
    onConfirmSkipRecovery: () => void;
    onDismissSkipRecovery: () => void;
  };
} {
  const [passphrasePrompt, setPassphrasePrompt] = React.useState<PassphrasePromptState>(null);
  const [passphraseInput, setPassphraseInput] = React.useState('');
  const [passphraseConfirmInput, setPassphraseConfirmInput] = React.useState('');
  const [passphraseVisible, setPassphraseVisible] = React.useState(false);
  const [passphraseError, setPassphraseError] = React.useState<string | null>(null);
  const [processing, setProcessing] = React.useState(false);
  const [skipRecoveryConfirmVisible, setSkipRecoveryConfirmVisible] = React.useState(false);
  const activePromptRef = React.useRef<PassphrasePromptState | null>(null);
  React.useEffect(() => {
    activePromptRef.current = passphrasePrompt;
  }, [passphrasePrompt]);

  const closePrompt = React.useCallback(() => {
    setSkipRecoveryConfirmVisible(false);
    setPassphrasePrompt(null);
    setPassphraseInput('');
    setPassphraseConfirmInput('');
    setPassphraseVisible(false);
    setPassphraseError(null);
    setProcessing(false);
  }, []);

  const onConfirmSkipRecovery = React.useCallback(() => {
    setSkipRecoveryConfirmVisible(false);
    const p = activePromptRef.current;
    if (p) p.reject(new Error('Prompt cancelled'));
    closePrompt();
  }, [closePrompt]);

  const onDismissSkipRecovery = React.useCallback(() => {
    setSkipRecoveryConfirmVisible(false);
  }, []);

  const promptPassphrase = React.useCallback((mode: PassphrasePromptMode): Promise<string> => {
    return new Promise<string>((resolve, reject) => {
      setPassphraseInput('');
      setPassphraseConfirmInput('');
      setPassphraseVisible(false);
      setPassphraseError(null);
      setPassphrasePrompt({ mode, resolve, reject });
    });
  }, []);

  const handlePromptSubmit = React.useCallback(() => {
    if (!passphrasePrompt || processing) return;
    const needsConfirm =
      passphrasePrompt.mode === 'setup' ||
      passphrasePrompt.mode === 'change' ||
      passphrasePrompt.mode === 'reset';
    if (needsConfirm) {
      if (passphraseInput.trim() !== passphraseConfirmInput.trim()) {
        setPassphraseError('Passphrases do not match');
        return;
      }
    }
    setProcessing(true);
    // Defer resolving to the next tick so React Native has a chance to render
    // the "processing" state before CPU-heavy crypto work begins.
    setTimeout(() => passphrasePrompt.resolve(passphraseInput), 0);
  }, [passphraseConfirmInput, passphraseInput, passphrasePrompt, processing]);

  const handlePromptCancel = React.useCallback(() => {
    void (async () => {
      if (!passphrasePrompt) return;
      const isSetup = passphrasePrompt.mode === 'setup';
      const isRestore = passphrasePrompt.mode === 'restore';
      if (isRestore) {
        if (Platform.OS === 'ios') {
          Alert.alert('Forgot your recovery passphrase?', '', [
            {
              text: 'Try Again',
              onPress: () => {
                setPassphraseInput('');
                setPassphraseConfirmInput('');
                setPassphraseError(null);
              },
            },
            {
              text: 'Try Later',
              onPress: () => {
                closePrompt();
                passphrasePrompt.reject(new Error('Prompt cancelled'));
              },
            },
            {
              text: 'Reset recovery',
              style: 'destructive',
              onPress: () => {
                closePrompt();
                passphrasePrompt.reject(new Error('Recovery reset requested'));
              },
            },
          ]);
          return;
        }
        // Restore flow: allow reset, try again immediately, or try again later.
        const choice = (await promptChoice3({
          title: 'Forgot your recovery passphrase?',
          message:
            'If you reset recovery, you’ll create a new keypair and recovery passphrase on this device.\n\nOld encrypted direct messages will become unrecoverable.\n\nIf you might remember it later, you can try again later and you’ll be prompted again the next time you sign in.',
          primaryText: 'Try Again',
          secondaryText: 'Try Later',
          tertiaryText: 'Reset recovery',
          tertiaryVariant: 'danger',
        })) as Choice3Result;
        if (choice === 'primary') {
          // Keep the prompt open; just clear input so they can re-enter immediately.
          setPassphraseInput('');
          setPassphraseConfirmInput('');
          setPassphraseError(null);
          return;
        }
        closePrompt();
        passphrasePrompt.reject(
          new Error(choice === 'tertiary' ? 'Recovery reset requested' : 'Prompt cancelled'),
        );
        return;
      }

      if (!isSetup) {
        // Change/reset flow: cancelling should just close (no "skip setup" warning).
        closePrompt();
        passphrasePrompt.reject(new Error('Prompt cancelled'));
        return;
      }

      // Setup flow: user is choosing to skip creating a recovery passphrase.
      // iOS: avoid stacking UiPromptModal on top of this screen’s native Modal (freezes / unresponsive UI).
      if (Platform.OS === 'ios') {
        setSkipRecoveryConfirmVisible(true);
        return;
      }
      const ok = await promptConfirm(
        'Skip Recovery Setup?',
        "If you don't set a recovery passphrase, you won't be able to restore older encrypted messages if you switch devices.\n\nWe do NOT store your passphrase, so make sure you remember it.",
        { confirmText: 'Skip for now', cancelText: 'Go back', destructive: true },
      );
      if (!ok) return;
      closePrompt();
      passphrasePrompt.reject(new Error('Prompt cancelled'));
    })();
  }, [closePrompt, passphrasePrompt, promptChoice3, promptConfirm]);

  const promptVisible = !!passphrasePrompt && !uiPromptOpen;
  const promptLabel =
    passphrasePrompt?.mode === 'restore'
      ? 'Enter Your Recovery Passphrase'
      : passphrasePrompt?.mode === 'change'
        ? 'Change Your Recovery Passphrase'
        : passphrasePrompt?.mode === 'reset'
          ? 'Set a New Recovery Passphrase'
          : 'Create a Recovery Passphrase';

  return {
    promptPassphrase,
    closePrompt,
    processing,
    setProcessing,
    modalProps: {
      visible: promptVisible,
      label: promptLabel,
      mode: passphrasePrompt?.mode ?? null,
      passphraseVisible,
      setPassphraseVisible,
      passphraseInput,
      setPassphraseInput,
      passphraseConfirmInput,
      setPassphraseConfirmInput,
      passphraseError,
      setPassphraseError,
      processing,
      onSubmit: handlePromptSubmit,
      onCancel: handlePromptCancel,
      skipRecoveryConfirmVisible,
      onConfirmSkipRecovery,
      onDismissSkipRecovery,
    },
  };
}
