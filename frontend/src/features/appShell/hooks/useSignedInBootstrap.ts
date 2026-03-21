import AsyncStorage from '@react-native-async-storage/async-storage';
import * as React from 'react';
import { Platform } from 'react-native';

import type { AmplifyUiUser } from '../../../types/amplifyUi';
import type { BackupBlob } from '../../../types/crypto';
import { deferForModalTransition } from '../../../utils/deferForModalTransition';

type KeyPair = { privateKey: string; publicKey: string } | null;

export function useSignedInBootstrap({
  user,
  apiUrl,

  // Auth + user profile
  fetchAuthSession,
  fetchUserAttributes,
  getUsernameFromAuthenticatorUser,

  // Notification policy + UI state resets
  setForegroundNotificationPolicy,
  setHasRecoveryBlob,
  setRecoveryBlobKnown,
  setRecoveryLocked,
  setProcessing,

  // Identity + display
  setMyUserSub,
  setDisplayName,

  // Crypto + recovery helpers (passed in to avoid changing behavior)
  loadKeyPair,
  storeKeyPair,
  derivePublicKey,
  decryptPrivateKey,
  generateKeypair,
  uploadPublicKey,
  uploadRecoveryBlob,
  checkRecoveryBlobExists,
  applyRecoveryBlobExists,
  getIdTokenWithRetry,
  promptPassphrase,
  closePrompt,
  bumpKeyEpoch,

  // Ui prompts
  promptAlert,
}: {
  user: AmplifyUiUser;
  apiUrl: string;

  fetchAuthSession: () => Promise<{ tokens?: { idToken?: { toString: () => string } } }>;
  fetchUserAttributes: () => Promise<Record<string, unknown>>;
  getUsernameFromAuthenticatorUser: (u: AmplifyUiUser) => string | undefined;

  setForegroundNotificationPolicy: () => Promise<void>;
  setHasRecoveryBlob: (v: boolean) => void;
  setRecoveryBlobKnown: (v: boolean) => void;
  setRecoveryLocked: (v: boolean) => void;
  setProcessing: (v: boolean) => void;

  setMyUserSub: (v: string) => void;
  setDisplayName: (v: string) => void;

  loadKeyPair: (userSub: string) => Promise<KeyPair>;
  storeKeyPair: (
    userSub: string,
    keyPair: { privateKey: string; publicKey: string },
  ) => Promise<void>;
  derivePublicKey: (privateKeyHex: string) => string;
  decryptPrivateKey: (blob: BackupBlob, passphrase: string) => Promise<string>;
  generateKeypair: () => Promise<{ privateKey: string; publicKey: string }>;
  uploadPublicKey: (token: string | undefined, publicKey: string) => Promise<void>;
  uploadRecoveryBlob: (token: string, privateKeyHex: string, passphrase: string) => Promise<void>;
  checkRecoveryBlobExists: (token: string) => Promise<boolean | null>;
  applyRecoveryBlobExists: (exists: boolean) => void;
  getIdTokenWithRetry: (opts?: {
    maxAttempts?: number;
    delayMs?: number;
  }) => Promise<string | null>;
  promptPassphrase: (mode: 'setup' | 'restore' | 'change' | 'reset') => Promise<string>;
  closePrompt: () => void;
  bumpKeyEpoch: () => void;

  promptAlert: (title: string, message: string) => Promise<void>;
}): void {
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
        const preferredUsername =
          typeof attrs.preferred_username === 'string' ? attrs.preferred_username : undefined;
        const email = typeof attrs.email === 'string' ? attrs.email : undefined;
        const name = preferredUsername || email || getUsernameFromAuthenticatorUser(user) || 'anon';
        const userId = typeof attrs.sub === 'string' ? attrs.sub : String(attrs.sub || '');
        if (mounted) setMyUserSub(userId);
        if (mounted) setDisplayName(name);
        // Best-effort: persist last display name for instant header hydration on next launch.
        const dn = String(name || '').trim();
        if (dn) {
          try {
            void AsyncStorage.setItem('ui:lastDisplayName:device', dn).catch(() => {});
          } catch {
            // ignore
          }
          if (Platform.OS === 'web') {
            try {
              globalThis?.localStorage?.setItem?.('ui:lastDisplayName:device', dn);
            } catch {
              // ignore
            }
          }
        }

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
            // If the user has a local keypair but has NOT created a recovery blob yet,
            // prompt them to create a recovery passphrase on sign-in until they complete it.
            if (exists === false) {
              try {
                const recoveryPassphrase = await promptPassphrase('setup');
                await uploadRecoveryBlob(token, keyPair.privateKey, recoveryPassphrase);
                if (mounted) applyRecoveryBlobExists(true);
              } catch (err) {
                // User chose "Skip for now" or dismissed, or network failed — do not block login.
                console.warn('Recovery setup skipped:', err);
              } finally {
                setProcessing(false);
                closePrompt();
              }
            }
          }
        }

        // Fetch recovery blob only when we don't already have a local keypair.
        let recoveryBlobExists = false;
        let resetRecoveryRequested = false;
        if (!keyPair) {
          const token = (await fetchAuthSession()).tokens?.idToken?.toString();
          const recoveryResp = await fetch(`${apiUrl.replace(/\/$/, '')}/users/recovery`, {
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
                  bumpKeyEpoch();
                  // Ensure Cognito has the matching public key so other devices encrypt to the right key.
                  await uploadPublicKey(token, derivedPublicKey);
                  recovered = true;
                  closePrompt();
                } catch (err) {
                  // Dismiss passphrase modal before stacking UiPromptModal (iOS nested-modal freeze).
                  closePrompt();
                  await deferForModalTransition();
                  await promptAlert(
                    'Incorrect passphrase',
                    'You have entered an incorrect passphrase. Try again.',
                  );
                  console.warn('Recovery attempt failed', err);
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
              bumpKeyEpoch();
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
            bumpKeyEpoch();
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
        if (mounted) setDisplayName(getUsernameFromAuthenticatorUser(user) || 'anon');
      }
    })();

    return () => {
      mounted = false;
    };
    // Intentionally depend on the authenticator user object only, to match previous behavior.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);
}
