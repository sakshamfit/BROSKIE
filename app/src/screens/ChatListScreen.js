import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet, TextInput, RefreshControl, Platform,
} from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import Icon from '../icons/Icon';
import Emoji, { EmojiText } from '../icons/Emoji';
import { useChat } from '../store/ChatContext';
import { useAuth } from '../store/AuthContext';
import { useTheme } from '../store/ThemeContext';
import {
  Avatar, Ticks, EmptyState, formatChatTime, SketchDivider, InkIconButton, Rule,
} from '../components/common';
import { type, inkBox, marker, stroke } from '../theme';
import { api } from '../api';

/* each divider leans a slightly different way, like a hand-ruled line */
const TILTS = [-0.5, 0.8, -0.3, 0.6, -0.7, 0.4];

export default function ChatListScreen({ navigation }) {
  const { chats, refreshChats, typing } = useChat();
  const { user } = useAuth();
  const { theme } = useTheme();
  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
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
    const hasUnread = item.unread > 0;

    let preview = 'no messages yet';
    let senderPrefix = null;
    if (lm) {
      if (lm.deleted) preview = 'message deleted';
      else if (lm.type === 'image') preview = 'Photo';
      else if (lm.type === 'voice') preview = 'Voice message';
      else if (lm.type === 'system') preview = lm.body;
      else preview = lm.body;
      if (item.type === 'group' && lm.type !== 'system' && !isMine) {
        const sender = item.members.find((m) => m.id === lm.senderId);
        if (sender) senderPrefix = `${sender.name.split(' ')[0]}:`;
      }
    }

    return (
      <>
        <Pressable
          onPress={() => navigation.navigate('Conversation', { chatId: item.id })}
          onLongPress={() => onLongPress(item)}
          style={({ pressed }) => [s.row, pressed ? marker(theme, 1) : null]}
        >
          <Avatar
            uri={item.avatar}
            name={item.name}
            id={item.otherUserId || item.id}
            group={item.type === 'group'}
            online={item.isOnline}
            unread={hasUnread}
            weight={hasUnread ? 'ink' : 'thin'}
            size={56}
          />

          <View style={s.rowBody}>
            <View style={s.rowTop}>
              <EmojiText style={s.name} numberOfLines={1}>{item.name}</EmojiText>
              <Text style={[s.time, hasUnread && { color: theme.ink }]}>
                {formatChatTime(lm?.createdAt || item.updatedAt)}
              </Text>
            </View>

            <View style={s.rowBottom}>
              {typers.length > 0 ? (
                <View style={marker(theme, 1)}>
                  <Text style={[type.bodyMd, { color: theme.ink, fontStyle: 'italic', paddingHorizontal: 3 }]} numberOfLines={1}>
                    {item.type === 'group' ? `${typers[0]} is typing…` : 'typing…'}
                  </Text>
                </View>
              ) : (
                <View style={s.previewRow}>
                  {isMine && lm && lm.type !== 'system' && <Ticks status={lm.status} size={13} />}
                  {lm && (lm.type === 'image' || lm.type === 'voice') && !lm.deleted && (
                    <Emoji char={lm.type === 'image' ? '📷' : '🎤'} size={13} />
                  )}
                  {!!senderPrefix && (
                    <Text style={[s.preview, { fontFamily: type.body(700), flex: 0 }]}>{senderPrefix}</Text>
                  )}
                  <EmojiText
                    style={[s.preview, hasUnread && { color: theme.text }]}
                    numberOfLines={1}
                  >
                    {preview}
                  </EmojiText>
                </View>
              )}
              {item.muted && <Icon name="volume-mute" size={14} color={theme.muted} style={{ marginLeft: 8 }} />}
            </View>
          </View>
        </Pressable>
        {index < visible.length - 1 && (
          <SketchDivider tilt={TILTS[index % TILTS.length]} style={{ marginVertical: 10, marginHorizontal: 8 }} />
        )}
      </>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* TopAppBar — ruled underline, centred wordmark */}
      <View style={[s.header, { borderBottomWidth: stroke.ink, borderBottomColor: theme.ink }]}>
        <InkIconButton name="ellipsis-vertical" onPress={() => navigation.navigate('Settings')} size={38} iconSize={18} />
        <Text style={s.wordmark}>友達</Text>
        <Pressable onPress={() => navigation.navigate('Settings')}>
          <Avatar uri={user?.avatar} name={user?.name} id={user?.id} size={38} />
        </Pressable>
      </View>

      <FlatList
        data={visible}
        keyExtractor={(i) => i.id}
        renderItem={renderChat}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.ink} />}
        contentContainerStyle={[s.listContent, !visible.length && { flexGrow: 1 }]}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View>
            {/* sketch-bordered search box */}
            <View style={s.searchBox}>
              <TextInput
                value={query}
                onChangeText={runSearch}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                placeholder="Search chats..."
                placeholderTextColor={theme.muted}
                style={s.searchInput}
              />
              <Icon name="search" size={19} color={theme.graphite} />
            </View>
            {/* scribble focus indicator */}
            {searchFocused && <Scribble />}

            {msgResults.length > 0 && (
              <View style={s.resultsWrap}>
                <Text style={[type.labelXs, { color: theme.muted, marginBottom: 8 }]}>MESSAGES</Text>
                {msgResults.slice(0, 6).map((m) => (
                  <Pressable
                    key={m.id}
                    style={({ pressed }) => [s.resultRow, pressed ? marker(theme, 1) : null]}
                    onPress={() => { setQuery(''); setMsgResults([]); navigation.navigate('Conversation', { chatId: m.chatId }); }}
                  >
                    <Icon name="chatbubble-outline" size={15} color={theme.graphite} />
                    <View style={{ flex: 1 }}>
                      <EmojiText style={[type.bodyStrong, { color: theme.text }]}>{m.chatName}</EmojiText>
                      <EmojiText style={[type.bodySm, { color: theme.subtext }]} numberOfLines={1}>{m.body}</EmojiText>
                    </View>
                    <Text style={s.time}>{formatChatTime(m.createdAt)}</Text>
                  </Pressable>
                ))}
                <Rule />
              </View>
            )}

            {!showArchived && archivedCount > 0 && (
              <Pressable style={({ pressed }) => [s.archiveRow, pressed ? marker(theme, 1) : null]} onPress={() => setShowArchived(true)}>
                <Icon name="archive-outline" size={17} color={theme.ink} />
                <Text style={[type.bodyMd, { flex: 1, color: theme.text }]}>Archived</Text>
                <Text style={[type.labelSm, { color: theme.muted }]}>{archivedCount}</Text>
              </Pressable>
            )}
            {showArchived && (
              <Pressable style={({ pressed }) => [s.archiveRow, pressed ? marker(theme, 1) : null]} onPress={() => setShowArchived(false)}>
                <Icon name="arrow-back" size={17} color={theme.ink} />
                <Text style={[type.bodyMd, { flex: 1, color: theme.text }]}>Back to chats</Text>
              </Pressable>
            )}
          </View>
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
        <Icon name="create-outline" size={21} color={theme.onPrimary} />
      </Pressable>
    </View>
  );
}

