import * as React from 'react';
import type { TextInput } from 'react-native';
import { Animated, Modal, Platform, Text, View } from 'react-native';

import { AppBrandIcon } from '../../../components/AppBrandIcon';
import type { InAppCameraCapture } from '../../../components/InAppCameraModal';
import { InAppCameraModal } from '../../../components/InAppCameraModal';
import { MediaViewerModal } from '../../../components/MediaViewerModal';
import type { ChatScreenStyles } from '../../../screens/ChatScreen.styles';
import type { MemberRow } from '../../../types/members';
import {
  SAVE_TO_PHONE_DONT_SHOW_AGAIN_KEY,
  SAVE_TO_PHONE_DONT_SHOW_AGAIN_LABEL,
} from '../../../utils/saveToPhonePrompt';
import type { ChatMessage } from '../types';
import type { ChatCopyToClipboardOptions } from '../useChatCopyToClipboard';
import type { ChatMediaViewerState } from '../viewerTypes';
import { AiConsentModal } from './AiConsentModal';
import { AiHelperModal } from './AiHelperModal';
import { AttachPickerModal } from './AttachPickerModal';
import { ChannelAboutModal } from './ChannelAboutModal';
import { ChannelMembersModal } from './ChannelMembersModal';
import { ChannelNameModal } from './ChannelNameModal';
import { ChannelPasswordModal } from './ChannelPasswordModal';
import { CiphertextModal } from './CiphertextModal';
import { GroupMembersModal } from './GroupMembersModal';
import { GroupNameModal } from './GroupNameModal';
import { InfoModal } from './InfoModal';
import { MessageActionMenuModal } from './MessageActionMenuModal';
import { ReactionInfoModal } from './ReactionInfoModal';
import { ReactionPickerModal } from './ReactionPickerModal';
import { ReportModal } from './ReportModal';
import { SummaryModal } from './SummaryModal';
import { TtlPickerModal } from './TtlPickerModal';

type UiConfirm = React.ComponentProps<typeof MessageActionMenuModal>['uiConfirm'];
type UiChoice3 = React.ComponentProps<typeof MessageActionMenuModal>['uiChoice3'];
type ReportCdnMedia = React.ComponentProps<typeof ReportModal>['cdnMedia'];

type AiHelperController = {
  open: boolean;
  thread: React.ComponentProps<typeof AiHelperModal>['thread'];
  instruction: string;
  loading: boolean;
  mode: 'ask' | 'reply';
  setInstruction: (t: string) => void;
  setMode: (m: 'ask' | 'reply') => void;
  submit: () => void;
  resetHelperThread: () => void;
  closeHelper: () => void;
  scrollRef: React.ComponentProps<typeof AiHelperModal>['scrollRef'];
  scrollContentRef: React.ComponentProps<typeof AiHelperModal>['scrollContentRef'];
  lastTurnRef: React.ComponentProps<typeof AiHelperModal>['lastTurnRef'];
  lastAssistantLayoutRef: React.ComponentProps<typeof AiHelperModal>['lastAssistantLayoutRef'];
  scrollViewportHRef: React.ComponentProps<typeof AiHelperModal>['scrollViewportHRef'];
  scrollContentHRef: React.ComponentProps<typeof AiHelperModal>['scrollContentHRef'];
  scrollYRef: React.ComponentProps<typeof AiHelperModal>['scrollYRef'];
  lastAutoScrollAtRef: React.ComponentProps<typeof AiHelperModal>['lastAutoScrollAtRef'];
  lastAutoScrollContentHRef: React.ComponentProps<
    typeof AiHelperModal
  >['lastAutoScrollContentHRef'];
  lastAutoScrollModeRef: React.ComponentProps<typeof AiHelperModal>['lastAutoScrollModeRef'];
  autoScrollRetryRef: React.ComponentProps<typeof AiHelperModal>['autoScrollRetryRef'];
  autoScrollIntentRef: React.ComponentProps<typeof AiHelperModal>['autoScrollIntentRef'];
  autoScroll: () => void;
};

