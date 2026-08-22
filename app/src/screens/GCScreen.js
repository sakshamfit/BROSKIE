import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet, Modal, TextInput, ActivityIndicator,
  RefreshControl, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../icons/Icon';
import { EmojiText } from '../icons/Emoji';
import { api } from '../api';
import { useAuth } from '../store/AuthContext';
import { useChat } from '../store/ChatContext';
import { useTheme } from '../store/ThemeContext';
import {
  Avatar, EmptyState, TapeChip, Rule, InkButton, InkField, FrostedBackdrop,
  GoldTick, hasGoldTick, formatChatTime, rippleFor, CountBead,
} from '../components/common';
import BrandHeader from '../components/BrandHeader';
import { SpringPressable, motion, haptic, FadeSlide } from '../motion';
import { type, marker, stroke, raised } from '../theme';
import useResponsive from '../hooks/useResponsive';

/**
 * GC — the group-chat section (Instagram-style GCs). Anyone can make any
 * kind of group and start chatting; anyone can find it in Discover and join
 * — instantly for open GCs, or via an admin-approved request. GC
 * conversations are real chats, but they NEVER appear in the Chats inbox:
 * they live here only (chat.type === 'gc').
 */
export default function GCScreen({ navigation, onOpenChat }) {
  const { user } = useAuth();
  const { theme } = useTheme();
  const { gcChats, refreshGCs, gcTyping: typing, onGCEvent } = useChat();
  const { isTablet } = useResponsive();
  const [section, setSection] = useState('mine'); // mine | discover
  const [discover, setDiscover] = useState([]);
  const [discoverLoading, setDiscoverLoading] = useState(true);
  const [gcMeta, setGcMeta] = useState({}); // chatId -> { description, privacy, requestCount }
  const [busyId, setBusyId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [requestsFor, setRequestsFor] = useState(null);
  const s = makeStyles(theme);

  // My GCs come from the GC-only store (gcChats). The direct Chat store
  // never contains GC rows, so nothing here can move or hide a direct chat.
  const myGCs = useMemo(
    () => gcChats.filter((c) => !c.archived).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)),
    [gcChats]
  );

  const loadAll = useCallback(async () => {
    try {
      const [, disc] = await Promise.all([
        refreshGCs().catch(() => []),
        api.gcDiscover().catch(() => ({ gcs: [] })),
      ]);
      setDiscover(Array.isArray(disc) ? disc : disc.gcs || []);
    } finally {
      setDiscoverLoading(false);
    }
  }, [refreshGCs]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => {
    // Keep `gcMeta` (description/privacy/request counts) in step with the
    // GC store summaries.
    setGcMeta(Object.fromEntries(gcChats.map((c) => [c.id, c.gc || {}])));
  }, [gcChats]);

  // Join requests arriving / being answered elsewhere — keep badges fresh.
  useEffect(() => {
    if (!onGCEvent) return undefined;
    return onGCEvent((ev) => {
      loadAll();
      if (ev === 'gc:requestUpdate') refreshGCs().catch(() => {});
    });
  }, [onGCEvent, loadAll, refreshGCs]);

  const onRefresh = async () => {
    setRefreshing(true);
    try { await loadAll(); } catch {}
    finally { setRefreshing(false); }
  };

  const openChat = (chat) => {
    haptic('selection');
    const isMember = !!(chat.isMember || chat.role || chat.members?.some((m) => m.id === user?.id) || myGCs.some((g) => g.id === chat.id));
    if (onOpenChat) onOpenChat(chat.id, isMember);
    else navigation?.navigate?.(isMember ? 'GCChat' : 'GCDetail', { chatId: chat.id });
  };

  const [joinError, setJoinError] = useState('');

  const joinGC = async (gc) => {
    if (busyId) return;
    setBusyId(gc.id);
    haptic('impact');
    try {
      const r = await api.gcJoin(gc.id);
      if (r.joined) {
        await refreshGCs().catch(() => {});
        setSection('mine');
      }
      await loadAll();
    } catch (e) {
      setJoinError(e.message || 'Could not join this GC');
      setTimeout(() => setJoinError(''), 2600);
    } finally {
      setBusyId(null);
    }
  };

  const cancelRequest = async (gc) => {
    if (busyId) return;
    setBusyId(gc.id);
    try { await api.gcCancelJoin(gc.id); await loadAll(); } catch {}
    finally { setBusyId(null); }
  };

  const onCreated = async () => {
    await refreshGCs().catch(() => {});
    await loadAll();
    setSection('mine');
  };

  const SectionToggle = (
    <View style={s.sectionRow}>
      <SpringPressable
        onPress={() => setSection('mine')}
        scaleTo={motion.scale.chip}
        haptic="selection"
        style={[s.sectionBtn, section === 'mine' && s.sectionActive, { borderColor: theme.ink }]}
      >
        <Icon name="gc" size={15} color={section === 'mine' ? theme.onPrimary : theme.text} />
        <Text style={[type.labelSm, { color: section === 'mine' ? theme.onPrimary : theme.text }]}>MY GCS</Text>
      </SpringPressable>
      <SpringPressable
        onPress={() => setSection('discover')}
        scaleTo={motion.scale.chip}
        haptic="selection"
        style={[s.sectionBtn, section === 'discover' && s.sectionActive, { borderColor: theme.ink }]}
      >
        <Icon name="search" size={15} color={section === 'discover' ? theme.onPrimary : theme.text} />
        <Text style={[type.labelSm, { color: section === 'discover' ? theme.onPrimary : theme.text }]}>DISCOVER</Text>
      </SpringPressable>
    </View>
  );

  const renderMyGC = ({ item, index }) => {
    const meta = gcMeta[item.id] || {};
    const last = item.lastMessage;
    const isMine = last?.senderId === user.id;
    let preview = 'Tap to start chatting';
    if (last) {
      if (last.type === 'system') preview = last.body;
      else if (last.type === 'image') preview = '📷 Photo';
      else if (last.type === 'voice') preview = '🎙 Voice note';
      else if (last.type === 'poll') preview = '📊 Poll';
      else preview = last.body || '';
      if (!isMine && last.type !== 'system' && last.senderId) {
        const sender = (item.members || []).find((m) => m.id === last.senderId);
        if (sender) preview = `${sender.name.split(' ')[0]}: ${preview}`;
      }
    }
    const isTyping = !!Object.keys(typing[item.id] || {}).length;
    const reqCount = meta.requestCount || 0;
    return (
      <SpringPressable
        accessibilityRole="button"
        accessibilityLabel={`Open GC ${item.name}`}
        onPress={() => openChat(item)}
        scaleTo={motion.scale.row}
        haptic="selection"
        style={({ pressed }) => [
          s.gcRow, index === 0 && s.gcRowFirst,
          { backgroundColor: pressed ? theme.cardAlt : theme.card, borderColor: theme.graphiteLine },
        ]}
      >
        <Avatar uri={item.avatar} name={item.name} id={item.id} group size={56} unread={!!item.unread} weight={item.unread ? 'ink' : 'thin'} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <EmojiText style={[type.bodyStrong, { color: theme.text, flexShrink: 1 }]} numberOfLines={1}>{item.name}</EmojiText>
            {item.members?.some((m) => hasGoldTick(m)) && <GoldTick size={13} />}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 2 }}>
              <Icon name="people-outline" size={11} color={theme.muted} />
              <Text style={[type.labelXs, { color: theme.muted }]}>{item.members?.length || 1}</Text>
            </View>
          </View>
          <Text style={[type.bodySm, { color: isTyping ? theme.highlighter : theme.subtext, marginTop: 2, fontStyle: isTyping ? 'italic' : null }]} numberOfLines={1}>
            {isTyping ? 'typing…' : preview}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 7 }}>
          <Text style={[type.labelXs, { color: theme.muted }]}>
            {last ? formatChatTime(last.createdAt) : ''}
          </Text>
          {!!item.unread && <CountBead label={item.unread > 9 ? '9+' : String(item.unread)} small />}
          {reqCount > 0 && (
            <Pressable
              accessibilityLabel={`${reqCount} join request${reqCount === 1 ? '' : 's'}`}
              onPress={(e) => { e?.stopPropagation?.(); haptic('selection'); setRequestsFor(item.id); }}
              hitSlop={6}
              style={({ pressed }) => [s.requestChip, { borderColor: theme.ink, backgroundColor: pressed ? theme.highlighterWash : theme.highlighter }]}
            >
              <Icon name="person-add-outline" size={11} color={theme.text} />
              <Text style={[type.labelXs, { color: theme.text }]}>{reqCount}</Text>
            </Pressable>
          )}
        </View>
      </SpringPressable>
    );
  };

  const renderDiscover = ({ item, index }) => {
    const busy = busyId === item.id;
    return (
      <View style={[s.discCard, { backgroundColor: theme.card, borderColor: theme.ink }, index === 0 && s.gcRowFirst]}>
        <Avatar uri={item.avatar} name={item.name} id={item.id} group size={54} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <EmojiText style={[type.bodyStrong, { color: theme.text, flexShrink: 1 }]} numberOfLines={1}>{item.name}</EmojiText>
            <TapeChip label={item.privacy === 'open' ? 'OPEN' : 'REQUEST'} tone={item.privacy === 'open' ? 'accent' : 'ink'} />
          </View>
          {!!item.description && (
            <Text style={[type.bodySm, { color: theme.subtext, marginTop: 3 }]} numberOfLines={2}>{item.description}</Text>
          )}
          <Text style={[type.labelXs, { color: theme.muted, marginTop: 4 }]} numberOfLines={1}>
            {item.memberCount} member{item.memberCount === 1 ? '' : 's'}
            {item.createdByName ? ` · by ${item.createdByName}` : ''}
          </Text>
        </View>
        {item.pendingRequest ? (
          <InkButton label="Requested" icon="checkmark" onPress={() => cancelRequest(item)} disabled={busy} style={s.discBtn} />
        ) : (
          <InkButton
            label={item.privacy === 'open' ? 'Join' : 'Request'}
            icon={item.privacy === 'open' ? 'add' : 'person-add-outline'}
            filled
            onPress={() => joinGC(item)}
            busy={busy}
            style={s.discBtn}
          />
        )}
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <BrandHeader navigation={navigation} />
      <FlatList
        data={section === 'mine' ? myGCs : discover}
        keyExtractor={(i) => i.id}
        renderItem={section === 'mine' ? renderMyGC : renderDiscover}
        contentContainerStyle={[s.list, isTablet && s.listWide, !(section === 'mine' ? myGCs.length : discover.length) && { flexGrow: 1 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.ink} />}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={s.headerWrap}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={[s.gcBadge, { borderColor: theme.ink }]}>
                <Icon name="gc" size={26} color={theme.ink} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.pageTitle}>GC</Text>
                <Text style={[type.labelXs, { color: theme.muted, marginTop: 2 }]}>
                  GROUP CHATS · MAKE ANY GROUP, CHAT ABOUT ANYTHING
                </Text>
              </View>
              <SpringPressable
                accessibilityRole="button"
                accessibilityLabel="Create a GC"
                onPress={() => { haptic('selection'); setCreateOpen(true); }}
                hitSlop={8}
                scaleTo={motion.scale.row}
                style={({ pressed }) => [s.headerAdd, { borderColor: theme.ink }, pressed && marker(theme, 1)]}
              >
                <Icon name="add" size={21} color={theme.ink} />
              </SpringPressable>
            </View>

            {SectionToggle}

            {!!joinError && (
              <Text style={[type.bodySm, { color: theme.danger, marginBottom: 8 }]}>{joinError}</Text>
            )}

            <Rule style={{ marginTop: 14, marginBottom: 4 }} />
          </View>
        }
        ListEmptyComponent={
          section === 'mine' ? (
            <EmptyState
              icon="gc"
              title="No GCs yet"
              subtitle="Make a group for anything — your squad, your class, your 2am overthinkers. Tap + to create one, or find one in Discover."
            />
          ) : discoverLoading ? (
            <ActivityIndicator style={{ marginTop: 40 }} color={theme.ink} />
          ) : (
            <EmptyState
              icon="search"
              title="Nothing to discover"
              subtitle="Every GC you haven't joined shows up here. Check back after people make new ones."
            />
          )
        }
      />

      <GCCreate visible={createOpen} onClose={() => setCreateOpen(false)} onCreated={onCreated} />

      <GCRequests
        chatId={requestsFor}
        onClose={() => setRequestsFor(null)}
        onHandled={() => { loadAll(); refreshGCs().catch(() => {}); }}
      />
    </View>
  );
}

