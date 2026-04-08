import AsyncStorage from '@react-native-async-storage/async-storage';
import * as React from 'react';

const UNENCRYPTED_CONSENT_KEY = 'ai:openaiPublicConsent:v1';

type Pending = { next: 'summary' | 'helper'; run: (action: 'summary' | 'helper') => void };

/**
 * Apple / privacy: disclose before sending chat-derived data to OpenAI (Summarize / AI Helper).
 *
 * - **Encrypted (DM / group):** consent is **session-only** (in memory). After Continue, AI works for
 *   any encrypted chat until the app process ends; a cold start shows the modal again on first use.
 * - **Unencrypted (Global / channels):** consent is **first time on this device** (AsyncStorage),
 *   to satisfy disclosure without nagging every session.
 */
export function useAiConsentGate(isEncryptedChat: boolean): {
  aiConsentGranted: boolean;
  open: boolean;
  action: null | 'summary' | 'helper';
  request: (next: 'summary' | 'helper', run: (action: 'summary' | 'helper') => void) => void;
  onProceed: (run: (action: 'summary' | 'helper') => void) => void;
  onCancel: () => void;
} {
  const [open, setOpen] = React.useState(false);
  const [action, setAction] = React.useState<null | 'summary' | 'helper'>(null);
  /** Snapshot when the modal opens so Proceed matches the chat type even if the user switches chats. */
  const [modalWasEncrypted, setModalWasEncrypted] = React.useState<boolean | null>(null);

  /** In-memory only; resets when the app restarts. */
  const [sessionEncryptedGranted, setSessionEncryptedGranted] = React.useState(false);

  const [unencryptedStorageReady, setUnencryptedStorageReady] = React.useState(false);
  const [unencryptedEverAccepted, setUnencryptedEverAccepted] = React.useState(false);

  const pendingRef = React.useRef<Pending | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const v = await AsyncStorage.getItem(UNENCRYPTED_CONSENT_KEY);
        if (!cancelled) {
          setUnencryptedEverAccepted(v === '1');
          setUnencryptedStorageReady(true);
        }
      } catch {
        if (!cancelled) setUnencryptedStorageReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const flushPending = React.useCallback(() => {
    const p = pendingRef.current;
    if (!p) return;
    pendingRef.current = null;
    if (unencryptedEverAccepted) {
      p.run(p.next);
    } else {
      setModalWasEncrypted(false);
      setAction(p.next);
      setOpen(true);
    }
  }, [unencryptedEverAccepted]);

  React.useEffect(() => {
    if (!unencryptedStorageReady) return;
    flushPending();
  }, [unencryptedStorageReady, flushPending]);

  const needsModal = React.useCallback(() => {
    if (isEncryptedChat) return !sessionEncryptedGranted;
    if (!unencryptedStorageReady) return true;
    return !unencryptedEverAccepted;
  }, [
    isEncryptedChat,
    sessionEncryptedGranted,
    unencryptedEverAccepted,
    unencryptedStorageReady,
  ]);

  const aiConsentGranted = !needsModal();

  const request = React.useCallback(
    (next: 'summary' | 'helper', run: (action: 'summary' | 'helper') => void) => {
      if (isEncryptedChat) {
        if (!sessionEncryptedGranted) {
          setModalWasEncrypted(true);
          setAction(next);
          setOpen(true);
          return;
        }
        run(next);
        return;
      }

      if (!unencryptedStorageReady) {
        pendingRef.current = { next, run };
        return;
      }
      if (!unencryptedEverAccepted) {
        setModalWasEncrypted(false);
        setAction(next);
        setOpen(true);
        return;
      }
      run(next);
    },
    [isEncryptedChat, sessionEncryptedGranted, unencryptedEverAccepted, unencryptedStorageReady],
  );

  const onProceed = React.useCallback(
    (run: (action: 'summary' | 'helper') => void) => {
      const a = action;
      const kind = modalWasEncrypted;
      setOpen(false);
      setAction(null);
      setModalWasEncrypted(null);
      if (kind === true) {
        setSessionEncryptedGranted(true);
      } else if (kind === false) {
        setUnencryptedEverAccepted(true);
        void AsyncStorage.setItem(UNENCRYPTED_CONSENT_KEY, '1').catch(() => {});
      }
      if (!a) return;
      run(a);
    },
    [action, modalWasEncrypted],
  );

  const onCancel = React.useCallback(() => {
    setOpen(false);
    setAction(null);
    setModalWasEncrypted(null);
  }, []);

  return {
    aiConsentGranted,
    open,
    action,
    request,
    onProceed,
    onCancel,
  };
}
