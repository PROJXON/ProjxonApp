import React from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import type { ChatScreenStyles } from '../../../screens/ChatScreen.styles';

type Props = {
  visible: boolean;
  isDark: boolean;
  /** DM / group: explain that decrypted message text leaves the device for OpenAI. */
  isEncryptedChat: boolean;
  // Uses ChatScreen's style keys for now (pure extraction).
  styles: ChatScreenStyles;
  onProceed: () => void;
  onCancel: () => void;
};

export function AiConsentModal({
  visible,
  isDark,
  isEncryptedChat,
  styles,
  onProceed,
  onCancel,
}: Props): React.JSX.Element {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.modalOverlay}>
        <View style={[styles.summaryModal, isDark ? styles.summaryModalDark : null]}>
          <Text style={[styles.summaryTitle, isDark ? styles.summaryTitleDark : null]}>
            AI {'&'} OpenAI
          </Text>
          <ScrollView style={styles.summaryScroll}>
            {isEncryptedChat ? (
              <>
                <Text style={[styles.summaryText, isDark ? styles.summaryTextDark : null]}>
                  <Text style={{ fontWeight: '700' }}>Encrypted chat:</Text> this DM or group is
                  encrypted between participants. Summarize and AI Helper only use message text that is
                  already decrypted on your device for this view, then send that text to{' '}
                  <Text style={{ fontWeight: '700' }}>OpenAI</Text> (OpenAI, L.L.C.) so it can return
                  a summary or suggested reply. OpenAI receives the content in readable form for this
                  request only after you tap Continue.
                </Text>
                <Text style={[styles.summaryText, isDark ? styles.summaryTextDark : null, { marginTop: 12 }]}>
                  Also sent: display names, the conversation id for this chat, and, if you use AI Helper
                  with media, up to a few small image or video thumbnails (see our Privacy Policy).
                  Nothing is sent until you choose Continue.
                </Text>
              </>
            ) : (
              <>
                <Text style={[styles.summaryText, isDark ? styles.summaryTextDark : null]}>
                  Summarize and AI Helper send data from this conversation to{' '}
                  <Text style={{ fontWeight: '700' }}>OpenAI</Text> (OpenAI, L.L.C.) so it can return
                  a summary or suggested text.
                </Text>
                <Text style={[styles.summaryText, isDark ? styles.summaryTextDark : null, { marginTop: 12 }]}>
                  What may be sent: recent message text, display names, the conversation id, and, if
                  you use AI Helper with media, small image or video thumbnails (see our Privacy Policy).
                  Nothing is sent until you tap Continue.
                </Text>
              </>
            )}
            <Text style={[styles.summaryText, isDark ? styles.summaryTextDark : null, { marginTop: 12 }]}>
              {isEncryptedChat ? (
                <>
                  Tap Continue to send this request to OpenAI. Cancel skips for now. We will show this
                  again after you fully close and reopen the app.
                </>
              ) : (
                <>
                  Tap Continue to send this request to OpenAI. Cancel skips for now. We will not show this
                  again on this device unless you reinstall the app or clear its storage.
                </>
              )}
            </Text>
          </ScrollView>
          <View style={styles.summaryButtons}>
            <Pressable
              style={[styles.toolBtn, isDark ? styles.toolBtnDark : null]}
              onPress={onProceed}
            >
              <Text style={[styles.toolBtnText, isDark ? styles.toolBtnTextDark : null]}>
                Continue
              </Text>
            </Pressable>
            <Pressable
              style={[styles.toolBtn, isDark ? styles.toolBtnDark : null]}
              onPress={onCancel}
            >
              <Text style={[styles.toolBtnText, isDark ? styles.toolBtnTextDark : null]}>
                Cancel
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
