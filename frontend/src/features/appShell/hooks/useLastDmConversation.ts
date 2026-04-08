import AsyncStorage from '@react-native-async-storage/async-storage';
import * as React from 'react';

function getDeviceStorageKey(): string {
  // Device-scoped fallback so we can restore before user attrs rehydrate.
  return 'ui:lastDmConversationId';
}

function getUserStorageKey(userSub: string | null | undefined): string | null {
  const u = typeof userSub === 'string' ? userSub.trim() : '';
  if (!u) return null;
  return `ui:lastDmConversationId:${u}`;
}

export function useLastDmConversation({
  userSub,
  conversationId,
}: {
  userSub?: string | null;
  conversationId: string;
}): {
  dmRestoreDone: boolean;
  lastDmConversationIdRef: React.MutableRefObject<string>;
} {
  const [dmRestoreDone, setDmRestoreDone] = React.useState<boolean>(false);
  const lastDmConversationIdRef = React.useRef<string>('');

  // Restore last visited DM/group DM on boot (dm#... or gdm#...).
  // Note: unlike channels, we do NOT auto-navigate to the last DM on boot.
  React.useEffect(() => {
    let mounted = true;
    setDmRestoreDone(false);
    // IMPORTANT: clear immediately so we don't show a previous user's DM label
    // while async storage loads for the new user.
    lastDmConversationIdRef.current = '';
    (async () => {
      try {
        const userKey = getUserStorageKey(userSub);
        // If we know the signed-in user, only trust that user's DM pointer.
        // Device fallback is only for pre-auth restore before user attrs are available.
        const raw = userKey
          ? await AsyncStorage.getItem(userKey)
          : await AsyncStorage.getItem(getDeviceStorageKey());
        const v = typeof raw === 'string' ? raw.trim() : '';
        if (!mounted) return;
        if (v.startsWith('dm#') || v.startsWith('gdm#')) {
          lastDmConversationIdRef.current = v;
        }
      } catch {
        // ignore
      } finally {
        if (mounted) setDmRestoreDone(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [userSub]);

  // Persist last visited DM/group DM.
  React.useEffect(() => {
    const v = String(conversationId || '').trim();
    if (!(v.startsWith('dm#') || v.startsWith('gdm#'))) return;
    lastDmConversationIdRef.current = v;
    (async () => {
      try {
        await AsyncStorage.setItem(getDeviceStorageKey(), v);
      } catch {
        // ignore
      }
      try {
        const userKey = getUserStorageKey(userSub);
        if (userKey) await AsyncStorage.setItem(userKey, v);
      } catch {
        // ignore
      }
    })();
  }, [conversationId, userSub]);

  return { dmRestoreDone, lastDmConversationIdRef };
}
