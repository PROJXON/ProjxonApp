import * as React from 'react';
import { Platform } from 'react-native';

import type { ChannelMeta } from './useChannelRoster';

type ToastKind = 'success' | 'error';
type ChannelUpdateFn = (op: string, args: Record<string, unknown>) => Promise<unknown> | void;

export function useChannelSettingsPanelActions(opts: {
  channelMeta: ChannelMeta | null;
  setChannelMeta: React.Dispatch<React.SetStateAction<ChannelMeta | null>>;
  setChannelActionBusy: (v: boolean) => void;
  channelUpdate: ChannelUpdateFn;
  showToast: (msg: string, kind?: ToastKind) => void;
  uiAlert: (title: string, body: string) => Promise<void> | void;
  uiChoice3: (
    title: string,
    message: string,
    opts: {
      primaryText: string;
      secondaryText: string;
      tertiaryText: string;
      primaryVariant?: 'default' | 'primary' | 'danger';
      secondaryVariant?: 'default' | 'primary' | 'danger';
      tertiaryVariant?: 'default' | 'primary' | 'danger';
    },
  ) => Promise<'primary' | 'secondary' | 'tertiary'>;
  setChannelPasswordDraft: (v: string) => void;
  setChannelPasswordEditOpen: (v: boolean) => void;
}) {
  const {
    channelMeta,
    setChannelMeta,
    setChannelActionBusy,
    channelUpdate,
    showToast,
    uiAlert,
    uiChoice3,
    setChannelPasswordDraft,
    setChannelPasswordEditOpen,
  } = opts;

  const onTogglePublic = React.useCallback(
    (v: boolean) => {
      (async () => {
        if (!channelMeta) return;
        const next = !!v;
        const prev = !!channelMeta.isPublic;
        if (next === prev) return;

        setChannelActionBusy(true);
        try {
          setChannelMeta((p) => (p ? { ...p, isPublic: next } : p));
          await channelUpdate('setPublic', { isPublic: next });

          // Always show the informational modal (all platforms).
          void uiAlert(
            next ? 'Channel is public' : 'Channel is Private',
            next
              ? 'This channel is now discoverable in search, and people can join publicly.'
              : 'This channel is no longer discoverable in search to non-members, and people cannot join it publicly.',
          );

          // Only show the toast on non‑iOS platforms; on iOS it appears to
          // contribute to touch issues when combined with other overlays.
          if (Platform.OS !== 'ios') {
            showToast(next ? 'Channel is now public' : 'Channel is now private', 'success');
          }
        } finally {
          setChannelActionBusy(false);
        }
      })().catch(() => {});
    },
    [channelMeta, channelUpdate, setChannelActionBusy, setChannelMeta, showToast, uiAlert],
  );

  const onPressPassword = React.useCallback(() => {
    if (!channelMeta) return;
    (async () => {
      if (channelMeta.hasPassword) {
        const choice = await uiChoice3('Channel Password', '', {
          primaryText: 'Change Channel Password',
          secondaryText: 'Turn Off Password',
          tertiaryText: 'Cancel',
          primaryVariant: 'primary',
          secondaryVariant: 'primary',
          tertiaryVariant: 'default',
        });
        if (choice === 'primary') {
          setChannelPasswordDraft('');
          setChannelPasswordEditOpen(true);
          return;
        }
        if (choice === 'secondary') {
          setChannelActionBusy(true);
          try {
            await channelUpdate('clearPassword', {});
            setChannelMeta((prev) => (prev ? { ...prev, hasPassword: false } : prev));
            showToast('Password turned off', 'success');
          } finally {
            setChannelActionBusy(false);
          }
        }
        return;
      }
      // No existing password: prompt to set one.
      setChannelPasswordDraft('');
      setChannelPasswordEditOpen(true);
    })().catch(() => {});
  }, [
    channelMeta,
    setChannelActionBusy,
    channelUpdate,
    setChannelMeta,
    setChannelPasswordDraft,
    setChannelPasswordEditOpen,
    showToast,
    uiChoice3,
  ]);

  return { onTogglePublic, onPressPassword };
}
