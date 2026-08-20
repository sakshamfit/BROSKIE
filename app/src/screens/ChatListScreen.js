import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet, TextInput, RefreshControl, Modal, Alert,
} from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import Icon from '../icons/Icon';
import Emoji, { EmojiText } from '../icons/Emoji';
import BrandHeader from '../components/BrandHeader';
import { useChat } from '../store/ChatContext';
import { useAuth } from '../store/AuthContext';
import { useTheme } from '../store/ThemeContext';
import {
  Avatar, Ticks, EmptyState, formatChatTime, SketchDivider, Rule, PaperCard, MotionIn,
  FrostedBackdrop, GoldTick, hasGoldTick,
} from '../components/common';
import { type, inkBox, marker, radius, stroke } from '../theme';
import { api } from '../api';
import { confirm } from '../hooks/confirm';

/* each divider leans a slightly different way, like a hand-ruled line */
const TILTS = [-0.5, 0.8, -0.3, 0.6, -0.7, 0.4];

// Chat tiles intentionally stay solid India-ink black in every theme. They
// are the high-contrast "black boxes" that separate people from the paper
// background instead of disappearing into it.
const CHAT_TILE = '#090909';
const CHAT_TILE_PRESSED = '#242321';
const CHAT_TILE_TEXT = '#fdf8f8';
const CHAT_TILE_MUTED = '#bdb9b7';
const CHAT_TILE_LINE = '#000000';

