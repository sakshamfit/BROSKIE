import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet, TextInput, RefreshControl, Platform,
} from 'react-native';
import Icon from '../icons/Icon';
import Emoji, { EmojiText } from '../icons/Emoji';
import { useChat } from '../store/ChatContext';
import { useAuth } from '../store/AuthContext';
import { useTheme } from '../store/ThemeContext';
import {
  Avatar, Ticks, EmptyState, formatChatTime, InkField, CountBead, InkIconButton, Rule,
} from '../components/common';
import { type, inkBox, marker, dashedRule, stroke } from '../theme';
import { api } from '../api';

export default function ChatListScreen({ navigation }) {
  const { chats, refreshChats, typing } = useChat();
  const { user } = useAuth();
  const { theme } = useTheme();
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [msgResults, setMsgResults] = useState([]);
  const [showArchived, setShowArchived] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const s = makeStyles(theme);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await refreshChats(); } finally { setRefreshing(false); }
  }, [refreshChats]);

  const runSearch = useCallback(async (q) => {
    setQuery(q);
    if (q.trim().length < 2) { setMsgResults([]); return; }
    try {
      const { messages } = await api.search(q.trim());
      setMsgResults(messages);
    } catch { setMsgResults([]); }
  }, []);

  const archivedCount = chats.filter((c) => c.archived).length;
  const visible = useMemo(() => {
    const base = chats.filter((c) => (showArchived ? c.archived : !c.archived));
    if (!query.trim()) return base;
    const q = query.toLowerCase();
    return base.filter((c) => c.name?.toLowerCase().includes(q));
  }, [chats, query, showArchived]);

  const toggleArchive = async (chat) => { await api.archive(chat.id, !chat.archived); refreshChats(); };

  const onLongPress = (chat) => {
    if (Platform.OS === 'web') {
      if (window.confirm(`${chat.archived ? 'Unarchive' : 'Archive'} "${chat.name}"?`)) toggleArchive(chat);
      return;
    }
    toggleArchive(chat);
  };

  const renderChat = ({ item, index }) => {
    const typers = Object.values(typing[item.id] || {});
    const lm = item.lastMessage;
    const isMine = lm && lm.senderId === user.id;

    let preview = 'no messages yet';
    if (lm) {
      if (lm.deleted) preview = 'message deleted';
      else if (lm.type === 'image') preview = 'Photo';
      else if (lm.type === 'voice') preview = 'Voice message';
      else if (lm.type === 'system') preview = lm.body;
      else preview = lm.body;
      if (item.type === 'group' && lm.type !== 'system' && !isMine) {
        const sender = item.members.find((m) => m.id === lm.senderId);
        if (sender) preview = `${sender.name.split(' ')[0]}: ${preview}`;
      }
    }

    return (
      <Pressable
        onPress={() => navigation.navigate('Conversation', { chatId: item.id })}
        onLongPress={() => onLongPress(item)}
        style={({ pressed }) => [s.row, pressed ? marker(theme, 1) : null]}
      >
        <Avatar uri={item.avatar} name={item.name} id={item.otherUserId || item.id} group={item.type === 'group'} online={item.isOnline} size={46} />
        <View style={s.rowBody}>
          <View style={s.rowTop}>
            <EmojiText style={s.name} numberOfLines={1}>{item.name}</EmojiText>
            <Text style={[s.time, item.unread > 0 && { color: theme.ink }]}>
              {formatChatTime(lm?.createdAt || item.updatedAt)}
            </Text>
          </View>
          <View style={s.rowBottom}>
            {typers.length > 0 ? (
              <View style={marker(theme, 1)}>
                <Text style={[type.bodySm, { color: theme.ink, fontStyle: 'italic', paddingHorizontal: 3 }]} numberOfLines={1}>
                  {item.type === 'group' ? `${typers[0]} is typing…` : 'typing…'}
                </Text>
              </View>
            ) : (
              <View style={s.previewRow}>
                {isMine && lm && lm.type !== 'system' && <Ticks status={lm.status} size={13} />}
                {lm && (lm.type === 'image' || lm.type === 'voice') && !lm.deleted && (
                  <Emoji char={lm.type === 'image' ? '📷' : '🎤'} size={13} />
                )}
                <EmojiText style={s.preview} numberOfLines={1}>{preview}</EmojiText>
              </View>
            )}
            <View style={s.badges}>
              {item.muted && <Icon name="volume-mute" size={14} color={theme.muted} style={{ marginRight: 6 }} />}
              {item.unread > 0 && <CountBead label={item.unread > 99 ? '99+' : String(item.unread)} small />}
            </View>
          </View>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={s.header}>
        {searching ? (
          <View style={s.searchRow}>
            <Pressable onPress={() => { setSearching(false); setQuery(''); setMsgResults([]); }} hitSlop={8}>
              <Icon name="arrow-back" size={21} color={theme.ink} />
            </Pressable>
            <InkField style={{ flex: 1 }} focused>
              <TextInput
                autoFocus value={query} onChangeText={runSearch}
                placeholder="search…"
                placeholderTextColor={theme.muted}
                style={s.searchInput}
              />
            </InkField>
          </View>
        ) : (
          <>
            <View style={{ flex: 1 }}>
              <Text style={s.headerTitle}>BROSKIE</Text>
              <Text style={[type.labelXs, { color: theme.muted, marginTop: 3 }]}>
                {chats.length} {chats.length === 1 ? 'CONVERSATION' : 'CONVERSATIONS'}
              </Text>
            </View>
            <View style={s.headerActions}>
              <InkIconButton name="search" onPress={() => setSearching(true)} size={38} iconSize={18} />
              <InkIconButton name="ellipsis-vertical" onPress={() => navigation.navigate('Settings')} size={38} iconSize={18} />
            </View>
          </>
        )}
      </View>

      <Rule style={{ marginHorizontal: 20, marginTop: 4, marginBottom: 0 }} />

      {searching && msgResults.length > 0 && (
        <View style={s.resultsWrap}>
          <Text style={[type.labelXs, { color: theme.muted, paddingHorizontal: 20, paddingVertical: 8 }]}>MESSAGES</Text>
          {msgResults.slice(0, 6).map((m) => (
            <Pressable
              key={m.id}
              style={({ pressed }) => [s.resultRow, pressed ? marker(theme, 1) : null]}
              onPress={() => { setSearching(false); navigation.navigate('Conversation', { chatId: m.chatId }); }}
            >
              <Icon name="chatbubble-outline" size={16} color={theme.graphite} />
              <View style={{ flex: 1 }}>
                <EmojiText style={[type.bodyStrong, { color: theme.text }]}>{m.chatName}</EmojiText>
                <EmojiText style={[type.bodySm, { color: theme.subtext }]} numberOfLines={1}>{m.body}</EmojiText>
              </View>
              <Text style={s.time}>{formatChatTime(m.createdAt)}</Text>
            </Pressable>
          ))}
          <Rule style={{ marginHorizontal: 20 }} />
        </View>
      )}

      <FlatList
        data={visible}
        keyExtractor={(i) => i.id}
        renderItem={renderChat}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.ink} />}
        ItemSeparatorComponent={() => <View style={[dashedRule(theme), { marginLeft: 78, marginRight: 20 }]} />}
        contentContainerStyle={[s.listContent, !visible.length && { flexGrow: 1 }]}
        ListHeaderComponent={
          !showArchived && archivedCount > 0 ? (
            <Pressable style={({ pressed }) => [s.archiveRow, pressed ? marker(theme, 1) : null]} onPress={() => setShowArchived(true)}>
              <Icon name="archive-outline" size={18} color={theme.ink} />
              <Text style={[type.bodyMd, { flex: 1, color: theme.text }]}>Archived</Text>
              <Text style={[type.labelSm, { color: theme.muted }]}>{archivedCount}</Text>
            </Pressable>
          ) : showArchived ? (
            <Pressable style={({ pressed }) => [s.archiveRow, pressed ? marker(theme, 1) : null]} onPress={() => setShowArchived(false)}>
              <Icon name="arrow-back" size={18} color={theme.ink} />
              <Text style={[type.bodyMd, { flex: 1, color: theme.text }]}>Back to chats</Text>
            </Pressable>
          ) : null
        }
        ListEmptyComponent={
          <EmptyState
            icon={showArchived ? 'archive-outline' : 'chatbubbles-outline'}
            title={showArchived ? 'Nothing archived' : 'Blank page'}
            subtitle={showArchived ? 'Long-press a chat to archive it.' : 'Tap the pen to start a conversation.'}
          />
        }
      />

      <Pressable
        onPress={() => navigation.navigate('NewChat')}
        style={({ pressed }) => [s.fab, inkBox(theme, 'bold'), { backgroundColor: pressed ? theme.highlighter : theme.ink }]}
      >
        <Icon name="create-outline" size={22} color={theme.onPrimary} />
      </Pressable>
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    paddingHorizontal: 20, paddingTop: 22, paddingBottom: 14,
  },
  headerTitle: { ...type.headlineLg, color: t.text },
  headerActions: { flexDirection: 'row', gap: 8, paddingTop: 4 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1, paddingTop: 4 },
  searchInput: { flex: 1, ...type.bodyLg, color: t.text, paddingVertical: 8, outlineStyle: 'none' },

  listContent: { paddingBottom: 110 },

  row: { flexDirection: 'row', paddingHorizontal: 20, paddingVertical: 14, alignItems: 'center', gap: 14 },
  rowBody: { flex: 1 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 },
  name: { ...type.headlineSm, color: t.text, flex: 1, marginRight: 10 },
  time: { ...type.labelXs, color: t.muted },
  rowBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flex: 1 },
  preview: { ...type.bodySm, color: t.subtext, flex: 1 },
  badges: { flexDirection: 'row', alignItems: 'center', marginLeft: 10 },

  fab: {
    position: 'absolute', right: 24, bottom: 26, width: 54, height: 54,
    alignItems: 'center', justifyContent: 'center',
  },
  archiveRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 16 },
  resultsWrap: { paddingBottom: 4 },
  resultRow: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10 },
});
