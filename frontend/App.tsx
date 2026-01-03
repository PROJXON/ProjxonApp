import React, { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  TextInput,
  Image,
  Pressable,
  Modal,
  Switch,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import ChatScreen from './src/screens/ChatScreen';
import GuestGlobalScreen from './src/screens/GuestGlobalScreen';
import { AnimatedDots } from './src/components/AnimatedDots';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ScreenOrientation from 'expo-screen-orientation';

import { Amplify } from "aws-amplify";
import {
  Authenticator,
  ThemeProvider,
  useAuthenticator,
} from "@aws-amplify/ui-react-native";
// IMPORTANT: use the React-Native entrypoint (`src/*`) so these primitives share the same ThemeContext
// as our `ThemeProvider` and Authenticator defaults. Importing from `dist/*` creates a separate context,
// causing mismatched colors/borders (especially in dark mode).
import { icons } from '@aws-amplify/ui-react-native/src/assets';
import { Button as AmplifyButton, IconButton, PhoneNumberField, TextField } from '@aws-amplify/ui-react-native/src/primitives';
import { authenticatorTextUtil, getErrors } from '@aws-amplify/ui';
import {
  DefaultContent,
  FederatedProviderButtons,
} from '@aws-amplify/ui-react-native/src/Authenticator/common';
import { deleteUser, fetchUserAttributes } from 'aws-amplify/auth';
import { fetchAuthSession } from '@aws-amplify/auth';
import { getUrl, uploadData } from 'aws-amplify/storage';
import { API_URL, CDN_URL } from './src/config/env';
import {
  registerForDmPushNotifications,
  setForegroundNotificationPolicy,
  unregisterDmPushNotifications,
} from './utils/pushNotifications';
import { HeaderMenuModal } from './src/components/HeaderMenuModal';
import { AVATAR_DEFAULT_COLORS, AvatarBubble, pickDefaultAvatarColor } from './src/components/AvatarBubble';
import Feather from '@expo/vector-icons/Feather';
import {
  applyTitleOverridesToConversations,
  applyTitleOverridesToUnreadMap,
  setTitleOverride,
} from './src/utils/conversationTitles';

import {
  generateKeypair,
  storeKeyPair,
  loadKeyPair,
  decryptPrivateKey,
  derivePublicKey,
  BackupBlob,
  encryptPrivateKey,
} from './utils/crypto';

import 'react-native-get-random-values'
import 'react-native-url-polyfill/auto'

// Keep the native splash visible until we explicitly hide it (prevents a brief
// "white screen + spinner" flash while JS bootstraps and we check auth session).
SplashScreen.preventAutoHideAsync().catch(() => {
  // ignore (can throw if called multiple times in dev)
});

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const outputs = require('./amplify_outputs.json');
  Amplify.configure(outputs);
} catch {
  // amplify_outputs.json not present yet; run `npx ampx sandbox` to generate it.
}

const toCdnUrl = (path: string): string => {
  const base = (CDN_URL || '').trim();
  const p = String(path || '').replace(/^\/+/, '');
  if (!base || !p) return '';
  try {
    const b = base.endsWith('/') ? base : `${base}/`;
    return new URL(p, b).toString();
  } catch {
    return '';
  }
};

