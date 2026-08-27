import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  View, FlatList, Pressable, StyleSheet, TextInput, RefreshControl, Modal, Alert, Animated, Easing, ActivityIndicator,
  Platform,
} from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import Icon from '../icons/Icon';
import Emoji, { EmojiText } from '../icons/Emoji';
import BrandHeader from '../components/BrandHeader';
import { useChatListState, useChatMessageState, useChatRealtime, useChatActions } from '../store/ChatContext';
import { useAuth } from '../store/AuthContext';
import { useTheme } from '../store/ThemeContext';
import {
  Avatar, Ticks, EmptyState, formatChatTime, SketchDivider, Rule, PaperCard, MotionIn,
  FrostedBackdrop, GoldTick, hasGoldTick, isGroupChat,
} from '../components/common';
import { type, inkBox, marker, radius, stroke } from '../theme';
import { Skeleton, TypingDots, SpringPressable, FadeSlide, Pop, haptic, motion, BottomSheet, staggerDelay, useReducedMotion } from '../motion';

/** Pressable that can carry a native-driven animated transform. */
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
import { api } from '../api';
import { confirm } from '../hooks/confirm';
import { useDebouncedCallback } from '../rateLimit';
import {
  INBOX_FILTERS, INBOX_LABELS, INBOX_EMPTY, isInboxFilter,
  filterInboxChats, filterInboxRequests, filterSearchMessages, inboxCounts,
} from '../chatInbox';
import { Text } from '../components/Text';

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
const EMPTY_TYPING = Object.freeze({});

// Web/desktop list tuning. Browser viewports are much taller than phones, so
// the native defaults (10 rows first pass, narrow render window) leave the
// fold half-empty on first paint and then churn rows in/out while scrolling —
// mount/unmount is what janks on the web, DOM rows themselves are cheap.
const LIST_PERF = Platform.OS === 'web'
  ? { initialNumToRender: 20, maxToRenderPerBatch: 16, windowSize: 31, updateCellsBatchingPeriod: 30 }
  : {};

