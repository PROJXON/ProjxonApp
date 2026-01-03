import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { AvatarBubble } from './AvatarBubble';

type MemberRow = {
  memberSub: string;
  displayName?: string;
  isAdmin?: boolean;
  status?: 'active' | 'banned' | 'left';
  avatarBgColor?: string;
  avatarTextColor?: string;
  avatarImagePath?: string;
};

export function GroupMembersSectionList({
  members,
  mySub,
  isDark,
  styles,
  meIsAdmin,
  groupActionBusy,
  kickCooldownUntilBySub,
  avatarUrlByPath,
  onKick,
  onBan,
  onUnban,
  onToggleAdmin,
}: {
  members: MemberRow[];
  mySub: string;
  isDark: boolean;
  styles: any;
  meIsAdmin: boolean;
  groupActionBusy: boolean;
  kickCooldownUntilBySub: Record<string, number>;
  avatarUrlByPath: Record<string, string>;
  onKick: (memberSub: string) => void;
  onBan: (member: { memberSub: string; label: string }) => void;
  onUnban: (memberSub: string) => void;
  onToggleAdmin: (member: { memberSub: string; isAdmin: boolean }) => void;
}) {
  const visible = (Array.isArray(members) ? members : []).filter((m) => m && (m.status === 'active' || m.status === 'banned'));

  const nameKey = (m: MemberRow) => String(m.displayName || m.memberSub || '').trim();
  const cmpWithinSection = (a: MemberRow, b: MemberRow) => {
    const aMe = !!mySub && String(a.memberSub) === mySub;
    const bMe = !!mySub && String(b.memberSub) === mySub;
    if (aMe !== bMe) return aMe ? -1 : 1;
    const ak = nameKey(a).toLocaleLowerCase();
    const bk = nameKey(b).toLocaleLowerCase();
    if (ak < bk) return -1;
    if (ak > bk) return 1;
    return String(a.memberSub || '').localeCompare(String(b.memberSub || ''));
  };

  const admins = visible.filter((m) => m.status === 'active' && !!m.isAdmin).slice().sort(cmpWithinSection);
  const normalMembers = visible.filter((m) => m.status === 'active' && !m.isAdmin).slice().sort(cmpWithinSection);
  const banned = visible.filter((m) => m.status === 'banned').slice().sort(cmpWithinSection);

  const renderSection = (title: string, list: MemberRow[]) => {
    if (!list.length) return null;
    return (
      <View style={{ marginBottom: 8 }}>
        <Text
          style={[
            styles.summaryText,
            isDark ? styles.summaryTextDark : null,
            { opacity: 0.75, fontSize: 13, fontWeight: '700', marginBottom: 6 },
          ]}
        >
          {title}
        </Text>
        {list.map((m) => {
          const isMe = !!mySub && String(m.memberSub) === mySub;
          const label = isMe ? 'You' : (m.displayName || String(m.memberSub || '').slice(0, 10));
          const canAdmin = !!meIsAdmin && !isMe;
          const canKick = canAdmin && m.status === 'active';
          const kickCoolingDown =
            typeof kickCooldownUntilBySub[m.memberSub] === 'number' && Date.now() < kickCooldownUntilBySub[m.memberSub];
          const isBanned = m.status === 'banned';
          const imageUri =
            m.avatarImagePath && avatarUrlByPath[String(m.avatarImagePath)]
              ? avatarUrlByPath[String(m.avatarImagePath)]
              : undefined;

          return (
            <View key={`gm:${m.memberSub}`} style={{ marginBottom: 10 }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', flexGrow: 1, flexShrink: 1, minWidth: 160 }}>
                  <AvatarBubble
                    seed={String(m.memberSub || '')}
                    label={String(label || '')}
                    size={30}
                    backgroundColor={typeof m.avatarBgColor === 'string' ? m.avatarBgColor : undefined}
                    textColor={typeof m.avatarTextColor === 'string' ? m.avatarTextColor : '#fff'}
                    imageUri={imageUri}
                    style={{ marginRight: 10 }}
                  />
                  <Text
                    style={[
                      styles.summaryText,
                      isDark ? styles.summaryTextDark : null,
                      { flexGrow: 1, flexShrink: 1, minWidth: 120 },
                    ]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {label}
                  </Text>
                </View>

                {canAdmin ? (
                  <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {canKick ? (
                      <Pressable
                        style={[
                          styles.toolBtn,
                          isDark ? styles.toolBtnDark : null,
                          (groupActionBusy || kickCoolingDown) ? { opacity: 0.6 } : null,
                        ]}
                        disabled={groupActionBusy || kickCoolingDown}
                        onPress={() => onKick(m.memberSub)}
                      >
                        <Text style={[styles.toolBtnText, isDark ? styles.toolBtnTextDark : null]}>Kick</Text>
                      </Pressable>
                    ) : null}

                    {isBanned ? (
                      <Pressable
                        style={[styles.toolBtn, isDark ? styles.toolBtnDark : null, groupActionBusy ? { opacity: 0.6 } : null]}
                        disabled={groupActionBusy}
                        onPress={() => onUnban(m.memberSub)}
                      >
                        <Text style={[styles.toolBtnText, isDark ? styles.toolBtnTextDark : null]}>Unban</Text>
                      </Pressable>
                    ) : (
                      <Pressable
                        style={[styles.toolBtn, isDark ? styles.toolBtnDark : null, groupActionBusy ? { opacity: 0.6 } : null]}
                        disabled={groupActionBusy}
                        onPress={() => onBan({ memberSub: m.memberSub, label: String(label || '') })}
                      >
                        <Text style={[styles.toolBtnText, isDark ? styles.toolBtnTextDark : null]}>Ban</Text>
                      </Pressable>
                    )}

                    {m.status === 'active' ? (
                      <Pressable
                        style={[styles.toolBtn, isDark ? styles.toolBtnDark : null, groupActionBusy ? { opacity: 0.6 } : null]}
                        disabled={groupActionBusy}
                        onPress={() => onToggleAdmin({ memberSub: m.memberSub, isAdmin: !!m.isAdmin })}
                      >
                        <Text style={[styles.toolBtnText, isDark ? styles.toolBtnTextDark : null]}>
                          {m.isAdmin ? 'Demote' : 'Promote'}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
    );
  };

  return (
    <View>
      {renderSection('Admins', admins)}
      {renderSection('Members', normalMembers)}
      {renderSection('Banned', banned)}
    </View>
  );
}

