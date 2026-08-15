import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, TextInput, ActivityIndicator } from 'react-native';
import Icon from '../icons/Icon';
import { EmojiText } from '../icons/Emoji';
import { api } from '../api';
import { useChat } from '../store/ChatContext';
import { useTheme } from '../store/ThemeContext';
import { Avatar, EmptyState, ClayInset, ClaySurface, ClayIconButton, handleFor } from '../components/common';
import { radius, type, clayFor, clayPressed } from '../theme';

export default function NewChatScreen({ navigation }) {
  const { theme } = useTheme();
  const { upsertChat, refreshChats } = useChat();
  const [users, setUsers] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [groupMode, setGroupMode] = useState(false);
  const [selected, setSelected] = useState([]);
  const [groupName, setGroupName] = useState('');
  const [busy, setBusy] = useState(false);

  const s = makeStyles(theme);

  useEffect(() => {
    api.users().then(({ users }) => setUsers(users)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const filtered = users.filter(
    (u) => u.name.toLowerCase().includes(query.toLowerCase()) || u.phone.includes(query)
  );

  const openDirect = async (u) => {
    setBusy(true);
    try {
      const { chat } = await api.directChat(u.id);
      upsertChat(chat);
      navigation.replace('Conversation', { chatId: chat.id });
    } finally { setBusy(false); }
  };

  const toggleSelect = (u) =>
    setSelected((prev) => (prev.includes(u.id) ? prev.filter((x) => x !== u.id) : [...prev, u.id]));

  const createGroup = async () => {
    if (!groupName.trim() || !selected.length) return;
    setBusy(true);
    try {
      const { chat } = await api.groupChat({ name: groupName.trim(), memberIds: selected });
      upsertChat(chat);
      await refreshChats();
      navigation.replace('Conversation', { chatId: chat.id });
    } finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={s.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={{ padding: 6 }}>
          <Icon name="arrow-back" size={23} color={theme.primary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[type.headlineMd, { color: theme.text }]}>{groupMode ? 'New group' : 'New chat'}</Text>
          <Text style={[type.bodySm, { color: theme.subtext }]}>
            {groupMode ? `${selected.length} selected` : `${users.length} contacts`}
          </Text>
        </View>
        <ClayIconButton
          name={groupMode ? 'person-outline' : 'people-outline'}
          onPress={() => { setGroupMode((v) => !v); setSelected([]); }}
          size={44}
          iconSize={20}
          color={groupMode ? theme.accent : theme.card}
          iconColor={groupMode ? theme.onAccent : theme.primary}
        />
      </View>

      {groupMode && (
        <ClayInset style={s.groupNameWrap}>
          <Icon name="camera-outline" size={20} color={theme.muted} />
          <TextInput
            style={s.groupInput}
            placeholder="Group name"
            placeholderTextColor={theme.muted}
            value={groupName}
            onChangeText={setGroupName}
          />
        </ClayInset>
      )}

      <ClayInset style={s.searchWrap}>
        <Icon name="search" size={18} color={theme.muted} />
        <TextInput
          style={s.searchInput}
          placeholder="Search name or number"
          placeholderTextColor={theme.muted}
          value={query}
          onChangeText={setQuery}
        />
      </ClayInset>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={theme.primary} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(i) => i.id}
          ListEmptyComponent={<EmptyState icon="person-outline" title="No contacts found" subtitle="Try a different search." />}
          contentContainerStyle={[s.list, !filtered.length && { flexGrow: 1 }]}
          renderItem={({ item }) => {
            const isSel = selected.includes(item.id);
            return (
              <ClaySurface
                style={[s.row, isSel && { backgroundColor: theme.accent }]}
                radius={radius.md}
                onPress={() => (groupMode ? toggleSelect(item) : openDirect(item))}
                disabled={busy}
              >
                <View>
                  <Avatar uri={item.avatar} name={item.name} id={item.id} online={item.isOnline} size={50} />
                  {groupMode && isSel && (
                    <View style={[s.check, { backgroundColor: theme.primary, borderColor: theme.accent }]}>
                      <Icon name="checkmark" size={12} color="#fff" />
                    </View>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <EmojiText style={[type.headlineSm, { color: isSel ? theme.onAccent : theme.text }]}>{item.name}</EmojiText>
                  <Text style={[type.labelMd, { color: isSel ? theme.onAccent : theme.primary, marginTop: 3, letterSpacing: 0.3 }]}>
                    {handleFor(item.name, item.phone)}
                  </Text>
                </View>
              </ClaySurface>
            );
          }}
        />
      )}

      {groupMode && selected.length > 0 && !!groupName.trim() && (
        <Pressable
          onPress={createGroup}
          disabled={busy}
          style={({ pressed }) => [s.fab, { backgroundColor: theme.accent }, pressed ? clayPressed(theme.shadowTint) : clayFor(theme, 3)]}
        >
          {busy ? <ActivityIndicator color={theme.onAccent} /> : <Icon name="checkmark" size={26} color={theme.onAccent} />}
        </Pressable>
      )}
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 14 },
  groupNameWrap: { flexDirection: 'row', alignItems: 'center', gap: 14, marginHorizontal: 20, marginBottom: 12, paddingHorizontal: 20, minHeight: 54 },
  groupInput: { flex: 1, ...type.bodyLg, color: t.text, paddingVertical: 15, outlineStyle: 'none' },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 20, marginBottom: 16, paddingHorizontal: 20, minHeight: 50 },
  searchInput: { flex: 1, ...type.bodySm, color: t.text, paddingVertical: 13, outlineStyle: 'none' },
  list: { paddingHorizontal: 20, paddingBottom: 110, gap: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 14 },
  check: { position: 'absolute', right: -3, bottom: -3, width: 22, height: 22, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', borderWidth: 2.5 },
  fab: { position: 'absolute', right: 20, bottom: 24, width: 62, height: 62, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
});
