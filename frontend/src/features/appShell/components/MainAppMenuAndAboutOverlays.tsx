import React from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { AppStyles } from '../../../../App.styles';
import { GlobalAboutContent } from '../../../components/globalAbout/GlobalAboutContent';
import { HeaderMenuModal } from '../../../components/HeaderMenuModal';
import { ThemeToggleRow } from '../../../components/ThemeToggleRow';
import type { MenuAnchorRect } from '../../../hooks/useMenuAnchor';

export function MainAppMenuAndAboutOverlays({
  styles,
  isDark,
  isWideUi,
  menuAnchor,

  menuOpen,
  setMenuOpen,

  onSetTheme,

  activeChannelConversationId,
  isDmMode,
  setGlobalAboutOpen,
  setChannelAboutRequestEpoch,
  setChatsOpen,

  // Channels menu resets
  setMyChannelsError,
  setCreateChannelError,
  setCreateChannelOpen,
  setCreateChannelName,
  setCreateChannelPassword,
  setCreateChannelIsPublic,
  setChannelSearchOpen,
  setChannelsError,
  setChannelJoinError,
  setChannelsQuery,
  setChannelsOpen,

  // Avatar
  setAvatarError,
  setAvatarOpen,

  // Background
  setBackgroundError,
  setBackgroundOpen,

  // Recovery
  setRecoveryOpen,
  getIdTokenWithRetry,
  checkRecoveryBlobExists,
  applyRecoveryBlobExists,

  // Blocklist
  setBlocklistOpen,

  // Delete account
  deleteMyAccount,

  // Signout
  unregisterDmPushNotifications,
  signOut,
  onSignedOut,

  // Global about modal
  globalAboutOpen,
  dismissGlobalAbout,
}: {
  styles: AppStyles;
  isDark: boolean;
  isWideUi: boolean;
  menuAnchor: MenuAnchorRect | null;

  menuOpen: boolean;
  setMenuOpen: (v: boolean) => void;

  onSetTheme: (theme: 'light' | 'dark') => void;

  activeChannelConversationId: string | null | undefined;
  isDmMode: boolean;
  setGlobalAboutOpen: (v: boolean) => void;
  setChannelAboutRequestEpoch: React.Dispatch<React.SetStateAction<number>>;
  setChatsOpen: (v: boolean) => void;

  setMyChannelsError: (v: string | null) => void;
  setCreateChannelError: (v: string | null) => void;
  setCreateChannelOpen: (v: boolean) => void;
  setCreateChannelName: (v: string) => void;
  setCreateChannelPassword: (v: string) => void;
  setCreateChannelIsPublic: (v: boolean) => void;
  setChannelSearchOpen: (v: boolean) => void;
  setChannelsError: (v: string | null) => void;
  setChannelJoinError: (v: string | null) => void;
  setChannelsQuery: (v: string) => void;
  setChannelsOpen: (v: boolean) => void;

  setAvatarError: (v: string | null) => void;
  setAvatarOpen: (v: boolean) => void;

  setBackgroundError: (v: string | null) => void;
  setBackgroundOpen: (v: boolean) => void;

  setRecoveryOpen: (v: boolean) => void;
  getIdTokenWithRetry: (args: { maxAttempts: number; delayMs: number }) => Promise<string | null>;
  checkRecoveryBlobExists: (token: string) => Promise<boolean | null>;
  applyRecoveryBlobExists: (exists: boolean) => void;

  setBlocklistOpen: (v: boolean) => void;

  deleteMyAccount: () => Promise<void>;

  unregisterDmPushNotifications: () => Promise<void>;
  // Amplify's `signOut` typing varies across versions; treat as sync/async.
  signOut: () => void | Promise<void>;
  onSignedOut?: () => void;

  globalAboutOpen: boolean;
  dismissGlobalAbout: () => void | Promise<void>;
}): React.JSX.Element {
  // On iOS, defer opening the next panel by one frame so the menu view is gone before the next Modal presents.
  const scheduleOpen = React.useCallback((fn: () => void) => {
    if (Platform.OS === 'ios') requestAnimationFrame(fn);
    else fn();
  }, []);

  const items = React.useMemo(() => {
    const base: Array<{ key: string; label: string; onPress: () => void | Promise<void> }> = [];

    if (!isDmMode) {
      base.push({
        key: 'about',
        label: 'About',
        onPress: () => {
          setMenuOpen(false);
          const cid = String(activeChannelConversationId || '').trim() || 'global';
          if (cid === 'global') {
            setGlobalAboutOpen(true);
          } else if (cid.startsWith('ch#')) {
            setChannelAboutRequestEpoch((v) => v + 1);
          }
        },
      });
    }

    base.push(
      {
        key: 'chats',
        label: 'Chats',
        onPress: () => {
          setMenuOpen(false);
          scheduleOpen(() => setChatsOpen(true));
        },
      },
      {
        key: 'channels',
        label: 'Channels',
        onPress: () => {
          setMenuOpen(false);
          scheduleOpen(() => {
            setMyChannelsError(null);
            setCreateChannelError(null);
            setCreateChannelOpen(false);
            setCreateChannelName('');
            setCreateChannelPassword('');
            setCreateChannelIsPublic(true);
            setChannelSearchOpen(false);
            setChannelsError(null);
            setChannelJoinError(null);
            setChannelsQuery('');
            setChannelsOpen(true);
          });
        },
      },
      {
        key: 'avatar',
        label: 'Avatar',
        onPress: () => {
          setMenuOpen(false);
          scheduleOpen(() => {
            setAvatarError(null);
            setAvatarOpen(true);
          });
        },
      },
      {
        key: 'background',
        label: 'Background',
        onPress: () => {
          setMenuOpen(false);
          scheduleOpen(() => {
            setBackgroundError(null);
            setBackgroundOpen(true);
          });
        },
      },
      {
        key: 'recovery',
        label: 'Recovery',
        onPress: () => {
          setMenuOpen(false);
          scheduleOpen(() => {
            setRecoveryOpen(true);
            void (async () => {
              const token = await getIdTokenWithRetry({ maxAttempts: 10, delayMs: 200 });
              if (token) {
                const exists = await checkRecoveryBlobExists(token);
                if (exists !== null) applyRecoveryBlobExists(exists);
              }
            })();
          });
        },
      },
      {
        key: 'blocked',
        label: 'Blocklist',
        onPress: () => {
          setMenuOpen(false);
          scheduleOpen(() => setBlocklistOpen(true));
        },
      },
      {
        key: 'deleteAccount',
        label: 'Delete account',
        onPress: () => {
          setMenuOpen(false);
          scheduleOpen(() => void deleteMyAccount());
        },
      },
      {
        key: 'signout',
        label: 'Sign out',
        onPress: async () => {
          setMenuOpen(false);
          try {
            await unregisterDmPushNotifications();
            await Promise.resolve(signOut());
          } finally {
            onSignedOut?.();
          }
        },
      },
    );

    return base;
  }, [
    scheduleOpen,
    activeChannelConversationId,
    applyRecoveryBlobExists,
    checkRecoveryBlobExists,
    deleteMyAccount,
    getIdTokenWithRetry,
    isDmMode,
    onSignedOut,
    setAvatarError,
    setAvatarOpen,
    setBackgroundError,
    setBackgroundOpen,
    setBlocklistOpen,
    setChannelAboutRequestEpoch,
    setChannelJoinError,
    setChannelSearchOpen,
    setChannelsError,
    setChannelsOpen,
    setChannelsQuery,
    setChatsOpen,
    setCreateChannelError,
    setCreateChannelIsPublic,
    setCreateChannelName,
    setCreateChannelOpen,
    setCreateChannelPassword,
    setGlobalAboutOpen,
    setMenuOpen,
    setMyChannelsError,
    setRecoveryOpen,
    signOut,
    unregisterDmPushNotifications,
  ]);

  return (
    <>
      <HeaderMenuModal
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={undefined}
        isDark={isDark}
        cardWidth={160}
        anchor={isWideUi ? menuAnchor : null}
        headerRight={<ThemeToggleRow isDark={isDark} onSetTheme={onSetTheme} styles={styles} />}
        items={items}
      />

      <Modal
        visible={globalAboutOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          void dismissGlobalAbout();
        }}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => void dismissGlobalAbout()} />
          <View style={[styles.modalContent, isDark ? styles.modalContentDark : null]}>
            <ScrollView style={{ maxHeight: 340 }}>
              <GlobalAboutContent
                isDark={isDark}
                titleStyle={[styles.modalTitle, isDark ? styles.modalTitleDark : null]}
                bodyStyle={[
                  styles.modalHelperText,
                  ...(isDark ? [styles.modalHelperTextDark] : []),
                  { marginBottom: 0 },
                ]}
              />
            </ScrollView>
            <View style={[styles.modalButtons, { justifyContent: 'flex-end', marginTop: 12 }]}>
              <Pressable
                style={[
                  styles.modalButton,
                  styles.modalButtonSmall,
                  isDark ? styles.modalButtonDark : null,
                ]}
                onPress={() => void dismissGlobalAbout()}
              >
                <Text style={[styles.modalButtonText, isDark ? styles.modalButtonTextDark : null]}>
                  Got it
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}
