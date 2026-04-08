import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

/**
 * Device-scoped keys used for signed-in chat/navigation hydration. They are not namespaced by
 * Cognito `sub`, so they must be cleared on sign-out or the next account can briefly (or until
 * refetch) see the previous user's inbox, channel names, and last-open conversation.
 */
const KEYS_TO_REMOVE = [
  'dm:threads:v1',
  'conversations:cache:v1',
  'ui:channelNamesById:v1',
  'ui:lastConversationId:device',
  'ui:lastChannelConversationId',
  'ui:lastDmConversationId',
  'ui:lastChannelLabel:device',
  'ui:lastDisplayName:device',
] as const;

export async function clearSessionCachesOnSignOut(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([...KEYS_TO_REMOVE]);
  } catch {
    // ignore
  }
  if (Platform.OS === 'web') {
    try {
      const ls = globalThis.localStorage;
      if (ls) {
        for (const k of KEYS_TO_REMOVE) {
          ls.removeItem(k);
        }
      }
    } catch {
      // ignore
    }
  }
}
