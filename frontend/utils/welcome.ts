import AsyncStorage from '@react-native-async-storage/async-storage';

// Future-proof helpers for "welcome modals" in channels/group DMs.
// We intentionally keep this local-only for now; server-side per-user persistence can come later.

export function welcomeSeenKey(opts: { conversationId: string; welcomeVersion: string }): string {
  const c = String(opts.conversationId || 'global').trim() || 'global';
  const v = String(opts.welcomeVersion || 'v1').trim() || 'v1';
  return `welcomeSeen:${c}:${v}`;
}

export async function hasSeenWelcome(opts: { conversationId: string; welcomeVersion: string }): Promise<boolean> {
  try {
    const key = welcomeSeenKey(opts);
    const v = await AsyncStorage.getItem(key);
    return !!v;
  } catch {
    return false;
  }
}

export async function markWelcomeSeen(opts: { conversationId: string; welcomeVersion: string }): Promise<void> {
  try {
    const key = welcomeSeenKey(opts);
    await AsyncStorage.setItem(key, '1');
  } catch {
    // ignore
  }
}


