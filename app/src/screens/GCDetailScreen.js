import React, { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { editorConfigFor } from '../imageEditor/config';
import UniversalImageEditor from '../components/UniversalImageEditor';
import {
  View, Text, ScrollView, Pressable, StyleSheet, Modal, TextInput, Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../icons/Icon';
import { EmojiText } from '../icons/Emoji';
import { useChatGCState, useChatActions } from '../store/ChatContext';
import { useAuth } from '../store/AuthContext';
import { useTheme } from '../store/ThemeContext';
import {
  Avatar, EmptyState, Rule, InkButton, InkField, FrostedBackdrop, TapeChip,
  GoldTick, hasGoldTick,
} from '../components/common';
import { FadeSlide, SheetSpringIn, SpringPressable, haptic, motion } from '../motion';
import { type, inkBox, marker, stroke, raised } from '../theme';
import { api } from '../api';
import { confirm } from '../hooks/confirm';

/**
 * GCDetailScreen — the GC environment hub.
 *
 * GC List → GCDetail → GCChat. This screen is 100% inside the GC section:
 * it reads the GC-only store, its "OPEN CHAT" button pushes the GC chat
 * route, and Back always returns to the GC list — it can never land the
 * user in the normal Chats tab.
 */
export default function GCDetailScreen({ route, navigation, embedded = false, onClose = null }) {
  const chatId = route?.params?.chatId || null;
  const { gcChats } = useChatGCState();
  const { refreshGCs, joinGCRoom, leaveGCRoom } = useChatActions();
  const { user } = useAuth();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const chat = gcChats.find((c) => c.id === chatId);
  const [busy, setBusy] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [requests, setRequests] = useState([]);
  const [requestsOpen, setRequestsOpen] = useState(false);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [requestsBusyId, setRequestsBusyId] = useState(null);
  const [missing, setMissing] = useState(false);
  const [photoEditor, setPhotoEditor] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [rulesDraft, setRulesDraft] = useState([]);
  const [rulesBusy, setRulesBusy] = useState(false);
  const s = makeStyles(theme);

  const me = chat?.members?.find((m) => m.id === user.id);
  const isAdmin = me?.role === 'admin';
  const gc = chat?.gc || {};

  const back = useCallback(() => {
    if (onClose) return onClose();
    navigation?.goBack?.();
  }, [navigation, onClose]);

  // If the GC summary isn't cached yet (deep link / cold start), pull it.
  useEffect(() => {
    if (chatId && !chat) {
      refreshGCs().catch(() => {});
      const t = setTimeout(() => setMissing(true), 9000);
      return () => clearTimeout(t);
    }
    setMissing(false);
    return undefined;
  }, [chatId, chat, refreshGCs]);

  const openRequests = async () => {
    if (!chatId) return;
    setRequestsOpen(true);
    setRequestsLoading(true);
    try {
      const r = await api.gcRequests(chatId);
      setRequests(r.requests || []);
    } catch {
      setRequests([]);
    } finally {
      setRequestsLoading(false);
    }
  };

  const respondRequest = async (targetId, action) => {
    if (requestsBusyId) return;
    setRequestsBusyId(targetId);
    try {
      await api.gcRespondRequest(chatId, targetId, action);
      setRequests((prev) => prev.filter((r) => r.id !== targetId));
      await refreshGCs().catch(() => {});
    } catch {}
    finally { setRequestsBusyId(null); }
  };

  const renameGC = async () => {
    const name = renameValue.trim();
    if (!name) return;
    setBusy(true);
    try {
      await api.updateChat(chatId, { name });
      await refreshGCs().catch(() => {});
      setRenameOpen(false);
    } catch (e) {
      console.warn('gc rename failed', e.message);
    } finally {
      setBusy(false);
    }
  };

  const setMemberRole = async (m) => {
    const promoting = m.role !== 'admin';
    const ok = await confirm(
      `${promoting ? 'Promote' : 'Demote'} ${m.name} ${promoting ? 'to admin' : 'to member'}?`,
      { title: promoting ? 'Promote' : 'Demote', confirmLabel: promoting ? 'Promote' : 'Demote' }
    );
    if (!ok) return;
    setBusy(true);
    try {
      await api.setGroupMemberRole(chatId, m.id, promoting ? 'admin' : 'member');
      await refreshGCs().catch(() => {});
    } catch (e) { console.warn(e.message); }
    finally { setBusy(false); }
  };

  const removeMember = async (m) => {
    const ok = await confirm(`Remove ${m.name} from this GC?`, {
      title: 'Remove member', confirmLabel: 'Remove', destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.removeGroupMember(chatId, m.id);
      await refreshGCs().catch(() => {});
    } catch (e) { console.warn(e.message); }
    finally { setBusy(false); }
  };

  const saveGCSettings = async (payload) => {
    setRulesBusy(true);
    try { await api.gcSettings(chatId, payload); await refreshGCs(); }
    catch (e) { Alert.alert('GC settings', e.message || 'Could not save changes'); }
    finally { setRulesBusy(false); }
  };

  const savePhoto = async (processed) => {
    try {
      const { url } = await api.uploadFile(processed.uri, processed.fileName || 'gc-avatar.jpg', processed.mimeType || 'image/jpeg');
      await saveGCSettings({ avatar: url });
    } catch (e) { Alert.alert('Photo not saved', e.message || 'Could not upload the GC photo'); }
  };

  const leaveGC = async () => {
    const ok = await confirm(`Leave “${chat?.name || 'this GC'}”? You'll stop getting its messages.`, {
      title: 'Leave GC', confirmLabel: 'Leave', destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      leaveGCRoom(chatId);
      await api.leaveGroup(chatId);
      await refreshGCs().catch(() => {});
      if (onClose) {
        onClose();
      } else if (navigation?.navigate) {
        navigation.navigate('Home');
      } else {
        back();
      }
    } catch (e) {
      console.warn(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!chat) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', padding: 28 }}>
        {missing ? (
          <>
            <Icon name="alert-circle-outline" size={34} color={theme.danger} />
            <Text style={[type.headlineSm, { color: theme.text, marginTop: 14 }]}>This GC isn't available</Text>
            <Text style={[type.bodySm, { color: theme.subtext, marginTop: 7, maxWidth: 320, textAlign: 'center' }]}>
              It may have been removed, or you're no longer a member. Your chats are untouched.
            </Text>
            <Pressable onPress={back} style={[inkBox(theme, 'ink'), { marginTop: 18, paddingHorizontal: 18, paddingVertical: 10 }]}>
              <Text style={[type.labelSm, { color: theme.ink }]}>BACK TO GCs</Text>
            </Pressable>
          </>
        ) : (
          <>
            <EmptyState icon="gc" title="Opening GC…" subtitle="Loading the group for you." />
          </>
        )}
      </View>
    );
  }

  const renderMember = (m) => {
    const canManage = isAdmin && m.id !== user.id;
    return (
      <View key={m.id} style={s.memberRow}>
        <Avatar uri={m.avatar} name={m.name} id={m.id} size={46} online={m.isOnline} profileId={m.id} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <EmojiText style={[type.bodyMd, { color: theme.text, flexShrink: 1 }]} numberOfLines={1}>
              {m.id === user.id ? 'You' : m.name}
            </EmojiText>
            {hasGoldTick(m) && <GoldTick size={12} />}
          </View>
          <Text style={[type.labelXs, { color: theme.graphite, marginTop: 2 }]}>@{m.username}</Text>
        </View>
        {m.role === 'admin' && <TapeChip label="ADMIN" tone="accent" />}
        {canManage && (
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <SpringPressable
              onPress={() => setMemberRole(m)}
              hitSlop={6}
              style={({ pressed }) => [s.memberAction, pressed ? marker(theme, 1) : null]}
              scaleTo={motion.scale.row}
            >
              <Icon name={m.role === 'admin' ? 'arrow-down-circle-outline' : 'arrow-up-circle-outline'} size={19} color={theme.ink} />
            </SpringPressable>
            <SpringPressable
              onPress={() => removeMember(m)}
              hitSlop={6}
              style={({ pressed }) => [s.memberAction, pressed ? marker(theme, 1) : null]}
              scaleTo={motion.scale.row}
            >
              <Icon name="remove-circle-outline" size={19} color={theme.danger} />
            </SpringPressable>
          </View>
        )}
      </View>
    );
  };

  const Row = ({ icon, label, onPress, danger, sub }) => (
    <SpringPressable
      style={({ pressed }) => [s.row, pressed && marker(theme, 1)]}
      onPress={onPress}
      disabled={busy}
      scaleTo={motion.scale.row}
      haptic="selection"
    >
      <Icon name={icon} size={19} color={danger ? theme.danger : theme.ink} style={{ width: 26 }} />
      <View style={{ flex: 1 }}>
        <Text style={[type.bodyMd, { color: danger ? theme.danger : theme.text }]}>{label}</Text>
        {!!sub && <Text style={[type.labelXs, { color: theme.muted, marginTop: 2 }]}>{sub}</Text>}
      </View>
    </SpringPressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView contentContainerStyle={[s.scroll, !embedded && { paddingTop: 14 + insets.top }]}>
        <Pressable onPress={back} hitSlop={8} style={s.back} accessibilityRole="button" accessibilityLabel="Back to GCs">
          <Icon name="arrow-back" size={22} color={theme.ink} />
        </Pressable>

        <FadeSlide from="down" distance={12} scale={0.97} duration={280}>
          <View style={[s.hero, raised(theme, 2), { backgroundColor: theme.card, borderColor: theme.ink }]}>
            <Avatar uri={chat.avatar} name={chat.name} id={chat.id} group size={104} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 }}>
              <EmojiText style={[type.headlineMd, { color: theme.text, textAlign: 'center', flexShrink: 1 }]}>{chat.name}</EmojiText>
              {hasGoldTick(chat) && <GoldTick size={20} />}
            </View>
            <Text style={[type.labelSm, { color: theme.graphite, marginTop: 6 }]}>
              GC · {chat.members.length} MEMBERS · {gc.privacy === 'open' ? 'OPEN' : 'APPROVAL'}
            </Text>
            {!!(gc.description || chat.about) && (
              <Text style={[type.bodySm, { color: theme.subtext, marginTop: 10, textAlign: 'center' }]}>
                {gc.description || chat.about}
              </Text>
            )}
            <InkButton
              label="Open chat"
              icon="chatbubble"
              filled
              onPress={() => {
                haptic('selection');
                joinGCRoom(chatId);
                navigation?.navigate?.('GCChat', { chatId });
              }}
              style={{ minWidth: 190, marginTop: 18 }}
            />
          </View>
        </FadeSlide>

        {/* GC admin + membership controls stay inside the GC environment */}
        <View style={[s.panel, { backgroundColor: theme.card, borderColor: theme.ink }]}>
          {isAdmin && (
            <>
              <Row
                icon="person-add-outline"
                label="Join requests"
                sub={gc.requestCount ? `${gc.requestCount} pending` : 'No pending requests'}
                onPress={openRequests}
              />
              <Rule style={{ marginVertical: 4 }} />
              <Row icon="create-outline" label="Rename GC" onPress={() => { setRenameValue(chat.name || ''); setRenameOpen(true); }} />
              <Rule style={{ marginVertical: 4 }} />
              <Row icon="image-outline" label="Change GC photo" onPress={() => setPhotoEditor(true)} />
              {!!chat.avatar && <>
                <Rule style={{ marginVertical: 4 }} />
                <Row icon="trash-outline" label="Remove GC photo" danger onPress={() => saveGCSettings({ avatar: null })} />
              </>}
              <Rule style={{ marginVertical: 4 }} />
              <Row icon="list-outline" label="GC rules" sub={gc.rules?.length ? `${gc.rules.length} rules` : 'No rules added yet'} onPress={() => { setRulesDraft([...(gc.rules || []), '']); setRulesOpen(true); }} />
            </>
          )}
          {!isAdmin && <Row icon="list-outline" label="GC rules" sub={gc.rules?.length ? `${gc.rules.length} rules` : 'No rules have been added yet'} onPress={() => setRulesOpen(true)} />}
          <Rule style={{ marginVertical: 4 }} />
          <Row icon="notifications-outline" label={chat.muted ? 'Unmute notifications' : 'Mute notifications'} onPress={async () => {
            await api.mute(chatId, !chat.muted);
            await refreshGCs().catch(() => {});
          }} />
          <Rule style={{ marginVertical: 4 }} />
          <Row icon="exit-outline" label="Leave GC" danger onPress={leaveGC} />
        </View>

        <View style={[s.panel, { backgroundColor: theme.card, borderColor: theme.ink }]}>
          <Text style={[type.labelXs, { color: theme.muted, marginBottom: 14 }]}>
            {chat.members.length} MEMBERS
          </Text>
          <View style={{ gap: 16 }}>
            {chat.members.map(renderMember)}
          </View>
        </View>
      </ScrollView>

      {/* rename modal */}
      <Modal visible={renameOpen} transparent animationType="fade" onRequestClose={() => setRenameOpen(false)}>
        <Pressable style={[s.overlay, { backgroundColor: 'transparent' }]} onPress={() => setRenameOpen(false)}>
          <FrostedBackdrop />
          <SheetSpringIn style={{ width: '100%', maxWidth: 380 }}>
            <Pressable style={[s.sheet, raised(theme, 2), { backgroundColor: theme.bg, borderColor: theme.ink }]}>
              <Text style={[type.headlineSm, { color: theme.text }]}>Rename GC</Text>
              <InkField style={{ marginTop: 14 }}>
                <TextInput
                  value={renameValue}
                  onChangeText={setRenameValue}
                  placeholder="GC name"
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
                  <InkButton label="Save" onPress={renameGC} filled busy={busy} />
                </View>
              </View>
            </Pressable>
          </SheetSpringIn>
        </Pressable>
      </Modal>

      {/* join requests tray */}
      <Modal visible={requestsOpen} animationType="slide" transparent onRequestClose={() => setRequestsOpen(false)}>
        <View style={s.sheetOverlay}>
          <FrostedBackdrop />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={[
              s.sheet,
              raised(theme, 2),
              { backgroundColor: theme.bg, borderTopWidth: stroke.bold, borderTopColor: theme.ink, paddingBottom: Math.max(insets.bottom, 24) },
            ]}
          >
            <View style={s.sheetHead}>
              <View style={{ flex: 1 }}>
                <Text style={[type.headlineSm, { color: theme.text }]}>Join requests</Text>
                <Text style={[type.bodySm, { color: theme.subtext, marginTop: 2 }]}>Approve to seat them in the GC</Text>
              </View>
              <Pressable onPress={() => setRequestsOpen(false)} hitSlop={10}>
                <Icon name="close" size={22} color={theme.ink} />
              </Pressable>
            </View>
            <Rule style={{ marginTop: 0, marginBottom: 8 }} />

            {requestsLoading ? (
              <Text style={[type.bodySm, { color: theme.muted, textAlign: 'center', paddingVertical: 28 }]}>Loading…</Text>
            ) : !requests.length ? (
              <Text style={[type.bodySm, { color: theme.muted, textAlign: 'center', paddingVertical: 28 }]}>
                No pending requests. When someone asks to join, they appear here.
              </Text>
            ) : (
              <ScrollView style={{ maxHeight: 360 }}>
                {requests.map((r) => (
                  <View key={r.id} style={s.reqRow}>
                    <Avatar uri={r.avatar} name={r.name} id={r.id} size={42} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <EmojiText style={[type.bodyStrong, { color: theme.text, flexShrink: 1 }]} numberOfLines={1}>{r.name}</EmojiText>
                      <Text style={[type.labelXs, { color: theme.muted }]}>@{r.username}</Text>
                    </View>
                    <InkButton label="Decline" icon="close" danger disabled={!!requestsBusyId} onPress={() => respondRequest(r.id, 'decline')} style={{ minHeight: 40, paddingHorizontal: 12 }} />
                    <InkButton label="Approve" icon="checkmark" filled disabled={!!requestsBusyId} busy={requestsBusyId === r.id} onPress={() => respondRequest(r.id, 'approve')} style={{ minHeight: 40, paddingHorizontal: 12 }} />
                  </View>
                ))}
              </ScrollView>
            )}
          </KeyboardAvoidingView>
        </View>
      </Modal>

      <UniversalImageEditor visible={photoEditor} pickOnOpen config={{ ...editorConfigFor('profile'), title: 'GC profile photo', ratios: [{ key: 'square', label: '1:1', value: 1 }], defaultRatio: 'square' }} onCancel={() => setPhotoEditor(false)} onDone={(result) => { setPhotoEditor(false); savePhoto(result); }} />

      <Modal visible={rulesOpen} transparent animationType="fade" onRequestClose={() => setRulesOpen(false)}>
        <Pressable style={s.overlay} onPress={() => setRulesOpen(false)}>
          <Pressable style={[s.sheet, { backgroundColor: theme.bg, borderColor: theme.ink }]}>
            <Text style={[type.headlineSm, { color: theme.text }]}>GC Rules</Text>
            {!isAdmin && !(gc.rules || []).length ? <Text style={[type.bodySm, { color: theme.muted, marginTop: 14 }]}>No rules have been added yet.</Text> : isAdmin ? <>
              {rulesDraft.map((rule, i) => <InkField key={i} style={{ marginTop: 10 }}><TextInput value={rule} onChangeText={(v) => setRulesDraft((p) => p.map((x, n) => n === i ? v : x))} placeholder={`Rule ${i + 1}`} placeholderTextColor={theme.muted} style={[s.input, { color: theme.text }]} maxLength={500} /></InkField>)}
              <InkButton label="Add rule" icon="add" onPress={() => setRulesDraft((p) => [...p, ''])} style={{ marginTop: 12 }} />
              <InkButton label="Save rules" filled busy={rulesBusy} onPress={() => { saveGCSettings({ rules: rulesDraft }); setRulesOpen(false); }} style={{ marginTop: 10 }} />
            </> : (gc.rules || []).map((rule, i) => <Text key={i} style={[type.bodyMd, { color: theme.text, marginTop: 12 }]}>{i + 1}. {rule}</Text>)}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  scroll: { padding: 20, paddingTop: 16, paddingBottom: 60, gap: 20 },
  back: { padding: 6, alignSelf: 'flex-start' },
  hero: { alignItems: 'center', paddingVertical: 30, borderWidth: 2, borderRadius: 16 },
  panel: { padding: 14, borderWidth: 1, borderRadius: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 6, paddingVertical: 12 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  memberAction: { padding: 4, borderWidth: 1, borderColor: t.graphiteLine },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  sheet: {
    width: '100%', maxWidth: 380, borderWidth: 3, padding: 20,
    borderTopLeftRadius: 6, borderTopRightRadius: 12,
    borderBottomRightRadius: 6, borderBottomLeftRadius: 10,
  },
  sheetOverlay: { flex: 1, justifyContent: 'flex-end' },
  sheetHead: { flexDirection: 'row', alignItems: 'center' },
  reqRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 10 },
  input: { flex: 1, ...type.bodyLg, paddingVertical: 11, outlineStyle: 'none' },
});
