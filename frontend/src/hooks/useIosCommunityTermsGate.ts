import AsyncStorage from '@react-native-async-storage/async-storage';
import * as React from 'react';
import { Platform } from 'react-native';

const STORAGE_KEY = 'legal:ios:ugcTermsAccepted:v1';

/**
 * iOS App Store (Guideline 1.2): require explicit acceptance of community / UGC terms before chat.
 * No-op on other platforms (ready + accepted immediately).
 */
export function useIosCommunityTermsGate(): {
  ready: boolean;
  accepted: boolean;
  accept: () => Promise<void>;
} {
  const isIos = Platform.OS === 'ios';
  const [ready, setReady] = React.useState<boolean>(!isIos);
  const [accepted, setAccepted] = React.useState<boolean>(!isIos);

  React.useEffect(() => {
    if (!isIos) return;
    let mounted = true;
    (async () => {
      try {
        const v = await AsyncStorage.getItem(STORAGE_KEY);
        if (mounted) setAccepted(v === '1');
      } finally {
        if (mounted) setReady(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [isIos]);

  const accept = React.useCallback(async () => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // still let user proceed
    }
    setAccepted(true);
  }, []);

  return { ready, accepted, accept };
}
