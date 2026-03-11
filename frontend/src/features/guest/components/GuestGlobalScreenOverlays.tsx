import React from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { GlobalAboutContent } from '../../../components/globalAbout/GlobalAboutContent';
import { HeaderMenuModal } from '../../../components/HeaderMenuModal';
import type { MediaViewerState } from '../../../components/MediaViewerModal';
import { MediaViewerModal } from '../../../components/MediaViewerModal';
import { RichText } from '../../../components/RichText';
import { ThemeToggleRow } from '../../../components/ThemeToggleRow';
import type { MenuAnchorRect } from '../../../hooks/useMenuAnchor';
import {
  ReactionInfoModal,
  type ReactionInfoModalStyles,
} from '../../chat/components/ReactionInfoModal';
import { GuestChannelPickerModal } from './GuestChannelPickerModal';

type GuestChannelSearchRow = {
  channelId: string;
  name: string;
  activeMemberCount?: number;
  hasPassword?: boolean;
};

export function GuestGlobalScreenOverlays({
  isDark,
  isWideUi,
  requestOpenLink,
  // Theme
  onSetTheme,
  // Menu
  menuOpen,
  setMenuOpen,
  menuAnchor,
  // About (global)
  globalAboutOpen,
  setGlobalAboutOpen,
  dismissGlobalAbout,
  // About (channel)
  isChannel,
  activeChannelTitle,
  activeChannelMetaAboutText,
  channelAboutOpen,
  setChannelAboutOpen,
  channelAboutText,
  setChannelAboutText,
  guestChannelAboutModal,
  // Channel picker
  channelPickerOpen,
  setChannelPickerOpen,
  channelQuery,
  setChannelQuery,
  channelListLoading,
  channelListError,
  globalUserCount,
  channelResults,
  onPickGlobal,
  onPickChannel,
  showLockedChannelAlert,
  // Sign-in
  requestSignIn,
  // Reactions
  reactionInfoOpen,
  reactionInfoEmoji,
  reactionInfoSubsSorted,
  reactionNameBySub,
  closeReactionInfo,
  guestReactionInfoModalStyles,
  // Viewer
  viewerOpen,
  viewerState,
  setViewerState,
  viewerSaving,
  onSaveViewer,
  closeViewer,
  // Confirm link modal node
  confirmLinkModal,
  // Screen styles
  styles,
}: {
  isDark: boolean;
  isWideUi: boolean;
  requestOpenLink: (url: string) => void;
  onSetTheme: (next: 'light' | 'dark') => void;

  menuOpen: boolean;
  setMenuOpen: (v: boolean) => void;
  menuAnchor: MenuAnchorRect | null;

  globalAboutOpen: boolean;
  setGlobalAboutOpen: (v: boolean) => void;
  dismissGlobalAbout: () => void | Promise<void>;

  isChannel: boolean;
  activeChannelTitle: string;
  activeChannelMetaAboutText: string;
  channelAboutOpen: boolean;
  setChannelAboutOpen: (v: boolean) => void;
  channelAboutText: string;
  setChannelAboutText: (v: string) => void;
  guestChannelAboutModal: {
    onRequestClose: () => void;
    onBackdropPress: () => void;
    onGotIt: () => void;
  };

  channelPickerOpen: boolean;
  setChannelPickerOpen: (v: boolean) => void;
  channelQuery: string;
  setChannelQuery: (v: string) => void;
  channelListLoading: boolean;
  channelListError: string | null | undefined;
  globalUserCount: number | null | undefined;
  channelResults: GuestChannelSearchRow[];
  onPickGlobal: () => void;
  onPickChannel: (channelId: string, name: string) => void;
  showLockedChannelAlert: () => void;

  requestSignIn: () => void;

  reactionInfoOpen: boolean;
  reactionInfoEmoji: string;
  reactionInfoSubsSorted: string[];
  reactionNameBySub: Record<string, string>;
  closeReactionInfo: () => void;
  guestReactionInfoModalStyles: ReactionInfoModalStyles;

  viewerOpen: boolean;
  viewerState: MediaViewerState;
  setViewerState: React.Dispatch<React.SetStateAction<MediaViewerState>>;
  viewerSaving: boolean;
  onSaveViewer: () => void;
  closeViewer: () => void;

  confirmLinkModal: React.ReactNode;
  styles: typeof import('../../../screens/GuestGlobalScreen.styles').styles;
}): React.JSX.Element {
  const scheduleOpen = React.useCallback((fn: () => void) => {
    fn();
  }, []);

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
        items={[
          {
            key: 'about',
            label: 'About',
            onPress: () => {
              setMenuOpen(false);
              scheduleOpen(() => {
                if (isChannel) {
                  setChannelAboutText(String(activeChannelMetaAboutText || ''));
                  setChannelAboutOpen(true);
                } else setGlobalAboutOpen(true);
              });
            },
          },
          {
            key: 'signin',
            label: 'Sign in',
            onPress: () => {
              setMenuOpen(false);
              scheduleOpen(() => requestSignIn());
            },
          },
        ]}
      />

      <Modal
        visible={channelAboutOpen}
        transparent
        animationType="fade"
        onRequestClose={guestChannelAboutModal.onRequestClose}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={guestChannelAboutModal.onBackdropPress}
          />
          <View style={[styles.modalCard, isDark ? styles.modalCardDark : null]}>
            <Text style={[styles.modalTitle, isDark ? styles.modalTitleDark : null]}>
              {activeChannelTitle && activeChannelTitle !== 'Global'
                ? `${activeChannelTitle}`
                : 'About'}
            </Text>
            <ScrollView style={styles.modalScroll}>
              <RichText
                text={String(channelAboutText || '')}
                isDark={isDark}
                style={[styles.modalRowText, ...(isDark ? [styles.modalRowTextDark] : [])]}
                enableMentions={false}
                variant="neutral"
                onOpenUrl={requestOpenLink}
              />
            </ScrollView>
            <View style={styles.modalButtons}>
              <Pressable
                style={[styles.modalBtn, isDark ? styles.modalBtnDark : null]}
                onPress={guestChannelAboutModal.onGotIt}
              >
                <Text style={[styles.modalBtnText, isDark ? styles.modalBtnTextDark : null]}>
                  Got it
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <GuestChannelPickerModal
        open={channelPickerOpen}
        isDark={isDark}
        styles={styles}
        query={channelQuery}
        onChangeQuery={setChannelQuery}
        loading={channelListLoading}
        error={channelListError ?? null}
        globalUserCount={globalUserCount ?? null}
        channels={channelResults}
        onPickGlobal={onPickGlobal}
        onPickChannel={onPickChannel}
        onLockedChannel={showLockedChannelAlert}
        onClose={() => setChannelPickerOpen(false)}
      />

      <ReactionInfoModal
        visible={reactionInfoOpen}
        isDark={isDark}
        styles={guestReactionInfoModalStyles}
        emoji={reactionInfoEmoji}
        subsSorted={reactionInfoSubsSorted}
        myUserId={null}
        nameBySub={reactionNameBySub}
        closeLabel="OK"
        onClose={closeReactionInfo}
      />

      <Modal visible={globalAboutOpen} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, isDark && styles.modalCardDark]}>
            <ScrollView style={styles.modalScroll}>
              <GlobalAboutContent
                isDark={isDark}
                titleStyle={[styles.modalTitle, isDark && styles.modalTitleDark]}
                bodyStyle={[styles.modalRowText, ...(isDark ? [styles.modalRowTextDark] : [])]}
                onOpenUrl={requestOpenLink}
              />
            </ScrollView>
            <View style={styles.modalButtons}>
              <Pressable
                style={[styles.modalBtn, isDark && styles.modalBtnDark]}
                onPress={() => void dismissGlobalAbout()}
                accessibilityRole="button"
                accessibilityLabel="Dismiss about"
              >
                <Text style={[styles.modalBtnText, isDark && styles.modalBtnTextDark]}>Got it</Text>
              </Pressable>
              <Pressable
                style={[styles.modalBtn, isDark && styles.modalBtnDark]}
                onPress={() => {
                  void dismissGlobalAbout();
                  requestSignIn();
                }}
                accessibilityRole="button"
                accessibilityLabel="Sign in"
              >
                <Text style={[styles.modalBtnText, isDark && styles.modalBtnTextDark]}>
                  Sign in
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <MediaViewerModal
        open={viewerOpen}
        viewerState={viewerState}
        setViewerState={setViewerState}
        saving={viewerSaving}
        onSave={onSaveViewer}
        onClose={closeViewer}
      />

      {confirmLinkModal}
    </>
  );
}