type ReportController = {
  reportOpen: boolean;
  reportSubmitting: boolean;
  reportNotice: React.ComponentProps<typeof ReportModal>['notice'];
  reportKind: React.ComponentProps<typeof ReportModal>['reportKind'];
  reportCategory: React.ComponentProps<typeof ReportModal>['reportCategory'];
  reportTargetMessage: React.ComponentProps<typeof ReportModal>['reportTargetMessage'];
  reportTargetUserSub: React.ComponentProps<typeof ReportModal>['reportTargetUserSub'];
  reportTargetUserLabel: React.ComponentProps<typeof ReportModal>['reportTargetUserLabel'];
  reportDetails: React.ComponentProps<typeof ReportModal>['reportDetails'];
  closeReportModal: () => void;
  submitReport: () => void;
  setReportKind: (k: React.ComponentProps<typeof ReportModal>['reportKind']) => void;
  setReportCategory: (c: React.ComponentProps<typeof ReportModal>['reportCategory']) => void;
  setReportDetails: (t: string) => void;
  setReportTargetUserSub: (sub: string) => void;
  setReportTargetUserLabel: (label: string) => void;
  setReportNotice: (n: React.ComponentProps<typeof ReportModal>['notice']) => void;
};

type MessageActionMenuController = {
  open: boolean;
  anchor: React.ComponentProps<typeof MessageActionMenuModal>['anchor'];
  anim: React.ComponentProps<typeof MessageActionMenuModal>['anim'];
  measuredH?: number;
  measuredHRef: React.ComponentProps<typeof MessageActionMenuModal>['measuredHRef'];
  onMeasuredH: React.ComponentProps<typeof MessageActionMenuModal>['onMeasuredH'];
  target: ChatMessage | null;
  closeMenu: () => void;
};

type MessageOps = {
  sendReaction: (msg: ChatMessage, emoji: string) => void;
  openReactionPicker: (msg: ChatMessage) => void;
  setCipherText: (t: string) => void;
  setCipherOpen: (v: boolean) => void;
  beginReply: (msg: ChatMessage) => void;
  beginInlineEdit: (msg: ChatMessage) => void;
  setInlineEditAttachmentMode: (m: 'keep' | 'replace' | 'remove') => void;
  handlePickMedia: () => void;
  clearPendingMedia: () => void;
  deleteForMe: (msg: ChatMessage) => void | Promise<void>;
  sendDeleteForEveryone: () => void | Promise<void>;
  openReportModalForMessage: (msg: ChatMessage) => void;
};

type ReactionInfoController = {
  open: boolean;
  emoji: string;
  subsSorted: string[];
  target: ChatMessage | null;
  closeReactionInfo: () => void;
};

type ViewerController = {
  open: boolean;
  state: ChatMediaViewerState;
  setState: React.Dispatch<React.SetStateAction<ChatMediaViewerState>>;
  saving?: boolean;
  saveToDevice: () => void | Promise<void>;
  close: () => void;
};

// Ops are validated server-side; keep this surface flexible.

