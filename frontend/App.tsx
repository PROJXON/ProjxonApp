import React, { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  Button,
  TextInput,
  Pressable,
  Modal,
  Alert,
  Switch,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import ChatScreen from './src/screens/ChatScreen';
import GuestGlobalScreen from './src/screens/GuestGlobalScreen';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
import { IconButton, PhoneNumberField, TextField } from '@aws-amplify/ui-react-native/src/primitives';
import { authenticatorTextUtil, getErrors } from '@aws-amplify/ui';
import {
  DefaultContent,
  FederatedProviderButtons,
} from '@aws-amplify/ui-react-native/src/Authenticator/common';
import { useFieldValues } from '@aws-amplify/ui-react-native/src/Authenticator/hooks';
import { fetchUserAttributes } from 'aws-amplify/auth';
import { fetchAuthSession } from '@aws-amplify/auth';
import { API_URL } from './src/config/env';

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

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const outputs = require('./amplify_outputs.json');
  Amplify.configure(outputs);
} catch {
  // amplify_outputs.json not present yet; run `npx ampx sandbox` to generate it.
}

const SignOutButton = ({
  style,
  theme,
  onSignedOut,
}: {
  style?: any;
  theme: 'light' | 'dark';
  onSignedOut?: () => void;
}) => {
  const { signOut } = useAuthenticator();
  const isDark = theme === 'dark';

  return (
    <Pressable
      onPress={async () => {
        try {
          await signOut();
        } finally {
          onSignedOut?.();
        }
      }}
      style={({ pressed }) => [
        styles.signOutPill,
        isDark && styles.signOutPillDark,
        pressed && { opacity: 0.85 },
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel="Sign out"
    >
      <Text style={[styles.signOutPillText, isDark && styles.signOutPillTextDark]}>Sign out</Text>
    </Pressable>
  );
};

const MainAppContent = ({ onSignedOut }: { onSignedOut?: () => void }) => {
  const { user } = useAuthenticator();
  const [displayName, setDisplayName] = useState<string>('anon');
  const [passphrasePrompt, setPassphrasePrompt] = useState<{
    mode: 'setup' | 'restore';
    resolve: (value: string) => void;
    reject: (reason?: any) => void;
  } | null>(null);
  const [passphraseInput, setPassphraseInput] = useState('');
  const [hasRecoveryBlob, setHasRecoveryBlob] = useState(false);
  const [processing, setProcessing] = useState(false);

  const promptPassphrase = (mode: 'setup' | 'restore'): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      setPassphraseInput('');
      setPassphrasePrompt({ mode, resolve, reject });
    });

  const closePrompt = () => {
    setPassphrasePrompt(null);
    setPassphraseInput('');
    setProcessing(false);
  };

  const handlePromptSubmit = () => {
    if (!passphrasePrompt || processing) return;
    console.log('passphrase entered', passphraseInput);
    setProcessing(true);
    // Defer resolving to the next tick so React Native has a chance to render
    // the "processing" state before CPU-heavy crypto work begins.
    setTimeout(() => passphrasePrompt.resolve(passphraseInput), 0);
  };

  const handlePromptCancel = () => {
    if (!passphrasePrompt) return;
    const isSetup = passphrasePrompt.mode === 'setup';
    Alert.alert(
      'Cancel recovery passphrase',
      isSetup
        ? "Are you sure? If you don't set a recovery passphrase, you won't be able to decrypt older messages if you switch devices or need recovery later.\n\nWe do NOT store your passphrase, so make sure you remember it."
        : "Are you sure? If you don't enter your recovery passphrase, you won't be able to decrypt older messages on this device.\n\nYou can try again if you remember it.",
      [
        { text: 'Go back', style: 'cancel' },
        {
          text: 'Yes, cancel',
          style: 'destructive',
          onPress: () => {
            closePrompt();
            passphrasePrompt.reject(new Error('Prompt cancelled'));
          },
        },
      ]
    );
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
        // reset per-user UI state on sign-in changes
        setHasRecoveryBlob(false);
        setProcessing(false);

        const attrs = await fetchUserAttributes();
        const name =
          (attrs.preferred_username as string | undefined) ||
          (attrs.email as string | undefined) ||
          (user as any)?.username ||
          'anon';
        const userId = attrs.sub as string;
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
        if (!keyPair) {
          const token = (await fetchAuthSession()).tokens?.idToken?.toString();
          console.log('token', token);
          const recoveryResp = await fetch(`${API_URL.replace(/\/$/, '')}/users/recovery`, {
            headers: { Authorization: `Bearer ${token}` },
          });

          if (recoveryResp.ok) {
            setHasRecoveryBlob(true);
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
                  // Ensure Cognito has the matching public key so other devices encrypt to the right key.
                  await uploadPublicKey(token, derivedPublicKey);
                  recovered = true;
                  closePrompt();
                } catch (err) {
                  Alert.alert(
                    'Incorrect passphrase',
                    'You have entered an incorrect passphrase. Try again'
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
            closePrompt();
            if (recoveryResp.status !== 404) {
              console.warn('Unexpected response fetching recovery blob', recoveryResp.status);
            }
          }
        }

        if (!keyPair) {
          const newKeyPair = await generateKeypair();
          await storeKeyPair(userId, newKeyPair);
          const token = (await fetchAuthSession()).tokens?.idToken?.toString();
          // Publish the public key immediately so other users/devices can encrypt to us,
          // even if the user cancels recovery setup.
          await uploadPublicKey(token, newKeyPair.publicKey);
          try {
            const recoveryPassphrase = await promptPassphrase('setup');
            await uploadRecoveryBlob(token!, newKeyPair.privateKey, recoveryPassphrase);
            setHasRecoveryBlob(true);
          } catch (err) {
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
  const isDmMode = conversationId !== 'global';
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const isDark = theme === 'dark';

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

  const startDM = async () => {
      const trimmed = peerInput.trim();
      const normalizedInput = trimmed.toLowerCase();
      const normalizedCurrent = currentUsername.trim().toLowerCase();
      if (!trimmed || normalizedInput === normalizedCurrent) {
        setSearchError(
          normalizedInput === normalizedCurrent ? 'Not you silly!' : 'Enter a username'
        );
        return;
      }

      const { tokens } = await fetchAuthSession();
      const idToken = tokens?.idToken?.toString();
      if (!idToken) {
        setSearchError('Unable to authenticate');
        return;
      }

      const res = await fetch(
        `${API_URL.replace(/\/$/, '')}/users?username=${encodeURIComponent(trimmed)}`,
        { headers: { Authorization: `Bearer ${idToken}` } }
      );
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
      // Best-effort: we can't derive displayName from dm#sub#sub, so use unread cache if available.
      const cached = unreadDmMap[targetConversationId];
      if (cached?.user) setPeer(cached.user);
      else if (targetConversationId === 'global') setPeer(null);
      else setPeer('Direct Message');
      setSearchOpen(false);
      setPeerInput('');
      setSearchError(null);
    },
    [unreadDmMap]
  );

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
    },
    [conversationId]
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
    (async () => {
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
          // Prefer display name if backend provides it; fall back to legacy `sender`/`user`.
          const sender = String(it.senderDisplayName || it.sender || it.user || 'someone');
          const senderSub = it.senderSub ? String(it.senderSub) : undefined;
          const count = Number.isFinite(Number(it.messageCount)) ? Number(it.messageCount) : 1;
          next[convId] = { user: sender, senderSub, count: Math.max(1, Math.floor(count)) };
        }
        setUnreadDmMap((prev) => ({ ...next, ...prev }));
      } catch {
        // ignore
      }
    })();
  }, [API_URL, user]);

  const promptVisible = !!passphrasePrompt;
  const promptLabel =
    passphrasePrompt?.mode === 'restore'
      ? 'Enter your recovery passphrase'
      : 'Create a recovery passphrase';

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
          <View style={[styles.themeToggle, isDark && styles.themeToggleDark]}>
            <Text style={[styles.themeToggleText, isDark && styles.themeToggleTextDark]}>
              {isDark ? 'Dark' : 'Light'}
            </Text>
            <Switch
              value={isDark}
              onValueChange={(v) => setTheme(v ? 'dark' : 'light')}
              trackColor={{
                false: '#d1d1d6',
                true: '#d1d1d6',
              }}
              thumbColor={isDark ? '#2a2a33' : '#ffffff'}
            />
          </View>
          <SignOutButton theme={theme} onSignedOut={onSignedOut} />
        </View>
      </View>

      {searchOpen && (
        <View style={styles.searchWrapper}>
          <View style={styles.searchRow}>
            <TextInput
              value={peerInput}
              onChangeText={(value) => {
                setPeerInput(value);
                setSearchError(null);
              }}
              placeholder="User to Message"
              placeholderTextColor={isDark ? '#8f8fa3' : '#999'}
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
        <Modal visible={promptVisible} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>{promptLabel}</Text>
              {passphrasePrompt?.mode === 'setup' ? (
                <Text style={styles.modalHelperText}>
                  Make sure you remember your passphrase for future device recovery - we do not
                  store it.
                </Text>
              ) : null}
              <TextInput
                style={styles.modalInput}
                secureTextEntry
                value={passphraseInput}
                onChangeText={setPassphraseInput}
                placeholder="Passphrase"
                autoFocus
                editable={!processing}
              />
              <View style={styles.modalButtons}>
                <Pressable
                  style={[styles.modalButton, processing && { opacity: 0.45 }]}
                  onPress={handlePromptCancel}
                  disabled={processing}
                >
                  <Text style={styles.modalButtonText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.modalButton,
                    styles.modalButtonPrimary,
                    processing && { opacity: 0.45 },
                  ]}
                  onPress={handlePromptSubmit}
                  disabled={processing}
                  >
                    <Text
                      style={{
                        color: '#fff',
                        fontWeight: '600',
                        textAlign: 'center',
                      }}
                    >
                      {processing
                        ? (passphrasePrompt?.mode === 'restore'
                          ? 'Decrypting...'
                          : 'Encrypting backup...')
                        : 'Submit'}
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
          headerTop={headerTop}
          theme={theme}
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
        size={16}
        source={showPassword ? icons.visibilityOff : icons.visibilityOn}
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
        size={16}
        source={showPassword ? icons.visibilityOff : icons.visibilityOn}
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

  const {
    disableFormSubmit,
    fields: fieldsWithHandlers,
    fieldValidationErrors,
    handleFormSubmit,
  } = useFieldValues({
    componentName: 'SignUp',
    fields,
    handleBlur,
    handleChange,
    handleSubmit,
    validationErrors,
  });

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
      <Pressable
        onPress={() => toSignIn()}
        style={({ pressed }) => [styles.authBackLinkBtn, pressed && { opacity: 0.85 }]}
        accessibilityRole="button"
        accessibilityLabel="Back to sign in"
      >
        <Text style={[styles.authBackLinkText, isDark ? styles.authBackLinkTextDark : null]}>
          Back to sign in
        </Text>
      </Pressable>
    </View>
  );
};

