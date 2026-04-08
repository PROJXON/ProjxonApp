import * as React from 'react';

export function useDeleteAccountFlow({
  apiUrl,
  myUserSub,
  promptAlert,
  promptConfirm,
  unregisterDmPushNotifications,
  fetchAuthSession,
  deleteUser,
  signOut,
  onSignedOut,
  getErrorMessage,
}: {
  apiUrl: string;
  myUserSub: string | null;
  promptAlert: (title: string, message: string) => Promise<void>;
  promptConfirm: (
    title: string,
    message: string,
    opts?: { confirmText?: string; cancelText?: string; destructive?: boolean },
  ) => Promise<boolean>;
  unregisterDmPushNotifications: () => Promise<void>;
  fetchAuthSession: () => Promise<{ tokens?: { idToken?: { toString: () => string } } }>;
  deleteUser: () => Promise<void>;
  signOut: () => Promise<void> | void;
  onSignedOut?: () => void | Promise<void>;
  getErrorMessage: (e: unknown) => string;
}): { deleteMyAccount: () => Promise<void> } {
  const deleteMyAccount = React.useCallback(async () => {
    if (!apiUrl) {
      await promptAlert('Unavailable', 'Missing API_URL (backend not configured).');
      return;
    }

    const ok = await promptConfirm(
      'Delete account?',
      'This will permanently delete your OrkaChat account\n\nWhat will be deleted:\n- Your profile (display name / avatar)\n- Your blocklist and chat index (best-effort)\n- Push notification tokens\n- Recovery backup (if set)\n\nWhat may remain:\n- Messages you already sent may still be visible to other users\n- Cached media may take a short time to disappear\n\nTimeline: typically immediate, but some cleanup may take a few minutes\n\nContinue?',
      { confirmText: 'Delete', cancelText: 'Cancel', destructive: true },
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
      const res = await fetch(`${apiUrl.replace(/\/$/, '')}/account/delete`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `Backend deletion failed (${res.status})`);
      }
    } catch (e: unknown) {
      await promptAlert('Delete failed', getErrorMessage(e) || 'Failed to delete account data.');
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
      await Promise.resolve(onSignedOut?.());
    }

    await promptAlert('Account Deleted', 'Your account deletion request completed.');
  }, [
    apiUrl,
    deleteUser,
    fetchAuthSession,
    getErrorMessage,
    myUserSub,
    onSignedOut,
    promptAlert,
    promptConfirm,
    signOut,
    unregisterDmPushNotifications,
  ]);

  return { deleteMyAccount };
}
