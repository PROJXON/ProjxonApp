import * as React from 'react';

import type { BackupBlob } from '../../../types/crypto';
import { deferForModalTransition } from '../../../utils/deferForModalTransition';

export function useRecoveryFlow({
  apiUrl,
  myUserSub,
  getIdToken,
  promptAlert,
  promptConfirm,
  promptPassphrase,
  closePrompt,
  decryptPrivateKey,
  derivePublicKey,
  storeKeyPair,
  loadKeyPair,
  generateKeypair,
  uploadPublicKey,
  uploadRecoveryBlob,
  bumpKeyEpoch,
  setHasRecoveryBlob,
  setRecoveryBlobKnown,
  setRecoveryLocked,
}: {
  apiUrl: string;
  myUserSub: string | null;
  getIdToken: () => Promise<string | null>;
  promptAlert: (title: string, message: string) => Promise<void>;
  promptConfirm: (
    title: string,
    message: string,
    opts?: { confirmText?: string; cancelText?: string; destructive?: boolean },
  ) => Promise<boolean>;
  promptPassphrase: (mode: 'restore' | 'change' | 'setup' | 'reset') => Promise<string>;
  closePrompt: () => void;
  decryptPrivateKey: (blob: BackupBlob, passphrase: string) => Promise<string>;
  derivePublicKey: (privateKeyHex: string) => string;
  storeKeyPair: (userSub: string, kp: { privateKey: string; publicKey: string }) => Promise<void>;
  loadKeyPair: (userSub: string) => Promise<{ privateKey?: string; publicKey?: string } | null>;
  generateKeypair: () => Promise<{ privateKey: string; publicKey: string }>;
  uploadPublicKey: (token: string | undefined, publicKey: string) => Promise<void> | void;
  uploadRecoveryBlob: (token: string, privateKeyHex: string, passphrase: string) => Promise<void>;
  bumpKeyEpoch: () => void;
  setHasRecoveryBlob: React.Dispatch<React.SetStateAction<boolean>>;
  setRecoveryBlobKnown: React.Dispatch<React.SetStateAction<boolean>>;
  setRecoveryLocked: React.Dispatch<React.SetStateAction<boolean>>;
}): {
  enterRecoveryPassphrase: () => Promise<void>;
  changeRecoveryPassphrase: () => Promise<void>;
  setupRecovery: () => Promise<void>;
  resetRecovery: () => Promise<void>;
} {
  const fetchRecoveryBlob = React.useCallback(
    async (token: string): Promise<BackupBlob | null> => {
      const base = String(apiUrl || '').replace(/\/$/, '');
      const resp = await fetch(`${base}/users/recovery`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.status === 404) return null;
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`Failed to fetch recovery blob (${resp.status}) ${text}`.trim());
      }
      return (await resp.json()) as BackupBlob;
    },
    [apiUrl],
  );

  const resetRecovery = React.useCallback(async () => {
    if (!myUserSub) return;
    const ok = await promptConfirm(
      'Reset Recovery?',
      'This will generate a new keypair and recovery passphrase on this device.\n\nOld encrypted direct messages will become unrecoverable.',
      { confirmText: 'Reset', cancelText: 'Cancel', destructive: true },
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
      bumpKeyEpoch();
      await uploadPublicKey(token, newKeyPair.publicKey);
      await uploadRecoveryBlob(token, newKeyPair.privateKey, nextPass);
      setHasRecoveryBlob(true);
      setRecoveryBlobKnown(true);
      setRecoveryLocked(false);
      closePrompt();
      await deferForModalTransition();
      await promptAlert('Recovery Reset', 'A new recovery passphrase has been set.');
    } catch {
      // cancelled setup
    } finally {
      closePrompt();
    }
  }, [
    bumpKeyEpoch,
    closePrompt,
    generateKeypair,
    getIdToken,
    myUserSub,
    promptAlert,
    promptConfirm,
    promptPassphrase,
    setHasRecoveryBlob,
    setRecoveryBlobKnown,
    setRecoveryLocked,
    storeKeyPair,
    uploadPublicKey,
    uploadRecoveryBlob,
  ]);

  const enterRecoveryPassphrase = React.useCallback(async () => {
    if (!myUserSub) return;
    const token = await getIdToken();
    if (!token) {
      await promptAlert('Not signed in', 'Missing auth token.');
      return;
    }
    const blob = await fetchRecoveryBlob(token);
    if (!blob) {
      await promptAlert('No recovery backup', 'No recovery backup was found for your account');
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
        await storeKeyPair(myUserSub, {
          privateKey: restoredPrivateKey,
          publicKey: derivedPublicKey,
        });
        bumpKeyEpoch();
        await uploadPublicKey(token, derivedPublicKey);
        setHasRecoveryBlob(true);
        setRecoveryBlobKnown(true);
        setRecoveryLocked(false);
        closePrompt();
        await deferForModalTransition();
        await promptAlert('Recovery Unlocked', 'Your recovery passphrase has been accepted');
        return;
      } catch {
        closePrompt();
        await deferForModalTransition();
        await promptAlert(
          'Incorrect passphrase',
          'You have entered an incorrect passphrase. Try again.',
        );
      } finally {
        closePrompt();
      }
    }
  }, [
    bumpKeyEpoch,
    closePrompt,
    decryptPrivateKey,
    derivePublicKey,
    fetchRecoveryBlob,
    getIdToken,
    myUserSub,
    promptAlert,
    promptPassphrase,
    resetRecovery,
    setHasRecoveryBlob,
    setRecoveryBlobKnown,
    setRecoveryLocked,
    storeKeyPair,
    uploadPublicKey,
  ]);

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
        'You need to enter your existing recovery passphrase on this device before you can change it.',
      );
      return;
    }
    try {
      const nextPass = await promptPassphrase('change');
      await uploadRecoveryBlob(token, kp.privateKey, nextPass);
      setHasRecoveryBlob(true);
      setRecoveryBlobKnown(true);
      closePrompt();
      await deferForModalTransition();
      await promptAlert('Passphrase Updated', 'Your recovery passphrase has been updated');
    } catch {
      // cancelled
    } finally {
      closePrompt();
    }
  }, [
    closePrompt,
    getIdToken,
    loadKeyPair,
    myUserSub,
    promptAlert,
    promptPassphrase,
    setHasRecoveryBlob,
    setRecoveryBlobKnown,
    uploadRecoveryBlob,
  ]);

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
        'You need to enter your existing recovery passphrase on this device before you can set up recovery.',
      );
      return;
    }
    try {
      const pass = await promptPassphrase('setup');
      await uploadRecoveryBlob(token, kp.privateKey, pass);
      setHasRecoveryBlob(true);
      setRecoveryBlobKnown(true);
      closePrompt();
      await deferForModalTransition();
      await promptAlert('Recovery set up', 'A recovery passphrase has been set for your account');
    } catch {
      // cancelled
    } finally {
      closePrompt();
    }
  }, [
    closePrompt,
    getIdToken,
    loadKeyPair,
    myUserSub,
    promptAlert,
    promptPassphrase,
    setHasRecoveryBlob,
    setRecoveryBlobKnown,
    uploadRecoveryBlob,
  ]);

  return { enterRecoveryPassphrase, changeRecoveryPassphrase, setupRecovery, resetRecovery };
}
