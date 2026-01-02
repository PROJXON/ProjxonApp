import React from 'react';
import { Alert, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as ScreenOrientation from 'expo-screen-orientation';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type InAppCameraMode = 'photo' | 'video';

export type InAppCameraCapture = {
  uri: string;
  mode: InAppCameraMode;
};

function VideoPreview({ uri }: { uri: string }): React.JSX.Element {
  const player = useVideoPlayer(uri, (p: any) => {
    try {
      p.play();
    } catch {}
  });
  return <VideoView player={player} style={styles.preview} contentFit="cover" nativeControls />;
}

export function InAppCameraModal({
  visible,
  initialMode,
  onClose,
  onCaptured,
  onAlert,
}: {
  visible: boolean;
  initialMode?: InAppCameraMode;
  onClose: () => void;
  onCaptured: (capture: InAppCameraCapture) => void;
  onAlert?: (title: string, message: string) => void | Promise<void>;
}): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const cameraRef = React.useRef<any>(null);
  const [facing, setFacing] = React.useState<'back' | 'front'>('back');
  const [captured, setCaptured] = React.useState<InAppCameraCapture | null>(null);
  const [isRecording, setIsRecording] = React.useState(false);
  const [cameraReady, setCameraReady] = React.useState(false);
  const [mode, setMode] = React.useState<InAppCameraMode>(initialMode ?? 'photo');
  const [camPerm, requestCamPerm] = useCameraPermissions();
  const [micPerm, requestMicPerm] = useMicrophonePermissions();

  const showAlert = React.useCallback(
    (title: string, message: string) => {
      if (typeof onAlert === 'function') {
        try {
          void Promise.resolve(onAlert(title, message));
          return;
        } catch {
          // fall through to native alert
        }
      }
      Alert.alert(title, message);
    },
    [onAlert]
  );

  React.useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      try {
        await ScreenOrientation.unlockAsync();
      } catch {
        // ignore
      }
      try {
        if (!camPerm?.granted) {
          const p = await requestCamPerm();
          if (!p.granted && !cancelled) {
            // Keep permission prompts as a native system alert (more appropriate than themed modals).
            Alert.alert(
              'Permission needed',
              'Please allow camera access to capture media.\n\nIf you previously denied this permission, enable it in Settings.'
            );
            onClose();
            return;
          }
        }
      } catch (e: any) {
        if (!cancelled) showAlert('Camera failed', e?.message ?? 'Unknown error');
        onClose();
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, showAlert]);

  React.useEffect(() => {
    if (!visible) return;
    // Reset state each time we open.
    setMode(initialMode ?? 'photo');
    return () => {
      // When closing, restore portrait lock for the rest of the app.
      (async () => {
        try {
          await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
        } catch {
          // ignore
        }
      })();
    };
  }, [visible]);

  const closeAndReset = React.useCallback(() => {
    try {
      cameraRef.current?.stopRecording?.();
    } catch {
      // ignore
    }
    setCaptured(null);
    setIsRecording(false);
    setCameraReady(false);
    onClose();
  }, [onClose]);

  const ensureMicPerm = React.useCallback(async (): Promise<boolean> => {
    try {
      if (micPerm?.granted) return true;
      const p = await requestMicPerm();
      return !!p.granted;
    } catch {
      return false;
    }
  }, [micPerm?.granted, requestMicPerm]);

  const takePhoto = React.useCallback(async () => {
    try {
      const cam = cameraRef.current;
      if (!cam?.takePictureAsync) return;
      // Still-photo behavior on Android emulators is inconsistent; prefer the default processing pipeline
      // (skipProcessing can yield black frames on some setups).
      const res = await cam.takePictureAsync({ quality: 1 });
      if (!res?.uri) return;
      setCaptured({ uri: String(res.uri), mode: 'photo' });
    } catch (e: any) {
      showAlert('Camera failed', e?.message ?? 'Unknown error');
    }
  }, [showAlert]);

  const startVideo = React.useCallback(async () => {
    try {
      const ok = await ensureMicPerm();
      if (!ok) {
        // Keep permission prompts as a native system alert (more appropriate than themed modals).
        Alert.alert(
          'Permission needed',
          'Please allow microphone access to record video.\n\nIf you previously denied this permission, enable it in Settings.'
        );
        return;
      }
      const cam = cameraRef.current;
      if (!cam?.recordAsync) return;
      setIsRecording(true);
      const res = await cam.recordAsync();
      if (res?.uri) setCaptured({ uri: String(res.uri), mode: 'video' });
    } catch (e: any) {
      showAlert('Camera failed', e?.message ?? 'Unknown error');
    } finally {
      setIsRecording(false);
    }
  }, [ensureMicPerm, showAlert]);

  const stopVideo = React.useCallback(() => {
    try {
      cameraRef.current?.stopRecording?.();
    } catch {
      // ignore
    }
  }, []);

  const confirm = React.useCallback(() => {
    if (!captured) return;
    onCaptured(captured);
    setCaptured(null);
    onClose();
  }, [captured, onCaptured, onClose]);

  const retake = React.useCallback(() => {
    setCaptured(null);
  }, []);

  const toggleFacing = React.useCallback(() => {
    setFacing((p) => (p === 'back' ? 'front' : 'back'));
  }, []);

  const setModeSafe = React.useCallback(
    async (next: InAppCameraMode) => {
      if (next === mode) return;
      if (isRecording) stopVideo();
      if (next === 'video') {
        const ok = await ensureMicPerm();
        if (!ok) {
          // Keep permission prompts as a native system alert (more appropriate than themed modals).
          Alert.alert(
            'Permission needed',
            'Please allow microphone access to record video.\n\nIf you previously denied this permission, enable it in Settings.'
          );
          return;
        }
      }
      setMode(next);
    },
    [ensureMicPerm, isRecording, mode, stopVideo, showAlert]
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={closeAndReset}>
      <View style={styles.root}>
        {/* Camera/preview is the background layer */}
        <View style={StyleSheet.absoluteFill}>
          {captured ? (
            captured.mode === 'photo' ? (
              <Image source={{ uri: captured.uri }} style={styles.preview} resizeMode="cover" />
            ) : (
              <VideoPreview uri={captured.uri} />
            )
          ) : (
            <CameraView
              ref={cameraRef}
              style={styles.preview}
              facing={facing}
              mode={mode === 'video' ? 'video' : 'picture'}
              videoQuality={mode === 'video' ? '1080p' : undefined}
              onCameraReady={() => setCameraReady(true)}
              // On some Android setups the camera surface can swallow touches; ensure overlays stay clickable.
              pointerEvents="none"
              onMountError={(e: any) => {
                const msg = e?.nativeEvent?.message ?? e?.message ?? 'Camera failed to start';
                showAlert('Camera failed', String(msg));
              }}
            />
          )}
        </View>

        {/* Controls overlay */}
        <View style={styles.overlay} pointerEvents="box-none">
          <View
            style={[
              styles.topBar,
              {
                // Visually flush to the top, but keep content below status bar/notch.
                paddingTop: Math.max(insets.top, 6),
                paddingBottom: 6,
              },
            ]}
          >
            <Pressable onPress={closeAndReset} style={({ pressed }) => [styles.topBtn, pressed && { opacity: 0.85 }]}>
              <Text style={styles.topBtnText}>Close</Text>
            </Pressable>
            <View style={styles.centerTitleWrap} pointerEvents="box-none">
              <Text style={styles.title}>Camera</Text>
            </View>
            {!captured ? (
              <Pressable onPress={toggleFacing} style={({ pressed }) => [styles.topBtn, pressed && { opacity: 0.85 }]}>
                <Text style={styles.topBtnText}>Flip</Text>
              </Pressable>
            ) : (
              <View style={styles.topBtn} />
            )}
          </View>

          <View
            pointerEvents="box-none"
            style={[
              styles.bottomBar,
              {
                // Keep the controls comfortably centered; safe-area padding should not shove content upward.
                paddingTop: 12,
                paddingBottom: 12 + insets.bottom,
              },
            ]}
          >
              <View
              style={[
                styles.bottomContent,
                // When previewing a video with native controls, the scrubber can overlap the very bottom.
                // Lift ONLY the controls row so the translucent bottom bar still extends to the bottom edge.
                captured?.mode === 'video' ? styles.bottomContentLiftForVideo : null,
              ]}
            >
              {captured ? (
                <>
                  <Pressable
                    onPress={retake}
                    style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.9 }]}
                  >
                    <Text style={styles.actionBtnText}>Retake</Text>
                  </Pressable>
                  <Pressable
                    onPress={confirm}
                    style={({ pressed }) => [styles.actionBtnPrimary, pressed && { opacity: 0.9 }]}
                  >
                    <Text style={styles.actionBtnPrimaryText}>Use</Text>
                  </Pressable>
                </>
              ) : (
                <View style={styles.captureColumn}>
                  <Pressable
                    onPress={() => {
                      if (mode === 'photo') void takePhoto();
                      else if (isRecording) stopVideo();
                      else void startVideo();
                    }}
                    disabled={!cameraReady}
                    style={({ pressed }) => [
                      styles.captureOuter,
                      !cameraReady ? { opacity: 0.5 } : null,
                      pressed && cameraReady ? { opacity: 0.9 } : null,
                    ]}
                  >
                    {mode === 'photo' ? (
                      <View style={styles.shutterInner} />
                    ) : isRecording ? (
                      <View style={styles.recordStopSquare} />
                    ) : (
                      <View style={styles.recordRedDot} />
                    )}
                  </Pressable>

                  <View style={styles.modeToggleRowBottom}>
                    <Pressable
                      onPress={() => void setModeSafe('photo')}
                      style={({ pressed }) => [
                        styles.modePill,
                        mode === 'photo' ? styles.modePillActive : null,
                        pressed ? { opacity: 0.9 } : null,
                      ]}
                    >
                      <Text style={[styles.modePillText, mode === 'photo' ? styles.modePillTextActive : null]}>
                        Photo
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => void setModeSafe('video')}
                      style={({ pressed }) => [
                        styles.modePill,
                        mode === 'video' ? styles.modePillActive : null,
                        pressed ? { opacity: 0.9 } : null,
                      ]}
                    >
                      <Text style={[styles.modePillText, mode === 'video' ? styles.modePillTextActive : null]}>
                        Video
                      </Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  overlay: {
    flex: 1,
    justifyContent: 'space-between',
    // Ensure overlay stays above camera surface on Android
    zIndex: 10,
    elevation: 10,
  },
  topBar: {
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  centerTitleWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { color: '#fff', fontWeight: '900', fontSize: 14 },
  topBtn: { width: 56, paddingVertical: 6 },
  topBtnText: { color: '#fff', fontWeight: '800' },
  captureColumn: { alignItems: 'center' },
  modeToggleRowBottom: { marginTop: 10, flexDirection: 'row', gap: 8 },
  modePill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  modePillActive: {
    borderColor: 'rgba(255,255,255,0.6)',
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  modePillText: { color: 'rgba(255,255,255,0.85)', fontWeight: '900', fontSize: 12 },
  modePillTextActive: { color: '#fff' },
  preview: { width: '100%', height: '100%', backgroundColor: '#000' },
  bottomBar: {
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  bottomContent: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  // Just enough to clear the native video scrubber without floating awkwardly high.
  bottomContentLiftForVideo: { marginBottom: 44 },
  captureOuter: {
    width: 66,
    height: 66,
    borderRadius: 33,
    borderWidth: 3,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#fff' },
  recordRedDot: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#ff3b30',
  },
  recordStopSquare: {
    width: 30,
    height: 30,
    borderRadius: 6,
    backgroundColor: '#ff3b30',
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
  },
  actionBtnText: { color: '#fff', fontWeight: '800' },
  actionBtnPrimary: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.55)',
    // "Glass" primary: stays readable but lets content show through.
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
  },
  actionBtnPrimaryText: { color: '#fff', fontWeight: '900' },
});


