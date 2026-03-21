import { Platform, StyleSheet } from 'react-native';

import { APP_COLORS, PALETTE, withAlpha } from './src/theme/colors';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'stretch',
    justifyContent: 'flex-start',
  },
  appSafe: {
    backgroundColor: APP_COLORS.light.bg.app,
  },
  appSafeDark: {
    backgroundColor: APP_COLORS.dark.bg.app,
  },
  authModalOverlay: {
    flex: 1,
    backgroundColor: withAlpha(PALETTE.black, 0.45),
    padding: 12,
    justifyContent: 'center',
  },
  authModalOverlayInner: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  authModalSheet: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    // Keep it feeling like a popup, not a full screen.
    // ScrollView inside will handle overflow on small screens.
    maxHeight: 640,
    // Allow short auth screens (e.g. "Reset Password" email step) to shrink
    // instead of leaving a large blank area under the content.
    minHeight: 280,
    borderRadius: 16,
    backgroundColor: APP_COLORS.light.bg.app,
    overflow: 'hidden',
  },
  authModalSheetDark: {
    backgroundColor: APP_COLORS.dark.bg.surface,
  },
  authModalTopRow: {
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  authModalTopRowDark: {
    backgroundColor: APP_COLORS.dark.bg.surface,
  },
  authModalBody: {
    paddingHorizontal: 12,
  },
  authModalBodyContent: {
    paddingBottom: 18,
  },
  authModalCloseCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: APP_COLORS.light.bg.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: APP_COLORS.light.border.subtle,
    // Give it a little breathing room from the top/right edge of the sheet.
    marginTop: 4,
  },
  authModalCloseCircleDark: {
    backgroundColor: APP_COLORS.dark.bg.header,
    borderColor: APP_COLORS.dark.border.subtle,
  },
  authModalCloseX: {
    fontSize: 22,
    lineHeight: 22,
    fontWeight: '900',
    color: APP_COLORS.light.text.primary,
    marginTop: -1,
  },
  authModalCloseXDark: {
    color: APP_COLORS.dark.text.primary,
  },
  authModalTitle: {
    fontWeight: '900',
    fontSize: 16,
    color: APP_COLORS.light.text.primary,
  },
  authModalTitleDark: {
    color: APP_COLORS.dark.text.primary,
  },
  authBackLinkBtn: {
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 4,
    marginTop: 6,
  },
  authBackLinkText: {
    fontWeight: '800',
    color: APP_COLORS.light.text.primary,
    textDecorationLine: 'none',
  },
  authBackLinkTextDark: {
    color: APP_COLORS.dark.text.primary,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  rightControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 0,
  },
  themeToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
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
  // Web-only: avoid browser default teal/blue accent that can bleed into the native Switch implementation.
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
    transform: [{ translateX: 0 }],
  },
  webToggleThumbOn: {
    backgroundColor: PALETTE.slate750,
    transform: [{ translateX: 18 }],
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
    backgroundColor: PALETTE.slate750,
    borderColor: PALETTE.slate750,
    borderWidth: 0,
  },
  segment: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: APP_COLORS.light.bg.surface2,
    padding: 3,
    borderRadius: 12,
    gap: 4,
    // Prevent the segmented control from pushing the menu button off-screen on narrow widths.
    flexShrink: 1,
    minWidth: 0,
  },
  segmentDark: {
    // Dark mode: make the segmented "track" distinct from the header background
    // so the control reads like a slider (track + thumb), not two separate buttons.
    backgroundColor: APP_COLORS.dark.bg.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: APP_COLORS.dark.border.subtle,
  },
  segmentBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    // Ensures Android clips the active background to rounded corners.
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 6,
  },
  // Allow the channel pill to take remaining width (so long channel names don't force the DM pill wider).
  segmentBtnGrow: {
    // Don't force expansion (causes big empty space between label and chip on mobile).
    // Let the pill size to its contents, but allow shrink/ellipsis when space is tight.
    flexGrow: 0,
    flexShrink: 1,
    minWidth: 0,
  },
  // Keep the DM pill sized to its contents (but allow shrink if screen is tight).
  segmentBtnFixed: {
    flexGrow: 0,
    flexShrink: 1,
  },
  segmentBtnMainArea: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 8,
    minWidth: 0,
  },
  segmentBtnTextTruncate: {
    flexShrink: 1,
    minWidth: 0,
  },
  // Default for header pills: allow the label area to shrink/truncate, but don't expand and create "dead space".
  segmentBtnMainAreaShrink: {
    flexGrow: 0,
    flexShrink: 1,
    minWidth: 0,
  },
  segmentBtnChipHitbox: {
    width: 36,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentBtnChipCircle: {
    width: 32,
    height: 18,
    borderRadius: 8,
    // Container only (do not add background/border here; those would affect layout if height changes).
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  segmentBtnChipHitboxWide: {
    width: 48,
  },
  segmentBtnChipCircleWide: {
    width: 44,
  },
  // Taller-looking chip background that does NOT affect layout height (absolute positioning).
  segmentBtnChipBgTall: {
    position: 'absolute',
    width: 32,
    height: 24,
    borderRadius: 8,
    backgroundColor: APP_COLORS.light.bg.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: APP_COLORS.light.border.subtle,
  },
  segmentBtnChipBgTallWide: {
    width: 44,
  },
  // Light mode: make the chip white when its parent pill is NOT selected.
  segmentBtnChipBgTallLightUnselected: {
    backgroundColor: APP_COLORS.light.bg.app,
    borderColor: APP_COLORS.light.border.subtle,
  },
  segmentBtnChipBgTallDark: {
    backgroundColor: APP_COLORS.dark.bg.surface,
    borderColor: APP_COLORS.dark.border.subtle,
  },
  segmentBtnChipCircleDark: {
    backgroundColor: APP_COLORS.dark.bg.surface,
    borderColor: APP_COLORS.dark.border.subtle,
  },
  segmentBtnActive: {
    backgroundColor: APP_COLORS.light.bg.app,
    borderRadius: 10,
  },
  segmentBtnActiveDark: {
    backgroundColor: PALETTE.slate750,
    borderRadius: 10,
  },
  segmentBtnText: {
    fontSize: 16,
    // Keep the pill height stable: the chip circle is 18px tall, so keep text metrics <= 18.
    lineHeight: 18,
    fontWeight: '700',
    color: APP_COLORS.light.text.muted,
    // Helps avoid descender clipping and unexpected extra vertical space (Android).
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  segmentBtnTextDark: {
    color: APP_COLORS.dark.text.secondary,
  },
  segmentBtnTextActive: {
    color: APP_COLORS.light.text.primary,
  },
  segmentBtnTextActiveDark: {
    color: APP_COLORS.dark.text.primary,
  },
  dmPillInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: APP_COLORS.light.brand.primary,
  },
  unreadChip: {
    minWidth: 26,
    height: 22,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: APP_COLORS.light.brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadChipDark: {
    backgroundColor: APP_COLORS.dark.brand.primary,
  },
  unreadChipText: {
    color: APP_COLORS.light.text.inverse,
    fontWeight: '900',
    fontSize: 12,
    lineHeight: 14,
  },
  unreadChipTextDark: {
    color: APP_COLORS.dark.text.primary,
  },
  signOutPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: APP_COLORS.light.bg.app,
    borderWidth: 1,
    borderColor: APP_COLORS.light.border.subtle,
  },
  signOutPillDark: {
    backgroundColor: APP_COLORS.dark.bg.surface,
    borderColor: APP_COLORS.dark.border.subtle,
  },
  signOutPillText: {
    fontSize: 14,
    fontWeight: '700',
    color: APP_COLORS.light.text.primary,
  },
  signOutPillTextDark: {
    color: APP_COLORS.dark.text.primary,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 0,
    gap: 8,
    zIndex: 1,
  },
  searchWrapper: {
    marginTop: 6,
    marginBottom: 0,
  },
  searchInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: PALETTE.lineDark,
    borderRadius: 10,
    paddingHorizontal: 10,
    // Keep compact, but make sure text/placeholder are vertically centered (esp. Android).
    height: 36,
    paddingVertical: 0,
    textAlignVertical: 'center',
    // Light mode: make the entry field white.
    backgroundColor: APP_COLORS.light.bg.app,
    color: APP_COLORS.light.text.primary,
    fontSize: 13,
    lineHeight: 16,
  },
  searchInputDark: {
    backgroundColor: APP_COLORS.dark.bg.surface,
    borderColor: APP_COLORS.dark.border.subtle,
    color: APP_COLORS.dark.text.primary,
  },
  startDmBtn: {
    minHeight: 36,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: APP_COLORS.light.bg.app,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.lineMedium,
  },
  startDmBtnDark: {
    backgroundColor: PALETTE.slate750,
    borderColor: PALETTE.slate750,
  },
  startDmBtnText: {
    color: APP_COLORS.light.text.primary,
    fontWeight: '700',
    fontSize: 13,
    lineHeight: 16,
  },
  startDmBtnTextDark: {
    color: APP_COLORS.dark.text.primary,
  },
  cancelBtn: {
    minHeight: 36,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.lineMedium,
    backgroundColor: APP_COLORS.light.bg.app,
  },
  cancelBtnDark: {
    backgroundColor: PALETTE.slate750,
    borderColor: PALETTE.slate750,
  },
  cancelBtnText: {
    color: APP_COLORS.light.text.primary,
    fontWeight: '700',
    fontSize: 13,
    lineHeight: 16,
  },
  cancelBtnTextDark: {
    color: APP_COLORS.dark.text.primary,
  },
  unreadList: {
    paddingHorizontal: 4,
    paddingTop: 4,
  },
  unreadHintWrapper: {
    paddingVertical: 0,
  },
  unreadHint: {
    color: APP_COLORS.light.text.secondary,
    fontSize: 13,
    marginTop: 0,
    paddingHorizontal: 4,
  },
  unreadHintDark: {
    color: APP_COLORS.dark.text.secondary,
  },
  unreadHintBold: {
    fontWeight: '700',
    // Keep unread sender highlight neutral in light mode (avoid bright blue).
    color: APP_COLORS.light.text.primary,
  },
  unreadHintBoldDark: {
    color: APP_COLORS.dark.text.primary,
  },
  errorText: {
    color: APP_COLORS.light.status.errorText,
    marginBottom: 8,
  },
  errorTextDark: {
    color: APP_COLORS.dark.status.errorText,
  },
  appContent: {
    flex: 1,
    alignSelf: 'stretch',
    position: 'relative',
  },
  appContentDark: {
    backgroundColor: APP_COLORS.dark.bg.app,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: withAlpha(PALETTE.black, 0.5),
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    // Keep generic modals (alerts, recovery passphrase, etc.) reasonably sized on desktop web,
    // while preserving the refined native sizing.
    ...(Platform.OS === 'web'
      ? ({ width: '92%', maxWidth: 520, alignSelf: 'center' } as const)
      : ({ width: '80%' } as const)),
    backgroundColor: APP_COLORS.light.bg.app,
    padding: 20,
    borderRadius: 12,
    elevation: 6,
    position: 'relative',
  },
  modalContentDark: {
    backgroundColor: APP_COLORS.dark.bg.header,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  modalTitleDark: {
    color: APP_COLORS.dark.text.primary,
  },
  modalHelperText: {
    color: APP_COLORS.light.text.secondary,
    marginBottom: 12,
    lineHeight: 18,
  },
  modalHelperTextDark: {
    color: APP_COLORS.dark.text.secondary,
  },
  modalInput: {
    height: 48,
    fontSize: 16,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: PALETTE.lineDark,
    borderRadius: 10,
    marginBottom: 12,
    // Android / web: lineHeight === height centers single-line text in 48px fields.
    // iOS: that pattern misaligns placeholder + secure entry (same as `blocksInput`).
    ...Platform.select({
      ios: {
        paddingVertical: 13,
        lineHeight: 20,
      },
      default: {
        paddingVertical: 0,
        lineHeight: 48,
        // Helps avoid descender clipping on Android.
        includeFontPadding: false,
        textAlignVertical: 'center',
      },
    }),
  },
  passphraseFieldWrapper: {
    position: 'relative',
    width: '100%',
    marginBottom: 12,
  },
  passphraseLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: APP_COLORS.light.text.secondary,
    marginBottom: 6,
    alignSelf: 'stretch',
  },
  passphraseLabelDark: {
    color: APP_COLORS.dark.text.secondary,
  },
  passphraseInput: {
    paddingRight: 40, // room for the eye icon (match sign-in tighter inset)
    marginBottom: 0,
  },
  passphraseEyeBtn: {
    position: 'absolute',
    right: 8,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    width: 32,
    // Keep the eye icon above focused input elevation on Android.
    zIndex: 2,
    elevation: 4,
  },
  passphraseErrorText: {
    color: APP_COLORS.light.status.errorText,
    marginTop: -4,
    marginBottom: 12,
    fontWeight: '700',
  },
  passphraseErrorTextDark: {
    color: APP_COLORS.dark.status.errorText,
  },
  modalInputLight: {
    color: APP_COLORS.light.text.primary,
    backgroundColor: APP_COLORS.light.bg.app,
  },
  modalInputDark: {
    borderColor: APP_COLORS.dark.border.subtle,
    backgroundColor: APP_COLORS.dark.bg.surface,
    color: APP_COLORS.dark.text.primary,
  },
  modalInputDisabled: {
    backgroundColor: APP_COLORS.light.bg.surface,
    color: PALETTE.slate350,
  },
  modalInputDisabledDark: {
    backgroundColor: APP_COLORS.dark.bg.surface,
    color: PALETTE.slate400,
    opacity: 0.7,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    // Leave consistent breathing room above footer buttons (esp. when a ScrollView above
    // shrinks due to the keyboard and the modal becomes "scrunched").
    paddingTop: 6,
    gap: 8,
  },
  modalButton: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    // Light mode: neutral buttons should be off-gray (modal backgrounds are white).
    backgroundColor: APP_COLORS.light.bg.surface2,
    borderWidth: 1,
    // Neutral "tool button" style (avoid blue default buttons in light mode).
    borderColor: APP_COLORS.light.border.subtle,
    // Web: avoid browser default focus ring tint (can appear green/blue on some platforms).
    ...(Platform.OS === 'web'
      ? { outlineStyle: 'solid', outlineWidth: 0, outlineColor: 'transparent', boxShadow: 'none' }
      : null),
  },
  modalButtonSmall: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  modalButtonDark: {
    backgroundColor: PALETTE.slate750,
    borderColor: 'transparent',
    borderWidth: 0,
  },
  // Primary button for generic in-app alerts/confirmations (avoid bright blue; match app theme).
  modalButtonPrimary: {
    backgroundColor: PALETTE.slate900,
    borderColor: 'transparent',
  },
  modalButtonPrimaryDark: {
    backgroundColor: PALETTE.slate750,
    borderColor: 'transparent',
  },
  // CTA button for our in-app prompts (avoid bright blue in light mode).
  modalButtonCta: {
    backgroundColor: PALETTE.slate900,
    borderColor: 'transparent',
  },
  modalButtonCtaDark: {
    backgroundColor: PALETTE.slate750,
    borderColor: 'transparent',
  },
  modalButtonDanger: {
    backgroundColor: APP_COLORS.light.status.errorText,
    borderColor: 'transparent',
  },
  modalButtonDangerDark: {
    backgroundColor: APP_COLORS.dark.status.dangerSoft,
    borderColor: 'transparent',
  },
  modalButtonText: {
    color: APP_COLORS.light.text.primary,
    fontWeight: '800',
    textAlign: 'center',
  },
  modalButtonTextDark: {
    color: APP_COLORS.dark.text.primary,
  },
  modalButtonPrimaryText: {
    color: APP_COLORS.light.text.inverse,
  },
  modalButtonCtaText: {
    color: APP_COLORS.light.text.inverse,
  },
  recoveryActionList: {
    marginTop: 12,
    gap: 10,
    alignSelf: 'stretch',
  },
  modalButtonDangerText: {
    color: APP_COLORS.light.text.inverse,
  },
  chatsCard: {
    width: '92%',
    maxWidth: 520,
    // Modals should be white in light mode.
    backgroundColor: APP_COLORS.light.bg.app,
    borderRadius: 16,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: APP_COLORS.light.border.subtle,
    maxHeight: '70%',
    // Ensure the card sits above the modal backdrop Pressable for touch handling on Android.
    position: 'relative',
    zIndex: 2,
    elevation: 8,
  },
  chatsCardDark: {
    backgroundColor: APP_COLORS.dark.bg.surface,
    borderColor: APP_COLORS.dark.border.subtle,
  },
  profileCard: {
    width: '92%',
    maxWidth: 520,
    // Modals should be white in light mode.
    backgroundColor: APP_COLORS.light.bg.app,
    borderRadius: 16,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: APP_COLORS.light.border.subtle,
    maxHeight: '70%',
    // Ensure the card sits above the modal backdrop Pressable for touch handling on Android.
    position: 'relative',
    zIndex: 2,
    elevation: 8,
  },
  profileCardDark: {
    backgroundColor: APP_COLORS.dark.bg.surface,
    borderColor: APP_COLORS.dark.border.subtle,
  },
  profilePreviewRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 },
  profilePreviewMeta: { flex: 1 },
  bgPreviewBox: {
    width: 72,
    height: 54,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: APP_COLORS.light.bg.app,
  },
  bgPreviewImage: { width: '100%', height: '100%' },
  profileSectionTitle: { marginTop: 10, marginBottom: 6, fontWeight: '900' },
  avatarPaletteRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  avatarColorDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(PALETTE.black, 0.25),
  },
  avatarColorDotSelected: {
    borderWidth: 1,
    borderColor: APP_COLORS.light.text.primary,
    transform: [{ scale: 1.05 }],
  },
  avatarColorDotSelectedDark: {
    borderWidth: 2,
    borderColor: APP_COLORS.dark.text.primary,
    transform: [{ scale: 1.05 }],
  },
  avatarTextColorRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatarTextColorBtn: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: APP_COLORS.light.bg.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: APP_COLORS.light.border.subtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarTextColorBtnDark: {
    backgroundColor: APP_COLORS.dark.bg.header,
    borderColor: APP_COLORS.dark.border.subtle,
  },
  avatarTextColorBtnSelected: { borderWidth: 1, borderColor: APP_COLORS.light.text.primary },
  avatarTextColorBtnSelectedDark: { borderWidth: 2, borderColor: APP_COLORS.dark.text.primary },
  avatarTextColorLabel: { fontWeight: '800', color: APP_COLORS.light.text.primary },
  avatarTextColorLabelDark: { color: APP_COLORS.dark.text.primary },
  profileActionsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  toolBtn: {
    flex: 1,
    height: 40,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: APP_COLORS.light.bg.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: APP_COLORS.light.border.subtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolBtnDark: {
    backgroundColor: APP_COLORS.dark.bg.header,
    borderColor: APP_COLORS.dark.border.subtle,
  },
  toolBtnText: {
    fontWeight: '800',
    fontSize: 14,
    lineHeight: 18,
    textAlign: 'center',
    // Helps avoid descender clipping on Android (e.g. the "g" in "Image").
    includeFontPadding: false,
    textAlignVertical: 'center',
    color: APP_COLORS.light.text.primary,
  },
  toolBtnTextDark: { color: APP_COLORS.dark.text.primary },
  bgEffectsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 10,
  },
  bgEffectsResetBtn: { paddingHorizontal: 6, paddingVertical: 4 },
  bgEffectsResetText: { fontWeight: '900', color: APP_COLORS.light.text.primary, opacity: 0.7 },
  bgEffectsResetTextDark: { fontWeight: '900', color: APP_COLORS.dark.text.primary, opacity: 0.75 },
  // Keep sliders comfortably narrow (about ~2/3 modal width).
  bgSliderSection: { marginTop: 10, alignSelf: 'center', width: '64%', maxWidth: 320 },
  bgSliderLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 4,
  },
  bgSliderLabel: { fontWeight: '900', color: APP_COLORS.light.text.primary },
  bgSliderLabelDark: { color: APP_COLORS.dark.text.primary },
  bgSliderValue: { fontWeight: '900', color: APP_COLORS.light.text.primary, opacity: 0.75 },
  bgSliderValueDark: { color: APP_COLORS.dark.text.primary, opacity: 0.8 },
  bgSlider: { width: '100%', height: 34, marginLeft: 4, marginRight: 4 },
  chatsTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  chatsCloseBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: APP_COLORS.light.bg.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: APP_COLORS.light.border.subtle,
  },
  chatsCloseBtnDark: {
    backgroundColor: PALETTE.slate750,
    borderWidth: 0,
    borderColor: 'transparent',
  },
  chatsCloseText: { color: APP_COLORS.light.text.primary, fontWeight: '800' },
  chatsCloseTextDark: { color: APP_COLORS.dark.text.primary },
  chatsScroll: { maxHeight: 420, marginTop: 8 },
  chatsLoadingRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 2,
  },
  chatsLoadingText: { lineHeight: 18 },
  chatsLoadingDotsWrap: { marginBottom: 1 },
  chatRow: {
    paddingVertical: 10,
    paddingHorizontal: 10,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: APP_COLORS.light.bg.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: APP_COLORS.light.border.subtle,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  chatRowDark: {
    backgroundColor: APP_COLORS.dark.bg.header,
    borderColor: APP_COLORS.dark.border.subtle,
  },
  chatRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  chatRowRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  chatRowName: {
    fontWeight: '800',
    color: APP_COLORS.light.text.primary,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  chatRowNameDark: { color: APP_COLORS.dark.text.primary },
  chatRowDate: { fontWeight: '800', fontSize: 13, color: APP_COLORS.light.text.primary },
  chatRowDateDark: { color: APP_COLORS.dark.text.primary },
  chatRowCount: { fontWeight: '900', color: APP_COLORS.light.brand.primary },
  chatRowCountDark: { color: APP_COLORS.dark.text.primary },
  memberChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: APP_COLORS.light.bg.app,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: APP_COLORS.light.border.subtle,
    minWidth: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberChipDark: { backgroundColor: PALETTE.slate750, borderColor: 'transparent' },
  memberChipText: { fontWeight: '900', color: APP_COLORS.light.text.primary },
  memberChipTextDark: { color: APP_COLORS.dark.text.primary },
  leaveChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: PALETTE.dangerBgMaterial50,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.dangerBorderMaterial100,
  },
  leaveChipDark: { backgroundColor: PALETTE.slate750, borderColor: 'transparent' },
  leaveChipText: { color: PALETTE.dangerTextMaterial800, fontWeight: '900' },
  leaveChipTextDark: { color: APP_COLORS.dark.status.dangerSoft },
  defaultChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: APP_COLORS.light.bg.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: APP_COLORS.light.border.subtle,
  },
  defaultChipDark: { backgroundColor: PALETTE.slate750, borderColor: 'transparent' },
  defaultChipText: { color: APP_COLORS.light.text.muted, fontWeight: '900' },
  defaultChipTextDark: { color: APP_COLORS.dark.text.muted },
  chatDeleteBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: APP_COLORS.light.bg.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: APP_COLORS.light.border.subtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatDeleteBtnDark: {
    backgroundColor: PALETTE.slate750,
    borderWidth: 0,
    borderColor: 'transparent',
  },

  blocksCard: {
    width: '92%',
    maxWidth: 520,
    // Modals should be white in light mode.
    backgroundColor: APP_COLORS.light.bg.app,
    borderRadius: 16,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: APP_COLORS.light.border.subtle,
    maxHeight: '70%',
    // Ensure the card sits above the modal backdrop Pressable for touch handling on Android.
    position: 'relative',
    zIndex: 2,
    elevation: 8,
  },
  blocksCardDark: {
    backgroundColor: APP_COLORS.dark.bg.surface,
    borderColor: APP_COLORS.dark.border.subtle,
  },
  blocksTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  blocksSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    marginBottom: 10,
  },
  blocksInput: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: APP_COLORS.light.border.subtle,
    backgroundColor: APP_COLORS.light.bg.surface2,
    paddingHorizontal: 12,
    fontSize: 16,
    color: APP_COLORS.light.text.primary,
    // Android / web: single-line vertical centering via lineHeight === height.
    // iOS: that pattern misaligns placeholder + typed text (placeholder looks “sunk”).
    ...Platform.select({
      ios: {
        paddingVertical: 13,
        lineHeight: 20,
      },
      default: {
        paddingVertical: 0,
        lineHeight: 48,
        // Helps avoid descender clipping on Android.
        includeFontPadding: false,
        textAlignVertical: 'center',
      },
    }),
  },
  blocksInputDark: {
    backgroundColor: APP_COLORS.dark.bg.header,
    borderColor: APP_COLORS.dark.border.subtle,
    color: APP_COLORS.dark.text.primary,
  },
  blocksBtn: {
    height: 48,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: APP_COLORS.light.bg.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: APP_COLORS.light.border.subtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  blocksBtnDark: { backgroundColor: PALETTE.slate750, borderColor: 'transparent' },
  blocksBtnText: { color: APP_COLORS.light.text.primary, fontWeight: '800' },
  blocksBtnTextDark: { color: APP_COLORS.dark.text.primary },
  blocksScroll: { maxHeight: 420, marginTop: 2 },
  blockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: APP_COLORS.light.bg.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: APP_COLORS.light.border.subtle,
    marginBottom: 8,
  },
  blockRowDark: {
    backgroundColor: APP_COLORS.dark.bg.header,
    borderColor: APP_COLORS.dark.border.subtle,
  },
  blockRowName: { fontWeight: '800', color: APP_COLORS.light.text.primary, flexShrink: 1 },
  blockRowNameDark: { color: APP_COLORS.dark.text.primary },
  blockActionBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: APP_COLORS.light.bg.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: APP_COLORS.light.border.subtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  blockActionBtnDark: {
    backgroundColor: PALETTE.slate750,
    borderWidth: 0,
    borderColor: 'transparent',
  },
});

export type AppStyles = typeof styles;