export default function ChatListScreen({ navigation }) {
  const {
    chats, chatsLoaded, chatsError, inboxFilter,
    chatRequests, chatRequestsLoaded, chatRequestsError,
  } = useChatListState();
  const { messages } = useChatMessageState();
  const { typing } = useChatRealtime();
  const { refreshChats, markRead, upsertChat, setInboxFilter, refreshChatRequests } = useChatActions();

  useEffect(() => {}, []);
  const { user } = useAuth();
  const { theme } = useTheme();
  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [msgResults, setMsgResults] = useState([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [sheetChat, setSheetChat] = useState(null); // long-press action sheet
  const [sheetBusy, setSheetBusy] = useState(false);
  const [requestBusy, setRequestBusy] = useState(null);
  const [requestError, setRequestError] = useState('');
  const filter = isInboxFilter(inboxFilter) ? inboxFilter : INBOX_FILTERS.recent;

  // Opens the short window in which rows are allowed to cascade in
  // (see ChatRowEntrance). Runs before the first rows render.
  const firstPaint = useRef(true);
  if (firstPaint.current) { firstPaint.current = false; listOpenedAt.t = Date.now(); }

  const s = useMemo(() => makeStyles(theme), [theme]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (filter === INBOX_FILTERS.requests) await refreshChatRequests();
      else await refreshChats({ includeGCs: false });
    } catch { /* existing rows + inline retry stay visible */ } finally { setRefreshing(false); }
  }, [filter, refreshChats, refreshChatRequests]);

  // Debounce: a fast typist fires one /api/search per pause instead of one
  // per keystroke. `searchMessages` keeps a stable identity, so handing it
  // to onChangeText is safe; the latest query wins. `searchSeq` discards
  // out-of-order responses so a slow result can't resurrect itself after
  // the box was cleared.
  // E2EE: server-side search only works on plaintext (non-encrypted) messages.
  // For encrypted chats, search is client-side only over locally decrypted messages.
  const searchSeq = useRef(0);
  const searchMessages = useDebouncedCallback(async (q, seq, category) => {
    if (category === INBOX_FILTERS.requests) {
      if (searchSeq.current === seq) setMsgResults([]);
      return;
    }
    const queryTrim = q.trim().toLowerCase();
    let serverResults = [];
    try {
      const { messages: srv } = await api.search(q.trim());
      serverResults = srv || [];
    } catch {
      serverResults = [];
    }
    // Client-side search for encrypted chats (local decrypted messages)
    let localEncryptedResults = [];
    try {
      const allLocal = Object.values(messages || {}).flat();
      localEncryptedResults = allLocal.filter(m => {
        if (!m.isEncrypted) return false;
        if (!m.body) return false;
        return String(m.body).toLowerCase().includes(queryTrim);
      }).map(m => ({
        ...m,
        chatName: chats.find(c => c.id === m.chatId)?.name || 'Encrypted chat',
      }));
    } catch {}
    const combined = [...serverResults, ...localEncryptedResults];
    // Deduplicate by id
    const seen = new Set();
    const deduped = combined.filter(m => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
    if (searchSeq.current === seq) setMsgResults(filterSearchMessages(deduped, chats, category));
  }, 300);

  const runSearch = useCallback((q) => {
    // Chat-name filtering below is a cheap local `useMemo`, so `query` is
    // applied on every keystroke. The server-side message search is the
    // expensive part, so it is debounced to one request per typing pause.
    setQuery(q);
    const seq = ++searchSeq.current;
    if (q.trim().length < 2 || filter === INBOX_FILTERS.requests) {
      setMsgResults([]);
      searchMessages.cancel();
      return;
    }
    searchMessages(q, seq, filter);
  }, [searchMessages, filter]);

  const selectFilter = useCallback((next) => {
    if (next === filter) { setMenuOpen(false); return; }
    setInboxFilter(next);
    setMenuOpen(false);
    setMsgResults([]);
    searchSeq.current += 1;
    searchMessages.cancel();
    setRequestError('');
  }, [filter, setInboxFilter, searchMessages]);

  // GCs (Instagram-style group chats) live in their own section — never here.
  const counts = useMemo(() => inboxCounts(chats, chatRequests), [chats, chatRequests]);
  const visibleChats = useMemo(
    () => (filter === INBOX_FILTERS.requests ? [] : filterInboxChats(chats, filter, query)),
    [chats, filter, query],
  );
  const visibleRequests = useMemo(
    () => (filter === INBOX_FILTERS.requests ? filterInboxRequests(chatRequests, query) : []),
    [chatRequests, filter, query],
  );
  const visible = filter === INBOX_FILTERS.requests ? visibleRequests : visibleChats;
  const pinnedCount = filter === INBOX_FILTERS.recent ? visibleChats.filter((c) => c.pinned).length : 0;
  const listReady = filter === INBOX_FILTERS.requests ? chatRequestsLoaded : chatsLoaded;
  const listError = filter === INBOX_FILTERS.requests ? chatRequestsError : chatsError;
  const listHasRows = filter === INBOX_FILTERS.requests ? chatRequests.length > 0 : chats.some((c) => c.type !== 'gc');

  const respondRequest = async (item, action) => {
    if (action !== 'accept') {
      const ok = await confirm(
        action === 'block'
          ? `Block ${item.requester?.name || 'this person'} and delete the request?`
          : 'Decline this chat request?',
        {
          title: action === 'block' ? 'Block sender' : 'Decline request',
          confirmLabel: action === 'block' ? 'Block' : 'Decline',
          destructive: true,
        },
      );
      if (!ok) return;
    }
    setRequestBusy(`${item.chatId}:${action}`);
    setRequestError('');
    try {
      const result = await api.respondChatRequest(item.chatId, action);
      if (action === 'accept' && result.chat) upsertChat(result.chat);
      await refreshChatRequests().catch(() => {});
      if (action === 'accept') await refreshChats({ includeGCs: false }).catch(() => {});
    } catch (error) {
      setRequestError(error.message || 'Could not update this request.');
    } finally {
      setRequestBusy(null);
    }
  };

  const toggleArchive = async (chat) => { await api.archive(chat.id, !chat.archived); refreshChats({ includeGCs: false }); };
  const togglePin = async (chat) => { await api.pin(chat.id, !chat.pinned); refreshChats({ includeGCs: false }); };
  const toggleMute = async (chat) => { await api.mute(chat.id, !chat.muted); refreshChats({ includeGCs: false }); };
  const deleteChat = async (chat) => {
    const ok = await confirm(
      `Delete ${isGroupChat(chat) ? `“${chat.name}”` : `your chat with ${chat.name}`} from your inbox? Its current history will be cleared for you, but not for other members.`,
      { title: 'Delete chat', confirmLabel: 'Delete chat', destructive: true }
    );
    if (!ok) return;
    setSheetBusy(true);
    try {
      await api.deleteChat(chat.id);
      setSheetChat(null);
      await refreshChats({ includeGCs: false });
    } catch (error) {
      Alert.alert('Could not delete chat', error.message || 'Please try again.');
    } finally {
      setSheetBusy(false);
    }
  };

  const openSheet = useCallback((chat) => {
    haptic('selection');
    setSheetChat(chat);
  }, []);
  const renderChat = useCallback(({ item, index }) => (
    <ChatRow
      item={item}
      index={index}
      typing={typing[item.id] || EMPTY_TYPING}
      user={user}
      theme={theme}
      navigation={navigation}
      onOpenSheet={openSheet}
      style={s}
    />
  ), [typing, user, theme, navigation, openSheet, s]);

  const renderRequest = ({ item, index }) => (
    <RequestChatRow
      item={item}
      index={index}
      theme={theme}
      busy={requestBusy}
      onAccept={() => respondRequest(item, 'accept')}
      onDecline={() => respondRequest(item, 'delete')}
      style={s}
    />
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <BrandHeader navigation={navigation} />

      <FlatList
        key={`inbox-${filter}`}
        data={visible}
        extraData={`${filter}:${visible.length}:${requestBusy || ''}`}
        keyExtractor={(i) => (filter === INBOX_FILTERS.requests ? i.chatId : i.id)}
        renderItem={filter === INBOX_FILTERS.requests ? renderRequest : renderChat}
        {...LIST_PERF}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.ink} />}
        contentContainerStyle={[s.listContent, !visible.length && { flexGrow: 1 }]}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <MotionIn distance={8}>
            <View>
            <InboxFilterCard
              theme={theme}
              style={s}
              filter={filter}
              counts={counts}
              requestsKnown={chatRequestsLoaded && !chatRequestsError}
              open={menuOpen}
              onToggle={() => { haptic('selection'); setMenuOpen((v) => !v); }}
              onSelect={selectFilter}
            />
            {/* searchable, but visually kept as a hand-inked panel */}
            <View style={s.searchBox}>
              <TextInput
                value={query}
                onChangeText={runSearch}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                placeholder={filter === INBOX_FILTERS.requests ? 'Search requests...' : filter === INBOX_FILTERS.archived ? 'Search archived...' : 'Search chats...'}
                placeholderTextColor={theme.muted}
                style={s.searchInput}
              />
              <Icon name="search" size={19} color={theme.graphite} />
            </View>
            {/* scribble focus indicator */}
            {searchFocused && <Scribble />}

            {!!listError && (filter === INBOX_FILTERS.requests ? chatRequests.length > 0 : chats.length > 0) && (
              <View style={[s.loadError, { borderColor: theme.danger, backgroundColor: theme.dangerContainer }]}>
                <Icon name="alert-circle-outline" size={17} color={theme.danger} />
                <View style={{ flex: 1 }}>
                  <Text style={[type.bodyStrong, { color: theme.danger }]}>
                    {filter === INBOX_FILTERS.requests ? 'Unable to refresh requests' : 'Unable to refresh conversations'}
                  </Text>
                  <Text style={[type.bodySm, { color: theme.subtext }]}>
                    {filter === INBOX_FILTERS.requests ? 'Showing saved requests.' : 'Showing saved chat history.'}
                  </Text>
                </View>
                <Pressable onPress={() => onRefresh()} hitSlop={7}>
                  <Text style={[type.labelXs, { color: theme.danger }]}>RETRY</Text>
                </Pressable>
              </View>
            )}
            {!!requestError && filter === INBOX_FILTERS.requests && (
              <View style={[s.loadError, { borderColor: theme.danger, backgroundColor: theme.dangerContainer }]}>
                <Icon name="alert-circle-outline" size={17} color={theme.danger} />
                <Text style={[type.bodySm, { color: theme.danger, flex: 1 }]}>{requestError}</Text>
              </View>
            )}

            {msgResults.length > 0 && (
              <FadeSlide key={query} from="up" distance={8} duration={motion.fast}>
              <View style={s.resultsWrap}>
                <Text style={[type.labelXs, { color: theme.muted, marginBottom: 8 }]}>MESSAGES</Text>
                {msgResults.slice(0, 6).map((m) => (
                  <SpringPressable
                    key={m.id}
                    style={({ pressed }) => [s.resultRow, pressed ? marker(theme, 1) : null]}
                    onPress={() => { setQuery(''); setMsgResults([]); searchMessages.cancel(); navigation.navigate('Conversation', { chatId: m.chatId }); }}
                    scaleTo={motion.scale.row}
                    haptic="selection"
                  >
                    <Icon name="chatbubble-outline" size={15} color={theme.graphite} />
                    <View style={{ flex: 1 }}>
                      <EmojiText style={[type.bodyStrong, { color: theme.text }]}>{m.chatName}</EmojiText>
                      <EmojiText style={[type.bodySm, { color: theme.subtext }]} numberOfLines={1}>{m.body}</EmojiText>
                    </View>
                    <Text style={s.time}>{formatChatTime(m.createdAt)}</Text>
                  </SpringPressable>
                ))}
                <Rule />
              </View>
              </FadeSlide>
            )}

            {filter === INBOX_FILTERS.recent && pinnedCount > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingVertical: 10 }}>
                <Icon name="pin" size={14} color={theme.ink} />
                <Text style={[type.labelXs, { color: theme.muted, letterSpacing: 1 }]}>PINNED</Text>
              </View>
            )}
            </View>
          </MotionIn>
        }
        ListEmptyComponent={
          !listReady ? (
            <ChatListSkeleton />
          ) : listError && !listHasRows ? (
            <View style={s.emptyLoadError}>
              <EmptyState
                icon="alert-circle-outline"
                title={filter === INBOX_FILTERS.requests ? 'Unable to load requests' : 'Unable to load conversations'}
                subtitle="Your history was not erased. Check your connection and retry."
              />
              <SpringPressable
                accessibilityRole="button"
                onPress={() => onRefresh()}
                style={({ pressed }) => [s.retryButton, inkBox(theme, 'thin'), pressed && marker(theme, 1)]}
                scaleTo={motion.scale.row}
                haptic="selection"
              >
                <Icon name="refresh" size={16} color={theme.ink} />
                <Text style={[type.labelSm, { color: theme.ink }]}>RETRY</Text>
              </SpringPressable>
            </View>
          ) : (
            <EmptyState
              icon={query.trim() ? 'search-outline' : INBOX_EMPTY[filter].icon}
              title={query.trim() ? (filter === INBOX_FILTERS.requests ? 'No matching requests' : 'No matching chats') : INBOX_EMPTY[filter].title}
              subtitle={query.trim() ? 'Try another name or clear the search.' : INBOX_EMPTY[filter].subtitle}
            />
          )
        }
      />

      <SpringPressable
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
      </SpringPressable>

      {/* long-press action sheet */}
      {/* Long-press actions. One shared sheet behaviour: the backdrop dims
          as it springs in, a downward drag pushes it away with the finger,
          and dismissing always animates out rather than cutting. */}
      <BottomSheet
        visible={!!sheetChat}
        onClose={() => setSheetChat(null)}
        dismissible={!sheetBusy}
        centered
        backdrop={<FrostedBackdrop intensity={65} dim={0.16} />}
        backdropStyle={{ backgroundColor: theme.dark ? 'rgba(0,0,0,0.28)' : 'rgba(28,27,27,0.18)' }}
        style={{ paddingHorizontal: 22 }}
      >
        <View style={{ width: '100%', maxWidth: 360 }}>
          <PaperCard weight="ink" style={[s.sheet, { backgroundColor: theme.dark ? 'rgba(31,30,30,0.96)' : 'rgba(253,248,248,0.96)' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6 }}>
              <Avatar
                uri={sheetChat?.avatar} name={sheetChat?.name}
                id={sheetChat?.otherUserId || sheetChat?.id}
                group={isGroupChat(sheetChat)} size={44}
              />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <EmojiText style={[type.headlineSm, { color: theme.text, flexShrink: 1 }]} numberOfLines={1}>{sheetChat?.name}</EmojiText>
                  {hasGoldTick(sheetChat) && <GoldTick size={15} />}
                </View>
                <Text style={[type.bodySm, { color: theme.subtext }]}>
                  {sheetChat?.type === 'gc' ? 'Group chat (GC)' : isGroupChat(sheetChat) ? 'Group chat' : 'Direct chat'}
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
      </BottomSheet>
    </View>
  );
}

