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
  Switch,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import ChatScreen from './src/screens/ChatScreen';
import GuestGlobalScreen from './src/screens/GuestGlobalScreen';
import { AnimatedDots } from './src/components/AnimatedDots';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';

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
import { getUrl, uploadData } from 'aws-amplify/storage';
import { API_URL } from './src/config/env';
import {
  registerForDmPushNotifications,
  setForegroundNotificationPolicy,
  unregisterDmPushNotifications,
} from './utils/pushNotifications';
import { HeaderMenuModal } from './src/components/HeaderMenuModal';
import { AVATAR_DEFAULT_COLORS, AvatarBubble, pickDefaultAvatarColor } from './src/components/AvatarBubble';
import Feather from '@expo/vector-icons/Feather';

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

const MainAppContent = ({ onSignedOut }: { onSignedOut?: () => void }) => {
  const { user } = useAuthenticator();
  const { signOut } = useAuthenticator();
  const [displayName, setDisplayName] = useState<string>('anon');
  const [myUserSub, setMyUserSub] = React.useState<string | null>(null);
  const [avatarOpen, setAvatarOpen] = React.useState<boolean>(false);
  const [avatarSaving, setAvatarSaving] = React.useState<boolean>(false);
  const [avatarError, setAvatarError] = React.useState<string | null>(null);
  const [myAvatar, setMyAvatar] = React.useState<{
    bgColor?: string;
    textColor?: string;
    imagePath?: string;
    imageUri?: string; // cached preview URL (not persisted)
  }>(() => ({ textColor: '#fff' }));
  const [pendingAvatarImageUri, setPendingAvatarImageUri] = React.useState<string | null>(null);
  const [pendingAvatarRemoveImage, setPendingAvatarRemoveImage] = React.useState<boolean>(false);
  const [passphrasePrompt, setPassphrasePrompt] = useState<{
    mode: 'setup' | 'restore';
    resolve: (value: string) => void;
    reject: (reason?: any) => void;
  } | null>(null);
  const [passphraseInput, setPassphraseInput] = useState('');
  const [hasRecoveryBlob, setHasRecoveryBlob] = useState(false);
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
  >(null);

  const promptPassphrase = (mode: 'setup' | 'restore'): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      setPassphraseInput('');
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

  const handlePromptCancel = async () => {
    if (!passphrasePrompt) return;
    const isSetup = passphrasePrompt.mode === 'setup';
    const ok = await promptConfirm(
      'Cancel recovery passphrase',
      isSetup
        ? "Are you sure? If you don't set a recovery passphrase, you won't be able to decrypt older messages if you switch devices or need recovery later.\n\nWe do NOT store your passphrase, so make sure you remember it."
        : "Are you sure? If you don't enter your recovery passphrase, you won't be able to decrypt older messages on this device.\n\nYou can try again if you remember it.",
      { confirmText: 'Yes, cancel', cancelText: 'Go back', destructive: true }
    );
    if (!ok) return;
    closePrompt();
    passphrasePrompt.reject(new Error('Prompt cancelled'));
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
        // Notification policy: avoid banners/sounds while foregrounded (chat UI handles it).
        await setForegroundNotificationPolicy();

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
        const { url } = await getUrl({ path: myAvatar.imagePath });
        if (!cancelled) setMyAvatar((prev) => ({ ...prev, imageUri: url.toString() }));
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
    Array<{ conversationId: string; peerDisplayName?: string; peerSub?: string; lastMessageAt?: number }>
  >([]);
  const [chatsLoading, setChatsLoading] = React.useState<boolean>(false);
  const [conversationsCacheAt, setConversationsCacheAt] = React.useState<number>(0);
  const isDmMode = conversationId !== 'global';
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const isDark = theme === 'dark';
  const [menuOpen, setMenuOpen] = React.useState<boolean>(false);
  const [chatsOpen, setChatsOpen] = React.useState<boolean>(false);
  const [blocklistOpen, setBlocklistOpen] = React.useState<boolean>(false);
  const [blocklistLoading, setBlocklistLoading] = React.useState<boolean>(false);
  const [blockUsername, setBlockUsername] = React.useState<string>('');
  const [blockError, setBlockError] = React.useState<string | null>(null);
  const [blockedUsers, setBlockedUsers] = React.useState<
    Array<{ blockedSub: string; blockedDisplayName?: string; blockedUsernameLower?: string; blockedAt?: number }>
  >([]);
  const [blocklistCacheAt, setBlocklistCacheAt] = React.useState<number>(0);

  const blockedSubs = React.useMemo(() => blockedUsers.map((b) => b.blockedSub).filter(Boolean), [blockedUsers]);

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
          lastMessageAt: Number(c?.lastMessageAt ?? 0),
        }))
        .filter((c: any) => c.conversationId);
      setServerConversations(parsed);
      setConversationsCacheAt(Date.now());
      try {
        await AsyncStorage.setItem(
          'conversations:cache:v1',
          JSON.stringify({ at: Date.now(), conversations: parsed })
        );
      } catch {
        // ignore
      }
    } catch {
      // ignore
    } finally {
      setChatsLoading(false);
    }
  }, [API_URL]);

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
    // Cache strategy:
    // - Show whatever we already have immediately (state or persisted cache).
    // - Refresh in background only if stale.
    const STALE_MS = 60_000;
    // IMPORTANT: don't refetch in a loop when the server returns 0 conversations.
    // Use the last fetch timestamp (even if empty) to gate refreshes.
    if (conversationsCacheAt && Date.now() - conversationsCacheAt < STALE_MS) return;
    void fetchConversations();
  }, [chatsOpen, fetchConversations, conversationsCacheAt]);

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
      if (targetConversationId !== 'global') {
        upsertDmThread(
          targetConversationId,
          cached?.user || peer || 'Direct Message',
          Date.now()
        );
      }
      setSearchOpen(false);
      setPeerInput('');
      setSearchError(null);
    },
    [unreadDmMap, upsertDmThread, peer]
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
        if (kind === 'dm' && convId) {
          setSearchOpen(false);
          setPeerInput('');
          setSearchError(null);
          setConversationId(convId);
          setPeer(senderName || 'Direct Message');
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
          const lastAt = Number(it.lastMessageCreatedAt || 0);
          upsertDmThread(convId, sender, Number.isFinite(lastAt) && lastAt > 0 ? lastAt : Date.now());
        }
        setUnreadDmMap((prev) => ({ ...next, ...prev }));
      } catch {
        // ignore
      }
    })();
  }, [API_URL, user, upsertDmThread]);

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
              setPendingAvatarImageUri(null);
              setAvatarOpen(true);
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

      <Modal visible={avatarOpen} transparent animationType="fade" onRequestClose={() => setAvatarOpen(false)}>
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setAvatarOpen(false)} />
          <View style={[styles.profileCard, isDark ? styles.profileCardDark : null]}>
            <View style={styles.chatsTopRow}>
              <Text style={[styles.modalTitle, isDark ? styles.modalTitleDark : null]}>Avatar</Text>
            </View>

            <View style={styles.profilePreviewRow}>
              <AvatarBubble
                seed={myUserSub || displayName}
                label={displayName}
                size={44}
                backgroundColor={myAvatar.bgColor || pickDefaultAvatarColor(myUserSub || displayName)}
                textColor={myAvatar.textColor || '#fff'}
                imageUri={pendingAvatarImageUri || myAvatar.imageUri}
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

            {pendingAvatarImageUri || myAvatar.imageUri ? (
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
                    const selected = (myAvatar.bgColor || '') === c;
                    return (
                      <Pressable
                        key={`bg:${c}`}
                        onPress={() => setMyAvatar((prev) => ({ ...prev, bgColor: c }))}
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
                    onPress={() => setMyAvatar((prev) => ({ ...prev, textColor: '#fff' }))}
                    style={[
                      styles.avatarTextColorBtn,
                      isDark ? styles.avatarTextColorBtnDark : null,
                      (myAvatar.textColor || '#fff') === '#fff'
                        ? (isDark ? styles.avatarTextColorBtnSelectedDark : styles.avatarTextColorBtnSelected)
                        : null,
                    ]}
                  >
                    <Text style={[styles.avatarTextColorLabel, isDark ? styles.avatarTextColorLabelDark : null]}>White</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setMyAvatar((prev) => ({ ...prev, textColor: '#111' }))}
                    style={[
                      styles.avatarTextColorBtn,
                      isDark ? styles.avatarTextColorBtnDark : null,
                      (myAvatar.textColor || '#fff') === '#111'
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
                style={({ pressed }) => [styles.toolBtn, isDark && styles.toolBtnDark, pressed && { opacity: 0.92 }]}
                onPress={async () => {
                  try {
                    setAvatarError(null);
                    setPendingAvatarRemoveImage(false);
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
                    setPendingAvatarImageUri(uri);
                  } catch (e: any) {
                    setAvatarError(e?.message || 'Could not pick image.');
                  }
                }}
              >
                <Text style={[styles.toolBtnText, isDark && styles.toolBtnTextDark]}>Upload photo</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.toolBtn, isDark && styles.toolBtnDark, pressed && { opacity: 0.92 }]}
                onPress={() => {
                  setPendingAvatarImageUri(null);
                  setPendingAvatarRemoveImage(true);
                  setMyAvatar((prev) => ({ ...prev, imagePath: undefined, imageUri: undefined }));
                }}
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
                  setAvatarSaving(true);
                  setAvatarError(null);
                  try {
                    let nextImagePath = myAvatar.imagePath;

                    if (pendingAvatarImageUri) {
                      // Normalize to a square JPEG (256x256) after user crop.
                      const normalized = await ImageManipulator.manipulateAsync(
                        pendingAvatarImageUri,
                        [{ resize: { width: 256, height: 256 } }],
                        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
                      );
                      const blob = await (await fetch(normalized.uri)).blob();
                      // Store avatars under uploads/global/* so both authenticated users and guests
                      // can resolve them via Amplify Storage permissions (and later behind CloudFront).
                      const path = `uploads/global/avatars/${myUserSub}/${Date.now()}.jpg`;
                      await uploadData({ path, data: blob, options: { contentType: 'image/jpeg' } }).result;
                      nextImagePath = path;
                      setPendingAvatarImageUri(null);
                      setPendingAvatarRemoveImage(false);
                    }

                    const next = {
                      bgColor: myAvatar.bgColor,
                      textColor: myAvatar.textColor || '#fff',
                      // IMPORTANT:
                      // - undefined => omit key => "no change" server-side
                      // - ''        => explicit clear (updateProfile.js removes avatarImagePath)
                      imagePath: pendingAvatarRemoveImage ? '' : nextImagePath,
                    };

                    // Update local state first so UI feels instant.
                    setMyAvatar((prev) => ({ ...prev, ...next, imageUri: undefined }));
                    await saveAvatarToStorageAndServer(next);
                    setAvatarOpen(false);
                  } catch (e: any) {
                    setAvatarError(e?.message || 'Failed to save avatar.');
                  } finally {
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
                onPress={() => setAvatarOpen(false)}
                disabled={avatarSaving}
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
            <View style={[styles.modalContent, isDark ? styles.modalContentDark : null]}>
              <Text style={[styles.modalTitle, isDark ? styles.modalTitleDark : null]}>
                {uiPrompt?.title || ''}
              </Text>
              <Text style={[styles.modalHelperText, isDark ? styles.modalHelperTextDark : null]}>
                {uiPrompt?.message || ''}
              </Text>
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
              ) : null}
              <TextInput
                style={[
                  styles.modalInput,
                  isDark ? styles.modalInputDark : styles.modalInputLight,
                  processing ? styles.modalInputDisabled : null,
                  isDark && processing ? styles.modalInputDisabledDark : null,
                ]}
                secureTextEntry
                value={passphraseInput}
                onChangeText={setPassphraseInput}
                placeholder="Passphrase"
                placeholderTextColor={isDark ? '#8f8fa3' : '#999'}
                selectionColor={isDark ? '#ffffff' : '#111'}
                cursorColor={isDark ? '#ffffff' : '#111'}
                autoFocus
                editable={!processing}
              />
              <View style={styles.modalButtons}>
                <Pressable
                  style={[styles.modalButton, processing && { opacity: 0.45 }]}
                  onPress={() => void handlePromptCancel()}
                  disabled={processing}
                >
                  <Text style={[styles.modalButtonText, isDark ? styles.modalButtonTextDark : null]}>
                    Cancel
                  </Text>
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
                    {processing ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                        <Text style={{ color: '#fff', fontWeight: '700', textAlign: 'center' }}>
                          {passphrasePrompt?.mode === 'restore' ? 'Decrypting' : 'Encrypting backup'}
                        </Text>
                        <AnimatedDots color="#fff" size={18} />
                      </View>
                    ) : (
                      <Text
                        style={{
                          color: '#fff',
                          fontWeight: '600',
                          textAlign: 'center',
                        }}
                      >
                        Submit
                      </Text>
                    )}
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
          blockedUserSubs={blockedSubs}
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
    backgroundColor: '#fff',
    borderWidth: 1,
    // Neutral "tool button" style (avoid blue default buttons in light mode).
    borderColor: '#ddd',
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
  modalButtonPrimary: {
    backgroundColor: '#1a73e8',
    borderColor: 'transparent',
  },
  modalButtonPrimaryDark: {
    backgroundColor: '#1976d2',
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
  modalButtonDangerText: {
    color: '#fff',
  },
  chatsCard: {
    width: '92%',
    maxWidth: 520,
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
  chatsTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  chatsCloseBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
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
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatDeleteBtnDark: { backgroundColor: '#2a2a33', borderWidth: 0, borderColor: 'transparent' },

  blocksCard: {
    width: '92%',
    maxWidth: 520,
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
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    color: '#111',
  },
  blocksInputDark: { backgroundColor: '#1c1c22', borderColor: '#2a2a33', color: '#fff' },
  blocksBtn: {
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
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
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
    alignItems: 'center',
    justifyContent: 'center',
  },
  blockActionBtnDark: { backgroundColor: '#2a2a33', borderWidth: 0, borderColor: 'transparent' },
});