/** Zig-zag scribble under the focused search field (real jagged stroke). */
function Scribble() {
  const { theme } = useTheme();
  // uneven peaks/valleys so it reads as a quick pen flick, not a chart
  const pts = '0,7 22,1 44,9 66,2 88,8 110,3 132,9 154,2 176,7 198,1 220,8 242,4 264,9 286,2 308,7';
  return (
    <View style={{ height: 11, marginTop: 4, marginHorizontal: 12, opacity: 0.8 }}>
      <Svg width="100%" height="11" viewBox="0 0 308 11" preserveAspectRatio="none">
        <Polyline
          points={pts}
          fill="none"
          stroke={theme.ink}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 18, paddingBottom: 14,
  },
  wordmark: { ...type.headlineMd, color: t.text, fontStyle: 'italic', letterSpacing: -0.5 },

  listContent: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 120 },

  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 20, minHeight: 52, marginBottom: 6,
    borderWidth: 2, borderColor: t.ink,
    // stadium, but each corner a touch different so it reads hand-drawn
    borderTopLeftRadius: 26, borderTopRightRadius: 24,
    borderBottomRightRadius: 26, borderBottomLeftRadius: 22,
  },
  searchInput: { flex: 1, ...type.bodyLg, color: t.text, paddingVertical: 12, outlineStyle: 'none' },

  row: { flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 12, alignItems: 'center', gap: 16 },
  rowBody: { flex: 1, minWidth: 0 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 },
  name: { ...type.headlineSm, color: t.text, flex: 1, marginRight: 10 },
  time: { ...type.labelXs, color: t.muted },
  rowBottom: { flexDirection: 'row', alignItems: 'center' },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flex: 1 },
  preview: { ...type.bodyMd, color: t.subtext, flex: 1 },

  fab: {
    position: 'absolute', right: 24, bottom: 26, width: 54, height: 54,
    alignItems: 'center', justifyContent: 'center',
  },
  archiveRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 8, paddingVertical: 14, marginBottom: 6 },
  resultsWrap: { paddingTop: 16 },
  resultRow: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 10 },
});
