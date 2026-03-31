import { StyleSheet } from 'react-native';

import type { ReactionInfoModalStyles } from '../features/chat/components/ReactionInfoModal';
import { APP_COLORS, PALETTE, withAlpha } from '../theme/colors';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: APP_COLORS.light.bg.app,
  },
  containerDark: {
    backgroundColor: APP_COLORS.dark.bg.app,
  },
  headerRow: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
    zIndex: 10,
    elevation: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: APP_COLORS.light.border.subtle,
    backgroundColor: APP_COLORS.light.bg.header,
  },
  headerRowDark: {
    backgroundColor: APP_COLORS.dark.bg.header,
    borderBottomColor: APP_COLORS.dark.border.subtle,
  },
  headerRowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  contentColumn: { width: '100%', maxWidth: 1040, alignSelf: 'center' },
  headerTitle: {
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '800',
    color: APP_COLORS.light.text.primary,
  },
  headerTitleDark: {
    color: APP_COLORS.dark.text.primary,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  themeToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: APP_COLORS.light.bg.app,
    borderWidth: 1,
    borderColor: APP_COLORS.light.border.subtle,
  },
  themeToggleDark: {
    backgroundColor: APP_COLORS.dark.bg.surface,
    borderColor: APP_COLORS.dark.border.subtle,
  },
  // Web + iOS: custom toggle (Android uses native Switch).
  webToggleTrack: {
    width: 44,
    height: 26,
    borderRadius: 999,
    padding: 2,
    backgroundColor: APP_COLORS.light.border.default,
    justifyContent: 'center',
  },
  webToggleTrackOn: {
    // Match mobile: keep the track light; the "on" state is indicated by thumb position.
    backgroundColor: APP_COLORS.light.border.default,
  },
  webToggleThumb: {
    width: 22,
    height: 22,
    borderRadius: 999,
    backgroundColor: APP_COLORS.light.bg.app,
  },
  webToggleThumbOn: {
    backgroundColor: APP_COLORS.dark.border.subtle,
  },
  menuIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: APP_COLORS.light.bg.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: APP_COLORS.light.border.subtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuIconBtnDark: {
    backgroundColor: APP_COLORS.dark.border.subtle,
    borderColor: APP_COLORS.dark.border.subtle,
    borderWidth: 0,
  },
  errorText: {
    paddingHorizontal: 12,
    paddingBottom: 6,
    color: APP_COLORS.light.status.errorText,
    fontSize: 12,
  },
  errorTextDark: {
    color: APP_COLORS.dark.status.errorText,
  },
  loadingWrap: {
    paddingVertical: 16,
    paddingHorizontal: 12,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingHorizontal: 6,
    // Inverted list: include symmetric padding so the newest message doesn't hug the bottom bar.
    paddingTop: 12,
    paddingBottom: 12,
  },
  bottomBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: APP_COLORS.light.border.subtle,
    // Match signed-in ChatScreen composer bar.
    backgroundColor: APP_COLORS.light.bg.header,
  },
  bottomBarInner: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
  },
  bottomBarDark: {
    backgroundColor: APP_COLORS.dark.bg.header,
    borderTopColor: APP_COLORS.dark.border.subtle,
  },
  bottomBarCta: {
    height: 48,
    borderRadius: 12,
    backgroundColor: APP_COLORS.light.text.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomBarCtaDark: {
    backgroundColor: APP_COLORS.dark.border.subtle,
  },
  bottomBarCtaText: {
    color: APP_COLORS.light.text.inverse,
    fontWeight: '800',
    fontSize: 15,
  },
  bottomBarCtaTextDark: {
    color: APP_COLORS.dark.text.primary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: withAlpha(PALETTE.black, 0.35),
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    width: '92%',
    maxWidth: 420,
    maxHeight: '80%',
    backgroundColor: APP_COLORS.light.bg.app,
    borderRadius: 12,
    padding: 16,
  },
  modalCardDark: {
    backgroundColor: APP_COLORS.dark.bg.surface,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: APP_COLORS.light.text.primary,
    marginBottom: 10,
  },
  modalTitleDark: { color: APP_COLORS.dark.text.primary },
  modalScroll: { maxHeight: 420 },
  modalRowText: { color: APP_COLORS.light.text.heading, lineHeight: 20, marginBottom: 8 },
  modalRowTextDark: { color: APP_COLORS.dark.text.body },
  // Use padding (not margin) so the gap lives *above the buttons* rather than being
  // treated as space after the last scroll/list item.
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', paddingTop: 6, gap: 8 },
  modalBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: APP_COLORS.light.bg.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: APP_COLORS.light.border.subtle,
  },
  modalBtnDark: {
    backgroundColor: APP_COLORS.dark.bg.header,
    borderColor: APP_COLORS.dark.border.subtle,
  },
  modalBtnText: { color: APP_COLORS.light.text.primary, fontWeight: '800' },
  modalBtnTextDark: { color: APP_COLORS.dark.text.primary, fontWeight: '800' },
});

export const guestReactionInfoModalStyles = {
  // Map the shared modal component's style keys to GuestGlobalScreen styles.
  modalOverlay: styles.modalOverlay,
  summaryModal: styles.modalCard,
  summaryModalDark: styles.modalCardDark,
  summaryTitle: styles.modalTitle,
  summaryTitleDark: styles.modalTitleDark,
  summaryScroll: styles.modalScroll,
  summaryText: styles.modalRowText,
  summaryTextDark: styles.modalRowTextDark,
  summaryButtons: styles.modalButtons,
  toolBtn: styles.modalBtn,
  toolBtnDark: styles.modalBtnDark,
  toolBtnText: styles.modalBtnText,
  toolBtnTextDark: styles.modalBtnTextDark,
  reactionInfoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reactionInfoRemoveHint: { opacity: 0.7, fontSize: 12 },
} satisfies ReactionInfoModalStyles;
