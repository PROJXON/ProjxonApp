import * as React from 'react';
import { Platform } from 'react-native';

import type { AmplifyUiUser } from '../../../types/amplifyUi';
import { isUserInDirectDmConversation } from '../../../utils/conversationAccess';

export function useDmUnreadsAndPush({
  user,
  conversationId,
  setConversationId,
  setPeer,
  setSearchOpen,
  setPeerInput,
  setSearchError,
  setChannelNameById,

  unreadDmMap,
  setUnreadDmMap,
  upsertDmThread,
  fetchUnreads,
  registerForDmPushNotifications,
  myUserSubRef,
}: {
  user: AmplifyUiUser;
  /** Latest Cognito sub; notification deep-links must not open another user's 1:1 DM. */
  myUserSubRef: React.MutableRefObject<string | null>;
  conversationId: string;
  setConversationId: (v: string) => void;
  setPeer: (v: string | null) => void;
  setSearchOpen: (v: boolean) => void;
  setPeerInput: (v: string) => void;
  setSearchError: (v: string | null) => void;
  setChannelNameById: React.Dispatch<React.SetStateAction<Record<string, string>>>;

  unreadDmMap: Record<string, { user: string; count: number; senderSub?: string }>;
  setUnreadDmMap: React.Dispatch<
    React.SetStateAction<Record<string, { user: string; count: number; senderSub?: string }>>
  >;
  upsertDmThread: (convId: string, peerName: string, lastActivityAt?: number) => void;
  fetchUnreads: () => Promise<void>;
  registerForDmPushNotifications: () => Promise<{ ok: boolean; reason?: string }>;
}): {
  hasUnreadDms: boolean;
  unreadEntries: Array<[string, { user: string; count: number; senderSub?: string }]>;
  handleNewDmNotification: (newConversationId: string, sender: string, senderSub?: string) => void;
} {
  // Best-effort: register DM push token after login (Signal-like: sender name only, no message preview).
  React.useEffect(() => {
    if (Platform.OS === 'web') return;
    let mounted = true;
    (async () => {
      try {
        if (!user) return;
        const res = await registerForDmPushNotifications();
        if (!mounted) return;
        if (!res.ok) {
          // Silent in production; optionally log in dev builds.
          if (__DEV__) console.debug('push registration skipped/failed:', res.reason || 'unknown');
        }
      } catch (err) {
        if (__DEV__) console.debug('push registration error:', err);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [registerForDmPushNotifications, user]);

  const hasUnreadDms = Object.keys(unreadDmMap).length > 0;
  const unreadEntries = React.useMemo(() => Object.entries(unreadDmMap), [unreadDmMap]);

  // Handle taps on OS notifications to jump into the DM.
  React.useEffect(() => {
    if (Platform.OS === 'web') return;
    type NotificationSubscription = { remove: () => void };
    type ExpoNotificationsLike = {
      getLastNotificationResponseAsync?: () => Promise<unknown>;
      addNotificationResponseReceivedListener?: (
        cb: (resp: unknown) => void,
      ) => NotificationSubscription;
    };
    let sub: NotificationSubscription | null = null;
    let cancelled = false;

    const handleNotificationResponse = (resp: unknown) => {
      const rec = typeof resp === 'object' && resp != null ? (resp as Record<string, unknown>) : {};
      const notification =
        typeof rec.notification === 'object' && rec.notification != null
          ? (rec.notification as Record<string, unknown>)
          : {};
      const request =
        typeof notification.request === 'object' && notification.request != null
          ? (notification.request as Record<string, unknown>)
          : {};
      const content =
        typeof request.content === 'object' && request.content != null
          ? (request.content as Record<string, unknown>)
          : {};
      const data =
        typeof content.data === 'object' && content.data != null
          ? (content.data as Record<string, unknown>)
          : {};
      const kind = typeof data.kind === 'string' ? data.kind : '';
      const convId = typeof data.conversationId === 'string' ? data.conversationId : '';
      const senderName = typeof data.senderDisplayName === 'string' ? data.senderDisplayName : '';

      if ((kind === 'dm' || kind === 'group') && convId) {
        if (convId.startsWith('dm#')) {
          const me = String(myUserSubRef.current || '').trim();
          if (!me || !isUserInDirectDmConversation(convId, me)) return;
        }
        setSearchOpen(false);
        setPeerInput('');
        setSearchError(null);
        setConversationId(convId);
        setPeer(senderName || (kind === 'group' ? 'Group DM' : 'Direct Message'));
        return;
      }
      if (
        (kind === 'channelMention' || kind === 'channelReply') &&
        convId &&
        convId.startsWith('ch#')
      ) {
        const channelName = typeof data.channelName === 'string' ? data.channelName : '';
        const channelId = convId.slice('ch#'.length).trim();
        if (channelId && channelName.trim()) {
          setChannelNameById((prev) => ({ ...prev, [channelId]: channelName.trim() }));
        }
        setSearchOpen(false);
        setPeerInput('');
        setSearchError(null);
        setPeer(null);
        setConversationId(convId);
        return;
      }
      if ((kind === 'globalMention' || kind === 'globalReply') && convId === 'global') {
        setSearchOpen(false);
        setPeerInput('');
        setSearchError(null);
        setPeer(null);
        setConversationId('global');
      }
    };

    try {
      const NotificationsModule = require('expo-notifications') as ExpoNotificationsLike;

      // Handle cold start / opened-from-notification (listener may not fire).
      const getLast = NotificationsModule?.getLastNotificationResponseAsync ?? null;
      if (getLast) {
        void getLast()
          .then((r) => {
            if (cancelled) return;
            if (r) handleNotificationResponse(r);
          })
          .catch(() => undefined);
      }

      const addListener = NotificationsModule?.addNotificationResponseReceivedListener ?? null;
      if (addListener) {
        sub = addListener((resp: unknown) => handleNotificationResponse(resp));
      }
    } catch {
      // expo-notifications not installed / dev client not rebuilt
    }
    return () => {
      cancelled = true;
      try {
        sub?.remove();
      } catch {
        // ignore
      }
    };
    // Intentionally []: setState functions are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    [conversationId, setUnreadDmMap, upsertDmThread],
  );

  React.useEffect(() => {
    if (!conversationId) return;
    // Only clear unread badges for DM / group DM conversations.
    if (!(conversationId.startsWith('dm#') || conversationId.startsWith('gdm#'))) return;
    setUnreadDmMap((prev) => {
      if (!prev[conversationId]) return prev;
      const next = { ...prev };
      delete next[conversationId];
      return next;
    });
  }, [conversationId, setUnreadDmMap]);

  // Hydrate unread DMs on login so the badge survives logout/login.
  React.useEffect(() => {
    if (!user) return;
    void fetchUnreads();
  }, [fetchUnreads, user]);

  return { hasUnreadDms, unreadEntries, handleNewDmNotification };
}
