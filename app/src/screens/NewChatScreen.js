import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, TextInput, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../icons/Icon';
import { EmojiText } from '../icons/Emoji';
import { api } from '../api';
import { useChatActions } from '../store/ChatContext';
import { useTheme } from '../store/ThemeContext';
import { Avatar, EmptyState, InkField, InkIconButton, InkCheckbox, handleFor, GoldTick, hasGoldTick } from '../components/common';
import { type, inkBox, marker, dashedRule } from '../theme';
import { SpringPressable, motion } from '../motion';

export default function NewChatScreen({ navigation, embedded = false }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { upsertChat, refreshChats, refreshActivity, createEncryptedGroupChat } = useChatActions();
  const [users, setUsers] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [groupMode, setGroupMode] = useState(false);
  const [selected, setSelected] = useState([]);
  const [groupName, setGroupName] = useState('');
  const [busy, setBusy] = useState(false);
  const [connectBusy, setConnectBusy] = useState(null);
  const [connectError, setConnectError] = useState('');
  const [encryptedGroup, setEncryptedGroup] = useState(false);

  const s = makeStyles(theme);

  const loadUsers = async () => {
    try {
      const { users: list } = await api.users();
      setUsers(list);
    } catch {} finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadUsers(); }, []);

  const filtered = users.filter((u) => {
    const q = query.toLowerCase();
    return (
      u.name.toLowerCase().includes(q) ||
      (u.username && u.username.includes(q)) ||
      u.phone.includes(query)
    );
  });

  const openDirect = async (u) => {
    setBusy(true);
    try {
      const { chat } = await api.directChat(u.id);
      if (!chat?.id) throw new Error('Could not open this conversation');
      // Give Conversation an immediate route fallback and also synchronize the
      // shared inbox before navigating. This removes the blank-screen race on
      // slower Android devices where navigation committed before Context state.
      upsertChat(chat);
      await refreshChats().catch(() => {});
      navigation.replace('Conversation', { chatId: chat.id, initialChat: chat });
    } finally { setBusy(false); }
  };

  const sendConnect = async (u) => {
    if (u.connectStatus === 'connected' || u.connectStatus === 'outgoing') return;
    if (u.connectStatus === 'incoming') {
      setConnectError('They already sent you a +one — open Activity to accept.');
      return;
    }
    setConnectBusy(u.id);
    setConnectError('');
    try {
      const result = await api.connectUser(u.id);
      setUsers((prev) => prev.map((person) => (
        person.id === u.id ? { ...person, connectStatus: result.status || 'outgoing' } : person
      )));
      refreshActivity?.();
    } catch (e) {
      setConnectError(e.message || 'Could not send a +one request');
    } finally {
      setConnectBusy(null);
    }
  };

  const toggleSelect = (u) =>
    setSelected((prev) => (prev.includes(u.id) ? prev.filter((x) => x !== u.id) : [...prev, u.id]));

  const createGroup = async () => {
    if (!groupName.trim() || !selected.length) return;
    setBusy(true);
    try {
      let chat;
      if (encryptedGroup) {
        chat = await createEncryptedGroupChat({ name: groupName.trim(), memberIds: selected });
      } else {
        const res = await api.groupChat({ name: groupName.trim(), memberIds: selected });
        chat = res.chat;
      }
      if (!chat?.id) throw new Error('Could not create group');
      upsertChat(chat);
      await refreshChats();
      navigation.replace('Conversation', { chatId: chat.id, initialChat: chat });
    } finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={[s.header, !embedded && { paddingTop: 20 + insets.top }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={{ padding: 6 }}>
          <Icon name="arrow-back" size={22} color={theme.ink} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[type.headlineMd, { color: theme.text }]}>{groupMode ? 'New group' : 'find +ones'}</Text>
          <Text style={[type.bodySm, { color: theme.subtext }]}>
            {groupMode ? `${selected.length} selected` : 'Tap +one to connect · tap a name to chat'}
          </Text>
        </View>
        <InkIconButton
          name={groupMode ? 'person-outline' : 'people-outline'}
          onPress={() => { setGroupMode((v) => !v); setSelected([]); }}
          size={38}
          iconSize={18}
          active={groupMode}
        />
      </View>

      {groupMode && (
        <>
          <InkField style={s.groupNameWrap}>
            <Icon name="camera-outline" size={20} color={theme.muted} />
            <TextInput
              style={s.groupInput}
              placeholder="Group name"
              placeholderTextColor={theme.muted}
              value={groupName}
              onChangeText={setGroupName}
            />
          </InkField>
          <Pressable
            onPress={() => setEncryptedGroup(v => !v)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 20, marginBottom: 14, padding: 10, borderWidth: encryptedGroup ? 2 : 1, borderColor: encryptedGroup ? theme.ink : theme.graphiteLine, backgroundColor: encryptedGroup ? theme.highlighterSoft : 'transparent' }}
          >
            <Icon name={encryptedGroup ? 'lock-closed' : 'lock-open-outline'} size={18} color={theme.ink} />
            <View style={{ flex: 1 }}>
              <Text style={[type.bodyMd, { color: theme.text }]}>{encryptedGroup ? 'Encrypted group — E2EE' : 'Enable encryption for this group'}</Text>
              <Text style={[type.labelXs, { color: theme.muted, marginTop: 2 }]}>{encryptedGroup ? 'Messages encrypted with per-chat symmetric key wrapped per member. Server stores ciphertext only. Collaborative notes remain unencrypted.' : 'Opt-in Secret Group mode — server cannot read messages.'}</Text>
            </View>
            <Icon name={encryptedGroup ? 'checkbox' : 'square-outline'} size={20} color={theme.ink} />
          </Pressable>
        </>
      )}

      <InkField style={s.searchWrap}>
        <Icon name="search" size={18} color={theme.muted} />
        <TextInput
          style={s.searchInput}
          placeholder="Search name or number"
          placeholderTextColor={theme.muted}
          value={query}
          onChangeText={setQuery}
        />
      </InkField>

      {!!connectError && (
        <Text style={[type.bodySm, { color: theme.danger, paddingHorizontal: 20, marginBottom: 8 }]}>{connectError}</Text>
      )}

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={theme.ink} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(i) => i.id}
          ListEmptyComponent={<EmptyState icon="person-outline" title="No contacts found" subtitle="Try a different search." />}
          ItemSeparatorComponent={() => <View style={[dashedRule(theme), { marginHorizontal: 20 }]} />}
          contentContainerStyle={[s.list, !filtered.length && { flexGrow: 1 }]}
          renderItem={({ item }) => {
            const isSel = selected.includes(item.id);
            return (
              <SpringPressable
                style={({ pressed }) => [s.row, isSel && marker(theme, 1), pressed && marker(theme, 1)]}
                onPress={() => (groupMode ? toggleSelect(item) : openDirect(item))}
                disabled={busy}
                scaleTo={motion.scale.row}
                haptic="selection"
              >
                {!groupMode && (
                  <PlusOneButton
                    theme={theme}
                    status={item.connectStatus}
                    busy={connectBusy === item.id}
                    disabled={!!connectBusy || busy}
                    onPress={() => sendConnect(item)}
                  />
                )}
                {groupMode && <InkCheckbox checked={isSel} size={19} />}
                <Avatar uri={item.avatar} name={item.name} id={item.id} online={item.isOnline} size={44} profileId={item.id} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <EmojiText style={[type.headlineSm, { color: theme.text, flexShrink: 1 }]}>{item.name}</EmojiText>
                    {hasGoldTick(item) && <GoldTick size={15} />}
                  </View>
                  <Text style={[type.labelXs, { color: theme.graphite, marginTop: 3 }]}>
                    {handleFor(item)}
                  </Text>
                </View>
              </SpringPressable>
            );
          }}
        />
      )}

      {groupMode && selected.length > 0 && !!groupName.trim() && (
        <SpringPressable
          onPress={createGroup}
          disabled={busy}
          style={({ pressed }) => [s.fab, inkBox(theme, 'bold'), { backgroundColor: pressed ? theme.highlighter : theme.ink }]}
          scaleTo={motion.scale.row}
          haptic="selection"
        >
          {busy ? <ActivityIndicator color={theme.onPrimary} /> : <Icon name="checkmark" size={22} color={theme.onPrimary} />}
        </SpringPressable>
      )}
    </View>
  );
}