/** Create-a-GC overlay: name, description, who can join, and the first
 *  members picked from your contacts. */
function GCCreate({ visible, onClose, onCreated }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const s = makeStyles(theme);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [privacy, setPrivacy] = useState('request'); // open | request
  const [contacts, setContacts] = useState([]);
  const [selected, setSelected] = useState([]);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setName(''); setDescription(''); setPrivacy('request');
    setSelected([]); setError('');
  };

  useEffect(() => {
    if (!visible) return undefined;
    reset();
    api.users('', { contactsOnly: true })
      .then((r) => setContacts(r.users || []))
      .catch(() => setContacts([]));
    return undefined;
  }, [visible]);

  const toggle = (id) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const close = () => {
    if (posting) return;
    onClose?.();
  };

  const submit = async () => {
    if (!name.trim()) { setError('Give your GC a name'); return; }
    setPosting(true);
    setError('');
    try {
      await api.gcCreate({
        name: name.trim(),
        description: description.trim(),
        privacy,
        memberIds: selected,
      });
      onClose?.();
      onCreated?.();
    } catch (e) {
      setError(e.message || 'Could not create this GC');
    } finally {
      setPosting(false);
    }
  };

  const PRIVACY = [
    { key: 'open', icon: 'planet-outline', label: 'Anyone can join', sub: 'Tap Join and they are in' },
    { key: 'request', icon: 'person-add-outline', label: 'Approve requests', sub: 'You approve each person' },
  ];

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView
        style={[s.createWrap, { backgroundColor: theme.bg, paddingTop: Math.max(insets.top, 10), paddingBottom: Math.max(insets.bottom, 12) }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={s.createTopBar}>
          <Pressable onPress={close} hitSlop={9} style={{ padding: 5 }}>
            <Icon name="close" size={24} color={theme.ink} />
          </Pressable>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="gc" size={20} color={theme.ink} />
            <Text style={[type.headlineSm, { color: theme.text }]}>New GC</Text>
          </View>
          <InkButton label="Create" icon="checkmark" filled busy={posting} onPress={submit} disabled={!name.trim()} />
        </View>

        <FlatList
          data={contacts}
          keyExtractor={(i) => i.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
          ListHeaderComponent={
            <View>
              <InkField style={s.nameField}>
                <Icon name="gc" size={18} color={theme.muted} />
                <TextInput
                  style={s.nameInput}
                  placeholder="GC name (e.g. 2am Overthinkers)"
                  placeholderTextColor={theme.muted}
                  value={name}
                  onChangeText={(t) => { setName(t); setError(''); }}
                  maxLength={60}
                  returnKeyType="done"
                />
              </InkField>
              <InkField style={s.descField}>
                <TextInput
                  style={s.descInput}
                  placeholder="What is this GC about? (optional)"
                  placeholderTextColor={theme.muted}
                  value={description}
                  onChangeText={setDescription}
                  maxLength={300}
                  multiline
                />
              </InkField>

              <Text style={[type.labelXs, { color: theme.muted, marginTop: 14, marginBottom: 8 }]}>WHO CAN JOIN</Text>
              {PRIVACY.map((p) => {
                const active = privacy === p.key;
                return (
                  <SpringPressable
                    key={p.key}
                    onPress={() => { haptic('selection'); setPrivacy(p.key); }}
                    scaleTo={motion.scale.row}
                    style={({ pressed }) => [
                      s.privacyRow,
                      { borderColor: active ? theme.ink : theme.graphiteLine, backgroundColor: pressed ? theme.cardAlt : theme.card },
                      active && { borderWidth: stroke.ink },
                    ]}
                  >
                    <Icon name={active ? 'checkmark-circle' : p.icon} size={20} color={active ? theme.ink : theme.muted} />
                    <View style={{ flex: 1 }}>
                      <Text style={[type.bodyStrong, { color: theme.text }]}>{p.label}</Text>
                      <Text style={[type.bodySm, { color: theme.subtext, marginTop: 1 }]}>{p.sub}</Text>
                    </View>
                  </SpringPressable>
                );
              })}

              {!!error && <Text style={[type.bodySm, { color: theme.danger, marginTop: 12 }]}>{error}</Text>}

              <Text style={[type.labelXs, { color: theme.muted, marginTop: 18, marginBottom: 4 }]}>
                ADD PEOPLE {selected.length ? `· ${selected.length} PICKED` : '· OPTIONAL'}
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const isSel = selected.includes(item.id);
            return (
              <SpringPressable
                onPress={() => { haptic('selection'); toggle(item.id); }}
                scaleTo={motion.scale.row}
                style={({ pressed }) => [s.memberRow, (isSel || pressed) && marker(theme, 1)]}
              >
                <Avatar uri={item.avatar} name={item.name} id={item.id} size={40} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <EmojiText style={[type.bodyMd, { color: theme.text, flexShrink: 1 }]} numberOfLines={1}>{item.name}</EmojiText>
                    {hasGoldTick(item) && <GoldTick size={12} />}
                  </View>
                  <Text style={[type.labelXs, { color: theme.muted }]}>@{item.username}</Text>
                </View>
                <View style={[s.tickBox, { borderColor: isSel ? theme.ink : theme.graphiteLine, backgroundColor: isSel ? theme.ink : 'transparent' }]}>
                  {isSel && <Icon name="checkmark" size={15} color={theme.onPrimary} />}
                </View>
              </SpringPressable>
            );
          }}
          ListEmptyComponent={
            <Text style={[type.bodySm, { color: theme.muted, paddingVertical: 18, textAlign: 'center' }]}>
              No contacts yet — people you chat with will show up here. You can still create the GC now.
            </Text>
          }
        />
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** The admin's join-request tray for one GC. */
function GCRequests({ chatId, onClose, onHandled }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const s = makeStyles(theme);
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    if (!chatId) { setList([]); return; }
    setLoading(true);
    (async () => {
      try {
        const r = await api.gcRequests(chatId);
        setList(r.requests || []);
      } catch {} finally { setLoading(false); }
    })();
  }, [chatId]);

  const respond = async (userId, action) => {
    if (!chatId || busyId) return;
    setBusyId(userId);
    haptic('selection');
    try {
      await api.gcRespondRequest(chatId, userId, action);
      setList((prev) => prev.filter((r) => r.id !== userId));
      onHandled?.();
    } catch {} finally { setBusyId(null); }
  };

  return (
    <Modal visible={!!chatId} animationType="slide" transparent onRequestClose={onClose}>
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
            <Pressable onPress={onClose} hitSlop={10}>
              <Icon name="close" size={22} color={theme.ink} />
            </Pressable>
          </View>
          <Rule style={{ marginTop: 0, marginBottom: 8 }} />

          {loading ? (
            <ActivityIndicator style={{ marginVertical: 30 }} color={theme.ink} />
          ) : !list.length ? (
            <Text style={[type.bodySm, { color: theme.muted, textAlign: 'center', paddingVertical: 28 }]}>
              No pending requests. When someone asks to join, they appear here.
            </Text>
          ) : (
            <FlatList
              data={list}
              keyExtractor={(r) => r.id}
              style={{ maxHeight: 320 }}
              renderItem={({ item }) => (
                <View style={s.reqRow}>
                  <Avatar uri={item.avatar} name={item.name} id={item.id} size={42} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <EmojiText style={[type.bodyStrong, { color: theme.text, flexShrink: 1 }]} numberOfLines={1}>{item.name}</EmojiText>
                      {hasGoldTick(item) && <GoldTick size={12} />}
                    </View>
                    <Text style={[type.labelXs, { color: theme.muted }]}>@{item.username}</Text>
                  </View>
                  <InkButton
                    label="Decline"
                    icon="close"
                    danger
                    disabled={!!busyId}
                    onPress={() => respond(item.id, 'decline')}
                    style={{ minHeight: 40, paddingHorizontal: 12 }}
                  />
                  <InkButton
                    label="Approve"
                    icon="checkmark"
                    filled
                    disabled={!!busyId}
                    busy={busyId === item.id}
                    onPress={() => respond(item.id, 'approve')}
                    style={{ minHeight: 40, paddingHorizontal: 12 }}
                  />
                </View>
              )}
            />
          )}
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const makeStyles = (t) => StyleSheet.create({
  list: { paddingHorizontal: 20, paddingBottom: 120 },
  listWide: { maxWidth: 640, width: '100%', alignSelf: 'center' },

  headerWrap: { paddingTop: 18, paddingBottom: 12 },
  pageTitle: { ...type.headlineLg, color: t.text, transform: [{ rotate: '-1deg' }] },
  gcBadge: {
    width: 54, height: 54, borderWidth: stroke.ink, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', backgroundColor: t.highlighterWash,
  },
  headerAdd: { width: 44, height: 44, borderWidth: 2, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  sectionRow: { flexDirection: 'row', gap: 7, marginTop: 14 },
  sectionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderRadius: 999, paddingVertical: 9, paddingHorizontal: 8,
  },
  sectionActive: { backgroundColor: t.ink },

  gcRow: {
    flexDirection: 'row', alignItems: 'center', gap: 13,
    padding: 13, borderWidth: 1, borderBottomWidth: 0, borderTopLeftRadius: 12, borderTopRightRadius: 12,
  },
  gcRowFirst: { borderTopWidth: 1 },
  requestChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderRadius: 999,
  },

  discCard: {
    flexDirection: 'row', alignItems: 'center', gap: 13,
    padding: 13, borderWidth: 1, borderBottomWidth: 0, borderTopLeftRadius: 12, borderTopRightRadius: 12,
  },
  discBtn: { minHeight: 42, paddingHorizontal: 13 },

  createWrap: { flex: 1 },
  createTopBar: {
    minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, marginBottom: 6,
  },
  nameField: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
  nameInput: { flex: 1, ...type.headlineSm, color: t.text, paddingVertical: 12, outlineStyle: 'none' },
  descField: { marginTop: 10, paddingHorizontal: 14 },
  descInput: { ...type.bodyMd, color: t.text, minHeight: 54, maxHeight: 110, paddingVertical: 10, outlineStyle: 'none' },
  privacyRow: {
    flexDirection: 'row', alignItems: 'center', gap: 13,
    borderWidth: 1, borderRadius: 12, padding: 13, marginBottom: 9,
  },
  memberRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 9, paddingHorizontal: 10, borderRadius: 10,
  },
  tickBox: {
    width: 26, height: 26, borderWidth: 2, borderRadius: 7,
    alignItems: 'center', justifyContent: 'center',
  },

  sheetOverlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, maxHeight: '85%' },
  sheetHead: { flexDirection: 'row', alignItems: 'center' },
  reqRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 10 },
});
