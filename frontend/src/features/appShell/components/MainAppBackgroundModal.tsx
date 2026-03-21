import AsyncStorage from '@react-native-async-storage/async-storage';
import Slider from '@react-native-community/slider';
import * as ImagePicker from 'expo-image-picker';
import React from 'react';
import {
  Image as RNImage,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { AppStyles } from '../../../../App.styles';
import { AnimatedDots } from '../../../components/AnimatedDots';
import { WebCropModal } from '../../../components/modals/WebCropModal';
import { APP_COLORS, PALETTE } from '../../../theme/colors';
import { blobToDataUrlWeb } from '../../../utils/webImageCrop';

type ChatBackgroundState =
  | { mode: 'default' }
  | { mode: 'color'; color: string }
  | { mode: 'image'; uri: string; blur?: number; opacity?: number };

export function MainAppBackgroundModal({
  styles,
  isDark,
  avatarDefaultColors,

  backgroundOpen,
  setBackgroundOpen,

  backgroundSaving,
  setBackgroundSaving,
  backgroundSavingRef,

  chatBackground,
  setChatBackground,
  chatBackgroundImageScaleMode,
  setChatBackgroundImageScaleMode,

  backgroundDraft,
  setBackgroundDraft,
  backgroundDraftImageUri,
  setBackgroundDraftImageUri,

  backgroundError,
  setBackgroundError,

  bgEffectBlur,
  setBgEffectBlur,
  bgEffectOpacity,
  setBgEffectOpacity,
  bgImageScaleModeDraft,
  setBgImageScaleModeDraft,
}: {
  styles: AppStyles;
  isDark: boolean;
  avatarDefaultColors: string[];

  backgroundOpen: boolean;
  setBackgroundOpen: (v: boolean) => void;

  backgroundSaving: boolean;
  setBackgroundSaving: (v: boolean) => void;
  backgroundSavingRef: React.MutableRefObject<boolean>;

  chatBackground: ChatBackgroundState;
  setChatBackground: React.Dispatch<React.SetStateAction<ChatBackgroundState>>;
  chatBackgroundImageScaleMode: 'fill' | 'fit';
  setChatBackgroundImageScaleMode: React.Dispatch<React.SetStateAction<'fill' | 'fit'>>;

  backgroundDraft: ChatBackgroundState;
  setBackgroundDraft: React.Dispatch<React.SetStateAction<ChatBackgroundState>>;
  backgroundDraftImageUri: string | null;
  setBackgroundDraftImageUri: (v: string | null) => void;

  backgroundError: string | null;
  setBackgroundError: (v: string | null) => void;

  bgEffectBlur: number;
  setBgEffectBlur: (v: number) => void;
  bgEffectOpacity: number;
  setBgEffectOpacity: (v: number) => void;
  bgImageScaleModeDraft: 'fill' | 'fit';
  setBgImageScaleModeDraft: React.Dispatch<React.SetStateAction<'fill' | 'fit'>>;
}): React.JSX.Element {
  const [webCropOpen, setWebCropOpen] = React.useState(false);
  const [webCropSrc, setWebCropSrc] = React.useState<string | null>(null);

  const discardDraft = React.useCallback(() => {
    if (backgroundSavingRef.current) return;
    setBackgroundOpen(false);
    setBackgroundDraft(chatBackground);
    setBgImageScaleModeDraft(chatBackgroundImageScaleMode);
    setBackgroundDraftImageUri(null);
    setBackgroundError(null);
    setWebCropOpen(false);
    setWebCropSrc(null);
  }, [
    backgroundSavingRef,
    chatBackground,
    chatBackgroundImageScaleMode,
    setBgImageScaleModeDraft,
    setBackgroundDraft,
    setBackgroundDraftImageUri,
    setBackgroundError,
    setBackgroundOpen,
  ]);

  const handlePickImage = React.useCallback(async () => {
    try {
      setBackgroundError(null);
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setBackgroundError('Please allow photo library access to choose a background.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: Platform.OS !== 'web',
        aspect: [9, 16],
        quality: 0.9,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      const uri = asset?.uri;
      if (!uri) return;
      // Web: Expo gives us blob URLs; show crop UI so users can adjust framing.
      if (Platform.OS === 'web') {
        setWebCropSrc(uri);
        setWebCropOpen(true);
        return;
      }
      setBackgroundDraftImageUri(uri);
      setBackgroundDraft({ mode: 'image', uri, blur: bgEffectBlur, opacity: bgEffectOpacity });
    } catch (e: unknown) {
      setBackgroundError(e instanceof Error ? e.message : 'Could not pick image.');
    }
  }, [
    bgEffectBlur,
    bgEffectOpacity,
    setBackgroundDraft,
    setBackgroundDraftImageUri,
    setBackgroundError,
  ]);

  const handleSave = React.useCallback(async () => {
    backgroundSavingRef.current = true;
    setBackgroundSaving(true);
    setBackgroundError(null);
    try {
      let effective: ChatBackgroundState;
      if (backgroundDraftImageUri) {
        effective = {
          mode: 'image',
          uri: backgroundDraftImageUri,
          blur: bgEffectBlur,
          opacity: bgEffectOpacity,
        };
      } else if (backgroundDraft.mode === 'image') {
        effective = {
          ...backgroundDraft,
          blur: bgEffectBlur,
          opacity: bgEffectOpacity,
        };
      } else {
        effective = backgroundDraft;
      }
      setChatBackground(effective);
      await AsyncStorage.setItem('ui:chatBackground', JSON.stringify(effective));
      setChatBackgroundImageScaleMode(bgImageScaleModeDraft);
      await AsyncStorage.setItem('ui:chatBackgroundImageScaleMode', bgImageScaleModeDraft);
      setBackgroundOpen(false);
    } catch (e: unknown) {
      setBackgroundError(e instanceof Error ? e.message : 'Failed to save background.');
    } finally {
      backgroundSavingRef.current = false;
      setBackgroundSaving(false);
    }
  }, [
    backgroundDraft,
    backgroundDraftImageUri,
    backgroundSavingRef,
    bgEffectBlur,
    bgEffectOpacity,
    bgImageScaleModeDraft,
    setBackgroundError,
    setBackgroundOpen,
    setBackgroundSaving,
    setChatBackground,
    setChatBackgroundImageScaleMode,
  ]);

  const effectivePreview = backgroundDraftImageUri
    ? ({ mode: 'image', uri: backgroundDraftImageUri } as const)
    : backgroundDraft;
  const photoEnabled = !!backgroundDraftImageUri || backgroundDraft.mode === 'image';

  return (
    <>
      <Modal
        visible={backgroundOpen}
        transparent
        animationType="fade"
        onRequestClose={discardDraft}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            disabled={backgroundSaving}
            onPress={discardDraft}
          />
          <View style={[styles.profileCard, isDark ? styles.profileCardDark : null]}>
            <View style={styles.chatsTopRow}>
              <Text style={[styles.modalTitle, isDark ? styles.modalTitleDark : null]}>
                Background
              </Text>
            </View>

            <ScrollView
              style={{ flexGrow: 0, flexShrink: 1 }}
              contentContainerStyle={{ paddingBottom: 10 }}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.profilePreviewRow}>
                <View style={styles.bgPreviewBox}>
                  {effectivePreview.mode === 'image' ? (
                    <RNImage
                      source={{ uri: effectivePreview.uri }}
                      style={[styles.bgPreviewImage, { opacity: bgEffectOpacity }]}
                      resizeMode="cover"
                      blurRadius={bgEffectBlur}
                    />
                  ) : effectivePreview.mode === 'color' ? (
                    <View
                      style={[StyleSheet.absoluteFill, { backgroundColor: effectivePreview.color }]}
                    />
                  ) : (
                    <View
                      style={[
                        StyleSheet.absoluteFill,
                        {
                          backgroundColor: isDark
                            ? APP_COLORS.dark.bg.app
                            : APP_COLORS.light.bg.app,
                        },
                      ]}
                    />
                  )}
                </View>
                <View style={styles.profilePreviewMeta}>
                  <Text
                    style={[styles.modalHelperText, isDark ? styles.modalHelperTextDark : null]}
                  >
                    Choose a chat background
                  </Text>
                </View>
              </View>

              {backgroundError ? (
                <Text style={[styles.errorText, isDark && styles.errorTextDark]}>
                  {backgroundError}
                </Text>
              ) : null}

              {!backgroundDraftImageUri && backgroundDraft.mode !== 'image' ? (
                <>
                  <Text
                    style={[
                      styles.modalHelperText,
                      isDark ? styles.modalHelperTextDark : null,
                      styles.profileSectionTitle,
                    ]}
                  >
                    Color
                  </Text>
                  <View style={styles.avatarPaletteRow}>
                    {[
                      PALETTE.white,
                      PALETTE.cloud,
                      PALETTE.mist,
                      PALETTE.slate900,
                      PALETTE.orkaDarkBg,
                      ...avatarDefaultColors,
                    ].map((c) => {
                      const selected =
                        backgroundDraft.mode === 'color' && backgroundDraft.color === c;
                      return (
                        <Pressable
                          key={`bgc:${c}`}
                          onPress={() => setBackgroundDraft({ mode: 'color', color: c })}
                          style={[
                            styles.avatarColorDot,
                            { backgroundColor: c },
                            selected
                              ? isDark
                                ? styles.avatarColorDotSelectedDark
                                : styles.avatarColorDotSelected
                              : null,
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel={`Select background color ${c}`}
                        />
                      );
                    })}
                  </View>
                </>
              ) : (
                <Text
                  style={[
                    styles.modalHelperText,
                    isDark ? styles.modalHelperTextDark : null,
                    { marginTop: 6, marginBottom: 4 },
                  ]}
                >
                  Photo background enabled - remove the photo to use a solid color
                </Text>
              )}

              {photoEnabled ? (
                <>
                  <View style={[styles.bgEffectsHeaderRow, { marginTop: 2 }]}>
                    <Text
                      style={[
                        styles.modalHelperText,
                        isDark ? styles.modalHelperTextDark : null,
                        styles.profileSectionTitle,
                        { marginTop: 0, marginBottom: 0 },
                      ]}
                    >
                      Image Scale
                    </Text>
                  </View>
                  <View style={[styles.avatarTextColorRow, { marginTop: 4 }]}>
                    <Pressable
                      onPress={() => setBgImageScaleModeDraft('fill')}
                      style={[
                        styles.avatarTextColorBtn,
                        isDark ? styles.avatarTextColorBtnDark : null,
                        bgImageScaleModeDraft === 'fill'
                          ? isDark
                            ? styles.avatarTextColorBtnSelectedDark
                            : styles.avatarTextColorBtnSelected
                          : null,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel="Fill background (may crop)"
                    >
                      <Text
                        style={[
                          styles.avatarTextColorLabel,
                          isDark ? styles.avatarTextColorLabelDark : null,
                        ]}
                      >
                        Fill
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setBgImageScaleModeDraft('fit')}
                      style={[
                        styles.avatarTextColorBtn,
                        isDark ? styles.avatarTextColorBtnDark : null,
                        bgImageScaleModeDraft === 'fit'
                          ? isDark
                            ? styles.avatarTextColorBtnSelectedDark
                            : styles.avatarTextColorBtnSelected
                          : null,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel="Fit background (no crop)"
                    >
                      <Text
                        style={[
                          styles.avatarTextColorLabel,
                          isDark ? styles.avatarTextColorLabelDark : null,
                        ]}
                      >
                        Fit
                      </Text>
                    </Pressable>
                  </View>

                  <View style={[styles.bgEffectsHeaderRow, { marginTop: 4 }]}>
                    <Text
                      style={[
                        styles.modalHelperText,
                        isDark ? styles.modalHelperTextDark : null,
                        styles.profileSectionTitle,
                        { marginTop: 0, marginBottom: 0 },
                      ]}
                    >
                      Photo effects
                    </Text>
                    <Pressable
                      disabled={backgroundSaving}
                      style={({ pressed }) => [
                        styles.bgEffectsResetBtn,
                        pressed ? { opacity: 0.85 } : null,
                      ]}
                      onPress={() => {
                        setBgEffectBlur(0);
                        setBgEffectOpacity(1);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Reset background effects"
                    >
                      <Text
                        style={[
                          styles.bgEffectsResetText,
                          isDark ? styles.bgEffectsResetTextDark : null,
                        ]}
                      >
                        Reset
                      </Text>
                    </Pressable>
                  </View>

                  <View style={[styles.bgSliderSection, { marginTop: 6 }]}>
                    <View style={styles.bgSliderLabelRow}>
                      <Text
                        style={[styles.bgSliderLabel, isDark ? styles.bgSliderLabelDark : null]}
                      >
                        Blur
                      </Text>
                      <Text
                        style={[styles.bgSliderValue, isDark ? styles.bgSliderValueDark : null]}
                      >
                        {bgEffectBlur}
                      </Text>
                    </View>
                    <Slider
                      style={styles.bgSlider}
                      minimumValue={0}
                      maximumValue={10}
                      step={1}
                      value={bgEffectBlur}
                      onValueChange={(v: number) => setBgEffectBlur(v)}
                      onSlidingComplete={(v: number) =>
                        setBgEffectBlur(Math.max(0, Math.min(10, Math.round(v))))
                      }
                      minimumTrackTintColor={
                        isDark ? APP_COLORS.dark.text.primary : APP_COLORS.light.text.primary
                      }
                      maximumTrackTintColor={
                        isDark ? APP_COLORS.dark.border.subtle : PALETTE.slate190
                      }
                      thumbTintColor={
                        isDark ? APP_COLORS.dark.text.primary : APP_COLORS.light.text.primary
                      }
                    />
                  </View>

                  <View style={styles.bgSliderSection}>
                    <View style={styles.bgSliderLabelRow}>
                      <Text
                        style={[styles.bgSliderLabel, isDark ? styles.bgSliderLabelDark : null]}
                      >
                        Opacity
                      </Text>
                      <Text
                        style={[styles.bgSliderValue, isDark ? styles.bgSliderValueDark : null]}
                      >
                        {`${Math.round(bgEffectOpacity * 100)}%`}
                      </Text>
                    </View>
                    <Slider
                      style={styles.bgSlider}
                      minimumValue={0.2}
                      maximumValue={1}
                      step={0.01}
                      value={bgEffectOpacity}
                      onValueChange={(v: number) => setBgEffectOpacity(Math.round(v * 100) / 100)}
                      onSlidingComplete={(v: number) =>
                        setBgEffectOpacity(Math.max(0.2, Math.min(1, Math.round(v * 100) / 100)))
                      }
                      minimumTrackTintColor={
                        isDark ? APP_COLORS.dark.text.primary : APP_COLORS.light.text.primary
                      }
                      maximumTrackTintColor={
                        isDark ? APP_COLORS.dark.border.subtle : PALETTE.slate190
                      }
                      thumbTintColor={
                        isDark ? APP_COLORS.dark.text.primary : APP_COLORS.light.text.primary
                      }
                    />
                  </View>
                </>
              ) : null}

              <View style={styles.profileActionsRow}>
                <Pressable
                  disabled={backgroundSaving}
                  style={({ pressed }) => [
                    styles.toolBtn,
                    isDark && styles.toolBtnDark,
                    backgroundSaving ? { opacity: 0.5 } : null,
                    pressed && !backgroundSaving ? { opacity: 0.92 } : null,
                  ]}
                  onPress={() => void handlePickImage()}
                  accessibilityRole="button"
                >
                  <Text style={[styles.toolBtnText, isDark && styles.toolBtnTextDark]}>
                    Choose Image
                  </Text>
                </Pressable>

                <Pressable
                  disabled={
                    backgroundSaving ||
                    (!backgroundDraftImageUri && backgroundDraft.mode !== 'image')
                  }
                  style={({ pressed }) => [
                    styles.toolBtn,
                    isDark && styles.toolBtnDark,
                    backgroundSaving ||
                    (!backgroundDraftImageUri && backgroundDraft.mode !== 'image')
                      ? { opacity: 0.5 }
                      : null,
                    pressed &&
                    !(
                      backgroundSaving ||
                      (!backgroundDraftImageUri && backgroundDraft.mode !== 'image')
                    )
                      ? { opacity: 0.92 }
                      : null,
                  ]}
                  onPress={() => {
                    setBackgroundDraftImageUri(null);
                    setBackgroundDraft({ mode: 'default' });
                  }}
                  accessibilityRole="button"
                >
                  <Text style={[styles.toolBtnText, isDark && styles.toolBtnTextDark]}>
                    Remove Image
                  </Text>
                </Pressable>

                <Pressable
                  disabled={backgroundSaving}
                  style={({ pressed }) => [
                    styles.toolBtn,
                    isDark && styles.toolBtnDark,
                    backgroundSaving ? { opacity: 0.5 } : null,
                    pressed && !backgroundSaving ? { opacity: 0.92 } : null,
                  ]}
                  onPress={() => {
                    setBackgroundDraftImageUri(null);
                    setBackgroundDraft({ mode: 'default' });
                  }}
                  accessibilityRole="button"
                >
                  <Text style={[styles.toolBtnText, isDark && styles.toolBtnTextDark]}>
                    Default
                  </Text>
                </Pressable>
              </View>
            </ScrollView>

            <View style={[styles.modalButtons, { marginTop: 10 }]}>
              <Pressable
                style={({ pressed }) => [
                  styles.modalButton,
                  styles.modalButtonSmall,
                  isDark ? styles.modalButtonDark : null,
                  pressed ? { opacity: 0.92 } : null,
                ]}
                onPress={() => void handleSave()}
                disabled={backgroundSaving}
              >
                {backgroundSaving ? (
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 2,
                    }}
                  >
                    <Text
                      style={[styles.modalButtonText, isDark ? styles.modalButtonTextDark : null]}
                    >
                      Saving
                    </Text>
                    <AnimatedDots
                      color={isDark ? APP_COLORS.dark.text.primary : APP_COLORS.light.text.primary}
                      size={18}
                    />
                  </View>
                ) : (
                  <Text
                    style={[styles.modalButtonText, isDark ? styles.modalButtonTextDark : null]}
                  >
                    Save
                  </Text>
                )}
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  styles.modalButton,
                  styles.modalButtonSmall,
                  isDark ? styles.modalButtonDark : null,
                  pressed ? { opacity: 0.92 } : null,
                ]}
                onPress={discardDraft}
                disabled={backgroundSaving}
              >
                <Text style={[styles.modalButtonText, isDark ? styles.modalButtonTextDark : null]}>
                  Close
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <WebCropModal
        styles={styles}
        isDark={isDark}
        visible={Platform.OS === 'web' && webCropOpen}
        title="Crop background"
        imageSrc={webCropSrc}
        aspect={9 / 16}
        previewObjectFit={bgImageScaleModeDraft === 'fit' ? 'contain' : 'cover'}
        viewportMaxWidth={460}
        viewportMaxHeight={560}
        outWidth={720}
        outHeight={1280}
        quality={0.82}
        onCancel={() => {
          setWebCropOpen(false);
          setWebCropSrc(null);
        }}
        onDone={async ({ blob }) => {
          const dataUrl = await blobToDataUrlWeb(blob);
          setBackgroundDraftImageUri(dataUrl);
          setBackgroundDraft({
            mode: 'image',
            uri: dataUrl,
            blur: bgEffectBlur,
            opacity: bgEffectOpacity,
          });
          setWebCropOpen(false);
          setWebCropSrc(null);
        }}
      />
    </>
  );
}
