import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, TextInput, ActivityIndicator } from 'react-native';
import Icon from '../icons/Icon';
import { EmojiText } from '../icons/Emoji';
import { api } from '../api';
import { useChat } from '../store/ChatContext';
import { useTheme } from '../store/ThemeContext';
import { Avatar, EmptyState, InkField, InkIconButton, InkCheckbox, handleFor, Rule } from '../components/common';
import { radius, type, inkBox, marker, dashedRule } from '../theme';

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
          <Icon name="arrow-back" size={22} color={theme.ink} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[type.headlineMd, { color: theme.text }]}>{groupMode ? 'New group' : 'New chat'}</Text>
          <Text style={[type.bodySm, { color: theme.subtext }]}>
            {groupMode ? `${selected.length} selected` : `${users.length} contacts`}
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
              <Pressable
                style={({ pressed }) => [s.row, isSel && marker(theme, 1), pressed && marker(theme, 1)]}
                onPress={() => (groupMode ? toggleSelect(item) : openDirect(item))}
                disabled={busy}
              >
                {groupMode && <InkCheckbox checked={isSel} size={19} />}
                <Avatar uri={item.avatar} name={item.name} id={item.id} online={item.isOnline} size={44} />
                <View style={{ flex: 1 }}>
                  <EmojiText style={[type.headlineSm, { color: theme.text }]}>{item.name}</EmojiText>
                  <Text style={[type.labelXs, { color: theme.graphite, marginTop: 3 }]}>
                    {handleFor(item)}
                  </Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}

      {groupMode && selected.length > 0 && !!groupName.trim() && (
        <Pressable
          onPress={createGroup}
          disabled={busy}
          style={({ pressed }) => [s.fab, inkBox(theme, 'bold'), { backgroundColor: pressed ? theme.highlighter : theme.ink }]}
        >
          {busy ? <ActivityIndicator color={theme.onPrimary} /> : <Icon name="checkmark" size={22} color={theme.onPrimary} />}
        </Pressable>
      )}
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 14 },
  groupNameWrap: { marginHorizontal: 20, marginBottom: 14, paddingHorizontal: 2, minHeight: 48 },
  groupInput: { flex: 1, ...type.bodyLg, color: t.text, paddingVertical: 11, outlineStyle: 'none' },
  searchWrap: { marginHorizontal: 20, marginBottom: 8, paddingHorizontal: 2, minHeight: 46 },
  searchInput: { flex: 1, ...type.bodyMd, color: t.text, paddingVertical: 11, outlineStyle: 'none' },
  list: { paddingBottom: 110 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 13 },
  fab: { position: 'absolute', right: 24, bottom: 26, width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
});