export type ChatScreenOverlaysProps = {
  isDark: boolean;
  styles: ChatScreenStyles;
  insets: { top: number; bottom: number };

  // AI summary + consent
  aiSummary: { open: boolean; loading: boolean; text: string; close: () => void };
  /** DM / group: show copy that decrypted message text is sent to OpenAI. */
  isEncryptedChatForAiConsent: boolean;
  aiConsentGate: {
    open: boolean;
    onProceed: (run: (a: 'summary' | 'helper') => void) => void;
    onCancel: () => void;
  };
  runAiAction: (a: 'summary' | 'helper') => void;

  attach: {
    open: boolean;
    setOpen: (v: boolean) => void;
    pickFromLibrary: () => Promise<void> | void;
    openCamera: () => Promise<void> | void;
    pickDocument: () => Promise<void> | void;
  };

  camera: {
    open: boolean;
    setOpen: (v: boolean) => void;
    showAlert: (title: string, body: string) => void;
    onCaptured: (cap: InAppCameraCapture) => void;
  };

  // AI helper
  aiHelper: AiHelperController;
  copyToClipboard: (text: string, opts?: ChatCopyToClipboardOptions) => Promise<boolean>;
  setInput: (t: string) => void;

  // Reporting
  report: ReportController;
  cdnMedia: ReportCdnMedia;

  // Message actions + reactions
  messageActionMenu: MessageActionMenuController;
  myUserId: string | null | undefined;
  myPublicKey: string | null | undefined;
  displayName: string;
  isDm: boolean;
  encryptedPlaceholder: string;
  normalizeUser: (v: unknown) => string;
  mediaUrlByPath: Record<string, string>;
  dmThumbUriByPath: Record<string, string>;
  messageListData: ChatMessage[];
  quickReactions: string[];
  blockedSubsSet: Set<string>;
  onBlockUserSub?: (blockedSub: string, label?: string) => void | Promise<void>;
  uiConfirm: UiConfirm;
  uiChoice3: UiChoice3;
  messageOps: MessageOps;
  // Multi-select
  selectionActive?: boolean;
  onSelectMessage?: (msg: ChatMessage) => void;

  reactionPickerOpen: boolean;
  reactionPickerTarget: ChatMessage | null;
  emojis: string[];
  closeReactionPicker: () => void;

  cipher: {
    open: boolean;
    text: string;
    setOpen: (v: boolean) => void;
    setText: (t: string) => void;
  };

  reactionInfo: ReactionInfoController;
  nameBySub: Record<string, string>;

  // Info modal
  info: {
    infoOpen: boolean;
    infoTitle: string;
    infoBody: string;
    setInfoOpen: (v: boolean) => void;
  };

  // TTL picker
  ttl: {
    ttlPickerOpen: boolean;
    TTL_OPTIONS: Array<{ label: string; seconds: number }>;
    ttlIdx: number;
    ttlIdxDraft: number;
    setTtlIdxDraft: (v: number) => void;
    setTtlPickerOpen: (v: boolean) => void;
    setTtlIdx: (v: number) => void;
  };

  // Group
  groupNameEditOpen: boolean;
  groupActionBusy: boolean;
  groupNameDraft: string;
  setGroupNameDraft: (v: string) => void;
  groupNameModalActions: {
    onDefault: () => void | Promise<void>;
    onSave: () => void | Promise<void>;
    onCancel: () => void;
  };

  groupMembersOpen: boolean;
  groupMeta: { meIsAdmin?: boolean } | null;
  groupAddMembersDraft: string;
  setGroupAddMembersDraft: (v: string) => void;
  groupMembersModalActions: {
    onAddMembers: () => void | Promise<void>;
    onBan: (args: { memberSub: string; label: string }) => void | Promise<void>;
    onClose: () => void;
  };
  groupAddMembersInputRef: React.MutableRefObject<TextInput | null>;
  groupMembersVisible: MemberRow[];
  kickCooldownUntilBySub: Record<string, number>;
  avatarUrlByPath: Record<string, string>;
  groupKick: (memberSub: string) => void;
  groupUpdate: (op: string, args: Record<string, unknown>) => Promise<unknown> | void;

  // Channel
  channelMembersOpen: boolean;
  channelMembersVisible: MemberRow[];
  channelMeta: {
    meIsAdmin?: boolean;
    name?: string;
    isPublic?: boolean;
    hasPassword?: boolean;
  } | null;
  channelActionBusy: boolean;
  channelMembersModalActions: {
    onAddMembers: () => void | Promise<void>;
    onBan: (args: { memberSub: string; label: string }) => void | Promise<void>;
    onToggleAdmin: (args: { memberSub: string; isAdmin: boolean }) => void;
    onClose: () => void;
  };
  channelAddMembersDraft: string;
  setChannelAddMembersDraft: (v: string) => void;
  channelAddMembersInputRef: React.MutableRefObject<TextInput | null>;
  channelUpdate: (op: string, args: Record<string, unknown>) => Promise<unknown> | void;
  channelKick: (memberSub: string) => void;

  channelAboutOpen: boolean;
  channelAboutEdit: boolean;
  channelAboutDraft: string;
  setChannelAboutDraft: (v: string) => void;
  setChannelAboutEdit: (v: boolean) => void;
  channelAboutModalActions: {
    onRequestClose: () => void;
    onBackdropPress: () => void;
    onSave: () => void | Promise<void>;
    onCancelEdit: () => void;
    onGotIt: () => void;
  };
  requestOpenLink: (url: string) => void;

  channelNameEditOpen: boolean;
  channelNameDraft: string;
  setChannelNameDraft: (v: string) => void;
  channelNameModalActions: { onSave: () => void | Promise<void>; onCancel: () => void };

  channelPasswordEditOpen: boolean;
  channelPasswordDraft: string;
  setChannelPasswordDraft: (v: string) => void;
  channelPasswordModalActions: { onSave: () => void | Promise<void>; onCancel: () => void };

  // Viewer
  viewer: ViewerController;
  dmFileUriByPath: Record<string, string>;

  // Confirm link modal (React node)
  confirmLinkModal: React.ReactNode;

  // Toast
  toast: { message: string; kind?: 'success' | 'error' } | null;
  toastAnim: Animated.Value;
};