const INBOX_OPTIONS = [INBOX_FILTERS.recent, INBOX_FILTERS.archived, INBOX_FILTERS.requests];

function InboxFilterCard({ theme, style: s, filter, counts, requestsKnown, open, onToggle, onSelect }) {
  return (
    <View style={[s.recentCard, { backgroundColor: theme.card, borderColor: theme.ink }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${INBOX_LABELS[filter]}, change chat list`}
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        hitSlop={6}
        style={s.filterTrigger}
      >
        <Text style={s.recentTitle} numberOfLines={1}>{INBOX_LABELS[filter]}</Text>
        <Icon
          name="chevron-down-outline"
          size={20}
          color={theme.ink}
          style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
        />
      </Pressable>
      <View style={[s.inkLine, { backgroundColor: theme.ink }]} />
      <View style={[s.inkLineFine, { backgroundColor: theme.ink }]} />
      {open && (
        <View style={s.filterMenu} accessibilityRole="menu">
          {INBOX_OPTIONS.map((key) => {
            const selected = key === filter;
            const count = key === INBOX_FILTERS.archived
              ? counts.archived
              : key === INBOX_FILTERS.requests && requestsKnown
                ? counts.requests
                : 0;
            const showCount = key !== INBOX_FILTERS.recent && count > 0;
            return (
              <SpringPressable
                key={key}
                accessibilityRole="menuitem"
                accessibilityState={{ selected }}
                accessibilityLabel={showCount ? `${INBOX_LABELS[key]}, ${count}` : INBOX_LABELS[key]}
                onPress={() => onSelect(key)}
                style={({ pressed }) => [s.filterOption, selected && marker(theme, 1), pressed && marker(theme, 1)]}
                scaleTo={motion.scale.row}
                haptic="selection"
              >
                <Text style={[type.bodyMd, { color: theme.text, flex: 1, fontFamily: selected ? type.body(700) : type.body(400) }]}>
                  {INBOX_LABELS[key]}
                </Text>
                {showCount ? <Text style={[type.labelSm, { color: theme.muted }]}>{count}</Text> : null}
                {selected ? <Icon name="checkmark" size={16} color={theme.ink} /> : null}
              </SpringPressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

function RequestChatRow({ item, index, theme, busy, onAccept, onDecline, style: s }) {
  const person = item.requester || {};
  const message = item.chat?.lastMessage;
  const preview = message?.deleted
    ? 'This message was deleted.'
    : message?.body || 'Wants to chat';
  const acceptBusy = busy === `${item.chatId}:accept`;
  const declineBusy = busy === `${item.chatId}:delete`;
  return (
    <ChatRowEntrance index={index} style={s.requestWrap}>
      <View style={[s.requestCard, inkBox(theme, index % 2 ? 'thin' : 'ink'), { backgroundColor: theme.card }]}>
        <View style={s.requestHead}>
          <Avatar uri={person.avatar} name={person.name} id={person.id} size={48} weight="ink" profileId={person.id} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <EmojiText style={[type.headlineSm, { color: theme.text, flexShrink: 1 }]} numberOfLines={1}>
                {person.name || 'Unknown'}
              </EmojiText>
              {hasGoldTick(person) && <GoldTick size={15} />}
            </View>
            <EmojiText style={[type.bodySm, { color: theme.subtext, marginTop: 3 }]} numberOfLines={2}>
              {preview}
            </EmojiText>
          </View>
        </View>
        <View style={s.requestActions}>
          <SpringPressable
            onPress={onAccept}
            disabled={!!busy}
            style={({ pressed }) => [s.requestBtn, inkBox(theme, 'ink'), { backgroundColor: theme.ink }, pressed && { opacity: 0.88 }, !!busy && !acceptBusy && { opacity: 0.5 }]}
            scaleTo={motion.scale.row}
            haptic="selection"
          >
            {acceptBusy ? <ActivityIndicator size="small" color={theme.onPrimary} /> : (
              <Text style={[type.labelXs, { color: theme.onPrimary }]}>ACCEPT</Text>
            )}
          </SpringPressable>
          <SpringPressable
            onPress={onDecline}
            disabled={!!busy}
            style={({ pressed }) => [s.requestBtn, inkBox(theme, 'thin'), pressed && marker(theme, 1), !!busy && !declineBusy && { opacity: 0.5 }]}
            scaleTo={motion.scale.row}
            haptic="warning"
          >
            {declineBusy ? <ActivityIndicator size="small" color={theme.ink} /> : (
              <Text style={[type.labelXs, { color: theme.ink }]}>DECLINE</Text>
            )}
          </SpringPressable>
        </View>
      </View>
    </ChatRowEntrance>
  );
}

function SheetRow({ icon, label, onPress, danger = false, disabled = false }) {
  const { theme } = useTheme();
  const color = danger ? theme.danger : theme.ink;
  return (
    <SpringPressable
      style={({ pressed }) => [s2.row, pressed ? marker(theme, 1) : null, disabled && { opacity: 0.45 }]}
      onPress={onPress}
      disabled={disabled}
      scaleTo={motion.scale.row}
      haptic="selection"
    >
      <Icon name={icon} size={18} color={color} />
      <Text style={[type.bodyMd, { color }]}>{label}</Text>
    </SpringPressable>
  );
}

/**
 * One conversation row. New incoming messages make the row react:
 * avatar pulses, the unread mark pops, and a brief highlight washes across
 * the card — "something new happened here" without shaking the row.
 */
/**
 * Rows cascade in when the list first paints — and only then.
 *
 * FlatList unmounts rows that scroll far out of view and re-mounts them on
 * the way back, so a naive mount animation makes the list flicker every time
 * the user scrolls up. This gates the entrance on a short window after the
 * screen appears: first paint gets the cascade, everything afterwards is
 * simply there.
 */
const listOpenedAt = { t: 0 };

function ChatRowEntrance({ index, style, children }) {
  const animate = useRef(Date.now() - listOpenedAt.t < 600).current;
  if (!animate) return <View style={style}>{children}</View>;
  return <MotionIn delay={staggerDelay(index)} distance={8} style={style}>{children}</MotionIn>;
}

const ChatRow = React.memo(function ChatRow({ item, index, typing, user, theme, navigation, onOpenSheet, style: s }) {
  const pulse = useRef(new Animated.Value(0)).current;   // avatar scale pulse
  const wash = useRef(new Animated.Value(0)).current;    // highlight wash
  const lastActivityAt = useRef(item.lastMessage?.createdAt || item.updatedAt || 0);

  useEffect(() => {
    const at = item.lastMessage?.createdAt || item.updatedAt || 0;
    if (at === lastActivityAt.current) return;
    const prev = lastActivityAt.current;
    lastActivityAt.current = at;
    const lm = item.lastMessage;
    const isIncoming = lm && !lm.deleted && lm.type !== 'system' && lm.senderId !== user?.id;
    // `prev !== 0` skips the very first mount — only genuinely new arrivals react.
    if (!isIncoming || prev === 0) return;
    haptic('selection');
    // A new message should catch the eye, then get out of the way. The old
    // 10% avatar jump and 1.5s wash were doing a victory lap for something
    // that happens constantly in a messenger.
    Animated.sequence([
      Animated.spring(pulse, { toValue: 1, ...motion.springPop, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 520, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start();
    Animated.sequence([
      Animated.timing(wash, { toValue: 1, duration: 120, useNativeDriver: true }),
      Animated.timing(wash, { toValue: 0, duration: 620, delay: 180, useNativeDriver: true }),
    ]).start();
  }, [item.lastMessage?.createdAt, item.updatedAt, item.lastMessage, user?.id, pulse, wash]);

  // Row press physics. Native-driven, one value, no re-render per press.
  const reduced = useReducedMotion();
  const press = useRef(new Animated.Value(0)).current;
  const onRowPressIn = useCallback(() => {
    if (reduced) { press.setValue(1); return; }
    Animated.spring(press, { toValue: 1, ...motion.springPress, useNativeDriver: true }).start();
  }, [press, reduced]);
  const onRowPressOut = useCallback(() => {
    if (reduced) { press.setValue(0); return; }
    Animated.spring(press, { toValue: 0, ...motion.springBack, useNativeDriver: true }).start();
  }, [press, reduced]);
  const pressX = press.interpolate({ inputRange: [0, 1], outputRange: [0, 2] });
  const pressY = press.interpolate({ inputRange: [0, 1], outputRange: [0, 4] });
  const pressTint = press.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

  const typers = Object.values(typing || {});
  const lm = item.lastMessage;
  const isMine = lm && lm.senderId === user.id;
  const hasUnread = item.unread > 0;
  const avatarScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });
  const washOpacity = wash.interpolate({ inputRange: [0, 1], outputRange: [0, 0.38] });

  let preview = 'no messages yet';
  let senderPrefix = null;
  if (lm) {
    if (lm.deleted) preview = 'message deleted';
    else if (lm.isEncrypted) {
      // Server stores ciphertext — show generic preview, never ciphertext
      if (lm.type === 'image') preview = '🔒 Encrypted photo';
      else if (lm.type === 'voice') preview = '🔒 Encrypted voice';
      else if (lm.type === 'poll') preview = '🔒 Encrypted poll';
      else preview = '🔒 Encrypted message';
    } else if (lm.type === 'image') preview = 'Photo';
    else if (lm.type === 'voice') preview = 'Voice message';
    else if (lm.type === 'poll') preview = '📊 Poll';
    else if (lm.type === 'system') preview = lm.body;
    else preview = lm.body;
    if (isGroupChat(item) && lm.type !== 'system' && !isMine) {
      const sender = item.members.find((m) => m.id === lm.senderId);
      if (sender) senderPrefix = `${sender.name.split(' ')[0]}:`;
    }
  }

  return (
    <ChatRowEntrance index={index} style={s.rowWrap}>
      {/* A hard offset plate plus a soft shadow gives the black card real
          depth on Android, iOS and web without adding another native module. */}
      <View pointerEvents="none" style={[s.rowDepth, hasUnread && { backgroundColor: '#8d7900' }]} />
      {/* Pressing slides the tile down onto its own depth plate — the same
          2/4px offset as before, but sprung instead of snapped, so the card
          reads as being physically pushed into the page and released. */}
      <AnimatedPressable
        // No accessibilityRole here: the row already contains the avatar's
        // own "view profile" button, and a button inside a button is invalid
        // (and confuses screen readers). The label is enough.
        accessibilityLabel={`Open chat with ${item.name}`}
        onPress={() => { haptic('selection'); navigation.navigate('Conversation', { chatId: item.id }); }}
        onPressIn={onRowPressIn}
        onPressOut={onRowPressOut}
        onLongPress={() => onOpenSheet(item)}
        delayLongPress={280}
        style={[
          s.row,
          hasUnread ? s.rowUnread : s.rowRead,
          {
            borderColor: hasUnread ? theme.highlighter : CHAT_TILE_LINE,
            transform: [
              { rotate: hasUnread ? '-0.18deg' : '0.1deg' },
              { translateX: pressX },
              { translateY: pressY },
            ],
          },
        ]}
      >
        {/* pressed tint, driven by the same value as the offset */}
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: CHAT_TILE_PRESSED, opacity: pressTint }]}
        />
        <View pointerEvents="none" style={s.rowSheen} />
        <View pointerEvents="none" style={s.rowEdge} />
        {/* brief "new thing happened" wash across the card */}
        <Animated.View
          pointerEvents="none"
          style={[s.newWash, { opacity: washOpacity, backgroundColor: theme.highlighterWash }]}
        />
        {hasUnread && (
          <Pop trigger={String(item.unread)} firstStatic style={s.unreadMark}>
            <View style={[s.unreadMarkInner, { backgroundColor: theme.highlighter, borderColor: CHAT_TILE }]} />
          </Pop>
        )}
        <Animated.View style={[s.avatarFrame, { borderColor: hasUnread ? theme.highlighter : CHAT_TILE_TEXT }, { transform: [{ scale: avatarScale }] }]}>
          <Avatar
            uri={item.avatar}
            name={item.name}
            id={item.otherUserId || item.id}
            group={isGroupChat(item)}
            online={item.isOnline}
            unread={hasUnread}
            weight={hasUnread ? 'ink' : 'thin'}
            size={56}
            profileId={isGroupChat(item) ? null : item.otherUserId}
          />
        </Animated.View>

        <View style={s.rowBody}>
          <View style={s.rowTop}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 6, marginRight: 10 }}>
              {item.pinned && <Icon name="pin" size={13} color={theme.highlighter} />}
              {item.isEncrypted && <Icon name="lock-closed" size={12} color={theme.highlighter} />}
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
              <View style={[marker(theme, 1), s.typingRow]}>
                <TypingDots color={theme.highlighter} size={4} />
                <Text style={[type.bodyMd, { color: theme.highlighter, fontStyle: 'italic' }]} numberOfLines={1}>
                  {isGroupChat(item) ? `${typers[0]} is typing` : 'typing'}
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
      </AnimatedPressable>
    </ChatRowEntrance>
  );
});

/** Soft skeleton of the chat list shown before the first fetch resolves. */
function ChatListSkeleton() {
  const { theme } = useTheme();
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 4, gap: 22 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Skeleton width={60} height={60} radius={999} />
          <View style={{ flex: 1, gap: 10 }}>
            <Skeleton width="42%" height={15} />
            <Skeleton width="78%" height={12} />
          </View>
        </View>
      ))}
    </View>
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
  recentTitle: { ...type.headlineMd, color: t.text, letterSpacing: 0.7, flex: 1 },
  filterTrigger: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  filterMenu: { marginTop: 10, gap: 2 },
  filterOption: {
    minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 6, paddingVertical: 10,
  },
  requestWrap: { marginBottom: 16 },
  requestCard: { padding: 14 },
  requestHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  requestActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  requestBtn: {
    minHeight: 40, minWidth: 96, paddingHorizontal: 14, paddingVertical: 8,
    alignItems: 'center', justifyContent: 'center',
  },
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
  newWash: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1,
  },
  typingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 3 },
  rowUnread: { borderWidth: 3 },
  rowRead: { borderStyle: 'solid' },
  avatarFrame: {
    width: 66, height: 66, padding: 3, borderWidth: 2, borderRadius: radius.full,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#111111',
  },
  unreadMark: { position: 'absolute', width: 13, height: 13, left: -7, top: '50%', marginTop: -6, transform: [{ rotate: '45deg' }], zIndex: 2 },
  unreadMarkInner: { width: 13, height: 13, borderWidth: 2 },
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
  loadError: {
    flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 14,
  },
  emptyLoadError: { alignItems: 'center', justifyContent: 'center', paddingBottom: 40 },
  retryButton: {
    minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    paddingHorizontal: 16, paddingVertical: 9, marginTop: -22, backgroundColor: t.card,
  },
  resultsWrap: { paddingTop: 16 },
  resultRow: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 10 },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  sheet: { position: 'relative', zIndex: 2, width: '100%', maxWidth: 360, padding: 16 },
});