export default function ChatListScreen({ navigation }) {
  const { chats, refreshChats, typing, markRead } = useChat();
  const { user } = useAuth();
  const { theme } = useTheme();
  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [msgResults, setMsgResults] = useState([]);
  const [showArchived, setShowArchived] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [sheetChat, setSheetChat] = useState(null); // long-press action sheet
  const [sheetBusy, setSheetBusy] = useState(false);

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

  const pinnedCount = visible.filter((c) => c.pinned).length;

  const toggleArchive = async (chat) => { await api.archive(chat.id, !chat.archived); refreshChats(); };
  const togglePin = async (chat) => { await api.pin(chat.id, !chat.pinned); refreshChats(); };
  const toggleMute = async (chat) => { await api.mute(chat.id, !chat.muted); refreshChats(); };
  const deleteChat = async (chat) => {
    const ok = await confirm(
      `Delete ${chat.type === 'group' ? `“${chat.name}”` : `your chat with ${chat.name}`} from your inbox? Its current history will be cleared for you, but not for other members.`,
      { title: 'Delete chat', confirmLabel: 'Delete chat', destructive: true }
    );
    if (!ok) return;
    setSheetBusy(true);
    try {
      await api.deleteChat(chat.id);
      setSheetChat(null);
      await refreshChats();
    } catch (error) {
      Alert.alert('Could not delete chat', error.message || 'Please try again.');
    } finally {
      setSheetBusy(false);
    }
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
      else if (lm.type === 'poll') preview = '📊 Poll';
      else if (lm.type === 'system') preview = lm.body;
      else preview = lm.body;
      if (item.type === 'group' && lm.type !== 'system' && !isMine) {
        const sender = item.members.find((m) => m.id === lm.senderId);
        if (sender) senderPrefix = `${sender.name.split(' ')[0]}:`;
      }
    }

    return (
      <MotionIn delay={Math.min(index, 8) * 28} distance={10} style={s.rowWrap}>
        {/* A hard offset plate plus a soft shadow gives the black card real
            depth on Android, iOS and web without adding another native module. */}
        <View pointerEvents="none" style={[s.rowDepth, hasUnread && { backgroundColor: '#8d7900' }]} />
        <Pressable
          onPress={() => navigation.navigate('Conversation', { chatId: item.id })}
          onLongPress={() => setSheetChat(item)}
          delayLongPress={280}
          style={({ pressed }) => [
            s.row,
            hasUnread ? s.rowUnread : s.rowRead,
            {
              borderColor: hasUnread ? theme.highlighter : CHAT_TILE_LINE,
              transform: [
                { rotate: hasUnread ? '-0.18deg' : '0.1deg' },
                { translateX: pressed ? 2 : 0 },
                { translateY: pressed ? 4 : 0 },
              ],
            },
            pressed ? { backgroundColor: CHAT_TILE_PRESSED } : null,
          ]}
        >
          <View pointerEvents="none" style={s.rowSheen} />
          <View pointerEvents="none" style={s.rowEdge} />
          {hasUnread && <View style={[s.unreadMark, { backgroundColor: theme.highlighter, borderColor: CHAT_TILE }]} />}
          <View style={[s.avatarFrame, { borderColor: hasUnread ? theme.highlighter : CHAT_TILE_TEXT }]}>
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
          </View>

          <View style={s.rowBody}>
            <View style={s.rowTop}>
              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 6, marginRight: 10 }}>
                {item.pinned && <Icon name="pin" size={13} color={theme.highlighter} />}
                <EmojiText style={s.name} numberOfLines={1}>{item.name}</EmojiText>
                {hasGoldTick(item) && <GoldTick size={15} />}
                {item.requestStatus === 'pending' && item.requestDirection === 'outgoing' && (
                  <Text style={[type.labelXs, s.requestSent]}>REQUEST SENT</Text>
                )}
              </View>
              <Text style={[s.time, hasUnread && { color: theme.highlighter }]}>
                {formatChatTime(lm?.createdAt || item.updatedAt)}
              </Text>
            </View>

            <View style={s.rowBottom}>
              {typers.length > 0 ? (
                <View style={marker(theme, 1)}>
                  <Text style={[type.bodyMd, { color: theme.highlighter, fontStyle: 'italic', paddingHorizontal: 3 }]} numberOfLines={1}>
                    {item.type === 'group' ? `${typers[0]} is typing…` : 'typing…'}
                  </Text>
                </View>
              ) : (
                <View style={s.previewRow}>
                  {isMine && lm && lm.type !== 'system' && (
                    <Ticks status={lm.status} size={13} color={lm.status === 'read' ? theme.highlighter : CHAT_TILE_MUTED} />
                  )}
                  {lm && (lm.type === 'image' || lm.type === 'voice') && !lm.deleted && (
                    <Emoji char={lm.type === 'image' ? '📷' : '🎤'} size={13} />
                  )}
                  {!!senderPrefix && (
                    <Text style={[s.preview, { fontFamily: type.body(700), flex: 0, color: CHAT_TILE_TEXT }]}>{senderPrefix}</Text>
                  )}
                  <EmojiText
                    style={[s.preview, hasUnread && { color: CHAT_TILE_TEXT }]}
                    numberOfLines={1}
                  >
                    {preview}
                  </EmojiText>
                </View>
              )}
              {item.muted && <Icon name="volume-mute" size={14} color={CHAT_TILE_MUTED} style={{ marginLeft: 8 }} />}
            </View>
          </View>
        </Pressable>
      </MotionIn>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <BrandHeader navigation={navigation} />

      <FlatList
        data={visible}
        keyExtractor={(i) => i.id}
        renderItem={renderChat}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.ink} />}
        contentContainerStyle={[s.listContent, !visible.length && { flexGrow: 1 }]}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <MotionIn distance={8}>
            <View>
            <View style={[s.recentCard, { backgroundColor: theme.card, borderColor: theme.ink }]}>
              <Text style={s.recentTitle}>RECENT CHATS</Text>
              <View style={[s.inkLine, { backgroundColor: theme.ink }]} />
              <View style={[s.inkLineFine, { backgroundColor: theme.ink }]} />
            </View>
            {/* searchable, but visually kept as a hand-inked panel */}
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

            {!showArchived && pinnedCount > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingVertical: 10 }}>
                <Icon name="pin" size={14} color={theme.ink} />
                <Text style={[type.labelXs, { color: theme.muted, letterSpacing: 1 }]}>PINNED</Text>
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
          </MotionIn>
        }
        ListEmptyComponent={
          <EmptyState
            icon={showArchived ? 'archive-outline' : 'chatbubbles-outline'}
            title={showArchived ? 'Nothing archived' : 'Blank page'}
            subtitle={showArchived ? 'Long-press a chat to archive it.' : 'Tap find +ones to start a conversation.'}
          />
        }
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="find +ones"
        onPress={() => navigation.navigate('NewChat')}
        style={({ pressed }) => [s.fab, inkBox(theme, 'bold'), { backgroundColor: pressed ? theme.highlighter : theme.ink }]}
      >
        {({ pressed }) => (
          <>
            <Icon name="search" size={16} color={pressed ? theme.ink : theme.onPrimary} />
            <Text style={[s.fabLabel, { color: pressed ? theme.ink : theme.onPrimary }]}>find +ones</Text>
          </>
        )}
      </Pressable>

      {/* long-press action sheet */}
      <Modal visible={!!sheetChat} transparent animationType="fade" onRequestClose={() => !sheetBusy && setSheetChat(null)}>
        <View style={[s.overlay, { backgroundColor: theme.dark ? 'rgba(0,0,0,0.28)' : 'rgba(28,27,27,0.18)' }]}>
          <FrostedBackdrop intensity={65} dim={0.16} />
          <Pressable style={StyleSheet.absoluteFill} onPress={() => !sheetBusy && setSheetChat(null)} />
          <PaperCard weight="ink" style={[s.sheet, { backgroundColor: theme.dark ? 'rgba(31,30,30,0.96)' : 'rgba(253,248,248,0.96)' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6 }}>
              <Avatar
                uri={sheetChat?.avatar} name={sheetChat?.name}
                id={sheetChat?.otherUserId || sheetChat?.id}
                group={sheetChat?.type === 'group'} size={44}
              />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <EmojiText style={[type.headlineSm, { color: theme.text, flexShrink: 1 }]} numberOfLines={1}>{sheetChat?.name}</EmojiText>
                  {hasGoldTick(sheetChat) && <GoldTick size={15} />}
                </View>
                <Text style={[type.bodySm, { color: theme.subtext }]}>
                  {sheetChat?.type === 'group' ? 'Group chat' : 'Direct chat'}
                </Text>
              </View>
              <Pressable onPress={() => setSheetChat(null)} hitSlop={8}>
                <Icon name="close" size={20} color={theme.muted} />
              </Pressable>
            </View>
            <Rule style={{ marginVertical: 6 }} />
            <SheetRow
              icon={sheetChat?.pinned ? 'pin' : 'pin-outline'}
              label={sheetChat?.pinned ? 'Unpin chat' : 'Pin chat'}
              onPress={() => { const c = sheetChat; setSheetChat(null); togglePin(c); }}
            />
            <SheetRow
              icon={sheetChat?.muted ? 'volume-mute' : 'notifications-outline'}
              label={sheetChat?.muted ? 'Unmute notifications' : 'Mute notifications'}
              onPress={() => { const c = sheetChat; setSheetChat(null); toggleMute(c); }}
            />
            <SheetRow
              icon="archive-outline"
              label={sheetChat?.archived ? 'Unarchive chat' : 'Archive chat'}
              onPress={() => { const c = sheetChat; setSheetChat(null); toggleArchive(c); }}
            />
            {sheetChat?.unread > 0 && (
              <SheetRow
                icon="checkmark-done"
                label="Mark as read"
                onPress={() => { const c = sheetChat; setSheetChat(null); markRead(c.id); }}
              />
            )}
            <Rule style={{ marginVertical: 5 }} />
            <SheetRow
              icon="trash-outline"
              label={sheetBusy ? 'Deleting…' : 'Delete chat'}
              danger
              disabled={sheetBusy}
              onPress={() => deleteChat(sheetChat)}
            />
          </PaperCard>
        </View>
      </Modal>
    </View>
  );
}