export function ChatScreenOverlays(props: ChatScreenOverlaysProps): React.JSX.Element {
  const {
    isDark,
    styles,
    insets,
    aiSummary,
    isEncryptedChatForAiConsent,
    aiConsentGate,
    runAiAction,
    attach,
    camera,
    aiHelper,
    copyToClipboard,
    setInput,
    report,
    cdnMedia,
    messageActionMenu,
    myUserId,
    myPublicKey,
    displayName,
    isDm,
    encryptedPlaceholder,
    normalizeUser,
    mediaUrlByPath,
    dmThumbUriByPath,
    messageListData,
    quickReactions,
    blockedSubsSet,
    onBlockUserSub,
    uiConfirm,
    uiChoice3,
    messageOps,
    selectionActive,
    onSelectMessage,
    reactionPickerOpen,
    reactionPickerTarget,
    emojis,
    closeReactionPicker,
    cipher,
    reactionInfo,
    nameBySub,
    info,
    ttl,
    groupNameEditOpen,
    groupActionBusy,
    groupNameDraft,
    setGroupNameDraft,
    groupNameModalActions,
    groupMembersOpen,
    groupMeta,
    groupAddMembersDraft,
    setGroupAddMembersDraft,
    groupMembersModalActions,
    groupAddMembersInputRef,
    groupMembersVisible,
    kickCooldownUntilBySub,
    avatarUrlByPath,
    groupKick,
    groupUpdate,
    channelMembersOpen,
    channelMembersVisible,
    channelMeta,
    channelActionBusy,
    channelMembersModalActions,
    channelAddMembersDraft,
    setChannelAddMembersDraft,
    channelAddMembersInputRef,
    channelUpdate,
    channelKick,
    channelAboutOpen,
    channelAboutEdit,
    channelAboutDraft,
    setChannelAboutDraft,
    setChannelAboutEdit,
    channelAboutModalActions,
    requestOpenLink,
    channelNameEditOpen,
    channelNameDraft,
    setChannelNameDraft,
    channelNameModalActions,
    channelPasswordEditOpen,
    channelPasswordDraft,
    setChannelPasswordDraft,
    channelPasswordModalActions,
    viewer,
    dmFileUriByPath,
    confirmLinkModal,
    toast,
    toastAnim,
  } = props;

  return (
    <>
      <SummaryModal
        visible={aiSummary.open}
        isDark={isDark}
        styles={styles}
        loading={aiSummary.loading}
        text={aiSummary.text}
        onClose={aiSummary.close}
      />

      <AiConsentModal
        visible={aiConsentGate.open}
        isDark={isDark}
        isEncryptedChat={isEncryptedChatForAiConsent}
        styles={styles}
        onProceed={() => aiConsentGate.onProceed(runAiAction)}
        onCancel={aiConsentGate.onCancel}
      />

      <AttachPickerModal
        visible={attach.open}
        isDark={isDark}
        styles={styles}
        onClose={() => attach.setOpen(false)}
        onPickLibrary={() => {
          attach.setOpen(false);
          setTimeout(() => void attach.pickFromLibrary(), 0);
        }}
        onPickCamera={() => {
          attach.setOpen(false);
          // iOS first-run permission prompts can race with modal transitions.
          // Give the attach modal a brief moment to fully close before opening camera.
          setTimeout(() => void attach.openCamera(), Platform.OS === 'ios' ? 250 : 0);
        }}
        onPickFile={() => {
          attach.setOpen(false);
          setTimeout(() => void attach.pickDocument(), 0);
        }}
      />

      <InAppCameraModal
        visible={camera.open}
        onClose={() => camera.setOpen(false)}
        onAlert={camera.showAlert}
        onCaptured={(cap) => {
          camera.setOpen(false);
          camera.onCaptured(cap);
        }}
      />

      <AiHelperModal
        visible={aiHelper.open}
        isDark={isDark}
        styles={styles}
        thread={aiHelper.thread}
        instruction={aiHelper.instruction}
        loading={aiHelper.loading}
        mode={aiHelper.mode}
        onChangeInstruction={aiHelper.setInstruction}
        onChangeMode={aiHelper.setMode}
        onSubmit={aiHelper.submit}
        onResetThread={aiHelper.resetHelperThread}
        onClose={aiHelper.closeHelper}
        onCopySuggestion={async (s: string) => copyToClipboard(s, { skipToast: true })}
        onUseSuggestion={(s: string) => {
          setInput(s);
          aiHelper.closeHelper();
        }}
        scrollRef={aiHelper.scrollRef}
        scrollContentRef={aiHelper.scrollContentRef}
        lastTurnRef={aiHelper.lastTurnRef}
        lastAssistantLayoutRef={aiHelper.lastAssistantLayoutRef}
        scrollViewportHRef={aiHelper.scrollViewportHRef}
        scrollContentHRef={aiHelper.scrollContentHRef}
        scrollYRef={aiHelper.scrollYRef}
        lastAutoScrollAtRef={aiHelper.lastAutoScrollAtRef}
        lastAutoScrollContentHRef={aiHelper.lastAutoScrollContentHRef}
        lastAutoScrollModeRef={aiHelper.lastAutoScrollModeRef}
        autoScrollRetryRef={aiHelper.autoScrollRetryRef}
        autoScrollIntentRef={aiHelper.autoScrollIntentRef}
        autoScroll={aiHelper.autoScroll}
      />

      <ReportModal
        visible={report.reportOpen}
        isDark={isDark}
        styles={styles}
        submitting={report.reportSubmitting}
        notice={report.reportNotice}
        reportKind={report.reportKind}
        reportCategory={report.reportCategory}
        reportTargetMessage={report.reportTargetMessage}
        reportTargetUserSub={report.reportTargetUserSub}
        reportTargetUserLabel={report.reportTargetUserLabel}
        reportDetails={report.reportDetails}
        cdnMedia={cdnMedia}
        onClose={report.closeReportModal}
        onSubmit={report.submitReport}
        onToggleKind={(next) => {
          if (next) {
            // Switch to reporting the user (hydrate from the message if needed)
            if (report.reportTargetUserSub) {
              report.setReportKind('user');
              return;
            }
            const sub = report.reportTargetMessage?.userSub
              ? String(report.reportTargetMessage.userSub)
              : '';
            if (sub) {
              report.setReportTargetUserSub(sub);
              report.setReportTargetUserLabel(
                String(report.reportTargetMessage?.user || '').trim(),
              );
              report.setReportKind('user');
              return;
            }
            report.setReportNotice({
              type: 'error',
              message: 'Cannot report user: no user was found for this report.',
            });
            report.setReportKind('message');
            return;
          }
          // Switch back to reporting the message (if we have one)
          if (report.reportTargetMessage) report.setReportKind('message');
        }}
        onSelectCategory={(key) => report.setReportCategory(key)}
        onChangeDetails={(t) => report.setReportDetails(t)}
      />

      <MessageActionMenuModal
        visible={messageActionMenu.open}
        isDark={isDark}
        styles={styles}
        insets={{ top: insets.top, bottom: insets.bottom }}
        anchor={messageActionMenu.anchor}
        anim={messageActionMenu.anim}
        measuredH={messageActionMenu.measuredH ?? 0}
        measuredHRef={messageActionMenu.measuredHRef}
        onMeasuredH={messageActionMenu.onMeasuredH}
        target={messageActionMenu.target}
        myUserId={myUserId}
        myPublicKey={myPublicKey}
        displayName={displayName}
        isDm={isDm}
        encryptedPlaceholder={encryptedPlaceholder}
        normalizeUser={normalizeUser}
        mediaUrlByPath={mediaUrlByPath}
        dmThumbUriByPath={dmThumbUriByPath}
        quickReactions={quickReactions}
        nameBySub={nameBySub}
        messageListData={messageListData}
        blockedSubsSet={blockedSubsSet}
        onBlockUserSub={onBlockUserSub}
        uiConfirm={uiConfirm}
        uiChoice3={uiChoice3}
        showAlert={camera.showAlert}
        close={messageActionMenu.closeMenu}
        copyToClipboard={copyToClipboard}
        selectionActive={!!selectionActive}
        onSelectMessage={onSelectMessage}
        sendReaction={messageOps.sendReaction}
        openReactionPicker={messageOps.openReactionPicker}
        setCipherText={messageOps.setCipherText}
        setCipherOpen={messageOps.setCipherOpen}
        beginReply={messageOps.beginReply}
        beginInlineEdit={messageOps.beginInlineEdit}
        setInlineEditAttachmentMode={messageOps.setInlineEditAttachmentMode}
        handlePickMedia={messageOps.handlePickMedia}
        clearPendingMedia={messageOps.clearPendingMedia}
        deleteForMe={messageOps.deleteForMe}
        sendDeleteForEveryone={messageOps.sendDeleteForEveryone}
        openReportForMessage={messageOps.openReportModalForMessage}
      />

      <ReactionPickerModal
        visible={reactionPickerOpen}
        isDark={isDark}
        styles={styles}
        target={reactionPickerTarget}
        myUserId={myUserId}
        emojis={emojis}
        onPick={(emoji) => {
          if (reactionPickerTarget) messageOps.sendReaction(reactionPickerTarget, emoji);
          closeReactionPicker();
        }}
        onClose={closeReactionPicker}
      />

      <CiphertextModal
        visible={cipher.open}
        isDark={isDark}
        styles={styles}
        text={cipher.text}
        onClose={() => cipher.setOpen(false)}
      />

      <ReactionInfoModal
        visible={reactionInfo.open}
        isDark={isDark}
        styles={styles}
        emoji={reactionInfo.emoji}
        subsSorted={reactionInfo.subsSorted}
        myUserId={myUserId}
        nameBySub={nameBySub}
        onRemoveMine={() => {
          if (!reactionInfo.target || !reactionInfo.emoji) return;
          messageOps.sendReaction(reactionInfo.target, reactionInfo.emoji);
          reactionInfo.closeReactionInfo();
        }}
        onClose={() => {
          reactionInfo.closeReactionInfo();
        }}
      />

      <InfoModal
        visible={info.infoOpen}
        isDark={isDark}
        styles={styles}
        title={info.infoTitle}
        body={info.infoBody}
        onClose={() => info.setInfoOpen(false)}
      />

      <TtlPickerModal
        visible={ttl.ttlPickerOpen}
        isDark={isDark}
        styles={styles}
        options={ttl.TTL_OPTIONS}
        draftIdx={ttl.ttlIdxDraft}
        onSelectIdx={ttl.setTtlIdxDraft}
        onCancel={() => {
          // Discard changes unless explicitly confirmed.
          ttl.setTtlIdxDraft(ttl.ttlIdx);
          ttl.setTtlPickerOpen(false);
        }}
        onDone={() => {
          // Commit selection only on explicit confirmation.
          ttl.setTtlIdx(ttl.ttlIdxDraft);
          ttl.setTtlPickerOpen(false);
        }}
      />

      <GroupNameModal
        visible={groupNameEditOpen}
        isDark={isDark}
        styles={styles}
        busy={groupActionBusy}
        draft={groupNameDraft}
        onChangeDraft={setGroupNameDraft}
        onDefault={groupNameModalActions.onDefault}
        onSave={groupNameModalActions.onSave}
        onCancel={groupNameModalActions.onCancel}
      />

      <GroupMembersModal
        visible={groupMembersOpen}
        isDark={isDark}
        styles={styles}
        busy={groupActionBusy}
        meIsAdmin={!!groupMeta?.meIsAdmin}
        addMembersDraft={groupAddMembersDraft}
        onChangeAddMembersDraft={setGroupAddMembersDraft}
        onAddMembers={groupMembersModalActions.onAddMembers}
        addMembersInputRef={groupAddMembersInputRef}
        members={groupMembersVisible}
        mySub={typeof myUserId === 'string' && myUserId.trim() ? myUserId.trim() : ''}
        kickCooldownUntilBySub={kickCooldownUntilBySub}
        avatarUrlByPath={avatarUrlByPath}
        onKick={(memberSub) => groupKick(memberSub)}
        onUnban={(memberSub) => void groupUpdate('unban', { memberSub })}
        onToggleAdmin={({ memberSub, isAdmin }) =>
          void groupUpdate(isAdmin ? 'demoteAdmin' : 'promoteAdmin', { memberSub })
        }
        onBan={groupMembersModalActions.onBan}
        onClose={groupMembersModalActions.onClose}
      />

      <ChannelMembersModal
        visible={channelMembersOpen}
        isDark={isDark}
        styles={styles}
        canAddMembers={
          !!channelMeta?.meIsAdmin &&
          (channelMeta?.isPublic === false ||
            (channelMeta?.isPublic === true && !!channelMeta?.hasPassword))
        }
        addMembersDraft={channelAddMembersDraft}
        onChangeAddMembersDraft={setChannelAddMembersDraft}
        onAddMembers={channelMembersModalActions.onAddMembers}
        addMembersInputRef={channelAddMembersInputRef}
        members={channelMembersVisible}
        mySub={typeof myUserId === 'string' ? myUserId : ''}
        meIsAdmin={!!channelMeta?.meIsAdmin}
        actionBusy={channelActionBusy}
        kickCooldownUntilBySub={kickCooldownUntilBySub}
        avatarUrlByPath={avatarUrlByPath}
        onBan={channelMembersModalActions.onBan}
        onUnban={(memberSub) => void channelUpdate('unban', { memberSub })}
        onKick={(memberSub) => channelKick(memberSub)}
        onToggleAdmin={channelMembersModalActions.onToggleAdmin}
        onClose={channelMembersModalActions.onClose}
      />

      {confirmLinkModal}

      <ChannelAboutModal
        visible={channelAboutOpen}
        isDark={isDark}
        styles={styles}
        title={channelMeta?.name ? `${channelMeta.name}` : 'About'}
        edit={channelAboutEdit}
        draft={String(channelAboutDraft || '')}
        busy={channelActionBusy}
        canEdit={!!channelMeta?.meIsAdmin}
        onChangeDraft={(v) => setChannelAboutDraft(String(v || '').slice(0, 4000))}
        onOpenUrl={requestOpenLink}
        onRequestClose={channelAboutModalActions.onRequestClose}
        onBackdropPress={channelAboutModalActions.onBackdropPress}
        onPreview={() => setChannelAboutEdit(false)}
        onSave={channelAboutModalActions.onSave}
        onCancelEdit={channelAboutModalActions.onCancelEdit}
        onGotIt={channelAboutModalActions.onGotIt}
        onEdit={() => setChannelAboutEdit(true)}
      />

      <ChannelNameModal
        visible={channelNameEditOpen}
        isDark={isDark}
        styles={styles}
        busy={channelActionBusy}
        draft={channelNameDraft}
        onChangeDraft={setChannelNameDraft}
        onSave={channelNameModalActions.onSave}
        onCancel={channelNameModalActions.onCancel}
      />

      <ChannelPasswordModal
        visible={channelPasswordEditOpen}
        isDark={isDark}
        styles={styles}
        busy={channelActionBusy}
        draft={channelPasswordDraft}
        onChangeDraft={setChannelPasswordDraft}
        onSave={channelPasswordModalActions.onSave}
        onCancel={channelPasswordModalActions.onCancel}
      />

      <MediaViewerModal
        open={viewer.open}
        viewerState={viewer.state}
        setViewerState={viewer.setState}
        dmFileUriByPath={dmFileUriByPath}
        saving={viewer.saving}
        saveConfirm={
          Platform.OS === 'ios'
            ? {
                title: 'Save to Phone?',
                message: 'Save this media to your device?',
                confirmText: 'Save',
                cancelText: 'Cancel',
                dontShowAgain: {
                  storageKey: SAVE_TO_PHONE_DONT_SHOW_AGAIN_KEY,
                  label: SAVE_TO_PHONE_DONT_SHOW_AGAIN_LABEL,
                },
              }
            : undefined
        }
        onSave={async () => {
          if (Platform.OS === 'web') {
            await viewer.saveToDevice();
            return;
          }
          if (Platform.OS === 'ios') {
            await viewer.saveToDevice();
            return;
          }

          const ok = await uiConfirm('Save to Phone?', 'Save this media to your device?', {
            confirmText: 'Save',
            cancelText: 'Cancel',
            dontShowAgain: {
              storageKey: SAVE_TO_PHONE_DONT_SHOW_AGAIN_KEY,
              label: SAVE_TO_PHONE_DONT_SHOW_AGAIN_LABEL,
            },
          });
          if (!ok) return;
          await viewer.saveToDevice();
        }}
        onClose={viewer.close}
      />

      {toast
        ? (() => {
            const toastNode = (
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.toastWrap,
                  // iOS + web: toast is not wrapped in Modal — keep above main content.
                  ...(Platform.OS !== 'android' ? [{ zIndex: 999999 } as const] : []),
                  {
                    bottom: Math.max(16, insets.bottom + 12),
                    opacity: toastAnim,
                    transform: [
                      {
                        translateY: toastAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [12, 0],
                        }),
                      },
                    ],
                  },
                ]}
              >
                <View
                  style={[
                    styles.toast,
                    !isDark ? styles.toastLight : null,
                    isDark ? styles.toastDark : null,
                    toast.kind === 'error'
                      ? isDark
                        ? styles.toastErrorDark
                        : styles.toastError
                      : null,
                  ]}
                >
                  {toast.kind === 'error' ? null : (
                    <AppBrandIcon isDark={isDark} slotWidth={18} slotHeight={18} />
                  )}
                  <Text style={[styles.toastText, !isDark ? styles.toastTextLight : null]}>
                    {toast.message}
                  </Text>
                </View>
              </Animated.View>
            );

            // Android: wrap in Modal so the toast stays above other full-screen Modal portals
            // (e.g. MediaViewerModal).
            //
            // iOS + web: do NOT wrap in Modal. On iOS a second Modal is a separate UIWindow — it
            // captures all touches until dismissed, even with pointerEvents="none", so the app
            // feels frozen while the toast is visible. Inline toast in the root view + zIndex
            // keeps touches passing through to the chat below.
            if (Platform.OS === 'android') {
              return (
                <Modal
                  visible
                  transparent
                  animationType="none"
                  onRequestClose={() => {
                    // no-op (toast auto-hides)
                  }}
                >
                  <View style={{ flex: 1 }} pointerEvents="none">
                    {toastNode}
                  </View>
                </Modal>
              );
            }

            return toastNode;
          })()
        : null}
    </>
  );
}
