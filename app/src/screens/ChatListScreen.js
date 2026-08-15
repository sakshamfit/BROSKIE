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
  Avatar, Ticks, EmptyState, formatChatTime, ClayInset, ClayBead, ClayIconButton, ClaySurface,
} from '../components/common';
import { radius, type, clayFor, clayPressed } from '../theme';
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
  const toggleMute = async (chat) => { await api.mute(chat.id, !chat.muted); refreshChats(); };

  const onLongPress = (chat) => {
    if (Platform.OS === 'web') {
      if (window.confirm(`${chat.archived ? 'Unarchive' : 'Archive'} "${chat.name}"?`)) toggleArchive(chat);
      return;
    }
    toggleArchive(chat);
  };

  const renderChat = ({ item }) => {
    const typers = Object.values(typing[item.id] || {});
    const lm = item.lastMessage;
    const isMine = lm && lm.senderId === user.id;

    let preview = 'Tap to start chatting';
    if (lm) {
      if (lm.deleted) preview = 'This message was deleted';
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
      <ClaySurface
        onPress={() => navigation.navigate('Conversation', { chatId: item.id })}
        onLongPress={() => onLongPress(item)}
        style={s.row}
        radius={radius.md}
        level={1}
      >
        <Avatar uri={item.avatar} name={item.name} id={item.otherUserId || item.id} group={item.type === 'group'} online={item.isOnline} size={54} />
        <View style={s.rowBody}>
          <View style={s.rowTop}>
            <EmojiText style={s.name} numberOfLines={1}>{item.name}</EmojiText>
            <Text style={[s.time, item.unread > 0 && { color: theme.primary, fontFamily: type.fontFamily(600) }]}>
              {formatChatTime(lm?.createdAt || item.updatedAt)}
            </Text>
          </View>
          <View style={s.rowBottom}>
            {typers.length > 0 ? (
              <Text style={[s.preview, { color: theme.primary, fontFamily: type.fontFamily(500) }]} numberOfLines={1}>
                {item.type === 'group' ? `${typers[0]} is typing…` : 'typing…'}
              </Text>
            ) : (
              <View style={s.previewRow}>
                {isMine && lm && lm.type !== 'system' && <Ticks status={lm.status} size={14} />}
                {lm && (lm.type === 'image' || lm.type === 'voice') && !lm.deleted && (
                  <Emoji char={lm.type === 'image' ? '📷' : '🎤'} size={14} />
                )}
                <EmojiText style={s.preview} numberOfLines={1}>{preview}</EmojiText>
              </View>
            )}
            <View style={s.badges}>
              {item.muted && <Icon name="volume-mute" size={15} color={theme.muted} style={{ marginRight: 6 }} />}
              {item.unread > 0 && <ClayBead label={item.unread > 99 ? '99+' : String(item.unread)} />}
            </View>
          </View>
        </View>
      </ClaySurface>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* header */}
      <View style={s.header}>
        {searching ? (
          <ClayInset style={s.searchBar}>
            <Pressable onPress={() => { setSearching(false); setQuery(''); setMsgResults([]); }} hitSlop={8}>
              <Icon name="arrow-back" size={21} color={theme.muted} />
            </Pressable>
            <TextInput
              autoFocus value={query} onChangeText={runSearch}
              placeholder="Search chats and messages…"
              placeholderTextColor={theme.muted}
              style={s.searchInput}
            />
          </ClayInset>
        ) : (
          <>
            <View style={{ flex: 1 }}>
              <Text style={s.headerTitle}>BROSKIE</Text>
            </View>
            <View style={s.headerActions}>
              <ClayIconButton name="search" onPress={() => setSearching(true)} size={44} iconSize={20} />
              <ClayIconButton name="ellipsis-vertical" onPress={() => navigation.navigate('Settings')} size={44} iconSize={20} />
            </View>
          </>
        )}
      </View>

      {/* message search results */}
      {searching && msgResults.length > 0 && (
        <View style={s.resultsWrap}>
          <Text style={[type.labelMd, { color: theme.primary, paddingHorizontal: 24, paddingBottom: 10 }]}>MESSAGES</Text>
          {msgResults.slice(0, 6).map((m) => (
            <ClaySurface
              key={m.id}
              style={s.resultRow}
              radius={radius.md}
              onPress={() => { setSearching(false); navigation.navigate('Conversation', { chatId: m.chatId }); }}
            >
              <Icon name="chatbubble-outline" size={18} color={theme.primary} />
              <View style={{ flex: 1 }}>
                <EmojiText style={[type.bodySm, { fontFamily: type.fontFamily(600), color: theme.text }]}>{m.chatName}</EmojiText>
                <EmojiText style={[type.bodySm, { color: theme.subtext }]} numberOfLines={1}>{m.body}</EmojiText>
              </View>
              <Text style={s.time}>{formatChatTime(m.createdAt)}</Text>
            </ClaySurface>
          ))}
        </View>
      )}

      <FlatList
        data={visible}
        keyExtractor={(i) => i.id}
        renderItem={renderChat}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
        contentContainerStyle={[s.listContent, !visible.length && { flexGrow: 1 }]}
        ListHeaderComponent={
          !showArchived && archivedCount > 0 ? (
            <ClaySurface onPress={() => setShowArchived(true)} style={s.archiveRow} radius={radius.md}>
              <Icon name="archive-outline" size={20} color={theme.primary} />
              <Text style={[type.bodyLg, { flex: 1, color: theme.text, fontFamily: type.fontFamily(500) }]}>Archived</Text>
              <ClayBead label={String(archivedCount)} small />
            </ClaySurface>
          ) : showArchived ? (
            <ClaySurface onPress={() => setShowArchived(false)} style={s.archiveRow} radius={radius.md}>
              <Icon name="arrow-back" size={20} color={theme.primary} />
              <Text style={[type.bodyLg, { flex: 1, color: theme.text, fontFamily: type.fontFamily(500) }]}>Back to chats</Text>
            </ClaySurface>
          ) : null
        }
        ListEmptyComponent={
          <EmptyState
            icon={showArchived ? 'archive-outline' : 'chatbubbles-outline'}
            title={showArchived ? 'No archived chats' : 'No chats yet'}
            subtitle={showArchived ? 'Long-press a chat to archive it.' : 'Tap the mint button to start a conversation.'}
          />
        }
      />

      <Pressable
        onPress={() => navigation.navigate('NewChat')}
        style={({ pressed }) => [s.fab, { backgroundColor: theme.accent }, pressed ? clayPressed(theme.shadowTint) : clayFor(theme, 3)]}
      >
        <Icon name="chatbubble-ellipses" size={26} color={theme.onAccent} />
      </Pressable>
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, minHeight: 84,
  },
  headerTitle: { ...type.displayLg, color: t.text, letterSpacing: 1.2 },
  headerActions: { flexDirection: 'row', gap: 10 },
  searchBar: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, minHeight: 52 },
  searchInput: { flex: 1, ...type.bodyLg, color: t.text, paddingVertical: 12, outlineStyle: 'none' },

  listContent: { paddingHorizontal: 20, paddingBottom: 110, gap: 16 },

  row: { flexDirection: 'row', padding: 16, alignItems: 'center', gap: 14 },
  rowBody: { flex: 1 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  name: { ...type.headlineSm, color: t.text, flex: 1, marginRight: 10 },
  time: { ...type.bodySm, fontSize: 12, color: t.muted },
  rowBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flex: 1 },
  preview: { ...type.bodySm, color: t.subtext, flex: 1 },
  badges: { flexDirection: 'row', alignItems: 'center', marginLeft: 10 },

  fab: {
    position: 'absolute', right: 20, bottom: 24, width: 64, height: 64, borderRadius: radius.full,
    alignItems: 'center', justifyContent: 'center',
  },
  archiveRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingVertical: 18 },
  resultsWrap: { paddingHorizontal: 20, paddingBottom: 16, gap: 12 },
  resultRow: { flexDirection: 'row', gap: 14, alignItems: 'center', paddingHorizontal: 18, paddingVertical: 14 },
});