function PlusOneButton({ theme, status, busy, disabled, onPress }) {
  const sent = status === 'outgoing';
  const connected = status === 'connected';
  const incoming = status === 'incoming';
  const label = connected ? 'ONE' : sent ? 'SENT' : incoming ? 'IN' : '+one';
  return (
    <SpringPressable
      accessibilityRole="button"
      accessibilityLabel={connected ? 'Already connected' : sent ? 'Request sent' : 'Send +one request'}
      onPress={(e) => {
        e?.stopPropagation?.();
        if (!sent && !connected && !incoming) onPress();
      }}
      disabled={disabled || sent || connected || incoming}
      hitSlop={6}
      style={({ pressed }) => [
        styles.plus,
        inkBox(theme, connected || sent ? 'thin' : 'ink'),
        connected && { backgroundColor: theme.ink },
        pressed && !sent && !connected && marker(theme, 1),
        (disabled || sent) && { opacity: busy ? 1 : 0.7 },
      ]}
      scaleTo={motion.scale.row}
      haptic="selection"
    >
      {busy
        ? <ActivityIndicator size="small" color={theme.ink} />
        : <Text style={[type.labelXs, { color: connected ? theme.onPrimary : theme.ink }]}>{label}</Text>}
    </SpringPressable>
  );
}

const makeStyles = (t) => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 14 },
  groupNameWrap: { marginHorizontal: 20, marginBottom: 14, paddingHorizontal: 2, minHeight: 48 },
  groupInput: { flex: 1, ...type.bodyLg, color: t.text, paddingVertical: 11, outlineStyle: 'none' },
  searchWrap: { marginHorizontal: 20, marginBottom: 8, paddingHorizontal: 2, minHeight: 46 },
  searchInput: { flex: 1, ...type.bodyMd, color: t.text, paddingVertical: 11, outlineStyle: 'none' },
  list: { paddingBottom: 110 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 13 },
  fab: { position: 'absolute', right: 24, bottom: 26, width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
});

const styles = StyleSheet.create({
  plus: {
    minWidth: 46, minHeight: 36, paddingHorizontal: 8, paddingVertical: 7,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
});