export default function App(): React.JSX.Element {
  const [booting, setBooting] = React.useState<boolean>(true);
  const [rootMode, setRootMode] = React.useState<'guest' | 'app'>('guest');
  const [authModalOpen, setAuthModalOpen] = React.useState<boolean>(false);
  const [uiTheme, setUiTheme] = React.useState<'light' | 'dark'>('light');
  const isDark = uiTheme === 'dark';

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
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

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
            height: 44,
            alignItems: 'center' as const,
            justifyContent: 'center' as const,
          },
          containerPrimary: {
            backgroundColor: isDark ? '#2a2a33' : '#111',
            borderWidth: 0,
          },
          containerDefault: {
            backgroundColor: isDark ? '#1c1c22' : '#fff',
            borderWidth: 1,
            borderColor: isDark ? '#2a2a33' : '#e3e3e3',
          },
          pressed: { opacity: 0.9 },
          text: { fontWeight: '800' as const, fontSize: 15 },
          textPrimary: { color: '#fff' },
          textDefault: { color: isDark ? '#fff' : '#111' },
          containerLink: { backgroundColor: 'transparent' },
          textLink: { color: isDark ? '#fff' : '#111', fontWeight: '800' as const },
        }),
        textField: () => ({
          label: { color: isDark ? '#d7d7e0' : '#444', fontWeight: '700' as const },
          fieldContainer: {
            borderRadius: 12,
            borderWidth: 1,
            borderColor: isDark ? '#2a2a33' : '#e3e3e3',
            backgroundColor: isDark ? '#1c1c22' : '#fff',
            paddingHorizontal: 12,
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

  const signUpFormFields = React.useCallback(
    (ffProps: any) => <LinkedSignUpFormFields {...ffProps} isDark={isDark} caret={caretProps} />,
    [isDark, caretProps]
  );

  const authComponents = React.useMemo(
    () => ({
      SignIn: (props: any) => (
        <Authenticator.SignIn {...props} fields={injectCaretColors(props?.fields, caretProps)} />
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
    [caretProps, confirmResetFormFields, signUpFormFields, isDark]
  );

  return (
    <SafeAreaProvider>
      <SafeAreaView style={[styles.container, styles.appSafe]}>
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
  themeToggleText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111',
  },
  themeToggleTextDark: {
    color: '#fff',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
    zIndex: 1,
  },
  searchWrapper: {
    marginTop: 10,
    marginBottom: 8,
  },
  searchInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 10,
    height: 40,
  },
  searchInputDark: {
    backgroundColor: '#14141a',
    borderColor: '#2a2a33',
    color: '#fff',
  },
  startDmBtn: {
    height: 40,
    paddingHorizontal: 12,
    borderRadius: 8,
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
    lineHeight: 16,
  },
  startDmBtnTextDark: {
    color: '#fff',
  },
  cancelBtn: {
    height: 40,
    paddingHorizontal: 12,
    borderRadius: 8,
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
    lineHeight: 16,
  },
  cancelBtnTextDark: {
    color: '#fff',
  },
  unreadList: {
    paddingHorizontal: 4,
  },
  unreadHintWrapper: {
    paddingVertical: 2,
  },
  unreadHint: {
    color: '#555',
    fontSize: 13,
    marginTop: 4,
    paddingHorizontal: 4,
  },
  unreadHintDark: {
    color: '#b7b7c2',
  },
  unreadHintBold: {
    fontWeight: '700',
    color: '#1976d2',
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
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  modalHelperText: {
    color: '#555',
    marginBottom: 12,
    lineHeight: 18,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 12,
  },
  modalInputDisabled: {
    backgroundColor: '#f5f5f5',
    color: '#999',
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
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#1a73e8',
  },
  modalButtonPrimary: {
    backgroundColor: '#1a73e8',
    borderColor: 'transparent',
  },
  modalButtonText: {
    color: '#1a73e8',
    fontWeight: '600',
    textAlign: 'center',
  },
  modalButtonPrimaryText: {
    color: '#fff',
  },
});