function SheetRow({ icon, label, onPress, danger = false, disabled = false }) {
  const { theme } = useTheme();
  const color = danger ? theme.danger : theme.ink;
  return (
    <Pressable
      style={({ pressed }) => [s2.row, pressed ? marker(theme, 1) : null, disabled && { opacity: 0.45 }]}
      onPress={onPress}
      disabled={disabled}
    >
      <Icon name={icon} size={18} color={color} />
      <Text style={[type.bodyMd, { color }]}>{label}</Text>
    </Pressable>
  );
}
const s2 = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 6, paddingVertical: 12 },
});

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
  requestsButton: {
    minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 8, paddingVertical: 7, backgroundColor: t.card,
  },

  listContent: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 120 },

  // Manga-inspired paper panel. These are visual-only treatments: chat records and handlers stay unchanged.
  recentCard: {
    borderWidth: 3, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 16,
    borderTopLeftRadius: 4, borderTopRightRadius: 7, borderBottomRightRadius: 3, borderBottomLeftRadius: 6,
    transform: [{ rotate: '-0.5deg' }],
  },
  recentTitle: { ...type.headlineMd, color: t.text, letterSpacing: 0.7 },
  inkLine: { height: 2, width: '100%', marginTop: 8 },
  inkLineFine: { height: 1, width: '94%', marginTop: 3, opacity: 0.5 },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, minHeight: 48, marginBottom: 16,
    borderWidth: 2, borderStyle: 'dashed', borderColor: t.graphiteLine,
    borderTopLeftRadius: 4, borderTopRightRadius: 7, borderBottomRightRadius: 3, borderBottomLeftRadius: 6,
  },
  searchInput: { flex: 1, ...type.bodyLg, color: t.text, paddingVertical: 12, outlineStyle: 'none' },

  rowWrap: {
    position: 'relative', marginBottom: 20,
    shadowColor: '#000000', shadowOffset: { width: 0, height: 9 }, shadowOpacity: 0.28, shadowRadius: 9,
    elevation: 10,
  },
  rowDepth: {
    position: 'absolute', left: 5, right: -5, top: 7, bottom: -7,
    backgroundColor: '#302e2b', borderWidth: 2, borderColor: '#000000',
    borderTopLeftRadius: 8, borderTopRightRadius: 12, borderBottomRightRadius: 9, borderBottomLeftRadius: 11,
  },
  row: {
    flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 13, alignItems: 'center', gap: 14,
    borderWidth: 2, backgroundColor: CHAT_TILE,
    borderTopLeftRadius: 8, borderTopRightRadius: 12, borderBottomRightRadius: 8, borderBottomLeftRadius: 11,
    overflow: 'hidden',
  },
  rowSheen: {
    position: 'absolute', left: 12, right: 16, top: 1, height: 1,
    backgroundColor: 'rgba(255,255,255,0.24)',
  },
  rowEdge: {
    position: 'absolute', top: 10, right: 1, bottom: 10, width: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  rowUnread: { borderWidth: 3 },
  rowRead: { borderStyle: 'solid' },
  avatarFrame: {
    width: 66, height: 66, padding: 3, borderWidth: 2, borderRadius: radius.full,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#111111',
  },
  unreadMark: { position: 'absolute', width: 13, height: 13, left: -7, top: '50%', marginTop: -6, transform: [{ rotate: '45deg' }], borderWidth: 2, zIndex: 2 },
  rowBody: { flex: 1, minWidth: 0 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 },
  name: { ...type.headlineSm, color: CHAT_TILE_TEXT, flexShrink: 1 },
  time: { ...type.labelXs, color: CHAT_TILE_MUTED },
  requestSent: { color: '#1c1b1b', backgroundColor: t.highlighter, paddingHorizontal: 5, paddingVertical: 2 },
  rowBottom: { flexDirection: 'row', alignItems: 'center' },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flex: 1 },
  preview: { ...type.bodyMd, color: CHAT_TILE_MUTED, flex: 1 },

  fab: {
    position: 'absolute', right: 16, bottom: 26,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 13, minHeight: 52,
    transform: [{ rotate: '2deg' }],
  },
  fabLabel: { ...type.bodyStrong, fontSize: 14.5, letterSpacing: -0.2 },
  archiveRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 8, paddingVertical: 14, marginBottom: 6 },
  resultsWrap: { paddingTop: 16 },
  resultRow: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 10 },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  sheet: { position: 'relative', zIndex: 2, width: '100%', maxWidth: 360, padding: 16 },
});
