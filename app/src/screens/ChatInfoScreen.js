import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, Modal, TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../icons/Icon';
import { EmojiText } from '../icons/Emoji';
import { useChat } from '../store/ChatContext';
import { useAuth } from '../store/AuthContext';
import { useTheme } from '../store/ThemeContext';
import { Avatar, lastSeenText, PaperCard, TapeChip, handleFor, Rule, InkButton, InkField, FrostedBackdrop, GoldTick, hasGoldTick } from '../components/common';
import { FadeSlide, SheetSpringIn } from '../motion';
import { radius, type, inkBox, marker, dashedRule, raised } from '../theme';
import { confirm } from '../hooks/confirm';
import { api } from '../api';
import { DISAPPEAR_OPTIONS, disappearLabel } from '../components/MessageBubble';
import CollabDocumentView from '../components/CollabDocumentView';

export default function ChatInfoScreen({ route, navigation, embedded = false }) {
  const { chatId } = route.params;
  const { chats, refreshChats, socketRef } = useChat();
  const socket = socketRef?.current || null;
  const { user } = useAuth();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const chat = chats.find((c) => c.id === chatId);
  const s = makeStyles(theme);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [disappearOpen, setDisappearOpen] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);

  const me = chat?.members?.find((m) => m.id === user.id);
  const isAdmin = me?.role === 'admin';

  useEffect(() => {
    if (chat?.type !== 'direct' || !chat.otherUserId) return;
    api.users().then(({ users }) => {
      const other = users.find((u) => u.id === chat.otherUserId);
      if (other) setBlocked(!!other.blocked);
    }).catch(() => {});
  }, [chat?.otherUserId]);

  if (!chat) return <View style={{ flex: 1, backgroundColor: theme.bg }} />;

  const toggleMute = async () => { await api.mute(chatId, !chat.muted); refreshChats(); };
  const toggleArchive = async () => { await api.archive(chatId, !chat.archived); refreshChats(); navigation.goBack(); };

  const toggleBlock = async () => {
    const ok = await confirm(
      blocked
        ? `Unblock ${chat.name}? They'll be able to message you and see your public posts again.`
        : `Block ${chat.name}? They won't be able to message you, and neither of you will see each other's Status or Network posts.`,
      { title: blocked ? 'Unblock' : 'Block', confirmLabel: blocked ? 'Unblock' : 'Block', destructive: !blocked }
    );
    if (!ok) return;
    setBusy(true);
    try {
      if (blocked) await api.unblockUser(chat.otherUserId);
      else await api.blockUser(chat.otherUserId);
      setBlocked(!blocked);
    } finally {
      setBusy(false);
    }
  };

  /* ---- group admin powers ---- */
  const renameGroup = async () => {
    const name = renameValue.trim();
    if (!name) return;
    setBusy(true);
    try {
      await api.updateChat(chatId, { name });
      await refreshChats();
      setRenameOpen(false);
    } catch (e) { console.warn(e.message); }
    finally { setBusy(false); }
  };

  const promote = async (m) => {
    const action = m.role === 'admin' ? 'Demote' : 'Promote';
    const ok = await confirm(
      `${action} ${m.id === user.id ? 'yourself' : m.name}?`,
      { title: `${action} to ${m.role === 'admin' ? 'member' : 'admin'}`, confirmLabel: action }
    );
    if (!ok) return;
    setBusy(true);
    try {
      await api.setGroupMemberRole(chatId, m.id, m.role === 'admin' ? 'member' : 'admin');
      await refreshChats();
    } catch (e) { console.warn(e.message); }
    finally { setBusy(false); }
  };

  const removeMember = async (m) => {
    const ok = await confirm(`Remove ${m.name} from the group?`, { title: 'Remove member', confirmLabel: 'Remove', destructive: true });
    if (!ok) return;
    setBusy(true);
    try {
      await api.removeGroupMember(chatId, m.id);
      await refreshChats();
    } catch (e) { console.warn(e.message); }
    finally { setBusy(false); }
  };

  const leaveGroup = async () => {
    const ok = await confirm(`Leave "${chat.name}"? You'll stop getting its messages.`, { title: 'Leave group', confirmLabel: 'Leave', destructive: true });
    if (!ok) return;
    setBusy(true);
    try {
      await api.leaveGroup(chatId);
      await refreshChats();
      navigation.goBack();
    } catch (e) { console.warn(e.message); }
    finally { setBusy(false); }
  };

  const setDisappear = async (seconds) => {
    setBusy(true);
    try {
      await api.setDisappear(chatId, seconds);
      await refreshChats();
      setDisappearOpen(false);
    } catch (e) { console.warn(e.message); }
    finally { setBusy(false); }
  };

  const Row = ({ icon, label, onPress, danger, sub }) => (
    <Pressable style={({ pressed }) => [s.row, pressed && marker(theme, 1)]} onPress={onPress} disabled={busy}>
      <Icon name={icon} size={19} color={danger ? theme.danger : theme.ink} style={{ width: 26 }} />
      <View style={{ flex: 1 }}>
        <Text style={[type.bodyMd, { color: danger ? theme.danger : theme.text }]}>{label}</Text>
        {!!sub && <Text style={[type.labelXs, { color: theme.muted, marginTop: 2 }]}>{sub}</Text>}
      </View>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView contentContainerStyle={[s.scroll, !embedded && { paddingTop: 16 + insets.top }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={s.back}>
          <Icon name="arrow-back" size={22} color={theme.ink} />
        </Pressable>

        <FadeSlide from="down" distance={12} scale={0.97} duration={280}>
        <PaperCard style={s.hero} weight="ink">
          <Avatar uri={chat.avatar} name={chat.name} id={chat.otherUserId || chat.id} group={chat.type === 'group'} size={104} />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16 }}>
            <EmojiText style={[type.headlineMd, { color: theme.text, textAlign: 'center', flexShrink: 1 }]}>{chat.name}</EmojiText>
            {hasGoldTick(chat) && <GoldTick size={20} />}
          </View>
          {chat.type === 'direct' ? (
            <Text style={[type.labelSm, { color: theme.graphite, marginTop: 6 }]}>
              {handleFor(chat)}
            </Text>
          ) : null}
          <Text style={[type.bodySm, { color: theme.subtext, marginTop: 8, textAlign: 'center' }]}>
            {chat.type === 'group' ? `Group · ${chat.members.length} participants` : lastSeenText(chat.isOnline, chat.lastSeen)}
          </Text>
        </PaperCard>
        </FadeSlide>

        {chat.type === 'direct' && !!chat.about && (
          <PaperCard>
            <Text style={[type.labelXs, { color: theme.muted, marginBottom: 8 }]}>ABOUT</Text>
            <EmojiText style={[type.bodyLg, { color: theme.text }]}>{chat.about}</EmojiText>
          </PaperCard>
        )}

        <PaperCard style={{ padding: 6 }}>
          <Row
            icon={chat.muted ? 'volume-mute' : 'notifications-outline'}
            label={chat.muted ? 'Unmute notifications' : 'Mute notifications'}
            onPress={toggleMute}
          />
          <Row
            icon="timer-outline"
            label="Disappearing messages"
            sub={chat.disappearSeconds ? `New messages disappear after ${disappearLabel(chat.disappearSeconds)}` : 'Off'}
            onPress={() => setDisappearOpen(true)}
          />
          <Row icon="archive-outline" label={chat.archived ? 'Unarchive chat' : 'Archive chat'} onPress={toggleArchive} />
          <Row icon="star-outline" label="Starred messages" onPress={() => navigation.navigate('Starred')} />
          <Row icon="document-text-outline" label="Collaborative notes" sub="Real-time OT docs for this chat" onPress={() => setDocsOpen(true)} />
        </PaperCard>

        {chat.type === 'group' && isAdmin && (
          <PaperCard style={{ padding: 6 }}>
            <Row icon="create-outline" label="Rename group" onPress={() => { setRenameValue(chat.name || ''); setRenameOpen(true); }} />
          </PaperCard>
        )}

        {chat.type === 'direct' && (
          <PaperCard style={{ padding: 6 }}>
            <Row
              icon={blocked ? 'checkmark-circle' : 'ban-outline'}
              label={blocked ? `Unblock ${chat.name}` : `Block ${chat.name}`}
              onPress={toggleBlock}
              danger={!blocked}
            />
          </PaperCard>
        )}

        {chat.type === 'group' && (
          <PaperCard>
            <Text style={[type.labelXs, { color: theme.muted, marginBottom: 14 }]}>
              {chat.members.length} PARTICIPANTS
            </Text>
            <View style={{ gap: 16 }}>
              {chat.members.map((m) => (
                <View key={m.id} style={s.memberRow}>
                  <Avatar uri={m.avatar} name={m.name} id={m.id} size={46} online={m.isOnline} />
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <EmojiText style={[type.bodyMd, { color: theme.text, flexShrink: 1 }]}>
                        {m.id === user.id ? 'You' : m.name}
                      </EmojiText>
                      {hasGoldTick(m) && <GoldTick size={14} />}
                    </View>
                    <Text style={[type.labelXs, { color: theme.graphite, marginTop: 2 }]}>
                      {handleFor(m)}
                    </Text>
                  </View>
                  {m.role === 'admin' && <TapeChip label="ADMIN" tone="accent" />}
                  {isAdmin && m.id !== user.id && (
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <Pressable
                        onPress={() => promote(m)}
                        hitSlop={6}
                        style={({ pressed }) => [s.memberAction, pressed ? marker(theme, 1) : null]}
                      >
                        <Icon name={m.role === 'admin' ? 'arrow-down-circle-outline' : 'arrow-up-circle-outline'} size={19} color={theme.ink} />
                      </Pressable>
                      <Pressable
                        onPress={() => removeMember(m)}
                        hitSlop={6}
                        style={({ pressed }) => [s.memberAction, pressed ? marker(theme, 1) : null]}
                      >
                        <Icon name="remove-circle-outline" size={19} color={theme.danger} />
                      </Pressable>
                    </View>
                  )}
                </View>
              ))}
            </View>
          </PaperCard>
        )}

        {chat.type === 'group' && (
          <PaperCard style={{ padding: 6 }}>
            <Row icon="exit-outline" label="Leave group" onPress={leaveGroup} danger />
          </PaperCard>
        )}
      </ScrollView>

      {/* rename modal */}
      <Modal visible={renameOpen} transparent animationType="fade" onRequestClose={() => setRenameOpen(false)}>
        <Pressable style={[s.overlay, { backgroundColor: 'transparent' }]} onPress={() => setRenameOpen(false)}>
          <FrostedBackdrop />
          <SheetSpringIn style={{ width: '100%', maxWidth: 380 }}>
          <Pressable style={[s.sheet, raised(theme, 2), { backgroundColor: theme.bg, borderColor: theme.ink }]}>
            <Text style={[type.headlineSm, { color: theme.text }]}>Rename group</Text>
            <InkField style={{ marginTop: 14 }}>
              <TextInput
                value={renameValue}
                onChangeText={setRenameValue}
                placeholder="Group name"
                placeholderTextColor={theme.muted}
                style={[s.input, { color: theme.text }]}
                maxLength={60}
                autoFocus
              />
            </InkField>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <View style={{ flex: 1 }}>
                <InkButton label="Cancel" onPress={() => setRenameOpen(false)} />
              </View>
              <View style={{ flex: 1 }}>
                <InkButton label="Save" onPress={renameGroup} filled busy={busy} />
              </View>
            </View>
          </Pressable>
          </SheetSpringIn>
        </Pressable>
      </Modal>

      {/* OT docs modal */}
      <Modal visible={docsOpen} animationType="slide" onRequestClose={() => setDocsOpen(false)}>
        <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 2, borderBottomColor: theme.ink }}>
            <Text style={[type.headlineSm, { color: theme.text }]}>COLLABORATIVE NOTES</Text>
            <Pressable onPress={() => setDocsOpen(false)} style={[inkBox(theme, 'thin'), { paddingHorizontal: 12, paddingVertical: 8 }]}>
              <Text style={[type.labelSm, { color: theme.ink }]}>CLOSE</Text>
            </Pressable>
          </View>
          <CollabDocumentView chatId={chatId} socket={socket} embedded />
        </View>
      </Modal>

      {/* disappearing timer modal */}
      <Modal visible={disappearOpen} transparent animationType="fade" onRequestClose={() => setDisappearOpen(false)}>
        <Pressable style={[s.overlay, { backgroundColor: 'transparent' }]} onPress={() => setDisappearOpen(false)}>
          <FrostedBackdrop />
          <SheetSpringIn style={{ width: '100%', maxWidth: 380 }}>
          <Pressable style={[s.sheet, raised(theme, 2), { backgroundColor: theme.bg, borderColor: theme.ink }]}>
            <Text style={[type.headlineSm, { color: theme.text }]}>Disappearing messages</Text>
            <Text style={[type.bodySm, { color: theme.subtext, marginTop: 4, marginBottom: 12 }]}>
              New messages in this {chat.type === 'group' ? 'group' : 'chat'} self-destruct after the timer.
            </Text>
            <View style={{ gap: 8 }}>
              <Pressable
                style={({ pressed }) => [s.timerOpt, inkBox(theme, 'thin'), pressed ? marker(theme, 1) : null]}
                onPress={() => setDisappear(0)}
              >
                <Icon name="time-outline" size={18} color={theme.ink} />
                <Text style={[type.bodyMd, { color: theme.text, flex: 1 }]}>Off — keep forever</Text>
                {!chat.disappearSeconds && <Icon name="checkmark" size={18} color={theme.ink} />}
              </Pressable>
              {DISAPPEAR_OPTIONS.map((o) => (
                <Pressable
                  key={o.seconds}
                  style={({ pressed }) => [s.timerOpt, inkBox(theme, 'thin'), pressed ? marker(theme, 1) : null]}
                  onPress={() => setDisappear(o.seconds)}
                >
                  <Icon name="timer-outline" size={18} color={theme.ink} />
                  <Text style={[type.bodyMd, { color: theme.text, flex: 1 }]}>{o.label}</Text>
                  {chat.disappearSeconds === o.seconds && <Icon name="checkmark" size={18} color={theme.ink} />}
                </Pressable>
              ))}
            </View>
          </Pressable>
          </SheetSpringIn>
        </Pressable>
      </Modal>
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  scroll: { padding: 20, paddingTop: 16, paddingBottom: 40, gap: 20 },
  back: { padding: 6, alignSelf: 'flex-start' },
  hero: { alignItems: 'center', paddingVertical: 28 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 12, paddingVertical: 13 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  memberAction: { padding: 4, borderWidth: 1, borderColor: t.graphiteLine },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  sheet: {
    width: '100%', maxWidth: 380, borderWidth: 3, padding: 20,
    borderTopLeftRadius: 6, borderTopRightRadius: 12,
    borderBottomRightRadius: 6, borderBottomLeftRadius: 10,
  },
  timerOpt: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 11 },
  input: { flex: 1, ...type.bodyLg, paddingVertical: 11, outlineStyle: 'none' },
});