const MainAppContent = ({ onSignedOut }: { onSignedOut?: () => void }) => {
  const { user } = useAuthenticator();
  const { signOut } = useAuthenticator();
  const [displayName, setDisplayName] = useState<string>('anon');
  const [myUserSub, setMyUserSub] = React.useState<string | null>(null);
  // Bump this whenever we change/recover/reset keys so ChatScreen reloads them from storage.
  const [keyEpoch, setKeyEpoch] = React.useState<number>(0);
  const [avatarOpen, setAvatarOpen] = React.useState<boolean>(false);
  const [avatarSaving, setAvatarSaving] = React.useState<boolean>(false);
  const avatarSavingRef = React.useRef<boolean>(false);
  const [avatarError, setAvatarError] = React.useState<string | null>(null);
  type AvatarState = {
    bgColor?: string;
    textColor?: string;
    imagePath?: string;
    imageUri?: string; // cached preview URL (not persisted)
  };
  // Persisted avatar state (what we actually saved / loaded).
  const [myAvatar, setMyAvatar] = React.useState<AvatarState>(() => ({ textColor: '#fff' }));
  // Draft avatar state for the Avatar modal. Changes here should only commit on "Save".
  const [avatarDraft, setAvatarDraft] = React.useState<AvatarState>(() => ({ textColor: '#fff' }));
  const [avatarDraftImageUri, setAvatarDraftImageUri] = React.useState<string | null>(null);
  const [avatarDraftRemoveImage, setAvatarDraftRemoveImage] = React.useState<boolean>(false);

  type ChatBackgroundState =
    | { mode: 'default' }
    | { mode: 'color'; color: string }
    | { mode: 'image'; uri: string; blur?: number; opacity?: number };
  const [chatBackground, setChatBackground] = React.useState<ChatBackgroundState>({ mode: 'default' });
  const [backgroundOpen, setBackgroundOpen] = React.useState<boolean>(false);
  const [backgroundSaving, setBackgroundSaving] = React.useState<boolean>(false);
  const backgroundSavingRef = React.useRef<boolean>(false);
  const [backgroundError, setBackgroundError] = React.useState<string | null>(null);
  const [backgroundDraft, setBackgroundDraft] = React.useState<ChatBackgroundState>({ mode: 'default' });
  const [backgroundDraftImageUri, setBackgroundDraftImageUri] = React.useState<string | null>(null);
  // Background "effects" are local draft controls for photo backgrounds.
  // Applied immediately to the preview; saved only on "Save".
  const [bgEffectBlur, setBgEffectBlur] = React.useState<number>(0);
  const [bgEffectOpacity, setBgEffectOpacity] = React.useState<number>(1);
  const [passphrasePrompt, setPassphrasePrompt] = useState<{
    mode: 'setup' | 'restore' | 'change' | 'reset';
    resolve: (value: string) => void;
    reject: (reason?: any) => void;
  } | null>(null);
  const [passphraseInput, setPassphraseInput] = useState('');
  const [passphraseConfirmInput, setPassphraseConfirmInput] = useState('');
  const [passphraseVisible, setPassphraseVisible] = useState(false);
  const [passphraseError, setPassphraseError] = useState<string | null>(null);
  const [hasRecoveryBlob, setHasRecoveryBlob] = useState(false);
  // hasRecoveryBlob defaults false; track whether we've actually checked the server this session.
  const [recoveryBlobKnown, setRecoveryBlobKnown] = useState(false);
  const [recoveryLocked, setRecoveryLocked] = React.useState<boolean>(false);
  const [processing, setProcessing] = useState(false);
  const [uiPrompt, setUiPrompt] = useState<
    | null
    | {
        kind: 'alert' | 'confirm';
        title: string;
        message: string;
        confirmText?: string;
        cancelText?: string;
        destructive?: boolean;
        resolve: (value: any) => void;
      }
    | {
        kind: 'choice3';
        title: string;
        message: string;
        primaryText: string;
        secondaryText: string;
        tertiaryText: string;
        primaryVariant?: 'default' | 'primary' | 'danger';
        secondaryVariant?: 'default' | 'primary' | 'danger';
        tertiaryVariant?: 'default' | 'primary' | 'danger';
        resolve: (value: 'primary' | 'secondary' | 'tertiary') => void;
      }
  >(null);

  // Initialize draft state when opening the Avatar modal.
  React.useEffect(() => {
    if (!avatarOpen) return;
    setAvatarDraft(myAvatar);
    setAvatarDraftImageUri(null);
    setAvatarDraftRemoveImage(false);
  }, [avatarOpen, myAvatar]);

  // Load global chat background (local-only).
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('ui:chatBackground');
        if (cancelled) return;
        if (!raw) return;
        const obj = JSON.parse(raw);
        if (obj && obj.mode === 'color' && typeof obj.color === 'string') {
          setChatBackground({ mode: 'color', color: obj.color });
        } else if (obj && obj.mode === 'image' && typeof obj.uri === 'string') {
          setChatBackground({
            mode: 'image',
            uri: obj.uri,
            blur: typeof obj.blur === 'number' ? Math.max(0, Math.min(10, Math.round(obj.blur))) : 0,
            opacity: typeof obj.opacity === 'number' ? obj.opacity : 1,
          });
        } else if (obj && obj.mode === 'default') {
          setChatBackground({ mode: 'default' });
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Initialize draft state when opening Background modal.
  React.useEffect(() => {
    if (!backgroundOpen) return;
    setBackgroundDraft(chatBackground);
    setBackgroundDraftImageUri(null);
    setBackgroundError(null);
    if (chatBackground?.mode === 'image') {
      const blur = typeof chatBackground.blur === 'number' ? chatBackground.blur : 0;
      const opacity = typeof chatBackground.opacity === 'number' ? chatBackground.opacity : 1;
      const clampedBlur = Math.max(0, Math.min(10, Math.round(blur)));
      const clampedOpacity = Math.max(0.2, Math.min(1, Math.round(opacity * 100) / 100));
      setBgEffectBlur(clampedBlur);
      setBgEffectOpacity(clampedOpacity);
    } else {
      setBgEffectBlur(0);
      setBgEffectOpacity(1);
    }
  }, [backgroundOpen, chatBackground]);

  const promptPassphrase = (mode: 'setup' | 'restore' | 'change' | 'reset'): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      setPassphraseInput('');
      setPassphraseConfirmInput('');
      setPassphraseVisible(false);
      setPassphraseError(null);
      setPassphrasePrompt({ mode, resolve, reject });
    });

  const promptAlert = (title: string, message: string): Promise<void> =>
    new Promise<void>((resolve) => {
      setUiPrompt({
        kind: 'alert',
        title,
        message,
        confirmText: 'OK',
        resolve,
      });
    });

  const promptConfirm = (
    title: string,
    message: string,
    opts?: { confirmText?: string; cancelText?: string; destructive?: boolean }
  ): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      setUiPrompt({
        kind: 'confirm',
        title,
        message,
        confirmText: opts?.confirmText ?? 'OK',
        cancelText: opts?.cancelText ?? 'Cancel',
        destructive: !!opts?.destructive,
        resolve,
      });
    });

  const promptChoice3 = (
    title: string,
    message: string,
    opts: {
      primaryText: string;
      secondaryText: string;
      tertiaryText: string;
      primaryVariant?: 'default' | 'primary' | 'danger';
      secondaryVariant?: 'default' | 'primary' | 'danger';
      tertiaryVariant?: 'default' | 'primary' | 'danger';
    }
  ): Promise<'primary' | 'secondary' | 'tertiary'> =>
    new Promise((resolve) => {
      setUiPrompt({
        kind: 'choice3',
        title,
        message,
        primaryText: opts.primaryText,
        secondaryText: opts.secondaryText,
        tertiaryText: opts.tertiaryText,
        primaryVariant: opts.primaryVariant,
        secondaryVariant: opts.secondaryVariant,
        tertiaryVariant: opts.tertiaryVariant,
        resolve,
      });
    });

  const closePrompt = () => {
    setPassphrasePrompt(null);
    setPassphraseInput('');
    setPassphraseConfirmInput('');
    setPassphraseVisible(false);
    setPassphraseError(null);
    setProcessing(false);
  };

  const deleteMyAccount = React.useCallback(async () => {
    if (!API_URL) {
      await promptAlert('Unavailable', 'Missing API_URL (backend not configured).');
      return;
    }

    const ok = await promptConfirm(
      'Delete account?',
      "This will permanently delete your Projxon account.\n\nWhat will be deleted:\n- Your profile (display name / avatar)\n- Your blocklist and chat index (best-effort)\n- Push notification tokens\n- Recovery backup (if set)\n\nWhat may remain:\n- Messages you already sent may still be visible to other users.\n- Cached media may take a short time to disappear.\n\nTimeline: typically immediate, but some cleanup may take a few minutes.\n\nContinue?",
      { confirmText: 'Delete', cancelText: 'Cancel', destructive: true }
    );
    if (!ok) return;

    // Best-effort: clear local push + crypto material for this user.
    try {
      await unregisterDmPushNotifications();
    } catch {
      // ignore
    }
    try {
      if (myUserSub) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const SecureStore = require('expo-secure-store') as typeof import('expo-secure-store');
        await SecureStore.deleteItemAsync(`crypto_keys_${myUserSub}`).catch(() => undefined);
      }
    } catch {
      // ignore
    }

    let idToken = '';
    try {
      const { tokens } = await fetchAuthSession();
      idToken = tokens?.idToken?.toString() || '';
    } catch {
      idToken = '';
    }

    if (!idToken) {
      await promptAlert('Not signed in', 'Missing auth token. Please sign in again and retry.');
      return;
    }

    // Step 1: delete app-side data while JWT is still valid.
    try {
      const res = await fetch(`${API_URL.replace(/\/$/, '')}/account/delete`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `Backend deletion failed (${res.status})`);
      }
    } catch (e: any) {
      await promptAlert('Delete failed', e?.message ?? 'Failed to delete account data.');
      return;
    }

    // Step 2: delete the Cognito user (removes the login itself).
    try {
      await deleteUser();
    } catch {
      // If this fails (expired token, etc.), fall back to signOut.
    }

    try {
      await signOut();
    } catch {
      // ignore
    } finally {
      onSignedOut?.();
    }

    await promptAlert('Account deleted', 'Your account deletion request completed.');
  }, [myUserSub, onSignedOut, promptAlert, promptConfirm, signOut]);

  const handlePromptSubmit = () => {
    if (!passphrasePrompt || processing) return;
    const needsConfirm =
      passphrasePrompt.mode === 'setup' || passphrasePrompt.mode === 'change' || passphrasePrompt.mode === 'reset';
    if (needsConfirm) {
      if (passphraseInput.trim() !== passphraseConfirmInput.trim()) {
        setPassphraseError('Passphrases do not match');
        return;
      }
    }
    console.log('passphrase entered', passphraseInput);
    setProcessing(true);
    // Defer resolving to the next tick so React Native has a chance to render
    // the "processing" state before CPU-heavy crypto work begins.
    setTimeout(() => passphrasePrompt.resolve(passphraseInput), 0);
  };

  const handlePromptCancel = async () => {
    if (!passphrasePrompt) return;
    const isSetup = passphrasePrompt.mode === 'setup';
    const isRestore = passphrasePrompt.mode === 'restore';
    if (isRestore) {
      // Restore flow: allow reset, try again immediately, or try again later.
      const choice = await promptChoice3(
        'Forgot your recovery passphrase?',
        "If you reset recovery, you’ll create a new keypair and recovery passphrase on this device.\n\nOld encrypted direct messages will become unrecoverable.\n\nIf you might remember it later, you can try again later and you’ll be prompted again the next time you sign in.",
        {
          primaryText: 'Try Again',
          secondaryText: 'Try Later',
          tertiaryText: 'Reset recovery',
          tertiaryVariant: 'danger',
        }
      );
      if (choice === 'primary') {
        // Keep the prompt open; just clear input so they can re-enter immediately.
        setPassphraseInput('');
        setPassphraseConfirmInput('');
        setPassphraseError(null);
        return;
      }
      closePrompt();
      passphrasePrompt.reject(new Error(choice === 'tertiary' ? 'Recovery reset requested' : 'Prompt cancelled'));
      return;
    }
    if (!isSetup) {
      // Change/reset flow: cancelling should just close (no "skip setup" warning).
      closePrompt();
      passphrasePrompt.reject(new Error('Prompt cancelled'));
      return;
    }

    // Setup flow: user is choosing to skip creating a recovery passphrase.
    const ok = await promptConfirm(
      'Skip Recovery Setup?',
      "If you don't set a recovery passphrase, you won't be able to restore older encrypted messages if you switch devices.\n\nWe do NOT store your passphrase, so make sure you remember it.",
      { confirmText: 'Skip for now', cancelText: 'Go back', destructive: true }
    );
    if (!ok) return;
    closePrompt();
    passphrasePrompt.reject(new Error('Prompt cancelled'));
  };

  const applyRecoveryBlobExists = (exists: boolean) => {
    setRecoveryBlobKnown(true);
    setHasRecoveryBlob(exists);
  };

  const uploadRecoveryBlob = async (
    token: string,
    privateKeyHex: string,
    passphrase: string
  ) => {
    const t0 = Date.now();
    console.log('encrypting backup...');
    const blob = await encryptPrivateKey(privateKeyHex, passphrase);
    console.log('backup encrypted in', Date.now() - t0, 'ms');
    console.log('sending recovery blob', blob);

    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const fetchPromise = fetch(`${API_URL.replace(/\/$/, '')}/users/recovery`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(blob),
        signal: controller.signal,
      });

      const timeoutPromise = new Promise<Response>((_, reject) => {
        timeoutId = setTimeout(() => {
          try {
            controller.abort();
          } catch {
            // ignore
          }
          reject(new Error('createRecovery timed out'));
        }, 20000);
      });

      const resp = await Promise.race([fetchPromise, timeoutPromise]);

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        console.warn('createRecovery non-2xx', resp.status, text);
        throw new Error(`createRecovery failed (${resp.status})`);
      }
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  };

  const checkRecoveryBlobExists = async (token: string): Promise<boolean | null> => {
    if (!API_URL) return null;
    const url = `${API_URL.replace(/\/$/, '')}/users/recovery`;
    try {
      // Prefer HEAD if supported (avoids downloading the blob). Some deployments don't support HEAD
      // and may return 404/405 even when the resource exists, so only treat HEAD "ok" as authoritative.
      const headResp = await fetch(url, { method: 'HEAD', headers: { Authorization: `Bearer ${token}` } });
      if (headResp.ok) return true;
      // fall through to GET for a definitive answer
    } catch {
      // ignore; fallback to GET below
    }
    try {
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (resp.ok) return true;
      if (resp.status === 404) {
        console.log('recovery blob exists check: 404');
        return false;
      }
      console.log('recovery blob exists check: unexpected status', resp.status);
      return null;
    } catch {
      console.log('recovery blob exists check: network error');
      return null;
    }
  };

  const getIdTokenWithRetry = async (opts?: { maxAttempts?: number; delayMs?: number }): Promise<string | null> => {
    const maxAttempts = Math.max(1, Math.floor(opts?.maxAttempts ?? 8));
    const delayMs = Math.max(0, Math.floor(opts?.delayMs ?? 200));
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const token = (await fetchAuthSession()).tokens?.idToken?.toString();
        if (token) return token;
      } catch {
        // ignore and retry
      }
      if (i < maxAttempts - 1 && delayMs > 0) {
        // Small backoff to allow Amplify to rehydrate the session after a Metro refresh.
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs * (i + 1)));
      }
    }
    return null;
  };

  const uploadPublicKey = async (token: string | undefined, publicKey: string) => {
    if (!token) {
      console.warn('uploadPublicKey: missing idToken');
      return;
    }
    const resp = await fetch(`${API_URL.replace(/\/$/, '')}/users/public-key`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ publicKey }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.warn('uploadPublicKey non-2xx', resp.status, text);
    }
  };

  React.useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        // Notification policy: avoid banners/sounds while foregrounded (chat UI handles it).
        await setForegroundNotificationPolicy();

        // reset per-user UI state on sign-in changes
        setHasRecoveryBlob(false);
        setRecoveryBlobKnown(false);
        setRecoveryLocked(false);
        setProcessing(false);

        const attrs = await fetchUserAttributes();
        const name =
          (attrs.preferred_username as string | undefined) ||
          (attrs.email as string | undefined) ||
          (user as any)?.username ||
          'anon';
        const userId = attrs.sub as string;
        if (mounted) setMyUserSub(userId);
        if (mounted) setDisplayName(name);

        let keyPair = await loadKeyPair(userId);
        // If a keypair exists locally, ensure it's internally consistent.
        // (We previously had cases where a stale Cognito public key was stored alongside a different private key.)
        if (keyPair) {
          const derivedPublicKey = derivePublicKey(keyPair.privateKey);
          if (derivedPublicKey !== keyPair.publicKey) {
            console.warn('Local keypair mismatch: fixing public key from private key');
            keyPair = { ...keyPair, publicKey: derivedPublicKey };
            await storeKeyPair(userId, keyPair);
            const token = (await fetchAuthSession()).tokens?.idToken?.toString();
            await uploadPublicKey(token, derivedPublicKey);
          }
        }

        // Even when we already have a local keypair, check if an account recovery backup exists
        // so the Recovery modal can show "Change passphrase" vs "Set up recovery" correctly.
        if (keyPair) {
          const token = await getIdTokenWithRetry({ maxAttempts: 10, delayMs: 200 });
          if (token) {
            const exists = await checkRecoveryBlobExists(token);
            if (exists !== null && mounted) applyRecoveryBlobExists(exists);
          }
        }

        // Fetch recovery blob only when we don't already have a local keypair.
        let recoveryBlobExists = false;
        let resetRecoveryRequested = false;
        if (!keyPair) {
          const token = (await fetchAuthSession()).tokens?.idToken?.toString();
          console.log('token', token);
          const recoveryResp = await fetch(`${API_URL.replace(/\/$/, '')}/users/recovery`, {
            headers: { Authorization: `Bearer ${token}` },
          });

          if (recoveryResp.ok) {
            recoveryBlobExists = true;
            setHasRecoveryBlob(true);
            setRecoveryBlobKnown(true);
            try {
              const blob: BackupBlob = await recoveryResp.json();
              let recovered = false;
              while (!recovered) {
                let passphrase: string;
                try {
                  passphrase = await promptPassphrase('restore');
                } catch (err) {
                  if (err instanceof Error && err.message === 'Prompt cancelled') {
                    closePrompt();
                    break;
                  }
                  if (err instanceof Error && err.message === 'Recovery reset requested') {
                    resetRecoveryRequested = true;
                    closePrompt();
                    break;
                  }
                  console.error('Recovery prompt error', err);
                  closePrompt();
                  break;
                }

                try {
                  const restoredPrivateKey = await decryptPrivateKey(blob, passphrase);
                  const derivedPublicKey = derivePublicKey(restoredPrivateKey);
                  keyPair = {
                    privateKey: restoredPrivateKey,
                    // IMPORTANT: always derive from the recovered private key to avoid
                    // mismatches with a stale Cognito public key.
                    publicKey: derivedPublicKey,
                  };
                  await storeKeyPair(userId, keyPair);
                  setKeyEpoch((v) => v + 1);
                  // Ensure Cognito has the matching public key so other devices encrypt to the right key.
                  await uploadPublicKey(token, derivedPublicKey);
                  recovered = true;
                  closePrompt();
                } catch (err) {
                  await promptAlert(
                    'Incorrect passphrase',
                    'You have entered an incorrect passphrase. Try again.'
                  );
                  console.warn('Recovery attempt failed', err);
                  closePrompt();
                  // continue prompting
                }
              }
            } catch (err) {
              console.error('Recovery failed to load blob', err);
              closePrompt();
            }
          } else {
            setHasRecoveryBlob(false);
            setRecoveryBlobKnown(true);
            closePrompt();
            if (recoveryResp.status !== 404) {
              console.warn('Unexpected response fetching recovery blob', recoveryResp.status);
            }
          }
        }

        // If a recovery blob exists but the user cancelled recovery, keep them "locked".
        // We should prompt again next login (and provide settings actions to retry/reset).
        if (!keyPair && recoveryBlobExists && !resetRecoveryRequested) {
          if (mounted) setRecoveryLocked(true);
          return;
        }

        // If no recovery blob exists OR user explicitly requested a reset, generate a new keypair.
        if (!keyPair) {
          const token = (await fetchAuthSession()).tokens?.idToken?.toString();
          try {
            if (resetRecoveryRequested) {
              // Reset flow is destructive; only proceed AFTER the user submits a new passphrase.
              const recoveryPassphrase = await promptPassphrase('reset');
              const newKeyPair = await generateKeypair();
              await storeKeyPair(userId, newKeyPair);
              setKeyEpoch((v) => v + 1);
              await uploadPublicKey(token, newKeyPair.publicKey);
              await uploadRecoveryBlob(token!, newKeyPair.privateKey, recoveryPassphrase);
              applyRecoveryBlobExists(true);
              if (mounted) setRecoveryLocked(false);
              return;
            }

            // First-time key setup (non-destructive): generate keys immediately so messaging works,
            // then optionally prompt to create a recovery backup.
            const newKeyPair = await generateKeypair();
            await storeKeyPair(userId, newKeyPair);
            setKeyEpoch((v) => v + 1);
            // Publish the public key immediately so other users/devices can encrypt to us,
            // even if the user cancels recovery setup.
            await uploadPublicKey(token, newKeyPair.publicKey);
            const recoveryPassphrase = await promptPassphrase('setup');
            await uploadRecoveryBlob(token!, newKeyPair.privateKey, recoveryPassphrase);
            applyRecoveryBlobExists(true);
          } catch (err) {
            if (resetRecoveryRequested) {
              // If they cancel the reset passphrase prompt, do NOT rotate keys. Keep locked.
              if (mounted) setRecoveryLocked(true);
              return;
            }
            console.warn('Recovery backup skipped:', err);
          } finally {
            // ensure the UI doesn't get stuck in "processing" for setup flow
            setProcessing(false);
            closePrompt();
          }
        }
      } catch {
        if (mounted) setDisplayName((user as any)?.username || 'anon');
      }
    })();

    return () => {
      mounted = false;
    };
  }, [user]);

  // Load avatar settings per signed-in user (AsyncStorage cache; best-effort server fetch for cross-device).
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!myUserSub) return;
      const key = `avatar:v1:${myUserSub}`;
      try {
        const raw = await AsyncStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (!cancelled && parsed && typeof parsed === 'object') {
            setMyAvatar((prev) => ({
              ...prev,
              bgColor: typeof parsed.bgColor === 'string' ? parsed.bgColor : prev.bgColor,
              textColor: typeof parsed.textColor === 'string' ? parsed.textColor : prev.textColor,
              imagePath: typeof parsed.imagePath === 'string' ? parsed.imagePath : prev.imagePath,
              imageUri: undefined,
            }));
          }
        }

        // Always do a best-effort server fetch too, even if we have cache, so changes
        // made on another device (or after a backend write) show up without reinstalling.
        if (!API_URL) return;
        const { tokens } = await fetchAuthSession();
        const idToken = tokens?.idToken?.toString();
        if (!idToken) return;
        const resp = await fetch(`${API_URL.replace(/\/$/, '')}/users?sub=${encodeURIComponent(myUserSub)}`, {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        if (!resp.ok) return;
        const u = await resp.json();
        if (!cancelled && u && typeof u === 'object') {
          const next = {
            bgColor: typeof u.avatarBgColor === 'string' ? u.avatarBgColor : undefined,
            textColor: typeof u.avatarTextColor === 'string' ? u.avatarTextColor : undefined,
            imagePath: typeof u.avatarImagePath === 'string' ? u.avatarImagePath : undefined,
          };
          setMyAvatar((prev) => ({
            ...prev,
            bgColor: typeof next.bgColor === 'string' ? next.bgColor : prev.bgColor,
            textColor: typeof next.textColor === 'string' ? next.textColor : prev.textColor,
            imagePath: typeof next.imagePath === 'string' ? next.imagePath : prev.imagePath,
            imageUri: undefined,
          }));
          // Keep the local cache in sync with what the server says.
          await AsyncStorage.setItem(key, JSON.stringify(next)).catch(() => {});
        }
      } catch (e) {
        console.log('avatar cache load failed', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [myUserSub]);

  // Resolve a preview URL for the current avatar image (if any).
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!myAvatar?.imagePath) return;
      if (myAvatar.imageUri) return;
      try {
        const s = toCdnUrl(myAvatar.imagePath);
        if (s && !cancelled) setMyAvatar((prev) => ({ ...prev, imageUri: s }));
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.log('avatar preview getUrl failed', myAvatar?.imagePath, e?.message || String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [myAvatar?.imagePath, myAvatar?.imageUri]);

  const saveAvatarToStorageAndServer = React.useCallback(
    async (next: { bgColor?: string; textColor?: string; imagePath?: string }) => {
      if (!myUserSub) return;
      const key = `avatar:v1:${myUserSub}`;
      await AsyncStorage.setItem(key, JSON.stringify(next));

      if (!API_URL) return;
      const { tokens } = await fetchAuthSession();
      const idToken = tokens?.idToken?.toString();
      if (!idToken) return;
      const resp = await fetch(`${API_URL.replace(/\/$/, '')}/users/profile`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        let msg = `Avatar save failed (${resp.status})`;
        try {
          const parsed = JSON.parse(text || '{}');
          if (parsed?.message) msg = String(parsed.message);
        } catch {
          if (text.trim()) msg = `${msg}: ${text.trim()}`;
        }
        throw new Error(msg);
      }
    },
    [myUserSub]
  );

  // Best-effort: register DM push token after login (Signal-like: sender name only, no message preview).
  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (!user) return;
        const res = await registerForDmPushNotifications();
        if (!mounted) return;
        if (!res.ok) {
          // Avoid spamming a modal; this should be transparent unless debugging.
          console.log('push registration skipped/failed:', res.reason || 'unknown');
        }
      } catch (err) {
        console.log('push registration error:', err);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [user]);

  const currentUsername =
    (displayName.length ? displayName : (
      (user as any)?.username as string | undefined || 'anon'
    ));

  const [conversationId, setConversationId] = useState<string>('global');
  const [peer, setPeer] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [peerInput, setPeerInput] = useState<string>('');
  const [searchError, setSearchError] = useState<string | null>(null);
  const [unreadDmMap, setUnreadDmMap] = useState<
    Record<string, { user: string; count: number; senderSub?: string }>
  >(
    () => ({})
  );
  // Local-only DM thread list (v1): used to power "Chats" inbox UI.
  // Backed by AsyncStorage so it survives restarts (per-device is OK for now).
  const [dmThreads, setDmThreads] = useState<Record<string, { peer: string; lastActivityAt: number }>>(() => ({}));
  const [serverConversations, setServerConversations] = React.useState<
    Array<{
      conversationId: string;
      peerDisplayName?: string;
      peerSub?: string;
      conversationKind?: 'dm' | 'group';
      memberStatus?: 'active' | 'left' | 'banned';
      lastMessageAt?: number;
    }>
  >([]);
  const [chatsLoading, setChatsLoading] = React.useState<boolean>(false);
  const [conversationsCacheAt, setConversationsCacheAt] = React.useState<number>(0);
  const isDmMode = conversationId !== 'global';
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const isDark = theme === 'dark';
  const [menuOpen, setMenuOpen] = React.useState<boolean>(false);
  const [chatsOpen, setChatsOpen] = React.useState<boolean>(false);
  const [blocklistOpen, setBlocklistOpen] = React.useState<boolean>(false);
  const [recoveryOpen, setRecoveryOpen] = React.useState<boolean>(false);
  const [blocklistLoading, setBlocklistLoading] = React.useState<boolean>(false);
  const [blockUsername, setBlockUsername] = React.useState<string>('');
  const [blockError, setBlockError] = React.useState<string | null>(null);
  const [blockedUsers, setBlockedUsers] = React.useState<
    Array<{ blockedSub: string; blockedDisplayName?: string; blockedUsernameLower?: string; blockedAt?: number }>
  >([]);
  const [blocklistCacheAt, setBlocklistCacheAt] = React.useState<number>(0);

  const blockedSubs = React.useMemo(() => blockedUsers.map((b) => b.blockedSub).filter(Boolean), [blockedUsers]);

  const getIdToken = React.useCallback(async (): Promise<string | null> => {
    return await getIdTokenWithRetry({ maxAttempts: 10, delayMs: 200 });
  }, []);

  const fetchRecoveryBlob = React.useCallback(
    async (token: string): Promise<BackupBlob | null> => {
      const resp = await fetch(`${API_URL.replace(/\/$/, '')}/users/recovery`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.status === 404) return null;
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`Failed to fetch recovery blob (${resp.status}) ${text}`.trim());
      }
      return (await resp.json()) as BackupBlob;
    },
    [API_URL]
  );

  const enterRecoveryPassphrase = React.useCallback(async () => {
    if (!myUserSub) return;
    const token = await getIdToken();
    if (!token) {
      await promptAlert('Not signed in', 'Missing auth token.');
      return;
    }
    const blob = await fetchRecoveryBlob(token);
    if (!blob) {
      await promptAlert('No recovery backup', 'No recovery backup was found for your account.');
      return;
    }

    // Keep prompting until success or user cancels.
    while (true) {
      let passphrase: string;
      try {
        passphrase = await promptPassphrase('restore');
      } catch (err) {
        if (err instanceof Error && err.message === 'Recovery reset requested') {
          await resetRecovery();
        }
        return;
      }
      try {
        const restoredPrivateKey = await decryptPrivateKey(blob, passphrase);
        const derivedPublicKey = derivePublicKey(restoredPrivateKey);
        await storeKeyPair(myUserSub, { privateKey: restoredPrivateKey, publicKey: derivedPublicKey });
        setKeyEpoch((v) => v + 1);
        await uploadPublicKey(token, derivedPublicKey);
        setHasRecoveryBlob(true);
        setRecoveryBlobKnown(true);
        setRecoveryLocked(false);
        await promptAlert('Recovery Unlocked', 'Your recovery passphrase has been accepted');
        return;
      } catch (e) {
        await promptAlert('Incorrect passphrase', 'You have entered an incorrect passphrase. Try again.');
      } finally {
        closePrompt();
      }
    }
  }, [myUserSub, getIdToken, fetchRecoveryBlob]);

  const changeRecoveryPassphrase = React.useCallback(async () => {
    if (!myUserSub) return;
    const token = await getIdToken();
    if (!token) {
      await promptAlert('Not signed in', 'Missing auth token.');
      return;
    }
    const kp = await loadKeyPair(myUserSub);
    if (!kp?.privateKey) {
      await promptAlert(
        'Recovery locked',
        'You need to enter your existing recovery passphrase on this device before you can change it.'
      );
      return;
    }
    try {
      const nextPass = await promptPassphrase('change');
      await uploadRecoveryBlob(token, kp.privateKey, nextPass);
      setHasRecoveryBlob(true);
      setRecoveryBlobKnown(true);
      await promptAlert('Passphrase updated', 'Your recovery passphrase has been updated');
    } catch {
      // cancelled
    } finally {
      closePrompt();
    }
  }, [myUserSub, getIdToken]);

  const setupRecovery = React.useCallback(async () => {
    if (!myUserSub) return;
    const token = await getIdToken();
    if (!token) {
      await promptAlert('Not signed in', 'Missing auth token.');
      return;
    }
    const kp = await loadKeyPair(myUserSub);
    if (!kp?.privateKey) {
      await promptAlert(
        'Recovery locked',
        'You need to enter your existing recovery passphrase on this device before you can set up recovery.'
      );
      return;
    }
    try {
      const pass = await promptPassphrase('setup');
      await uploadRecoveryBlob(token, kp.privateKey, pass);
      setHasRecoveryBlob(true);
      setRecoveryBlobKnown(true);
      await promptAlert('Recovery set up', 'A recovery passphrase has been set for your account.');
    } catch {
      // cancelled
    } finally {
      closePrompt();
    }
  }, [myUserSub, getIdToken]);

  const resetRecovery = React.useCallback(async () => {
    if (!myUserSub) return;
    const ok = await promptConfirm(
      'Reset Recovery?',
      'This will generate a new keypair and recovery passphrase on this device.\n\nOld encrypted direct messages will become unrecoverable.',
      { confirmText: 'Reset', cancelText: 'Cancel', destructive: true }
    );
    if (!ok) return;
    const token = await getIdToken();
    if (!token) {
      await promptAlert('Not signed in', 'Missing auth token.');
      return;
    }
    try {
      // IMPORTANT: Don't reset anything until the user successfully submits a new passphrase.
      // If they cancel, recovery should remain unchanged.
      const nextPass = await promptPassphrase('reset');
      const newKeyPair = await generateKeypair();
      await storeKeyPair(myUserSub, newKeyPair);
      setKeyEpoch((v) => v + 1);
      await uploadPublicKey(token, newKeyPair.publicKey);
      await uploadRecoveryBlob(token, newKeyPair.privateKey, nextPass);
      setHasRecoveryBlob(true);
      setRecoveryBlobKnown(true);
      setRecoveryLocked(false);
      await promptAlert('Recovery reset', 'A new recovery passphrase has been set.');
    } catch {
      // cancelled setup
    } finally {
      closePrompt();
    }
  }, [myUserSub, getIdToken]);

  const upsertDmThread = React.useCallback((convId: string, peerName: string, lastActivityAt?: number) => {
    const id = String(convId || '').trim();
    if (!id || id === 'global') return;
    const name = String(peerName || '').trim() || 'Direct Message';
    const ts = Number.isFinite(Number(lastActivityAt)) ? Number(lastActivityAt) : Date.now();
    setDmThreads((prev) => {
      const existing = prev[id];
      const next = { ...prev };
      next[id] = {
        peer: name || existing?.peer || 'Direct Message',
        lastActivityAt: Math.max(ts, existing?.lastActivityAt || 0),
      };
      return next;
    });
  }, []);

  // Local title overrides (source of truth from in-chat group meta).
  // Used to keep Chats list + unread labels consistent even if serverConversations is stale.
  const titleOverrideByConvIdRef = React.useRef<Record<string, string>>({});

  const dmThreadsList = React.useMemo(() => {
    const entries = Object.entries(dmThreads)
      .map(([convId, info]) => ({
        conversationId: convId,
        peer: info.peer,
        lastActivityAt: info.lastActivityAt || 0,
        unreadCount: unreadDmMap[convId]?.count || 0,
      }))
      .sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0));
    return entries;
  }, [dmThreads, unreadDmMap]);

  const fetchConversations = React.useCallback(async (): Promise<void> => {
    if (!API_URL) return;
    try {
      setChatsLoading(true);
      const { tokens } = await fetchAuthSession();
      const idToken = tokens?.idToken?.toString();
      if (!idToken) return;
      const res = await fetch(`${API_URL.replace(/\/$/, '')}/conversations?limit=100`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) return;
      const json = await res.json().catch(() => null);
      const convos = Array.isArray(json?.conversations) ? json.conversations : [];
      const parsed = convos
        .map((c: any) => ({
          conversationId: String(c?.conversationId || ''),
          peerDisplayName: c?.peerDisplayName ? String(c.peerDisplayName) : undefined,
          peerSub: c?.peerSub ? String(c.peerSub) : undefined,
          conversationKind: c?.conversationKind === 'group' ? 'group' : c?.conversationKind === 'dm' ? 'dm' : undefined,
          memberStatus:
            c?.memberStatus === 'active'
              ? 'active'
              : c?.memberStatus === 'left'
                ? 'left'
                : c?.memberStatus === 'banned'
                  ? 'banned'
                  : undefined,
          lastMessageAt: Number(c?.lastMessageAt ?? 0),
        }))
        .filter((c: any) => c.conversationId);

      // Apply any local overrides (e.g. group name changed in-chat).
      const parsedWithOverrides = applyTitleOverridesToConversations(parsed, titleOverrideByConvIdRef.current);
      setServerConversations(parsedWithOverrides);
      setConversationsCacheAt(Date.now());
      try {
        await AsyncStorage.setItem(
          'conversations:cache:v1',
          JSON.stringify({ at: Date.now(), conversations: parsedWithOverrides })
        );
      } catch {
        // ignore
      }

      // Best-effort: keep "Added to group: <title>" unread labels in sync with renamed group titles.
      try {
        const titleByConvId = new Map(
          parsedWithOverrides
            .map((c: any) => [String(c.conversationId || ''), String(c.peerDisplayName || '').trim()] as const)
            .filter(([id, t]: readonly [string, string]) => id && t)
        );
        setUnreadDmMap((prev) => {
          const next = { ...prev };
          for (const [convId, info] of Object.entries(prev || {})) {
            const title = titleByConvId.get(convId);
            if (!title) continue;
            if (info?.user && String(info.user).startsWith('Added to group:')) {
              next[convId] = { ...info, user: `Added to group: ${title}` };
            }
          }
          return next;
        });
      } catch {
        // ignore
      }
    } catch {
      // ignore
    } finally {
      setChatsLoading(false);
    }
  }, [API_URL]);

  const fetchUnreads = React.useCallback(async (): Promise<void> => {
    if (!API_URL) return;
    try {
      const { tokens } = await fetchAuthSession();
      const idToken = tokens?.idToken?.toString();
      if (!idToken) return;
      const res = await fetch(`${API_URL.replace(/\/$/, '')}/unreads`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      const unread = Array.isArray(data.unread) ? data.unread : [];
      const next: Record<string, { user: string; count: number; senderSub?: string }> = {};
      for (const it of unread) {
        const convId = String(it.conversationId || '');
        if (!convId) continue;
        const kind = typeof it.kind === 'string' ? String(it.kind) : '';
        // Prefer display name if backend provides it; fall back to legacy `sender`/`user`.
        // For kind=added, senderDisplayName is treated as the group title.
        const sender = String(
          it.senderDisplayName || it.sender || it.user || (kind === 'added' ? 'Added to group' : 'someone')
        );
        const senderSub = it.senderSub ? String(it.senderSub) : undefined;
        const countRaw = Number.isFinite(Number(it.messageCount)) ? Number(it.messageCount) : 1;
        const count = kind === 'added' ? 1 : Math.max(1, Math.floor(countRaw));
        next[convId] = {
          user: kind === 'added' ? `Added to group: ${sender}` : sender,
          senderSub,
          count,
        };
        const lastAt = Number(it.lastMessageCreatedAt || 0);
        upsertDmThread(convId, sender, Number.isFinite(lastAt) && lastAt > 0 ? lastAt : Date.now());
      }
      setUnreadDmMap((prev) => {
        // Prefer freshly fetched unread info, but apply any local group title overrides
        // so UI doesn't regress to a stale default name.
        const merged: Record<string, { user: string; count: number; senderSub?: string }> = { ...prev, ...next };
        return applyTitleOverridesToUnreadMap(merged, titleOverrideByConvIdRef.current);
      });
    } catch {
      // ignore
    }
  }, [API_URL, upsertDmThread]);

  // Used by ChatScreen to instantly update the Chats list + current header title after
  // a group name change (without waiting for refetch).
  const handleConversationTitleChanged = React.useCallback(
    (convIdRaw: string, titleRaw: string) => {
      const convId = String(convIdRaw || '').trim();
      if (!convId || convId === 'global') return;
      const title = String(titleRaw || '').trim();
      if (!title) return;

      // Persist local override so fetches won't overwrite the UI with stale server titles.
      titleOverrideByConvIdRef.current = setTitleOverride(titleOverrideByConvIdRef.current, convId, title);

      // Update current chat title if we're in it.
      if (conversationId === convId) {
        setPeer(title);
      }

      // Update server-backed conversations cache + DM threads list (best-effort).
      setServerConversations((prev) => {
        const next = prev.map((c) => (c.conversationId === convId ? { ...c, peerDisplayName: title } : c));
        try {
          AsyncStorage.setItem('conversations:cache:v1', JSON.stringify({ at: Date.now(), conversations: next })).catch(() => {});
        } catch {
          // ignore
        }
        return next;
      });

      // If there's a pending "Added to group: ..." unread label for this conversation, keep it in sync.
      setUnreadDmMap((prev) => {
        return applyTitleOverridesToUnreadMap(prev, { [convId]: title });
      });
      upsertDmThread(convId, title, Date.now());
    },
    [conversationId, upsertDmThread]
  );

  const deleteConversationFromList = React.useCallback(
    async (conversationIdToDelete: string) => {
      const convId = String(conversationIdToDelete || '').trim();
      if (!convId || !API_URL) return;
      const ok = await promptConfirm(
        'Remove chat?',
        'This removes the selected chat from your Chats list. If they message you again, it will reappear.\n\nThis does not delete message history.',
        { confirmText: 'Remove', cancelText: 'Cancel', destructive: true }
      );
      if (!ok) return;

      try {
        const { tokens } = await fetchAuthSession();
        const idToken = tokens?.idToken?.toString();
        if (!idToken) return;
        const res = await fetch(`${API_URL.replace(/\/$/, '')}/conversations/delete`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${idToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ conversationId: convId }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          console.warn('deleteConversation failed', res.status, text);
          return;
        }
      } catch (err) {
        console.warn('deleteConversation error', err);
        return;
      }

      // Optimistic local cleanup
      setServerConversations((prev) => prev.filter((c) => c.conversationId !== convId));
      setDmThreads((prev) => {
        if (!prev[convId]) return prev;
        const next = { ...prev };
        delete next[convId];
        return next;
      });
      setUnreadDmMap((prev) => {
        if (!prev[convId]) return prev;
        const next = { ...prev };
        delete next[convId];
        return next;
      });
    },
    [API_URL, promptConfirm]
  );

  const fetchBlocks = React.useCallback(async (): Promise<void> => {
    if (!API_URL) return;
    try {
      setBlocklistLoading(true);
      const { tokens } = await fetchAuthSession();
      const idToken = tokens?.idToken?.toString();
      if (!idToken) return;
      const res = await fetch(`${API_URL.replace(/\/$/, '')}/blocks`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) return;
      const json = await res.json().catch(() => null);
      const arr = Array.isArray(json?.blocked) ? json.blocked : [];
      const parsed = arr
        .map((it: any) => ({
          blockedSub: String(it?.blockedSub || ''),
          blockedDisplayName: it?.blockedDisplayName ? String(it.blockedDisplayName) : undefined,
          blockedUsernameLower: it?.blockedUsernameLower ? String(it.blockedUsernameLower) : undefined,
          blockedAt: typeof it?.blockedAt === 'number' ? Number(it.blockedAt) : undefined,
        }))
        .filter((b: any) => b.blockedSub);
      setBlockedUsers(parsed);
      setBlocklistCacheAt(Date.now());
      try {
        await AsyncStorage.setItem('blocklist:cache:v1', JSON.stringify({ at: Date.now(), blocked: parsed }));
      } catch {
        // ignore
      }
    } catch {
      // ignore
    } finally {
      setBlocklistLoading(false);
    }
  }, [API_URL]);

  const addBlockByUsername = React.useCallback(async (): Promise<void> => {
    if (!API_URL) return;
    const username = blockUsername.trim();
    if (!username) {
      setBlockError('Enter a username');
      return;
    }
    const ok = await promptConfirm(
      'Block user?',
      `Block "${username}"? You won’t see their messages, and they won’t be able to DM you.\n\nYou can unblock them later from your Blocklist.`,
      { confirmText: 'Block', cancelText: 'Cancel', destructive: true }
    );
    if (!ok) return;

    try {
      setBlockError(null);
      setBlocklistLoading(true);
      const { tokens } = await fetchAuthSession();
      const idToken = tokens?.idToken?.toString();
      if (!idToken) return;
      const res = await fetch(`${API_URL.replace(/\/$/, '')}/blocks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      if (res.status === 404) {
        setBlockError('No such user');
        return;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        setBlockError(text ? `Failed to block (${res.status})` : `Failed to block (${res.status})`);
        return;
      }
      setBlockUsername('');
      await fetchBlocks();
    } catch {
      setBlockError('Failed to block user');
    } finally {
      setBlocklistLoading(false);
    }
  }, [API_URL, blockUsername, fetchBlocks, promptConfirm]);

  const addBlockBySub = React.useCallback(
    async (blockedSub: string, label?: string): Promise<void> => {
      if (!API_URL) throw new Error('Missing API_URL');
      const sub = String(blockedSub || '').trim();
      if (!sub) throw new Error('Missing user id');

      const { tokens } = await fetchAuthSession();
      const idToken = tokens?.idToken?.toString();
      if (!idToken) throw new Error('Missing auth token');

      const res = await fetch(`${API_URL.replace(/\/$/, '')}/blocks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ blockedSub: sub }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const who = label ? `"${label}"` : 'user';
        throw new Error(text?.trim() ? `Failed to block ${who}: ${text.trim()}` : `Failed to block ${who} (${res.status})`);
      }

      await fetchBlocks();
    },
    [API_URL, fetchBlocks]
  );

  const unblockUser = React.useCallback(
    async (blockedSub: string, label?: string) => {
      const subToUnblock = String(blockedSub || '').trim();
      if (!subToUnblock || !API_URL) return;
      const ok = await promptConfirm(
        'Unblock user?',
        `Unblock ${label ? `"${label}"` : 'this user'}?`,
        { confirmText: 'Unblock', cancelText: 'Cancel', destructive: false }
      );
      if (!ok) return;

      try {
        setBlocklistLoading(true);
        const { tokens } = await fetchAuthSession();
        const idToken = tokens?.idToken?.toString();
        if (!idToken) return;
        const res = await fetch(`${API_URL.replace(/\/$/, '')}/blocks/delete`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ blockedSub: subToUnblock }),
        });
        if (!res.ok) return;
        setBlockedUsers((prev) => prev.filter((b) => b.blockedSub !== subToUnblock));
      } finally {
        setBlocklistLoading(false);
      }
    },
    [API_URL, promptConfirm]
  );

  React.useEffect(() => {
    if (!blocklistOpen) return;
    setBlockError(null);
    // Cache strategy:
    // - Show whatever we already have immediately (state or persisted cache).
    // - Refresh in background only if stale.
    const STALE_MS = 60_000;
    if (blocklistCacheAt && Date.now() - blocklistCacheAt < STALE_MS) return;
    void fetchBlocks();
  }, [blocklistOpen, fetchBlocks, blocklistCacheAt]);

  // Load cached blocklist on boot so Blocklist opens instantly.
  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('blocklist:cache:v1');
        if (!raw) return;
        const parsed = JSON.parse(raw);
        const arr = Array.isArray(parsed?.blocked) ? parsed.blocked : [];
        const at = Number(parsed?.at ?? 0);
        if (!mounted) return;
        if (arr.length) setBlockedUsers(arr);
        if (Number.isFinite(at) && at > 0) setBlocklistCacheAt(at);
      } catch {
        // ignore
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const chatsList = React.useMemo(() => {
    const mapUnread = unreadDmMap;
    if (serverConversations.length) {
      return serverConversations
        .map((c) => ({
          conversationId: c.conversationId,
          peer: c.peerDisplayName || mapUnread[c.conversationId]?.user || 'Direct Message',
          conversationKind: c.conversationKind,
          memberStatus: c.memberStatus,
          lastActivityAt: Number(c.lastMessageAt || 0),
          unreadCount: mapUnread[c.conversationId]?.count || 0,
        }))
        .sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0));
    }
    return dmThreadsList;
  }, [dmThreadsList, serverConversations, unreadDmMap]);

  React.useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem('ui:theme');
        if (stored === 'dark' || stored === 'light') setTheme(stored);
      } catch {
        // ignore
      }
    })();
  }, []);

  React.useEffect(() => {
    (async () => {
      try {
        await AsyncStorage.setItem('ui:theme', theme);
      } catch {
        // ignore
      }
    })();
  }, [theme]);

  // Load persisted DM threads (best-effort).
  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('dm:threads:v1');
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!mounted) return;
        if (parsed && typeof parsed === 'object') {
          setDmThreads(() => parsed);
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Persist DM threads (best-effort).
  React.useEffect(() => {
    (async () => {
      try {
        await AsyncStorage.setItem('dm:threads:v1', JSON.stringify(dmThreads));
      } catch {
        // ignore
      }
    })();
  }, [dmThreads]);

  // Refresh conversation list when opening the Chats modal.
  React.useEffect(() => {
    if (!chatsOpen) return;
    void fetchConversations();
    void fetchUnreads();
  }, [chatsOpen, fetchConversations, fetchUnreads]);

  // Load cached conversations on boot so Chats opens instantly.
  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('conversations:cache:v1');
        if (!raw) return;
        const parsed = JSON.parse(raw);
        const convos = Array.isArray(parsed?.conversations) ? parsed.conversations : [];
        const at = Number(parsed?.at ?? 0);
        if (!mounted) return;
        if (convos.length) setServerConversations(convos);
        if (Number.isFinite(at) && at > 0) setConversationsCacheAt(at);
      } catch {
        // ignore
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const startDM = async () => {
      const raw = peerInput.trim();
      const normalizedCurrent = currentUsername.trim().toLowerCase();
      if (!raw) {
        setSearchError('Enter a username');
        return;
      }

      // Support group DMs: comma/space separated usernames.
      const tokens = raw
        .split(/[,\s]+/g)
        .map((t) => t.trim())
        .filter(Boolean);
      const normalizedTokens = Array.from(new Set(tokens.map((t) => t.toLowerCase())));

      // 1:1 DM (existing behavior)
      if (normalizedTokens.length === 1) {
        const trimmed = tokens[0];
        const normalizedInput = trimmed.toLowerCase();
        if (!trimmed || normalizedInput === normalizedCurrent) {
          setSearchError(normalizedInput === normalizedCurrent ? 'Not you silly!' : 'Enter a username');
          return;
        }

        const { tokens: authTokens } = await fetchAuthSession();
        const idToken = authTokens?.idToken?.toString();
        if (!idToken) {
          setSearchError('Unable to authenticate');
          return;
        }

        const res = await fetch(`${API_URL.replace(/\/$/, '')}/users?username=${encodeURIComponent(trimmed)}`, {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        if (res.status === 404) {
          setSearchError('No such user!');
          return;
        }
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          console.warn('getUser failed', res.status, text);
          let msg = text;
          try {
            const parsed = text ? JSON.parse(text) : null;
            if (parsed && typeof parsed.message === 'string') msg = parsed.message;
          } catch {
            // ignore
          }
          setSearchError(msg ? `User lookup failed (${res.status}): ${msg}` : `User lookup failed (${res.status})`);
          return;
        }

        const data = await res.json();
        const peerSub = String(data.sub || data.userSub || '').trim();
        const canonical = String(data.displayName || data.preferred_username || data.username || trimmed).trim();
        if (!peerSub) {
          console.warn('getUser ok but missing sub', data);
          setSearchError('User lookup missing sub (check getUser response JSON)');
          return;
        }
        if (blockedSubs.includes(peerSub)) {
          setSearchError('That user is in your Blocklist. Unblock them to start a DM.');
          return;
        }
        const normalizedCanonical = canonical.toLowerCase();
        if (normalizedCanonical === normalizedCurrent) {
          setSearchError('Not you silly!');
          return;
        }
        const mySub = (await fetchUserAttributes()).sub as string | undefined;
        if (!mySub) {
          setSearchError('Unable to authenticate');
          return;
        }
        if (peerSub === mySub) {
          setSearchError('Not you silly!');
          return;
        }
        const [a, b] = [mySub, peerSub].sort();
        const id = `dm#${a}#${b}`;
        setPeer(canonical);
        setConversationId(id);
        upsertDmThread(id, canonical, Date.now());
        setSearchOpen(false);
        setPeerInput('');
        setSearchError(null);
        return;
      }

      // Group DM start
      if (normalizedTokens.length > 7) {
        setSearchError('Too many members (max 8 including you).');
        return;
      }
      if (normalizedTokens.includes(normalizedCurrent)) {
        setSearchError("Don't include yourself.");
        return;
      }

      const { tokens: authTokens } = await fetchAuthSession();
      const idToken = authTokens?.idToken?.toString();
      if (!idToken) {
        setSearchError('Unable to authenticate');
        return;
      }

      const res = await fetch(`${API_URL.replace(/\/$/, '')}/groups/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernames: normalizedTokens }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        let msg = text;
        try {
          const parsed = text ? JSON.parse(text) : null;
          if (parsed && typeof parsed.message === 'string') msg = parsed.message;
        } catch {
          // ignore
        }
        setSearchError(msg ? `Group start failed (${res.status}): ${msg}` : `Group start failed (${res.status})`);
        return;
      }
      const data = await res.json().catch(() => ({}));
      const convId = String(data.conversationId || '').trim();
      const title = String(data.title || 'Group DM').trim();
      if (!convId) {
        setSearchError('Group start missing conversationId');
        return;
      }
      setPeer(title);
      setConversationId(convId);
      upsertDmThread(convId, title, Date.now());
      setSearchOpen(false);
      setPeerInput('');
      setSearchError(null);
    };

  const hasUnreadDms = Object.keys(unreadDmMap).length > 0;
  const unreadEntries = React.useMemo(
    () => Object.entries(unreadDmMap),
    [unreadDmMap]
  );

  const goToConversation = React.useCallback(
    (targetConversationId: string) => {
      if (!targetConversationId) return;
      setConversationId(targetConversationId);
      // Best-effort title selection:
      // 1) server conversations (authoritative titles for groups + DMs)
      // 2) unread cache (push/unreads can provide a title)
      // 3) fallback by kind
      const server = serverConversations.find((c) => c.conversationId === targetConversationId);
      const cached = unreadDmMap[targetConversationId];
      const kind =
        server?.conversationKind ||
        (String(targetConversationId || '').startsWith('gdm#') ? 'group' : String(targetConversationId || '').startsWith('dm#') ? 'dm' : undefined);
      const title =
        (server?.peerDisplayName && String(server.peerDisplayName).trim()) ||
        (cached?.user && String(cached.user).trim()) ||
        (targetConversationId === 'global' ? '' : kind === 'group' ? 'Group DM' : 'Direct Message');
      if (targetConversationId === 'global') setPeer(null);
      else setPeer(title || (kind === 'group' ? 'Group DM' : 'Direct Message'));
      if (targetConversationId !== 'global') {
        upsertDmThread(
          targetConversationId,
          title || peer || (kind === 'group' ? 'Group DM' : 'Direct Message'),
          Date.now()
        );
      }
      setSearchOpen(false);
      setPeerInput('');
      setSearchError(null);
    },
    [unreadDmMap, upsertDmThread, peer, serverConversations]
  );

  // Handle taps on OS notifications to jump into the DM.
  React.useEffect(() => {
    let sub: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Notifications = require('expo-notifications');
      sub = Notifications.addNotificationResponseReceivedListener((resp: any) => {
        const data = resp?.notification?.request?.content?.data || {};
        const kind = typeof data.kind === 'string' ? data.kind : '';
        const convId = typeof data.conversationId === 'string' ? data.conversationId : '';
        const senderName = typeof data.senderDisplayName === 'string' ? data.senderDisplayName : '';
        if ((kind === 'dm' || kind === 'group') && convId) {
          setSearchOpen(false);
          setPeerInput('');
          setSearchError(null);
          setConversationId(convId);
          setPeer(senderName || (kind === 'group' ? 'Group DM' : 'Direct Message'));
        }
      });
    } catch {
      // expo-notifications not installed / dev client not rebuilt
    }
    return () => {
      try {
        sub?.remove?.();
      } catch {
        // ignore
      }
    };
  }, []);

  const handleNewDmNotification = React.useCallback(
    (newConversationId: string, sender: string, senderSub?: string) => {
      setUnreadDmMap((prev) => {
        if (!newConversationId || newConversationId === 'global') return prev;
        if (newConversationId === conversationId) return prev;
        const existing = prev[newConversationId];
        const next = { ...prev };
        next[newConversationId] = {
          user: sender || existing?.user || 'someone',
          senderSub: senderSub || existing?.senderSub,
          count: (existing?.count ?? 0) + 1,
        };
        return next;
      });
      if (newConversationId && newConversationId !== 'global') {
        upsertDmThread(newConversationId, sender || 'Direct Message', Date.now());
      }
    },
    [conversationId, upsertDmThread]
  );

  React.useEffect(() => {
    if (!conversationId) return;
    if (conversationId === 'global') return;
    setUnreadDmMap((prev) => {
      if (!prev[conversationId]) return prev;
      const next = { ...prev };
      delete next[conversationId];
      return next;
    });
  }, [conversationId]);

  // Hydrate unread DMs on login so the badge survives logout/login.
  React.useEffect(() => {
    if (!user) return;
    void fetchUnreads();
  }, [user, fetchUnreads]);

  const promptVisible = !!passphrasePrompt;
  const promptLabel =
    passphrasePrompt?.mode === 'restore'
      ? 'Enter your Recovery Passphrase'
      : passphrasePrompt?.mode === 'change'
        ? 'Change your Recovery Passphrase'
        : passphrasePrompt?.mode === 'reset'
          ? 'Set a New Recovery Passphrase'
        : 'Create a Recovery Passphrase';

  const headerTop = (
    <>
      <View style={styles.topRow}>
        <View style={[styles.segment, isDark && styles.segmentDark]}>
          <Pressable
            onPress={() => {
              setConversationId('global');
              setPeer(null);
              setPeerInput('');
              setSearchError(null);
              setSearchOpen(false);
            }}
            style={({ pressed }) => [
              styles.segmentBtn,
              !isDmMode && styles.segmentBtnActive,
              !isDmMode && isDark && styles.segmentBtnActiveDark,
              pressed && { opacity: 0.9 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Global chat"
          >
            <Text
              style={[
                styles.segmentBtnText,
                isDark && styles.segmentBtnTextDark,
                !isDmMode && styles.segmentBtnTextActive,
                !isDmMode && isDark && styles.segmentBtnTextActiveDark,
              ]}
            >
              Global
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setSearchOpen((prev) => !prev)}
            style={({ pressed }) => [
              styles.segmentBtn,
              (isDmMode || searchOpen) && styles.segmentBtnActive,
              (isDmMode || searchOpen) && isDark && styles.segmentBtnActiveDark,
              pressed && { opacity: 0.9 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Direct messages"
          >
            <View style={styles.dmPillInner}>
              <Text
                style={[
                  styles.segmentBtnText,
                  isDark && styles.segmentBtnTextDark,
                  (isDmMode || searchOpen) && styles.segmentBtnTextActive,
                  (isDmMode || searchOpen) && isDark && styles.segmentBtnTextActiveDark,
                ]}
              >
                DM
              </Text>
              {hasUnreadDms ? <View style={styles.unreadDot} /> : null}
            </View>
          </Pressable>
        </View>

        <View style={styles.rightControls}>
          <Pressable
            onPress={() => setMenuOpen(true)}
            style={({ pressed }) => [
              styles.menuIconBtn,
              isDark && styles.menuIconBtnDark,
              pressed && { opacity: 0.85 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Open menu"
          >
            <Feather name="menu" size={18} color={isDark ? '#fff' : '#111'} />
          </Pressable>
        </View>
      </View>

      {searchOpen && (
        <View
          style={[
            styles.searchWrapper,
            // When there are no unread hints, add a bit more space before the chat title row.
            // If there ARE unread hints, keep it tight so we don't "double pad" the header.
            !unreadEntries.length ? { marginBottom: 6 } : null,
          ]}
        >
          <View style={styles.searchRow}>
            <TextInput
              value={peerInput}
              onChangeText={(value) => {
                setPeerInput(value);
                setSearchError(null);
              }}
              placeholder="Enter Names"
              placeholderTextColor={isDark ? '#8f8fa3' : '#999'}
              selectionColor={isDark ? '#ffffff' : '#111'}
              cursorColor={isDark ? '#ffffff' : '#111'}
              style={[styles.searchInput, isDark && styles.searchInputDark]}
            />
            <Pressable
              onPress={startDM}
              style={({ pressed }) => [
                styles.startDmBtn,
                isDark && styles.startDmBtnDark,
                pressed && { opacity: 0.9 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Start direct message"
            >
              <Text style={[styles.startDmBtnText, isDark && styles.startDmBtnTextDark]}>
                Start DM
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setSearchOpen(false);
                setPeerInput('');
                setSearchError(null);
              }}
              style={({ pressed }) => [
                styles.cancelBtn,
                isDark && styles.cancelBtnDark,
                pressed && { opacity: 0.85 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Cancel direct message"
            >
              <Text style={[styles.cancelBtnText, isDark && styles.cancelBtnTextDark]}>
                Cancel
              </Text>
            </Pressable>
          </View>
          {unreadEntries.length ? (
            <View style={styles.unreadList}>
              {unreadEntries.map(([convId, info]) => (
                <Pressable
                  key={convId}
                  style={styles.unreadHintWrapper}
                  onPress={() => goToConversation(convId)}
                >
                  <Text style={[styles.unreadHint, isDark && styles.unreadHintDark]}>
                    {info.count} unread {info.count === 1 ? 'message' : 'messages'} from{' '}
                    <Text style={[styles.unreadHintBold, isDark && styles.unreadHintBoldDark]}>
                      {info.user}
                    </Text>
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      )}

      {searchError ? (
        <Text style={[styles.errorText, isDark && styles.errorTextDark]}>{searchError}</Text>
      ) : null}
    </>
  );

  return (
    <View style={[styles.appContent, isDark ? styles.appContentDark : null]}>
      <HeaderMenuModal
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={undefined}
        isDark={isDark}
        cardWidth={160}
        headerRight={
          <View style={[styles.themeToggle, isDark && styles.themeToggleDark]}>
            <Feather name={isDark ? 'moon' : 'sun'} size={16} color={isDark ? '#fff' : '#111'} />
            <Switch
              value={isDark}
              onValueChange={(v) => setTheme(v ? 'dark' : 'light')}
              trackColor={{ false: '#d1d1d6', true: '#d1d1d6' }}
              thumbColor={isDark ? '#2a2a33' : '#ffffff'}
            />
          </View>
        }
        items={[
          {
            key: 'chats',
            label: 'Chats',
            onPress: () => {
              setMenuOpen(false);
              setChatsOpen(true);
            },
          },
          {
            key: 'avatar',
            label: 'Avatar',
            onPress: () => {
              setMenuOpen(false);
              setAvatarError(null);
              setAvatarOpen(true);
            },
          },
          {
            key: 'background',
            label: 'Background',
            onPress: () => {
              setMenuOpen(false);
              setBackgroundError(null);
              setBackgroundOpen(true);
            },
          },
          {
            key: 'recovery',
            label: 'Recovery',
            onPress: async () => {
              setMenuOpen(false);
              setRecoveryOpen(true);
              // After a Metro refresh, Amplify may take a moment to rehydrate tokens.
              // Refresh recovery state so the modal shows "Change" vs "Set up" correctly.
              const token = await getIdTokenWithRetry({ maxAttempts: 10, delayMs: 200 });
              if (token) {
                const exists = await checkRecoveryBlobExists(token);
                if (exists !== null) applyRecoveryBlobExists(exists);
              }
            },
          },
          {
            key: 'blocked',
            label: 'Blocklist',
            onPress: () => {
              setMenuOpen(false);
              setBlocklistOpen(true);
            },
          },
          {
            key: 'deleteAccount',
            label: 'Delete account',
            onPress: async () => {
              setMenuOpen(false);
              await deleteMyAccount();
            },
          },
          {
            key: 'signout',
            label: 'Sign out',
            onPress: async () => {
              setMenuOpen(false);
              try {
                await unregisterDmPushNotifications();
                await signOut();
              } finally {
                onSignedOut?.();
              }
            },
          },
        ]}
      />

      <Modal
        visible={avatarOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (avatarSavingRef.current) return;
          // Discard draft changes unless saved.
          setAvatarOpen(false);
          setAvatarDraft(myAvatar);
          setAvatarDraftImageUri(null);
          setAvatarDraftRemoveImage(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            disabled={avatarSaving}
            onPress={() => {
              if (avatarSavingRef.current) return;
              // Discard draft changes unless saved.
              setAvatarOpen(false);
              setAvatarDraft(myAvatar);
              setAvatarDraftImageUri(null);
              setAvatarDraftRemoveImage(false);
            }}
          />
          <View style={[styles.profileCard, isDark ? styles.profileCardDark : null]}>
            <View style={styles.chatsTopRow}>
              <Text style={[styles.modalTitle, isDark ? styles.modalTitleDark : null]}>Avatar</Text>
            </View>

            <View style={styles.profilePreviewRow}>
              <AvatarBubble
                seed={myUserSub || displayName}
                label={displayName}
                size={44}
                backgroundColor={avatarDraft.bgColor || pickDefaultAvatarColor(myUserSub || displayName)}
                textColor={avatarDraft.textColor || '#fff'}
                imageUri={avatarDraftImageUri || avatarDraft.imageUri}
                imageBgColor={isDark ? '#1c1c22' : '#f2f2f7'}
              />
              <View style={styles.profilePreviewMeta}>
                <Text style={[styles.modalHelperText, isDark ? styles.modalHelperTextDark : null]}>
                  Pick colors or upload a photo (you can zoom/crop)
                </Text>
              </View>
            </View>

            {avatarError ? (
              <Text style={[styles.errorText, isDark && styles.errorTextDark]}>{avatarError}</Text>
            ) : null}

            {avatarDraftImageUri || avatarDraft.imageUri ? (
              <Text style={[styles.modalHelperText, isDark ? styles.modalHelperTextDark : null, { marginTop: 6 }]}>
                Photo avatar enabled - remove the photo to edit bubble/text colors
              </Text>
            ) : (
              <>
                <Text style={[styles.modalHelperText, isDark ? styles.modalHelperTextDark : null, styles.profileSectionTitle]}>
                  Bubble color
                </Text>
                <View style={styles.avatarPaletteRow}>
                  {AVATAR_DEFAULT_COLORS.map((c) => {
                    const selected = (avatarDraft.bgColor || '') === c;
                    return (
                      <Pressable
                        key={`bg:${c}`}
                        onPress={() => setAvatarDraft((prev) => ({ ...prev, bgColor: c }))}
                        style={[
                          styles.avatarColorDot,
                          { backgroundColor: c },
                          selected ? (isDark ? styles.avatarColorDotSelectedDark : styles.avatarColorDotSelected) : null,
                        ]}
                      />
                    );
                  })}
                </View>

                <Text style={[styles.modalHelperText, isDark ? styles.modalHelperTextDark : null, styles.profileSectionTitle]}>
                  Text color
                </Text>
                <View style={styles.avatarTextColorRow}>
                  <Pressable
                    onPress={() => setAvatarDraft((prev) => ({ ...prev, textColor: '#fff' }))}
                    style={[
                      styles.avatarTextColorBtn,
                      isDark ? styles.avatarTextColorBtnDark : null,
                      (avatarDraft.textColor || '#fff') === '#fff'
                        ? (isDark ? styles.avatarTextColorBtnSelectedDark : styles.avatarTextColorBtnSelected)
                        : null,
                    ]}
                  >
                    <Text style={[styles.avatarTextColorLabel, isDark ? styles.avatarTextColorLabelDark : null]}>White</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setAvatarDraft((prev) => ({ ...prev, textColor: '#111' }))}
                    style={[
                      styles.avatarTextColorBtn,
                      isDark ? styles.avatarTextColorBtnDark : null,
                      (avatarDraft.textColor || '#fff') === '#111'
                        ? (isDark ? styles.avatarTextColorBtnSelectedDark : styles.avatarTextColorBtnSelected)
                        : null,
                    ]}
                  >
                    <Text style={[styles.avatarTextColorLabel, isDark ? styles.avatarTextColorLabelDark : null]}>Black</Text>
                  </Pressable>
                </View>
              </>
            )}

            <View style={styles.profileActionsRow}>
              <Pressable
                disabled={avatarSaving}
                style={({ pressed }) => [
                  styles.toolBtn,
                  isDark && styles.toolBtnDark,
                  avatarSaving ? { opacity: 0.5 } : null,
                  pressed && !avatarSaving ? { opacity: 0.92 } : null,
                ]}
                onPress={async () => {
                  try {
                    setAvatarError(null);
                    setAvatarDraftRemoveImage(false);
                    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
                    if (!perm.granted) {
                      setAvatarError('Please allow photo library access to choose an avatar.');
                      return;
                    }
                    const result = await ImagePicker.launchImageLibraryAsync({
                      // Avoid deprecated MediaTypeOptions while staying compatible with older typings.
                      mediaTypes: ['images'] as any,
                      allowsEditing: true, // built-in crop UI w/ zoom
                      aspect: [1, 1],
                      quality: 0.9,
                    });
                    if (result.canceled) return;
                    const uri = result.assets?.[0]?.uri;
                    if (!uri) return;
                    setAvatarDraftImageUri(uri);
                  } catch (e: any) {
                    setAvatarError(e?.message || 'Could not pick image.');
                  }
                }}
                accessibilityRole="button"
                accessibilityState={{ disabled: avatarSaving }}
              >
                <Text style={[styles.toolBtnText, isDark && styles.toolBtnTextDark]}>Upload photo</Text>
              </Pressable>

              {/*
                Disable "Remove photo" when there's nothing to remove, and while saving to avoid
                racey state changes during the upload/save pipeline.
              */}
              <Pressable
                disabled={avatarSaving || (!avatarDraftImageUri && !avatarDraft.imageUri)}
                style={({ pressed }) => [
                  styles.toolBtn,
                  isDark && styles.toolBtnDark,
                  (avatarSaving || (!avatarDraftImageUri && !avatarDraft.imageUri)) ? { opacity: 0.5 } : null,
                  pressed && !(avatarSaving || (!avatarDraftImageUri && !avatarDraft.imageUri)) ? { opacity: 0.92 } : null,
                ]}
                onPress={() => {
                  setAvatarDraftImageUri(null);
                  setAvatarDraftRemoveImage(true);
                  // Only change draft state; commit happens on Save.
                  setAvatarDraft((prev) => ({ ...prev, imagePath: undefined, imageUri: undefined }));
                }}
                accessibilityRole="button"
                accessibilityState={{ disabled: avatarSaving || (!avatarDraftImageUri && !avatarDraft.imageUri) }}
              >
                <Text style={[styles.toolBtnText, isDark && styles.toolBtnTextDark]}>Remove photo</Text>
              </Pressable>
            </View>

            <View style={[styles.modalButtons, { marginTop: 10 }]}>
              <Pressable
                style={({ pressed }) => [
                  styles.modalButton,
                  styles.modalButtonSmall,
                  isDark ? styles.modalButtonDark : null,
                  pressed ? { opacity: 0.92 } : null,
                ]}
                onPress={async () => {
                  if (!myUserSub) return;
                  avatarSavingRef.current = true;
                  setAvatarSaving(true);
                  setAvatarError(null);
                  try {
                    let nextImagePath = avatarDraft.imagePath;

                    if (avatarDraftImageUri) {
                      // Normalize to a square JPEG (256x256) after user crop.
                      const normalized = await ImageManipulator.manipulateAsync(
                        avatarDraftImageUri,
                        [{ resize: { width: 256, height: 256 } }],
                        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
                      );
                      const blob = await (await fetch(normalized.uri)).blob();
                      // Store avatars under uploads/global/* so both authenticated users and guests
                      // can resolve them via Amplify Storage permissions (and later behind CloudFront).
                      const path = `uploads/public/avatars/${myUserSub}/${Date.now()}.jpg`;
                      await uploadData({ path, data: blob, options: { contentType: 'image/jpeg' } }).result;
                      nextImagePath = path;
                      setAvatarDraftImageUri(null);
                      setAvatarDraftRemoveImage(false);
                    }

                    const next = {
                      bgColor: avatarDraft.bgColor,
                      textColor: avatarDraft.textColor || '#fff',
                      // IMPORTANT:
                      // - undefined => omit key => "no change" server-side
                      // - ''        => explicit clear (updateProfile.js removes avatarImagePath)
                      imagePath: avatarDraftRemoveImage ? '' : nextImagePath,
                    };

                    // Update local state first so UI feels instant.
                    setMyAvatar((prev) => ({ ...prev, ...next, imageUri: undefined }));
                    await saveAvatarToStorageAndServer(next);
                    setAvatarOpen(false);
                  } catch (e: any) {
                    setAvatarError(e?.message || 'Failed to save avatar.');
                  } finally {
                    avatarSavingRef.current = false;
                    setAvatarSaving(false);
                  }
                }}
                disabled={avatarSaving}
              >
                {avatarSaving ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                    <Text style={[styles.modalButtonText, isDark ? styles.modalButtonTextDark : null]}>Saving</Text>
                    <AnimatedDots color={isDark ? '#fff' : '#111'} size={18} />
                  </View>
                ) : (
                  <Text style={[styles.modalButtonText, isDark ? styles.modalButtonTextDark : null]}>Save</Text>
                )}
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  styles.modalButton,
                  styles.modalButtonSmall,
                  isDark ? styles.modalButtonDark : null,
                  pressed ? { opacity: 0.92 } : null,
                ]}
                onPress={() => {
                  if (avatarSavingRef.current) return;
                  // Discard draft changes unless saved.
                  setAvatarOpen(false);
                  setAvatarDraft(myAvatar);
                  setAvatarDraftImageUri(null);
                  setAvatarDraftRemoveImage(false);
                }}
                disabled={avatarSaving}
              >
                <Text style={[styles.modalButtonText, isDark ? styles.modalButtonTextDark : null]}>Close</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={backgroundOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (backgroundSavingRef.current) return;
          setBackgroundOpen(false);
          setBackgroundDraft(chatBackground);
          setBackgroundDraftImageUri(null);
          setBackgroundError(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            disabled={backgroundSaving}
            onPress={() => {
              if (backgroundSavingRef.current) return;
              setBackgroundOpen(false);
              setBackgroundDraft(chatBackground);
              setBackgroundDraftImageUri(null);
              setBackgroundError(null);
            }}
          />
          <View style={[styles.profileCard, isDark ? styles.profileCardDark : null]}>
            <View style={styles.chatsTopRow}>
              <Text style={[styles.modalTitle, isDark ? styles.modalTitleDark : null]}>Background</Text>
            </View>

            <View style={styles.profilePreviewRow}>
              <View style={styles.bgPreviewBox}>
                {(() => {
                  const effective =
                    backgroundDraftImageUri
                      ? ({ mode: 'image', uri: backgroundDraftImageUri } as const)
                      : backgroundDraft;
                  if (effective.mode === 'image') {
                    return (
                      <Image
                        source={{ uri: effective.uri }}
                        style={[styles.bgPreviewImage, { opacity: bgEffectOpacity }]}
                        resizeMode="cover"
                        blurRadius={bgEffectBlur}
                      />
                    );
                  }
                  if (effective.mode === 'color') {
                    return <View style={[StyleSheet.absoluteFill, { backgroundColor: effective.color }]} />;
                  }
                  return (
                    <View
                      style={[
                        StyleSheet.absoluteFill,
                        { backgroundColor: isDark ? '#0b0b0f' : '#ffffff' },
                      ]}
                    />
                  );
                })()}
              </View>
              <View style={styles.profilePreviewMeta}>
                <Text style={[styles.modalHelperText, isDark ? styles.modalHelperTextDark : null]}>
                  Choose a chat background
                </Text>
              </View>
            </View>

            {backgroundError ? (
              <Text style={[styles.errorText, isDark && styles.errorTextDark]}>{backgroundError}</Text>
            ) : null}

            {!backgroundDraftImageUri && backgroundDraft.mode !== 'image' ? (
              <>
                <Text style={[styles.modalHelperText, isDark ? styles.modalHelperTextDark : null, styles.profileSectionTitle]}>
                  Color
                </Text>
                <View style={styles.avatarPaletteRow}>
                  {[
                    '#ffffff',
                    '#f2f2f7',
                    '#e9e9ee',
                    '#111111',
                    '#0b0b0f',
                    ...AVATAR_DEFAULT_COLORS,
                  ].map((c) => {
                    const selected = backgroundDraft.mode === 'color' && backgroundDraft.color === c;
                    return (
                      <Pressable
                        key={`bgc:${c}`}
                        onPress={() => setBackgroundDraft({ mode: 'color', color: c })}
                        style={[
                          styles.avatarColorDot,
                          { backgroundColor: c },
                          selected ? (isDark ? styles.avatarColorDotSelectedDark : styles.avatarColorDotSelected) : null,
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={`Select background color ${c}`}
                      />
                    );
                  })}
                </View>
              </>
            ) : (
              <Text style={[styles.modalHelperText, isDark ? styles.modalHelperTextDark : null, { marginTop: 6 }]}>
                Photo background enabled - remove the photo to use a solid color
              </Text>
            )}

            {(backgroundDraftImageUri || backgroundDraft.mode === 'image') ? (
              <>
                <View style={styles.bgEffectsHeaderRow}>
                  <Text style={[styles.modalHelperText, isDark ? styles.modalHelperTextDark : null, styles.profileSectionTitle]}>
                    Photo effects
                  </Text>
                  <Pressable
                    disabled={backgroundSaving}
                    style={({ pressed }) => [styles.bgEffectsResetBtn, pressed ? { opacity: 0.85 } : null]}
                    onPress={() => {
                      setBgEffectBlur(0);
                      setBgEffectOpacity(1);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Reset background effects"
                  >
                    <Text style={[styles.bgEffectsResetText, isDark ? styles.bgEffectsResetTextDark : null]}>Reset</Text>
                  </Pressable>
                </View>

                <View style={styles.bgSliderSection}>
                  <View style={styles.bgSliderLabelRow}>
                    <Text style={[styles.bgSliderLabel, isDark ? styles.bgSliderLabelDark : null]}>Blur</Text>
                    <Text style={[styles.bgSliderValue, isDark ? styles.bgSliderValueDark : null]}>{bgEffectBlur}</Text>
                  </View>
                  <Slider
                    style={styles.bgSlider}
                    minimumValue={0}
                    maximumValue={10}
                    step={1}
                    value={bgEffectBlur}
                    onValueChange={(v: number) => setBgEffectBlur(v)}
                    onSlidingComplete={(v: number) => setBgEffectBlur(Math.max(0, Math.min(10, Math.round(v))))}
                    minimumTrackTintColor={isDark ? '#fff' : '#111'}
                    maximumTrackTintColor={isDark ? '#2a2a33' : '#d6d6de'}
                    thumbTintColor={isDark ? '#fff' : '#111'}
                  />
                </View>

                <View style={styles.bgSliderSection}>
                  <View style={styles.bgSliderLabelRow}>
                    <Text style={[styles.bgSliderLabel, isDark ? styles.bgSliderLabelDark : null]}>Opacity</Text>
                    <Text style={[styles.bgSliderValue, isDark ? styles.bgSliderValueDark : null]}>
                      {`${Math.round(bgEffectOpacity * 100)}%`}
                    </Text>
                  </View>
                  <Slider
                    style={styles.bgSlider}
                    minimumValue={0.2}
                    maximumValue={1}
                    step={0.01}
                    value={bgEffectOpacity}
                    onValueChange={(v: number) => setBgEffectOpacity(Math.round(v * 100) / 100)}
                    onSlidingComplete={(v: number) =>
                      setBgEffectOpacity(Math.max(0.2, Math.min(1, Math.round(v * 100) / 100)))
                    }
                    minimumTrackTintColor={isDark ? '#fff' : '#111'}
                    maximumTrackTintColor={isDark ? '#2a2a33' : '#d6d6de'}
                    thumbTintColor={isDark ? '#fff' : '#111'}
                  />
                </View>
              </>
            ) : null}

            <View style={styles.profileActionsRow}>
              <Pressable
                disabled={backgroundSaving}
                style={({ pressed }) => [
                  styles.toolBtn,
                  isDark && styles.toolBtnDark,
                  backgroundSaving ? { opacity: 0.5 } : null,
                  pressed && !backgroundSaving ? { opacity: 0.92 } : null,
                ]}
                onPress={async () => {
                  try {
                    setBackgroundError(null);
                    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
                    if (!perm.granted) {
                      setBackgroundError('Please allow photo library access to choose a background.');
                      return;
                    }
                    const result = await ImagePicker.launchImageLibraryAsync({
                      mediaTypes: ['images'] as any,
                      allowsEditing: true,
                      aspect: [9, 16],
                      quality: 0.9,
                    });
                    if (result.canceled) return;
                    const uri = result.assets?.[0]?.uri;
                    if (!uri) return;
                    setBackgroundDraftImageUri(uri);
                    setBackgroundDraft({ mode: 'image', uri, blur: bgEffectBlur, opacity: bgEffectOpacity });
                  } catch (e: any) {
                    setBackgroundError(e?.message || 'Could not pick image.');
                  }
                }}
                accessibilityRole="button"
              >
                <Text style={[styles.toolBtnText, isDark && styles.toolBtnTextDark]}>Choose image</Text>
              </Pressable>

              <Pressable
                disabled={backgroundSaving || (!backgroundDraftImageUri && backgroundDraft.mode !== 'image')}
                style={({ pressed }) => [
                  styles.toolBtn,
                  isDark && styles.toolBtnDark,
                  (backgroundSaving || (!backgroundDraftImageUri && backgroundDraft.mode !== 'image')) ? { opacity: 0.5 } : null,
                  pressed && !(backgroundSaving || (!backgroundDraftImageUri && backgroundDraft.mode !== 'image')) ? { opacity: 0.92 } : null,
                ]}
                onPress={() => {
                  setBackgroundDraftImageUri(null);
                  setBackgroundDraft({ mode: 'default' });
                }}
                accessibilityRole="button"
              >
                <Text style={[styles.toolBtnText, isDark && styles.toolBtnTextDark]}>Remove image</Text>
              </Pressable>

              <Pressable
                disabled={backgroundSaving}
                style={({ pressed }) => [
                  styles.toolBtn,
                  isDark && styles.toolBtnDark,
                  backgroundSaving ? { opacity: 0.5 } : null,
                  pressed && !backgroundSaving ? { opacity: 0.92 } : null,
                ]}
                onPress={() => {
                  setBackgroundDraftImageUri(null);
                  setBackgroundDraft({ mode: 'default' });
                }}
                accessibilityRole="button"
              >
                <Text style={[styles.toolBtnText, isDark && styles.toolBtnTextDark]}>Default</Text>
              </Pressable>
            </View>

            <View style={[styles.modalButtons, { marginTop: 10 }]}>
              <Pressable
                style={({ pressed }) => [
                  styles.modalButton,
                  styles.modalButtonSmall,
                  isDark ? styles.modalButtonDark : null,
                  pressed ? { opacity: 0.92 } : null,
                ]}
                onPress={async () => {
                  backgroundSavingRef.current = true;
                  setBackgroundSaving(true);
                  setBackgroundError(null);
                  try {
                    let effective: ChatBackgroundState;
                    if (backgroundDraftImageUri) {
                      effective = { mode: 'image', uri: backgroundDraftImageUri, blur: bgEffectBlur, opacity: bgEffectOpacity };
                    } else if (backgroundDraft.mode === 'image') {
                      effective = {
                        ...backgroundDraft,
                        blur: bgEffectBlur,
                        opacity: bgEffectOpacity,
                      };
                    } else {
                      effective = backgroundDraft;
                    }
                    setChatBackground(effective);
                    await AsyncStorage.setItem('ui:chatBackground', JSON.stringify(effective));
                    setBackgroundOpen(false);
                  } catch (e: any) {
                    setBackgroundError(e?.message || 'Failed to save background.');
                  } finally {
                    backgroundSavingRef.current = false;
                    setBackgroundSaving(false);
                  }
                }}
                disabled={backgroundSaving}
              >
                {backgroundSaving ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                    <Text style={[styles.modalButtonText, isDark ? styles.modalButtonTextDark : null]}>Saving</Text>
                    <AnimatedDots color={isDark ? '#fff' : '#111'} size={18} />
                  </View>
                ) : (
                  <Text style={[styles.modalButtonText, isDark ? styles.modalButtonTextDark : null]}>Save</Text>
                )}
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  styles.modalButton,
                  styles.modalButtonSmall,
                  isDark ? styles.modalButtonDark : null,
                  pressed ? { opacity: 0.92 } : null,
                ]}
                onPress={() => {
                  if (backgroundSavingRef.current) return;
                  setBackgroundOpen(false);
                  setBackgroundDraft(chatBackground);
                  setBackgroundDraftImageUri(null);
                  setBackgroundError(null);
                }}
                disabled={backgroundSaving}
              >
                <Text style={[styles.modalButtonText, isDark ? styles.modalButtonTextDark : null]}>Close</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={recoveryOpen} transparent animationType="fade" onRequestClose={() => setRecoveryOpen(false)}>
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setRecoveryOpen(false)} />
          <View style={[styles.profileCard, isDark ? styles.profileCardDark : null]}>
            <View style={styles.chatsTopRow}>
              <Text style={[styles.modalTitle, isDark ? styles.modalTitleDark : null]}>Recovery</Text>
            </View>
            <Text style={[styles.modalHelperText, isDark ? styles.modalHelperTextDark : null]}>
              {recoveryLocked
                ? 'Recovery is locked on this device. Enter your passphrase to decrypt older messages, or reset recovery if you no longer remember it.'
                : !recoveryBlobKnown
                  ? 'Checking whether your account has a recovery backup...'
                  : hasRecoveryBlob
                  ? 'Your account has a recovery backup. You can change your recovery passphrase here.'
                  : 'Set up a recovery passphrase so you can restore encrypted messages if you switch devices'}
            </Text>

            <View style={styles.recoveryActionList}>
              {recoveryLocked ? (
                <Pressable
                  style={({ pressed }) => [
                    styles.modalButton,
                    styles.modalButtonCta,
                    isDark ? styles.modalButtonCtaDark : null,
                    pressed && { opacity: 0.9 },
                  ]}
                  onPress={async () => {
                    setRecoveryOpen(false);
                    await enterRecoveryPassphrase();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Enter recovery passphrase"
                >
                  <Text style={[styles.modalButtonText, styles.modalButtonCtaText]}>Enter Passphrase</Text>
                </Pressable>
              ) : !recoveryBlobKnown ? null : !hasRecoveryBlob ? (
                <Pressable
                  style={({ pressed }) => [
                    styles.modalButton,
                    styles.modalButtonCta,
                    isDark ? styles.modalButtonCtaDark : null,
                    pressed && { opacity: 0.9 },
                  ]}
                  onPress={async () => {
                    setRecoveryOpen(false);
                    await setupRecovery();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Set up recovery passphrase"
                >
                  <Text style={[styles.modalButtonText, styles.modalButtonCtaText]}>Set Up Recovery Passphrase</Text>
                </Pressable>
              ) : (
                <Pressable
                  style={({ pressed }) => [
                    styles.modalButton,
                    isDark ? styles.modalButtonDark : null,
                    pressed && { opacity: 0.9 },
                  ]}
                  onPress={async () => {
                    setRecoveryOpen(false);
                    await changeRecoveryPassphrase();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Change recovery passphrase"
                >
                  <Text style={[styles.modalButtonText, isDark ? styles.modalButtonTextDark : null]}>
                    Change Your Recovery Passphrase
                  </Text>
                </Pressable>
              )}

              <Pressable
                style={({ pressed }) => [
                  styles.modalButton,
                  isDark ? styles.modalButtonDark : null,
                  pressed && { opacity: 0.9 },
                ]}
                onPress={async () => {
                  setRecoveryOpen(false);
                  await resetRecovery();
                }}
                accessibilityRole="button"
                accessibilityLabel="Reset recovery"
              >
                <Text style={[styles.modalButtonText, isDark ? styles.modalButtonTextDark : null]}>
                  Reset Recovery
                </Text>
              </Pressable>
            </View>

            <View style={[styles.modalButtons, { justifyContent: 'flex-end', marginTop: 10 }]}>
              <Pressable
                style={({ pressed }) => [
                  styles.modalButton,
                  styles.modalButtonSmall,
                  isDark ? styles.modalButtonDark : null,
                  pressed ? { opacity: 0.92 } : null,
                ]}
                onPress={() => setRecoveryOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Close recovery"
              >
                <Text style={[styles.modalButtonText, isDark ? styles.modalButtonTextDark : null]}>Close</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={chatsOpen} transparent animationType="fade" onRequestClose={() => setChatsOpen(false)}>
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setChatsOpen(false)} />
          <View style={[styles.chatsCard, isDark ? styles.chatsCardDark : null]}>
            <View style={styles.chatsTopRow}>
              <Text style={[styles.modalTitle, isDark ? styles.modalTitleDark : null]}>Chats</Text>
            </View>
            <ScrollView style={styles.chatsScroll}>
              {chatsLoading ? (
                <View style={styles.chatsLoadingRow}>
                  <Text
                    style={[
                      styles.modalHelperText,
                      isDark ? styles.modalHelperTextDark : null,
                      styles.chatsLoadingText,
                    ]}
                  >
                    Loading
                  </Text>
                  <View style={styles.chatsLoadingDotsWrap}>
                    <AnimatedDots color={isDark ? '#ffffff' : '#111'} size={18} />
                  </View>
                </View>
              ) : chatsList.length ? (
                chatsList.map((t) => (
                  <Pressable
                    key={`chat:${t.conversationId}`}
                    style={({ pressed }) => [
                      styles.chatRow,
                      isDark ? styles.chatRowDark : null,
                      pressed ? { opacity: 0.9 } : null,
                    ]}
                    onPress={() => {
                      setChatsOpen(false);
                      goToConversation(t.conversationId);
                    }}
                  >
                    <View style={styles.chatRowLeft}>
                      <Text style={[styles.chatRowName, isDark ? styles.chatRowNameDark : null]} numberOfLines={1}>
                        {t.peer || 'Direct Message'}
                      </Text>
                      {t.unreadCount > 0 ? <View style={styles.unreadDot} /> : null}
                    </View>
                    <View style={styles.chatRowRight}>
                      {t.unreadCount > 0 ? (
                        <Text style={[styles.chatRowCount, isDark ? styles.chatRowCountDark : null]}>
                          {t.unreadCount}
                        </Text>
                      ) : null}
                      <Pressable
                        onPress={() => void deleteConversationFromList(t.conversationId)}
                        style={({ pressed }) => [
                          styles.chatDeleteBtn,
                          isDark ? styles.chatDeleteBtnDark : null,
                          pressed ? { opacity: 0.85 } : null,
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel="Remove chat"
                      >
                        <Feather name="trash-2" size={16} color={isDark ? '#fff' : '#111'} />
                      </Pressable>
                    </View>
                  </Pressable>
                ))
              ) : (
                <Text style={[styles.modalHelperText, isDark ? styles.modalHelperTextDark : null]}>
                  No active chats
                </Text>
              )}
            </ScrollView>
            <View style={styles.modalButtons}>
              <Pressable
                style={[styles.modalButton, styles.modalButtonSmall, isDark ? styles.modalButtonDark : null]}
                onPress={() => setChatsOpen(false)}
              >
                <Text style={[styles.modalButtonText, isDark ? styles.modalButtonTextDark : null]}>Close</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={blocklistOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setBlocklistOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setBlocklistOpen(false)} />
          <View style={[styles.blocksCard, isDark ? styles.blocksCardDark : null]}>
            <View style={styles.blocksTopRow}>
              <Text style={[styles.modalTitle, isDark ? styles.modalTitleDark : null]}>Blocklist</Text>
            </View>

            <View style={styles.blocksSearchRow}>
              <TextInput
                value={blockUsername}
                onChangeText={(v) => {
                  setBlockUsername(v);
                  setBlockError(null);
                }}
                placeholder="Username to block"
                placeholderTextColor={isDark ? '#8f8fa3' : '#999'}
                selectionColor={isDark ? '#ffffff' : '#111'}
                cursorColor={isDark ? '#ffffff' : '#111'}
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.blocksInput, isDark ? styles.blocksInputDark : null]}
              />
              <Pressable
                onPress={() => void addBlockByUsername()}
                style={({ pressed }) => [
                  styles.blocksBtn,
                  isDark ? styles.blocksBtnDark : null,
                  pressed ? { opacity: 0.9 } : null,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Block user"
              >
                <Text style={[styles.blocksBtnText, isDark ? styles.blocksBtnTextDark : null]}>Block</Text>
              </Pressable>
            </View>

            {blockError ? (
              <Text style={[styles.errorText, isDark ? styles.errorTextDark : null]}>{blockError}</Text>
            ) : null}

            <ScrollView style={styles.blocksScroll}>
              {blocklistLoading ? (
                <View style={styles.chatsLoadingRow}>
                  <Text
                    style={[
                      styles.modalHelperText,
                      isDark ? styles.modalHelperTextDark : null,
                      styles.chatsLoadingText,
                    ]}
                  >
                    Loading
                  </Text>
                  <View style={styles.chatsLoadingDotsWrap}>
                    <AnimatedDots color={isDark ? '#ffffff' : '#111'} size={18} />
                  </View>
                </View>
              ) : blockedUsers.length ? (
                blockedUsers
                  .slice()
                  .sort((a, b) => String(a.blockedDisplayName || a.blockedUsernameLower || '').localeCompare(String(b.blockedDisplayName || b.blockedUsernameLower || '')))
                  .map((b) => (
                    <View key={`blocked:${b.blockedSub}`} style={[styles.blockRow, isDark ? styles.blockRowDark : null]}>
                      <Text style={[styles.blockRowName, isDark ? styles.blockRowNameDark : null]} numberOfLines={1}>
                        {b.blockedDisplayName || b.blockedUsernameLower || b.blockedSub}
                      </Text>
                      <Pressable
                        onPress={() => void unblockUser(b.blockedSub, b.blockedDisplayName || b.blockedUsernameLower)}
                        style={({ pressed }) => [
                          styles.blockActionBtn,
                          isDark ? styles.blockActionBtnDark : null,
                          pressed ? { opacity: 0.85 } : null,
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel="Unblock user"
                      >
                        <Feather name="user-check" size={16} color={isDark ? '#fff' : '#111'} />
                      </Pressable>
                    </View>
                  ))
              ) : (
                <Text style={[styles.modalHelperText, isDark ? styles.modalHelperTextDark : null]}>
                  No blocked users
                </Text>
              )}
            </ScrollView>
            <View style={styles.modalButtons}>
              <Pressable
                style={[styles.modalButton, styles.modalButtonSmall, isDark ? styles.modalButtonDark : null]}
                onPress={() => setBlocklistOpen(false)}
              >
                <Text style={[styles.modalButtonText, isDark ? styles.modalButtonTextDark : null]}>Close</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
        <Modal visible={!!uiPrompt} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View
              style={[
                styles.modalContent,
                isDark ? styles.modalContentDark : null,
              ]}
            >
              <Text style={[styles.modalTitle, isDark ? styles.modalTitleDark : null]}>
                {uiPrompt?.title || ''}
              </Text>
              <Text style={[styles.modalHelperText, isDark ? styles.modalHelperTextDark : null]}>
                {uiPrompt?.message || ''}
              </Text>
              {uiPrompt?.kind === 'choice3' ? (
                <View style={{ alignSelf: 'stretch', gap: 10 }}>
                  <Pressable
                    style={[
                      styles.modalButton,
                      { alignSelf: 'stretch' },
                      uiPrompt?.primaryVariant === 'primary' ? styles.modalButtonPrimary : null,
                      uiPrompt?.primaryVariant === 'danger' ? styles.modalButtonDanger : null,
                      isDark ? styles.modalButtonDark : null,
                      isDark && uiPrompt?.primaryVariant === 'primary' ? styles.modalButtonPrimaryDark : null,
                      isDark && uiPrompt?.primaryVariant === 'danger' ? styles.modalButtonDangerDark : null,
                    ]}
                    onPress={() => {
                      const resolve = uiPrompt?.resolve;
                      setUiPrompt(null);
                      resolve?.('primary');
                    }}
                  >
                    <Text
                      style={[
                        styles.modalButtonText,
                        uiPrompt?.primaryVariant === 'primary' ? styles.modalButtonPrimaryText : null,
                        uiPrompt?.primaryVariant === 'danger' ? styles.modalButtonDangerText : null,
                        isDark ? styles.modalButtonTextDark : null,
                      ]}
                    >
                      {uiPrompt?.primaryText}
                    </Text>
                  </Pressable>

                  <Pressable
                    style={[
                      styles.modalButton,
                      { alignSelf: 'stretch' },
                      uiPrompt?.secondaryVariant === 'primary' ? styles.modalButtonPrimary : null,
                      uiPrompt?.secondaryVariant === 'danger' ? styles.modalButtonDanger : null,
                      isDark ? styles.modalButtonDark : null,
                      isDark && uiPrompt?.secondaryVariant === 'primary' ? styles.modalButtonPrimaryDark : null,
                      isDark && uiPrompt?.secondaryVariant === 'danger' ? styles.modalButtonDangerDark : null,
                    ]}
                    onPress={() => {
                      const resolve = uiPrompt?.resolve;
                      setUiPrompt(null);
                      resolve?.('secondary');
                    }}
                  >
                    <Text
                      style={[
                        styles.modalButtonText,
                        uiPrompt?.secondaryVariant === 'primary' ? styles.modalButtonPrimaryText : null,
                        uiPrompt?.secondaryVariant === 'danger' ? styles.modalButtonDangerText : null,
                        isDark ? styles.modalButtonTextDark : null,
                      ]}
                    >
                      {uiPrompt?.secondaryText}
                    </Text>
                  </Pressable>

                  <Pressable
                    style={[
                      styles.modalButton,
                      { alignSelf: 'stretch' },
                      uiPrompt?.tertiaryVariant === 'primary' ? styles.modalButtonPrimary : null,
                      uiPrompt?.tertiaryVariant === 'danger' ? styles.modalButtonDanger : null,
                      isDark ? styles.modalButtonDark : null,
                      isDark && uiPrompt?.tertiaryVariant === 'primary' ? styles.modalButtonPrimaryDark : null,
                      isDark && uiPrompt?.tertiaryVariant === 'danger' ? styles.modalButtonDangerDark : null,
                    ]}
                    onPress={() => {
                      const resolve = uiPrompt?.resolve;
                      setUiPrompt(null);
                      resolve?.('tertiary');
                    }}
                  >
                    <Text
                      style={[
                        styles.modalButtonText,
                        uiPrompt?.tertiaryVariant === 'primary' ? styles.modalButtonPrimaryText : null,
                        uiPrompt?.tertiaryVariant === 'danger' ? styles.modalButtonDangerText : null,
                        isDark ? styles.modalButtonTextDark : null,
                      ]}
                    >
                      {uiPrompt?.tertiaryText}
                    </Text>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.modalButtons}>
                    <Pressable
                      style={[
                        styles.modalButton,
                        uiPrompt?.kind === 'alert' ? styles.modalButtonPrimary : null,
                        uiPrompt?.destructive ? styles.modalButtonDanger : null,
                        isDark ? styles.modalButtonDark : null,
                        isDark && uiPrompt?.kind === 'alert' ? styles.modalButtonPrimaryDark : null,
                        isDark && uiPrompt?.destructive ? styles.modalButtonDangerDark : null,
                      ]}
                      onPress={() => {
                        const resolve = uiPrompt?.resolve;
                        const kind = uiPrompt?.kind;
                        setUiPrompt(null);
                        resolve?.(kind === 'confirm' ? true : undefined);
                      }}
                    >
                      <Text
                        style={[
                          styles.modalButtonText,
                          uiPrompt?.kind === 'alert' ? styles.modalButtonPrimaryText : null,
                          uiPrompt?.destructive ? styles.modalButtonDangerText : null,
                          isDark ? styles.modalButtonTextDark : null,
                        ]}
                      >
                        {uiPrompt?.confirmText || 'OK'}
                      </Text>
                    </Pressable>
                    {uiPrompt?.kind === 'confirm' ? (
                      <Pressable
                        style={[styles.modalButton, isDark ? styles.modalButtonDark : null]}
                        onPress={() => {
                          const resolve = uiPrompt?.resolve;
                          setUiPrompt(null);
                          resolve?.(false);
                        }}
                      >
                        <Text style={[styles.modalButtonText, isDark ? styles.modalButtonTextDark : null]}>
                          {uiPrompt?.cancelText || 'Cancel'}
                        </Text>
                      </Pressable>
                    ) : null}
                </View>
              )}
            </View>
          </View>
        </Modal>
        <Modal visible={promptVisible} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, isDark ? styles.modalContentDark : null]}>
              <Text style={[styles.modalTitle, isDark ? styles.modalTitleDark : null]}>{promptLabel}</Text>
              {passphrasePrompt?.mode === 'setup' ? (
                <Text style={[styles.modalHelperText, isDark ? styles.modalHelperTextDark : null]}>
                  Make sure you remember your passphrase for future device recovery - we do not
                  store it.
                </Text>
              ) : passphrasePrompt?.mode === 'change' ? (
                <Text style={[styles.modalHelperText, isDark ? styles.modalHelperTextDark : null]}>
                  Choose a new passphrase you’ll remember - we do not store it
                </Text>
              ) : passphrasePrompt?.mode === 'reset' ? (
                <Text style={[styles.modalHelperText, isDark ? styles.modalHelperTextDark : null]}>
                  Set a new recovery passphrase for your account - we do not store it
                </Text>
              ) : null}
              <View style={styles.passphraseFieldWrapper}>
                <TextInput
                  style={[
                    styles.modalInput,
                    styles.passphraseInput,
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
                  placeholder="Passphrase"
                  placeholderTextColor={isDark ? '#8f8fa3' : '#999'}
                  selectionColor={isDark ? '#ffffff' : '#111'}
                  cursorColor={isDark ? '#ffffff' : '#111'}
                  autoFocus
                  editable={!processing}
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
                    style={{
                      width: 18,
                      height: 18,
                      tintColor: isDark ? '#8f8fa3' : '#777',
                    }}
                  />
                </Pressable>
              </View>

              {passphrasePrompt?.mode === 'setup' ||
              passphrasePrompt?.mode === 'change' ||
              passphrasePrompt?.mode === 'reset' ? (
                <View style={styles.passphraseFieldWrapper}>
                  <TextInput
                    style={[
                      styles.modalInput,
                      styles.passphraseInput,
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
                    placeholderTextColor={isDark ? '#8f8fa3' : '#999'}
                    selectionColor={isDark ? '#ffffff' : '#111'}
                    cursorColor={isDark ? '#ffffff' : '#111'}
                    editable={!processing}
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
                      style={{
                        width: 18,
                        height: 18,
                        tintColor: isDark ? '#8f8fa3' : '#777',
                      }}
                    />
                  </Pressable>
                </View>
              ) : null}

              {passphraseError ? (
                <Text style={[styles.passphraseErrorText, isDark ? styles.passphraseErrorTextDark : null]}>
                  {passphraseError}
                </Text>
              ) : null}
              <View style={styles.modalButtons}>
                {/*
                  Disable submit until user enters a passphrase (avoid accidental empty submits).
                  Also avoids showing "Incorrect passphrase" alerts due to empty input.
                */}
                <Pressable
                  style={[
                    styles.modalButton,
                    styles.modalButtonCta,
                    isDark ? styles.modalButtonCtaDark : null,
                    (processing ||
                      !passphraseInput.trim() ||
                      ((passphrasePrompt?.mode === 'setup' ||
                        passphrasePrompt?.mode === 'change' ||
                        passphrasePrompt?.mode === 'reset') &&
                        !passphraseConfirmInput.trim())) && { opacity: 0.45 },
                  ]}
                  onPress={handlePromptSubmit}
                  disabled={
                    processing ||
                    !passphraseInput.trim() ||
                    ((passphrasePrompt?.mode === 'setup' ||
                      passphrasePrompt?.mode === 'change' ||
                      passphrasePrompt?.mode === 'reset') &&
                      !passphraseConfirmInput.trim())
                  }
                  >
                    {processing ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                        <Text style={[styles.modalButtonText, styles.modalButtonCtaText]}>
                          {passphrasePrompt?.mode === 'restore'
                            ? 'Decrypting'
                            : passphrasePrompt?.mode === 'change'
                              ? 'Updating backup'
                              : passphrasePrompt?.mode === 'reset'
                                ? 'Resetting recovery'
                              : 'Encrypting backup'}
                        </Text>
                        <AnimatedDots color="#fff" size={18} />
                      </View>
                    ) : (
                      <Text style={[styles.modalButtonText, styles.modalButtonCtaText]}>
                        Submit
                      </Text>
                    )}
                </Pressable>
                <Pressable
                  style={[styles.modalButton, isDark ? styles.modalButtonDark : null, processing && { opacity: 0.45 }]}
                  onPress={() => void handlePromptCancel()}
                  disabled={processing}
                >
                  <Text style={[styles.modalButtonText, isDark ? styles.modalButtonTextDark : null]}>
                    Cancel
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      <View style={{ flex: 1 }}>
        <ChatScreen
          conversationId={conversationId}
          peer={peer}
          displayName={displayName}
          onNewDmNotification={handleNewDmNotification}
          onKickedFromConversation={(convId) => {
            if (!convId) return;
            if (conversationId !== convId) return;
            setConversationId('global');
            setPeer(null);
          }}
          onConversationTitleChanged={handleConversationTitleChanged}
          headerTop={headerTop}
          theme={theme}
          chatBackground={chatBackground}
          blockedUserSubs={blockedSubs}
          keyEpoch={keyEpoch}
          promptAlert={promptAlert}
          promptConfirm={promptConfirm}
          onBlockUserSub={addBlockBySub}
        />
      </View>
    </View>
  );
};

const AuthModalGate = ({
  onAuthed,
}: {
  onAuthed: () => void;
}): React.JSX.Element => {
  const { user } = useAuthenticator();

  React.useEffect(() => {
    if (user) onAuthed();
  }, [user, onAuthed]);

  // While unauthenticated, the Authenticator will render its own UI.
  // When authenticated, this component renders nothing and the parent closes the modal.
  return <View />;
};

function injectCaretColors(
  fields: Array<any>,
  caret: { selectionColor: string; cursorColor?: string }
): Array<any> {
  return (Array.isArray(fields) ? fields : []).map((f) => ({
    ...f,
    selectionColor: caret.selectionColor,
    cursorColor: caret.cursorColor,
  }));
}

// iOS workaround: multiple secureTextEntry inputs can glitch unless we insert a hidden TextInput
// after each secure input.
const HIDDEN_INPUT_PROPS = {
  accessibilityElementsHidden: true,
  pointerEvents: 'none' as const,
  style: { backgroundColor: 'transparent', height: 0.1, width: 0.1 },
};

const LinkedConfirmResetPasswordFormFields = ({
  isDark,
  caret,
  fieldContainerStyle,
  fieldErrorsContainer,
  fieldErrorStyle,
  fieldStyle,
  fields,
  isPending = false,
  style,
  validationErrors,
}: any & {
  isDark: boolean;
  caret: { selectionColor: string; cursorColor?: string };
}): React.JSX.Element => {
  const [showPassword, setShowPassword] = React.useState(false);

  const formFields = (fields ?? []).map(({ name, type, ...field }: any) => {
    const errors = validationErrors ? getErrors(validationErrors?.[name]) : [];
    const hasError = errors?.length > 0;
    const isPassword = type === 'password';

    const FieldComp =
      isPassword ? TextField : type === 'phone' ? PhoneNumberField : TextField;

    const endAccessory = isPassword ? (
      <IconButton
        accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
        disabled={isPending}
        // If `color` is undefined, Amplify's Icon uses `tintColor: undefined`,
        // which can make the PNG invisible on dark backgrounds.
        color={isDark ? '#d7d7e0' : '#666'}
        size={18}
        source={showPassword ? icons.visibilityOn : icons.visibilityOff}
        onPress={() => setShowPassword((v) => !v)}
      />
    ) : undefined;

    return (
      <React.Fragment key={name}>
        <FieldComp
          {...field}
          disabled={isPending}
          error={hasError}
          fieldStyle={fieldStyle}
          style={fieldContainerStyle}
          selectionColor={caret.selectionColor}
          cursorColor={caret.cursorColor}
          secureTextEntry={isPassword ? !showPassword : undefined}
          endAccessory={endAccessory}
        />
        {Platform.OS === 'ios' && isPassword ? <TextInput {...HIDDEN_INPUT_PROPS} /> : null}
        {errors?.length ? (
          <View style={fieldErrorsContainer}>
            {errors.map((e: string) => (
              <Text key={`${name}:${e}`} style={fieldErrorStyle}>
                {e}
              </Text>
            ))}
          </View>
        ) : null}
      </React.Fragment>
    );
  });

  return <View style={style}>{formFields}</View>;
};

const LinkedSignUpFormFields = ({
  isDark,
  caret,
  fieldContainerStyle,
  fieldErrorsContainer,
  fieldErrorStyle,
  fieldStyle,
  fields,
  isPending = false,
  style,
  validationErrors,
}: any & {
  isDark: boolean;
  caret: { selectionColor: string; cursorColor?: string };
}): React.JSX.Element => {
  const [showPassword, setShowPassword] = React.useState(false);
  const MAX_USERNAME_LEN = 21;

  const formFields = (fields ?? []).map(({ name, type, ...field }: any) => {
    const errors = validationErrors ? getErrors(validationErrors?.[name]) : [];
    const hasError = errors?.length > 0;
    const isPassword = type === 'password';

    const FieldComp = type === 'phone' ? PhoneNumberField : TextField;

    const endAccessory = isPassword ? (
      <IconButton
        accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
        disabled={isPending}
        color={isDark ? '#d7d7e0' : '#666'}
        size={18}
        source={showPassword ? icons.visibilityOn : icons.visibilityOff}
        onPress={() => setShowPassword((v) => !v)}
      />
    ) : undefined;

    return (
      <React.Fragment key={name}>
        <FieldComp
          {...field}
          {...(name === 'preferred_username'
            ? {
                // Prevent ultra-long usernames; backend enforces too.
                maxLength: MAX_USERNAME_LEN,
              }
            : null)}
          disabled={isPending}
          error={hasError}
          fieldStyle={fieldStyle}
          style={fieldContainerStyle}
          selectionColor={caret.selectionColor}
          cursorColor={caret.cursorColor}
          secureTextEntry={isPassword ? !showPassword : undefined}
          endAccessory={endAccessory}
        />
        {Platform.OS === 'ios' && isPassword ? <TextInput {...HIDDEN_INPUT_PROPS} /> : null}
        {errors?.length ? (
          <View style={fieldErrorsContainer}>
            {errors.map((e: string) => (
              <Text key={`${name}:${e}`} style={fieldErrorStyle}>
                {e}
              </Text>
            ))}
          </View>
        ) : null}
      </React.Fragment>
    );
  });

  return <View style={style}>{formFields}</View>;
};

const LinkedSignInFormFields = ({
  isDark,
  caret,
  fieldContainerStyle,
  fieldErrorsContainer,
  fieldErrorStyle,
  fieldStyle,
  fields,
  isPending = false,
  style,
  validationErrors,
}: any & {
  isDark: boolean;
  caret: { selectionColor: string; cursorColor?: string };
}): React.JSX.Element => {
  const [showPassword, setShowPassword] = React.useState(false);

  const formFields = (fields ?? []).map(({ name, type, ...field }: any) => {
    const errors = validationErrors ? getErrors(validationErrors?.[name]) : [];
    const hasError = errors?.length > 0;
    const isPassword = type === 'password';

    const FieldComp = type === 'phone' ? PhoneNumberField : TextField;

    const endAccessory = isPassword ? (
      <IconButton
        accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
        disabled={isPending}
        color={isDark ? '#d7d7e0' : '#666'}
        size={18}
        // Reflect current state: "eye open" means visible.
        source={showPassword ? icons.visibilityOn : icons.visibilityOff}
        onPress={() => setShowPassword((v) => !v)}
      />
    ) : undefined;

    return (
      <React.Fragment key={name}>
        <FieldComp
          {...field}
          disabled={isPending}
          error={hasError}
          fieldStyle={fieldStyle}
          style={fieldContainerStyle}
          selectionColor={caret.selectionColor}
          cursorColor={caret.cursorColor}
          secureTextEntry={isPassword ? !showPassword : undefined}
          endAccessory={endAccessory}
        />
        {Platform.OS === 'ios' && isPassword ? <TextInput {...HIDDEN_INPUT_PROPS} /> : null}
        {errors?.length ? (
          <View style={fieldErrorsContainer}>
            {errors.map((e: string) => (
              <Text key={`${name}:${e}`} style={fieldErrorStyle}>
                {e}
              </Text>
            ))}
          </View>
        ) : null}
      </React.Fragment>
    );
  });

  return <View style={style}>{formFields}</View>;
};

const CustomSignUp = ({
  fields,
  handleBlur,
  handleChange,
  handleSubmit,
  hasValidationErrors,
  hideSignIn,
  isPending,
  socialProviders,
  toFederatedSignIn,
  toSignIn,
  validationErrors,
  Footer,
  Header,
  FormFields,
  ...rest
}: any): React.JSX.Element => {
  const {
    getCreateAccountText,
    getCreatingAccountText,
    getBackToSignInText,
    getSignUpTabText,
  } = authenticatorTextUtil;

  // NOTE:
  // We intentionally avoid importing Amplify UI's internal `useFieldValues` from `@aws-amplify/ui-react-native/src/*`
  // because it pulls TypeScript source files from node_modules into our `tsc` build (causing typecheck failures).
  // For our usage, Authenticator already provides correctly-wired `fields` + `handleSubmit`.
  const disableFormSubmit = false;
  const fieldsWithHandlers = fields;
  const fieldValidationErrors = validationErrors;
  const handleFormSubmit = handleSubmit;

  const disabled = hasValidationErrors || disableFormSubmit;
  const headerText = getSignUpTabText();
  const primaryButtonText = isPending ? getCreatingAccountText() : getCreateAccountText();
  const secondaryButtonText = getBackToSignInText();

  const body = socialProviders ? (
    <FederatedProviderButtons
      route="signUp"
      socialProviders={socialProviders}
      toFederatedSignIn={toFederatedSignIn}
    />
  ) : null;

  const buttons = React.useMemo(
    () => ({
      primary: {
        children: primaryButtonText,
        disabled,
        onPress: handleFormSubmit,
      },
      links: hideSignIn ? undefined : [{ children: secondaryButtonText, onPress: toSignIn }],
    }),
    [disabled, handleFormSubmit, hideSignIn, primaryButtonText, secondaryButtonText, toSignIn]
  );

  return (
    <DefaultContent
      body={body}
      buttons={buttons}
      error={rest?.error}
      fields={fieldsWithHandlers}
      Footer={Footer}
      FormFields={FormFields}
      Header={Header}
      headerText={headerText}
      isPending={isPending}
      validationErrors={fieldValidationErrors}
    />
  );
};

const ConfirmResetPasswordWithBackToSignIn = ({
  isDark,
  ...props
}: any & { isDark: boolean }): React.JSX.Element => {
  const { toSignIn } = useAuthenticator();
  return (
    <View>
      <Authenticator.ConfirmResetPassword {...props} />
      <AmplifyButton
        onPress={() => toSignIn()}
        variant="link"
        style={styles.authBackLinkBtn}
        accessibilityLabel="Back to Sign In"
      >
        Back to Sign In
      </AmplifyButton>
    </View>
  );
};

export default function App(): React.JSX.Element {
  const [booting, setBooting] = React.useState<boolean>(true);
  const [rootMode, setRootMode] = React.useState<'guest' | 'app'>('guest');
  const [authModalOpen, setAuthModalOpen] = React.useState<boolean>(false);
  const [uiTheme, setUiTheme] = React.useState<'light' | 'dark'>('light');
  const [themeReady, setThemeReady] = React.useState<boolean>(false);
  const [rootLayoutDone, setRootLayoutDone] = React.useState<boolean>(false);
  const isDark = uiTheme === 'dark';
  const appReady = !booting && themeReady;

  // Keep the app portrait by default, but allow camera UI to temporarily unlock orientation.
  React.useEffect(() => {
    (async () => {
      try {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      } catch {
        // ignore
      }
    })();
  }, []);

  // (Removed) We previously tried setting global TextInput defaultProps for caret color,
  // but on Android it can be ignored/overridden. We now inject caret colors directly into
  // Amplify Authenticator fields via `components` overrides.

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const sess = await fetchAuthSession().catch(() => ({ tokens: undefined }));
        const hasToken = !!sess?.tokens?.idToken?.toString();
        if (mounted) setRootMode(hasToken ? 'app' : 'guest');
      } finally {
        if (mounted) setBooting(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Read the stored theme so the auth modal matches the rest of the app.
  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem('ui:theme');
        if (!mounted) return;
        if (stored === 'dark' || stored === 'light') setUiTheme(stored);
      } catch {
        // ignore
      } finally {
        if (mounted) setThemeReady(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Hide the native splash once we’re ready and the root view has laid out.
  React.useEffect(() => {
    if (!appReady || !rootLayoutDone) return;
    (async () => {
      try {
        await SplashScreen.hideAsync();
      } catch {
        // ignore
      }
    })();
  }, [appReady, rootLayoutDone]);

  // Re-read theme when opening the auth modal in case the user toggled it on the guest screen.
  React.useEffect(() => {
    if (!authModalOpen) return;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem('ui:theme');
        if (stored === 'dark' || stored === 'light') setUiTheme(stored);
      } catch {
        // ignore
      }
    })();
  }, [authModalOpen]);

  const amplifyTheme = React.useMemo(
    () => ({
      // Light defaults (match app)
      tokens: {
        colors: {
          background: {
            primary: '#ffffff',
            secondary: '#f2f2f7',
            tertiary: '#ffffff',
          },
          border: {
            primary: '#e3e3e3',
            secondary: '#ddd',
          },
          font: {
            primary: '#111',
            secondary: '#444',
            tertiary: '#666',
            interactive: '#111',
            error: '#b00020',
          },
          // Kill the teal/blue brand colors for this app; keep it neutral.
          primary: {
            10: '#f2f2f7',
            20: '#e3e3e3',
            40: '#c7c7cc',
            60: '#8e8e93',
            80: '#2a2a33',
            90: '#111',
            100: '#000',
          },
        },
      },
      // Dark mode override tokens to ensure the authenticator background never goes "bluish".
      overrides: [
        {
          colorMode: 'dark' as const,
          tokens: {
            colors: {
              background: {
                primary: '#14141a',
                secondary: '#1c1c22',
                tertiary: '#14141a',
                // Used by the `ErrorMessage` primitive container.
                error: '#2a1a1a',
              },
              border: {
                primary: '#2a2a33',
                secondary: '#2a2a33',
              },
              font: {
                primary: '#ffffff',
                secondary: '#d7d7e0',
                tertiary: '#a7a7b4',
                interactive: '#ffffff',
                // Validation errors ("Please enter a valid email", etc).
                // This is the main fix for readability on dark backgrounds.
                error: '#ff6b6b',
              },
              primary: {
                10: '#2a2a33',
                20: '#2a2a33',
                40: '#444',
                60: '#666',
                80: '#d7d7e0',
                90: '#ffffff',
                100: '#ffffff',
              },
            },
          },
        },
      ],
      components: {
        button: () => ({
          container: {
            borderRadius: 12,
            // Avoid text clipping on Android devices (varies with font scale / OEM fonts).
            minHeight: 44,
            paddingVertical: 12,
            paddingHorizontal: 12,
            alignItems: 'center' as const,
            justifyContent: 'center' as const,
          },
          containerPrimary: {
            backgroundColor: isDark ? '#2a2a33' : '#111',
            borderWidth: 0,
          },
          containerDefault: {
            // Use a soft off-white fill in light mode (matches our text field backgrounds).
            backgroundColor: isDark ? '#1c1c22' : '#f2f2f7',
            borderWidth: 1,
            borderColor: isDark ? '#2a2a33' : '#e3e3e3',
          },
          pressed: { opacity: 0.9 },
          // Give descenders (e.g. "g") enough vertical room across devices.
          text: { fontWeight: '800' as const, fontSize: 15, lineHeight: 20 },
          textPrimary: { color: '#fff' },
          textDefault: { color: isDark ? '#fff' : '#111' },
          containerLink: { backgroundColor: 'transparent' },
          textLink: {
            color: isDark ? '#fff' : '#111',
            fontWeight: '800' as const,
            fontSize: 15,
            lineHeight: 20,
          },
        }),
        textField: () => ({
          label: { color: isDark ? '#d7d7e0' : '#444', fontWeight: '700' as const },
          fieldContainer: {
            borderRadius: 12,
            borderWidth: 1,
            borderColor: isDark ? '#2a2a33' : '#e3e3e3',
            // Off-gray fill in light mode (avoid stark white inputs).
            backgroundColor: isDark ? '#1c1c22' : '#f2f2f7',
            paddingHorizontal: 8,
          },
          field: {
            color: isDark ? '#fff' : '#111',
            paddingVertical: 12,
          },
        }),
        errorMessage: () => ({
          label: {
            // Higher-contrast error color for dark backgrounds.
            color: isDark ? '#ff6b6b' : '#b00020',
            fontWeight: '700' as const,
          },
        }),
      },
    }),
    [isDark]
  );

  const caretProps = React.useMemo(
    () => ({
      selectionColor: isDark ? '#ffffff' : '#111',
      cursorColor: isDark ? '#ffffff' : '#111',
    }),
    [isDark]
  );

  const confirmResetFormFields = React.useCallback(
    (ffProps: any) => (
      <LinkedConfirmResetPasswordFormFields {...ffProps} isDark={isDark} caret={caretProps} />
    ),
    [isDark, caretProps]
  );

  const signInFormFields = React.useCallback(
    (ffProps: any) => <LinkedSignInFormFields {...ffProps} isDark={isDark} caret={caretProps} />,
    [isDark, caretProps]
  );

  const signUpFormFields = React.useCallback(
    (ffProps: any) => <LinkedSignUpFormFields {...ffProps} isDark={isDark} caret={caretProps} />,
    [isDark, caretProps]
  );

  const authComponents = React.useMemo(
    () => ({
      SignIn: (props: any) => (
        <Authenticator.SignIn
          {...props}
          fields={injectCaretColors(props?.fields, caretProps)}
          FormFields={signInFormFields}
        />
      ),
      SignUp: (props: any) => (
        <CustomSignUp
          {...props}
          fields={injectCaretColors(props?.fields, caretProps)}
          FormFields={signUpFormFields}
        />
      ),
      ForgotPassword: (props: any) => (
        <Authenticator.ForgotPassword
          {...props}
          fields={injectCaretColors(props?.fields, caretProps)}
        />
      ),
      ConfirmResetPassword: (props: any) => (
        <ConfirmResetPasswordWithBackToSignIn
          {...props}
          isDark={isDark}
          fields={injectCaretColors(props?.fields, caretProps)}
          FormFields={confirmResetFormFields}
        />
      ),
      ConfirmSignUp: (props: any) => (
        <Authenticator.ConfirmSignUp
          {...props}
          fields={injectCaretColors(props?.fields, caretProps)}
        />
      ),
      ConfirmSignIn: (props: any) => (
        <Authenticator.ConfirmSignIn
          {...props}
          fields={injectCaretColors(props?.fields, caretProps)}
        />
      ),
    }),
    [caretProps, confirmResetFormFields, signInFormFields, signUpFormFields, isDark]
  );

  return (
    <SafeAreaProvider>
      {/* Apply TOP safe-area globally. Screens manage left/right/bottom insets themselves (chat input / CTAs). */}
      <SafeAreaView
        style={[styles.container, styles.appSafe, isDark && styles.appSafeDark]}
        edges={['top']}
        onLayout={() => setRootLayoutDone(true)}
      >
        <Authenticator.Provider>
          {booting ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator />
            </View>
          ) : rootMode === 'guest' ? (
            <>
              <GuestGlobalScreen onSignIn={() => setAuthModalOpen(true)} />

              <Modal
                visible={authModalOpen}
                transparent
                animationType="fade"
                onRequestClose={() => setAuthModalOpen(false)}
              >
                <View style={styles.authModalOverlay}>
                  <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                    style={styles.authModalOverlayInner}
                  >
                    <View style={[styles.authModalSheet, isDark && styles.authModalSheetDark]}>
                      <View style={[styles.authModalTopRow, isDark && styles.authModalTopRowDark]}>
                        <View style={{ width: 44 }} />
                        <Text style={[styles.authModalTitle, isDark && styles.authModalTitleDark]}>
                          Sign in
                        </Text>
                        <Pressable
                          onPress={() => setAuthModalOpen(false)}
                          style={({ pressed }) => [
                            styles.authModalCloseCircle,
                            isDark && styles.authModalCloseCircleDark,
                            pressed && { opacity: 0.85 },
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel="Close sign in"
                        >
                          <Text style={[styles.authModalCloseX, isDark && styles.authModalCloseXDark]}>
                            ×
                          </Text>
                        </Pressable>
                      </View>

                      <ThemeProvider theme={amplifyTheme} colorMode={isDark ? 'dark' : 'light'}>
                        <ScrollView
                          style={styles.authModalBody}
                          contentContainerStyle={styles.authModalBodyContent}
                          keyboardShouldPersistTaps="handled"
                        >
                          <Authenticator
                            loginMechanisms={['email']}
                            signUpAttributes={['preferred_username']}
                            components={authComponents}
                          >
                            <AuthModalGate
                              onAuthed={() => {
                                setAuthModalOpen(false);
                                setRootMode('app');
                              }}
                            />
                          </Authenticator>
                        </ScrollView>
                      </ThemeProvider>
                    </View>
                  </KeyboardAvoidingView>
                </View>
              </Modal>
            </>
          ) : (
            <ThemeProvider theme={amplifyTheme} colorMode={isDark ? 'dark' : 'light'}>
              <Authenticator
                loginMechanisms={['email']}
                signUpAttributes={['preferred_username']}
                components={authComponents}
              >
                <MainAppContent onSignedOut={() => setRootMode('guest')} />
              </Authenticator>
            </ThemeProvider>
          )}
        </Authenticator.Provider>

        <StatusBar style="auto" />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'stretch',
    justifyContent: 'flex-start',
  },
  appSafe: {
    backgroundColor: '#fff',
  },
  appSafeDark: {
    backgroundColor: '#0b0b0f',
  },
  authModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    padding: 12,
    justifyContent: 'center',
  },
  authModalOverlayInner: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  authModalSheet: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    // Keep it feeling like a popup, not a full screen.
    // ScrollView inside will handle overflow on small screens.
    maxHeight: 640,
    minHeight: 360,
    borderRadius: 16,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  authModalSheetDark: {
    backgroundColor: '#14141a',
  },
  authModalTopRow: {
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  authModalTopRowDark: {
    backgroundColor: '#14141a',
  },
  authModalBody: {
    paddingHorizontal: 12,
  },
  authModalBodyContent: {
    paddingBottom: 18,
  },
  authModalCloseCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f2f2f7',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e3e3e3',
  },
  authModalCloseCircleDark: {
    backgroundColor: '#1c1c22',
    borderColor: '#2a2a33',
  },
  authModalCloseX: {
    fontSize: 22,
    lineHeight: 22,
    fontWeight: '900',
    color: '#111',
    marginTop: -1,
  },
  authModalCloseXDark: {
    color: '#fff',
  },
  authModalTitle: {
    fontWeight: '900',
    fontSize: 16,
    color: '#111',
  },
  authModalTitleDark: {
    color: '#fff',
  },
  authBackLinkBtn: {
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 4,
    marginTop: 6,
  },
  authBackLinkText: {
    fontWeight: '800',
    color: '#111',
    textDecorationLine: 'none',
  },
  authBackLinkTextDark: {
    color: '#fff',
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  rightControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  themeToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e3e3e3',
  },
  themeToggleDark: {
    backgroundColor: '#14141a',
    borderColor: '#2a2a33',
  },
  menuIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e3e3e3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuIconBtnDark: {
    backgroundColor: '#14141a',
    borderColor: '#2a2a33',
  },
  segment: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f2f2f7',
    padding: 3,
    borderRadius: 12,
    gap: 4,
  },
  segmentDark: {
    backgroundColor: '#1c1c22',
  },
  segmentBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    minWidth: 84,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentBtnActive: {
    backgroundColor: '#fff',
  },
  segmentBtnActiveDark: {
    backgroundColor: '#2a2a33',
  },
  segmentBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#666',
  },
  segmentBtnTextDark: {
    color: '#b7b7c2',
  },
  segmentBtnTextActive: {
    color: '#111',
  },
  segmentBtnTextActiveDark: {
    color: '#fff',
  },
  dmPillInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#1976d2',
  },
  signOutPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e3e3e3',
  },
  signOutPillDark: {
    backgroundColor: '#14141a',
    borderColor: '#2a2a33',
  },
  signOutPillText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111',
  },
  signOutPillTextDark: {
    color: '#fff',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 0,
    gap: 8,
    zIndex: 1,
  },
  searchWrapper: {
    marginTop: 6,
    marginBottom: 0,
  },
  searchInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 10,
    paddingHorizontal: 10,
    // Keep compact, but make sure text/placeholder are vertically centered (esp. Android).
    height: 36,
    paddingVertical: 0,
    textAlignVertical: 'center',
    // Light mode: make the entry field white.
    backgroundColor: '#fff',
    color: '#111',
    fontSize: 13,
    lineHeight: 16,
  },
  searchInputDark: {
    backgroundColor: '#14141a',
    borderColor: '#2a2a33',
    color: '#fff',
  },
  startDmBtn: {
    minHeight: 36,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
  },
  startDmBtnDark: {
    backgroundColor: '#2a2a33',
    borderColor: '#2a2a33',
  },
  startDmBtnText: {
    color: '#111',
    fontWeight: '700',
    fontSize: 13,
    lineHeight: 16,
  },
  startDmBtnTextDark: {
    color: '#fff',
  },
  cancelBtn: {
    minHeight: 36,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
    backgroundColor: '#fff',
  },
  cancelBtnDark: {
    backgroundColor: '#2a2a33',
    borderColor: '#2a2a33',
  },
  cancelBtnText: {
    color: '#111',
    fontWeight: '700',
    fontSize: 13,
    lineHeight: 16,
  },
  cancelBtnTextDark: {
    color: '#fff',
  },
  unreadList: {
    paddingHorizontal: 4,
    paddingTop: 4,
  },
  unreadHintWrapper: {
    paddingVertical: 0,
  },
  unreadHint: {
    color: '#555',
    fontSize: 13,
    marginTop: 0,
    paddingHorizontal: 4,
  },
  unreadHintDark: {
    color: '#b7b7c2',
  },
  unreadHintBold: {
    fontWeight: '700',
    // Keep unread sender highlight neutral in light mode (avoid bright blue).
    color: '#111',
  },
  unreadHintBoldDark: {
    color: '#fff',
  },
  errorText: {
    color: '#b00020',
    marginBottom: 8,
  },
  errorTextDark: {
    color: '#ff6b6b',
  },
  appContent: {
    flex: 1,
    alignSelf: 'stretch',
    position: 'relative',
  },
  appContentDark: {
    backgroundColor: '#0b0b0f',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '80%',
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 12,
    elevation: 6,
    position: 'relative',
  },
  modalContentDark: {
    backgroundColor: '#1c1c22',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  modalTitleDark: {
    color: '#fff',
  },
  modalHelperText: {
    color: '#555',
    marginBottom: 12,
    lineHeight: 18,
  },
  modalHelperTextDark: {
    color: '#b7b7c2',
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 12,
  },
  passphraseFieldWrapper: {
    position: 'relative',
    width: '100%',
    marginBottom: 12,
  },
  passphraseInput: {
    paddingRight: 40, // room for the eye icon (match sign-in tighter inset)
    marginBottom: 0,
  },
  passphraseEyeBtn: {
    position: 'absolute',
    right: 8,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    width: 32,
  },
  passphraseErrorText: {
    color: '#b00020',
    marginTop: -4,
    marginBottom: 12,
    fontWeight: '700',
  },
  passphraseErrorTextDark: {
    color: '#ff6b6b',
  },
  modalInputLight: {
    color: '#111',
    backgroundColor: '#fff',
  },
  modalInputDark: {
    borderColor: '#2a2a33',
    backgroundColor: '#14141a',
    color: '#fff',
  },
  modalInputDisabled: {
    backgroundColor: '#f5f5f5',
    color: '#999',
  },
  modalInputDisabledDark: {
    backgroundColor: '#14141a',
    color: '#8f8fa3',
    opacity: 0.7,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  modalButton: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    // Light mode: neutral buttons should be off-gray (modal backgrounds are white).
    backgroundColor: '#f2f2f7',
    borderWidth: 1,
    // Neutral "tool button" style (avoid blue default buttons in light mode).
    borderColor: '#e3e3e3',
  },
  modalButtonSmall: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  modalButtonDark: {
    backgroundColor: '#2a2a33',
    borderColor: 'transparent',
    borderWidth: 0,
  },
  // Primary button for generic in-app alerts/confirmations (avoid bright blue; match app theme).
  modalButtonPrimary: {
    backgroundColor: '#111',
    borderColor: 'transparent',
  },
  modalButtonPrimaryDark: {
    backgroundColor: '#2a2a33',
    borderColor: 'transparent',
  },
  // CTA button for our in-app prompts (avoid bright blue in light mode).
  modalButtonCta: {
    backgroundColor: '#111',
    borderColor: 'transparent',
  },
  modalButtonCtaDark: {
    backgroundColor: '#2a2a33',
    borderColor: 'transparent',
  },
  modalButtonDanger: {
    backgroundColor: '#b00020',
    borderColor: 'transparent',
  },
  modalButtonDangerDark: {
    backgroundColor: '#ff6b6b',
    borderColor: 'transparent',
  },
  modalButtonText: {
    color: '#111',
    fontWeight: '800',
    textAlign: 'center',
  },
  modalButtonTextDark: {
    color: '#fff',
  },
  modalButtonPrimaryText: {
    color: '#fff',
  },
  modalButtonCtaText: {
    color: '#fff',
  },
  recoveryActionList: {
    marginTop: 12,
    gap: 10,
    alignSelf: 'stretch',
  },
  modalButtonDangerText: {
    color: '#fff',
  },
  chatsCard: {
    width: '92%',
    maxWidth: 520,
    // Modals should be white in light mode.
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e3e3e3',
    maxHeight: '70%',
  },
  chatsCardDark: {
    backgroundColor: '#14141a',
    borderColor: '#2a2a33',
  },
  profileCard: {
    width: '92%',
    maxWidth: 520,
    // Modals should be white in light mode.
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e3e3e3',
    maxHeight: '70%',
  },
  profileCardDark: { backgroundColor: '#14141a', borderColor: '#2a2a33' },
  profilePreviewRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 },
  profilePreviewMeta: { flex: 1 },
  bgPreviewBox: {
    width: 72,
    height: 54,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  bgPreviewImage: { width: '100%', height: '100%' },
  profileSectionTitle: { marginTop: 10, marginBottom: 6, fontWeight: '900' },
  avatarPaletteRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  avatarColorDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.25)',
  },
  avatarColorDotSelected: { borderWidth: 2, borderColor: '#111', transform: [{ scale: 1.05 }] },
  avatarColorDotSelectedDark: { borderWidth: 2, borderColor: '#fff', transform: [{ scale: 1.05 }] },
  avatarTextColorRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatarTextColorBtn: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#f2f2f7',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e3e3e3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarTextColorBtnDark: { backgroundColor: '#1c1c22', borderColor: '#2a2a33' },
  avatarTextColorBtnSelected: { borderWidth: 2, borderColor: '#111' },
  avatarTextColorBtnSelectedDark: { borderWidth: 2, borderColor: '#fff' },
  avatarTextColorLabel: { fontWeight: '800', color: '#111' },
  avatarTextColorLabelDark: { color: '#fff' },
  profileActionsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  toolBtn: {
    flex: 1,
    height: 40,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#f2f2f7',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e3e3e3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolBtnDark: { backgroundColor: '#1c1c22', borderColor: '#2a2a33' },
  toolBtnText: { fontWeight: '800', color: '#111' },
  toolBtnTextDark: { color: '#fff' },
  bgEffectsHeaderRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginTop: 10 },
  bgEffectsResetBtn: { paddingHorizontal: 6, paddingVertical: 4 },
  bgEffectsResetText: { fontWeight: '900', color: '#111', opacity: 0.7 },
  bgEffectsResetTextDark: { fontWeight: '900', color: '#fff', opacity: 0.75 },
  // Keep sliders comfortably narrow (about ~2/3 modal width).
  bgSliderSection: { marginTop: 10, alignSelf: 'center', width: '64%', maxWidth: 320 },
  bgSliderLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 4 },
  bgSliderLabel: { fontWeight: '900', color: '#111' },
  bgSliderLabelDark: { color: '#fff' },
  bgSliderValue: { fontWeight: '900', color: '#111', opacity: 0.75 },
  bgSliderValueDark: { color: '#fff', opacity: 0.8 },
  bgSlider: { width: '100%', height: 34, marginLeft: 4, marginRight: 4 },
  chatsTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  chatsCloseBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#f2f2f7',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e3e3e3',
  },
  chatsCloseBtnDark: { backgroundColor: '#2a2a33', borderWidth: 0, borderColor: 'transparent' },
  chatsCloseText: { color: '#111', fontWeight: '800' },
  chatsCloseTextDark: { color: '#fff' },
  chatsScroll: { maxHeight: 420, marginTop: 8 },
  chatsLoadingRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4, paddingVertical: 6, paddingHorizontal: 2 },
  chatsLoadingText: { lineHeight: 18 },
  chatsLoadingDotsWrap: { marginBottom: 1 },
  chatRow: {
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: '#f2f2f7',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e3e3e3',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  chatRowDark: { backgroundColor: '#1c1c22', borderColor: '#2a2a33' },
  chatRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  chatRowRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  chatRowName: { fontWeight: '800', color: '#111', flexShrink: 1 },
  chatRowNameDark: { color: '#fff' },
  chatRowCount: { fontWeight: '900', color: '#1976d2' },
  chatRowCountDark: { color: '#fff' },
  chatDeleteBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: '#f2f2f7',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e3e3e3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatDeleteBtnDark: { backgroundColor: '#2a2a33', borderWidth: 0, borderColor: 'transparent' },

  blocksCard: {
    width: '92%',
    maxWidth: 520,
    // Modals should be white in light mode.
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e3e3e3',
    maxHeight: '70%',
  },
  blocksCardDark: { backgroundColor: '#14141a', borderColor: '#2a2a33' },
  blocksTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  blocksSearchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 10 },
  blocksInput: {
    flex: 1,
    height: 40,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e3e3e3',
    backgroundColor: '#f2f2f7',
    paddingHorizontal: 12,
    color: '#111',
  },
  blocksInputDark: { backgroundColor: '#1c1c22', borderColor: '#2a2a33', color: '#fff' },
  blocksBtn: {
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: '#f2f2f7',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e3e3e3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  blocksBtnDark: { backgroundColor: '#2a2a33', borderColor: 'transparent' },
  blocksBtnText: { color: '#111', fontWeight: '800' },
  blocksBtnTextDark: { color: '#fff' },
  blocksScroll: { maxHeight: 420, marginTop: 2 },
  blockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: '#f2f2f7',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e3e3e3',
    marginBottom: 8,
  },
  blockRowDark: { backgroundColor: '#1c1c22', borderColor: '#2a2a33' },
  blockRowName: { fontWeight: '800', color: '#111', flexShrink: 1 },
  blockRowNameDark: { color: '#fff' },
  blockActionBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: '#f2f2f7',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e3e3e3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  blockActionBtnDark: { backgroundColor: '#2a2a33', borderWidth: 0, borderColor: 'transparent' },
});
