import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View, Text, FlatList, TextInput, Pressable, StyleSheet, KeyboardAvoidingView,
  Platform, Modal, Image, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../icons/Icon';
import Emoji, { EmojiText } from '../icons/Emoji';
import * as ImagePicker from 'expo-image-picker';
import { useChat } from '../store/ChatContext';
import { useAuth } from '../store/AuthContext';
import { useTheme } from '../store/ThemeContext';
import useResponsive from '../hooks/useResponsive';
import {
  Avatar, formatDayLabel, lastSeenText, InkField, InkIconButton, Rule, rippleFor, formatTime,
} from '../components/common';
import EmojiPicker from '../components/EmojiPicker';
import MessageBubble, { DISAPPEAR_OPTIONS } from '../components/MessageBubble';
import ForwardSheet from '../components/ForwardSheet';
import PollComposer from '../components/PollComposer';
import { api, mediaUrl } from '../api';
import { radius, type, inkBox, marker, dashedRule, stroke } from '../theme';

export default function ConversationScreen({ route, navigation, embedded = false }) {
  const { chatId, initialChat = null } = route.params || {};
  const {
    chats, messages, typing, refreshChats, loadMessages, sendMessage, markRead, setTypingState,
    react, deleteMessage, editMessage, createPoll, votePoll, startCall, call, setMessages,
  } = useChat();
  const { user } = useAuth();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { isTablet } = useResponsive();

  // `initialChat` is passed by NewChat so Android never waits on an async
  // Context render before it can draw the conversation shell.
  const chat = chats.find((c) => c.id === chatId) || initialChat;
  const list = messages[chatId] || [];
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const listRef = useRef(null);
  const typingTimer = useRef(null);
  const recTimer = useRef(null);

  // in-chat search
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef(null);

  // forward + timer + poll modals
  const [forwardMsg, setForwardMsg] = useState(null);
  const [timerMsg, setTimerMsg] = useState(null);
  const [pollOpen, setPollOpen] = useState(false);

  const s = makeStyles(theme);

  useEffect(() => {
    if (chatId) loadMessages(chatId).catch(() => {});
  }, [chatId, loadMessages]);
  useEffect(() => {
    if (chatId && !chat) refreshChats().catch(() => {});
  }, [chatId, chat, refreshChats]);
  useEffect(() => { if (chatId && list.length) markRead(chatId); }, [chatId, list.length, markRead]);

  useEffect(() => {
    if (recording) recTimer.current = setInterval(() => setRecSecs((v) => v + 1), 1000);
    else { clearInterval(recTimer.current); setRecSecs(0); }
    return () => clearInterval(recTimer.current);
  }, [recording]);

  const typers = Object.values(typing[chatId] || {});

  const onChangeText = (v) => {
    setText(v);
    setTypingState(chatId, true);
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setTypingState(chatId, false), 1600);
  };

  const nameFor = useCallback((id) => {
    if (id === user.id) return 'You';
    const m = chat?.members?.find((x) => x.id === id);
    return m ? m.name : 'Unknown';
  }, [chat, user]);

  const send = () => {
    const body = text.trim();
    if (!body) return;
    if (editing) {
      editMessage(editing.id, body)
        .then(() => {})
        .catch((e) => console.warn('edit failed', e.message));
      setEditing(null);
      setText('');
      setTypingState(chatId, false);
      return;
    }
    sendMessage(chatId, {
      type: 'text',
      body,
      replyTo: replyTo?.id || null,
      replyToMessage: replyTo
        ? { id: replyTo.id, senderId: replyTo.senderId, senderName: nameFor(replyTo.senderId), type: replyTo.type, body: replyTo.body }
        : null,
    });
    setText(''); setReplyTo(null); setShowEmoji(false); setTypingState(chatId, false);
  };

  const pickImage = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
      if (res.canceled || !res.assets?.length) return;
      setUploading(true);
      const asset = res.assets[0];
      const { url } = await api.uploadFile(asset.uri, asset.fileName || 'photo.jpg', asset.mimeType || 'image/jpeg');
      sendMessage(chatId, { type: 'image', mediaUrl: url, body: '' });
    } catch (e) {
      console.warn('image upload failed', e.message);
    } finally { setUploading(false); }
  };

  const stopRecording = () => {
    const secs = recSecs;
    setRecording(false);
    if (secs < 1) return;
    sendMessage(chatId, { type: 'voice', mediaUrl: null, duration: secs, body: '' });
  };

  /* ---- in-chat search ---- */
  const runInChatSearch = useCallback((q) => {
    setSearchQ(q);
    clearTimeout(searchTimer.current);
    if (q.trim().length < 2) { setSearchResults([]); return; }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const { messages: res } = await api.search(q.trim(), chatId);
        setSearchResults(res);
      } catch { setSearchResults([]); }
      finally { setSearching(false); }
    }, 250);
  }, [chatId]);

  const rows = useMemo(() => {
    const out = [];
    let lastDay = null;
    list.forEach((m) => {
      const day = new Date(m.createdAt).toDateString();
      if (day !== lastDay) { out.push({ _type: 'day', id: 'day_' + day, label: formatDayLabel(m.createdAt) }); lastDay = day; }
      out.push({ _type: 'msg', ...m });
    });
    return out;
  }, [list]);

  const scrollToMessage = useCallback((messageId) => {
    const idx = rows.findIndex((r) => r._type === 'msg' && r.id === messageId);
    if (idx === -1) return;
    listRef.current?.scrollToIndex({ index: idx, viewPosition: 0.4, animated: true });
  }, [rows]);

  const startEdit = (message) => {
    setEditing(message);
    setText(message.body || '');
    setShowEmoji(false);
  };

  const toggleStar = async (message) => {
    try {
      const { starred } = message.starred
        ? await api.unstarMessage(message.id)
        : await api.starMessage(message.id);
      setMessagesLocalStar(message.id, starred);
    } catch (e) { console.warn('star failed', e.message); }
  };

  // small local patch helper: keep message list in sync with star/timer changes
  // without waiting for the socket round-trip (the server also broadcasts
  // message:updated so other clients stay in sync).
  const setMessagesLocalStar = (id, starred) => {
    setMessages((prev) => {
      const entry = Object.entries(prev).find(([, list]) => list.some((m) => m.id === id));
      if (!entry) return prev;
      const [cid, list] = entry;
      return { ...prev, [cid]: list.map((m) => (m.id === id ? { ...m, starred } : m)) };
    });
  };

  const setMessageTimer = async (message, seconds) => {
    try {
      const { expiresAt } = await api.setMessageTimer(message.id, seconds);
      setMessages((prev) => {
        const entry = Object.entries(prev).find(([, list]) => list.some((m) => m.id === message.id));
        if (!entry) return prev;
        const [cid, list] = entry;
        return { ...prev, [cid]: list.map((m) => (m.id === message.id ? { ...m, expiresAt } : m)) };
      });
    } catch (e) { console.warn('timer failed', e.message); }
  };

  const onVote = async (messageId, pollId, optionIndex) => {
    try { await votePoll(messageId, pollId, optionIndex); } catch (e) { console.warn('vote failed', e.message); }
  };

  if (!chat) {
    return (
      <View style={[s.center, { backgroundColor: theme.bg, padding: 28 }]}>
        <ActivityIndicator color={theme.primary} />
        <Text style={[type.labelSm, { color: theme.muted, marginTop: 14 }]}>OPENING CHAT…</Text>
        <Pressable onPress={() => refreshChats().catch(() => {})} style={[inkBox(theme, 'thin'), { marginTop: 18, paddingHorizontal: 16, paddingVertical: 9 }]}>
          <Text style={[type.labelSm, { color: theme.ink }]}>RETRY</Text>
        </Pressable>
        {!embedded && (
          <Pressable onPress={() => navigation.goBack()} style={{ marginTop: 12, padding: 8 }}>
            <Text style={[type.labelSm, { color: theme.subtext }]}>BACK TO CHATS</Text>
          </Pressable>
        )}
      </View>
    );
  }

  const subtitle = typers.length
    ? (chat.type === 'group' ? `${typers[0]} is typing…` : 'typing…')
    : chat.type === 'group'
      ? chat.members.map((m) => (m.id === user.id ? 'You' : m.name.split(' ')[0])).join(', ')
      : lastSeenText(chat.isOnline, chat.lastSeen);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.chatBg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
    >
      {/* header — floating clay bar; own top inset only when not embedded
          in the desktop/tablet split (that shell already pads for the notch). */}
      <View style={[s.headerWrap, !embedded && { paddingTop: 18 + insets.top }]}>
        <View style={s.header}>
          {!embedded && (
            <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={s.backBtn}>
              <Icon name="arrow-back" size={22} color={theme.primary} />
            </Pressable>
          )}
          <Pressable style={s.headerInfo} onPress={() => navigation.navigate('ChatInfo', { chatId })}>
            <Avatar uri={chat.avatar} name={chat.name} id={chat.otherUserId || chat.id} group={chat.type === 'group'} size={42} />
            <View style={{ flex: 1 }}>
              <EmojiText style={[type.headlineSm, { color: theme.text }]} numberOfLines={1}>{chat.name}</EmojiText>
              <Text style={[type.bodySm, { fontSize: 12.5, color: typers.length ? theme.primary : theme.subtext }]} numberOfLines={1}>
                {subtitle}
              </Text>
            </View>
          </Pressable>
          <InkIconButton
            name="search"
            size={36}
            iconSize={16}
            active={searchOpen}
            onPress={() => { setSearchOpen((v) => !v); setSearchQ(''); setSearchResults([]); }}
          />
          {chat.type === 'group' && (
            <InkIconButton
              name="bar-chart-outline"
              size={36}
              iconSize={17}
              onPress={() => setPollOpen(true)}
            />
          )}
          {chat.type === 'direct' && (
            <>
              <InkIconButton
                name="videocam"
                size={36}
                iconSize={17}
                disabled={!!call}
                onPress={() => startCall(chatId, chat.otherUserId, 'video')}
              />
              <InkIconButton
                name="call"
                size={36}
                iconSize={15}
                disabled={!!call}
                onPress={() => startCall(chatId, chat.otherUserId, 'audio')}
              />
            </>
          )}
        </View>
        <Rule style={{ marginHorizontal: 20, marginTop: 10, marginBottom: 0 }} />
      </View>

      {/* in-chat search bar + results */}
      {searchOpen && (
        <View style={[s.searchWrap, { borderBottomWidth: stroke.thin, borderBottomColor: theme.graphiteLine }]}>
          <View style={s.searchRow}>
            <Icon name="search" size={17} color={theme.graphite} />
            <TextInput
              autoFocus
              value={searchQ}
              onChangeText={runInChatSearch}
              placeholder={`Search in ${chat.name}…`}
              placeholderTextColor={theme.muted}
              style={[s.searchInput, { color: theme.text }]}
            />
            {searching && <ActivityIndicator size="small" color={theme.muted} />}
            {!!searchQ && (
              <Pressable onPress={() => runInChatSearch('')} hitSlop={8}>
                <Icon name="close-circle" size={18} color={theme.muted} />
              </Pressable>
            )}
          </View>
          {searchResults.length > 0 && (
            <View style={s.searchResults}>
              <Text style={[type.labelXs, { color: theme.muted, paddingHorizontal: 4, marginBottom: 6 }]}>
                {searchResults.length} FOUND
              </Text>
              {searchResults.slice(0, 8).map((m) => (
                <Pressable
                  key={m.id}
                  style={({ pressed }) => [s.resultRow, pressed ? marker(theme, 1) : null]}
                  onPress={() => scrollToMessage(m.id)}
                >
                  <View style={{ flex: 1 }}>
                    <EmojiText style={[type.bodyMd, { color: theme.text }]} numberOfLines={1}>
                      {m.type === 'image' ? '📷 Photo' : m.type === 'voice' ? '🎤 Voice message' : m.body}
                    </EmojiText>
                    {m.type === 'text' && <Text style={[type.labelXs, { color: theme.muted }]}>{m.senderId === user.id ? 'You' : nameFor(m.senderId)}</Text>}
                  </View>
                  <Text style={[type.labelXs, { color: theme.muted }]}>{formatTime(m.createdAt)}</Text>
                </Pressable>
              ))}
            </View>
          )}
          {searchQ.trim().length >= 2 && !searching && searchResults.length === 0 && (
            <Text style={[type.bodySm, { color: theme.muted, padding: 8, paddingHorizontal: 4 }]}>No matches</Text>
          )}
        </View>
      )}

      <FlatList
        ref={listRef}
        data={rows}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ paddingVertical: 14, flexGrow: 1, justifyContent: 'flex-end' }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        onScrollToIndexFailed={(info) => {
          // Rows vary in height; fall back to an estimated offset, then retry.
          setTimeout(() => {
            listRef.current?.scrollToOffset({ offset: Math.max(0, info.averageItemLength * info.index - 200), animated: false });
          }, 60);
        }}
        renderItem={({ item }) =>
          item._type === 'day' ? (
            <View style={s.dayWrap}>
              <View style={[dashedRule(theme), { flex: 1 }]} />
              <View style={[s.tapeStrip, { backgroundColor: theme.cardAlt, borderColor: theme.graphiteLine }]}>
                <Text style={[type.labelXs, { color: theme.graphite }]}>{item.label.toUpperCase()}</Text>
              </View>
              <View style={[dashedRule(theme), { flex: 1 }]} />
            </View>
          ) : (
            <MessageBubble
              message={item}
              isMine={item.senderId === user.id}
              isGroup={chat.type === 'group'}
              senderName={nameFor(item.senderId)}
              onReply={setReplyTo}
              onReact={react}
              onDelete={deleteMessage}
              onImagePress={setLightbox}
              onEdit={startEdit}
              onForward={setForwardMsg}
              onStar={toggleStar}
              onSetTimer={setTimerMsg}
              onVotePoll={onVote}
            />
          )
        }
        ListEmptyComponent={
          <View style={s.emptyChat}>
            <View style={{ alignItems: 'center', gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <Emoji char="✒️" size={15} />
                <Text style={[type.bodySm, { color: theme.muted }]}>This is the beginning of your conversation.</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <Text style={[type.bodySm, { color: theme.muted }]}>Say hello</Text>
                <Emoji char="👋" size={16} />
              </View>
            </View>
          </View>
        }
      />

      {replyTo && (
        <View style={[s.replyBar, inkBox(theme, 'thin')]}>
          <View style={[s.replyAccent, { backgroundColor: theme.primary }]} />
          <View style={{ flex: 1 }}>
            <Text style={[type.labelXs, { color: theme.graphite }]}>{nameFor(replyTo.senderId).toUpperCase()}</Text>
            {replyTo.type === 'image' || replyTo.type === 'voice' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Emoji char={replyTo.type === 'image' ? '📷' : '🎤'} size={13} />
                <Text style={[type.bodySm, { color: theme.subtext }]}>
                  {replyTo.type === 'image' ? 'Photo' : 'Voice message'}
                </Text>
              </View>
            ) : (
              <EmojiText style={[type.bodySm, { color: theme.subtext }]} numberOfLines={1}>{replyTo.body}</EmojiText>
            )}
          </View>
          <Pressable onPress={() => setReplyTo(null)} hitSlop={8}>
            <Icon name="close" size={20} color={theme.muted} />
          </Pressable>
        </View>
      )}

      {editing && (
        <View style={[s.editBar, { borderColor: theme.ink, backgroundColor: theme.cardAlt }]}>
          <Icon name="create-outline" size={15} color={theme.ink} />
          <Text style={[type.labelXs, { color: theme.ink, flex: 1 }]} numberOfLines={1}>
            EDITING — {editing.body}
          </Text>
          <Pressable onPress={() => { setEditing(null); setText(''); }} hitSlop={8}>
            <Icon name="close" size={18} color={theme.muted} />
          </Pressable>
        </View>
      )}

      <EmojiPicker visible={showEmoji} onSelect={(e) => setText((v) => v + e)} />

      {/* composer — bottom safe-area (home indicator / gesture bar) only
          applies full-screen; the desktop/tablet split already handles it. */}
      <View style={[s.composerWrap, !embedded && { paddingBottom: Math.max(insets.bottom, 12) }]}>
        {recording ? (
          <InkField style={s.inputBar}>
            <View style={[s.recDot, { backgroundColor: theme.danger }]} />
            <Text style={[type.bodyLg, { flex: 1, color: theme.text }]}>
              Recording… {Math.floor(recSecs / 60)}:{String(recSecs % 60).padStart(2, '0')}
            </Text>
            <Pressable onPress={() => setRecording(false)} hitSlop={8}>
              <Text style={[type.labelSm, { color: theme.danger }]}>CANCEL</Text>
            </Pressable>
          </InkField>
        ) : (
          <InkField style={s.inputBar}>
            <Pressable onPress={() => setShowEmoji((v) => !v)} hitSlop={6}>
              <Icon name={showEmoji ? 'keypad-outline' : 'happy-outline'} size={23} color={theme.muted} />
            </Pressable>
            <TextInput
              style={s.input}
              placeholder={editing ? 'Edit message…' : 'Message'}
              placeholderTextColor={theme.muted}
              value={text}
              onChangeText={onChangeText}
              multiline
              onSubmitEditing={send}
              blurOnSubmit={false}
              onKeyPress={(e) => {
                if (Platform.OS === 'web' && e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) {
                  e.preventDefault?.();
                  send();
                }
              }}
            />
            {!editing && (
              <Pressable onPress={pickImage} hitSlop={6} disabled={uploading}>
                {uploading
                  ? <ActivityIndicator size="small" color={theme.muted} />
                  : <Icon name="attach" size={22} color={theme.muted} style={{ transform: [{ rotate: '45deg' }] }} />}
              </Pressable>
            )}
            {!editing && !text.trim() && (
              <Pressable onPress={pickImage} hitSlop={6}>
                <Icon name="camera-outline" size={22} color={theme.muted} />
              </Pressable>
            )}
          </InkField>
        )}

        <Pressable
          onPress={() => { if (text.trim()) send(); else if (editing) setEditing(null); else if (recording) stopRecording(); else setRecording(true); }}
          android_ripple={rippleFor(theme, { color: 'rgba(255,255,255,0.3)' })}
          style={({ pressed }) => [
            s.sendBtn,
            inkBox(theme, 'bold'),
            { backgroundColor: pressed && Platform.OS !== 'android' ? theme.highlighter : theme.ink },
          ]}
        >
          <Icon
            name={editing ? 'checkmark' : text.trim() ? 'send' : recording ? 'checkmark' : 'mic'}
            size={18}
            color={theme.onPrimary}
          />
        </Pressable>
      </View>

      <Modal visible={!!lightbox} transparent animationType="fade" onRequestClose={() => setLightbox(null)}>
        <Pressable style={s.lightbox} onPress={() => setLightbox(null)}>
          <Image source={{ uri: lightbox }} style={s.lightboxImg} resizeMode="contain" />
          <Pressable style={s.lightboxClose} onPress={() => setLightbox(null)}>
            <Icon name="close" size={26} color="#fff" />
          </Pressable>
        </Pressable>
      </Modal>

      {/* forward picker */}
      <ForwardSheet visible={!!forwardMsg} message={forwardMsg} onClose={() => setForwardMsg(null)} />

      {/* per-message disappearing timer */}
      <Modal visible={!!timerMsg} transparent animationType="fade" onRequestClose={() => setTimerMsg(null)}>
        <Pressable style={[s.overlay, { backgroundColor: theme.overlay }]} onPress={() => setTimerMsg(null)}>
          <Pressable style={[s.timerSheet, { backgroundColor: theme.bg, borderColor: theme.ink }]}>
            <Text style={[type.headlineSm, { color: theme.text }]}>Disappear in…</Text>
            <Text style={[type.bodySm, { color: theme.subtext, marginTop: 4, marginBottom: 12 }]}>
              The message self-destructs after the timer.
            </Text>
            <View style={{ gap: 8 }}>
              {(() => {
                const remaining = timerMsg.expiresAt ? Math.round((timerMsg.expiresAt - Date.now()) / 1000) : 0;
                const isActive = (sec) => (sec === 0 ? remaining === 0 : Math.abs(remaining - sec) < Math.max(2, sec * 0.05));
                return (
                  <>
                    <Pressable
                      style={({ pressed }) => [s.timerOpt, inkBox(theme, 'thin'), pressed ? marker(theme, 1) : null]}
                      onPress={() => { setMessageTimer(timerMsg, 0); setTimerMsg(null); }}
                    >
                      <Icon name="time-outline" size={18} color={theme.ink} />
                      <Text style={[type.bodyMd, { color: theme.text, flex: 1 }]}>Off — keep forever</Text>
                      {isActive(0) && <Icon name="checkmark" size={18} color={theme.ink} />}
                    </Pressable>
                    {DISAPPEAR_OPTIONS.map((o) => (
                      <Pressable
                        key={o.seconds}
                        style={({ pressed }) => [s.timerOpt, inkBox(theme, 'thin'), pressed ? marker(theme, 1) : null]}
                        onPress={() => { setMessageTimer(timerMsg, o.seconds); setTimerMsg(null); }}
                      >
                        <Icon name="timer-outline" size={18} color={theme.ink} />
                        <Text style={[type.bodyMd, { color: theme.text, flex: 1 }]}>{o.label}</Text>
                        {isActive(o.seconds) && <Icon name="checkmark" size={18} color={theme.ink} />}
                      </Pressable>
                    ))}
                  </>
                );
              })()}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* group poll composer */}
      <PollComposer
        visible={pollOpen}
        onClose={() => setPollOpen(false)}
        onCreate={async (question, options) => {
          await createPoll(chatId, question, options);
        }}
      />
    </KeyboardAvoidingView>
  );
}

const makeStyles = (t) => StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerWrap: { paddingTop: 18, paddingBottom: 4 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 10 },
  backBtn: { padding: 4 },
  headerInfo: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  dayWrap: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 16, paddingHorizontal: 24 },
  // Masking-tape date label: an intentionally slightly uneven paper strip.
  tapeStrip: {
    borderWidth: 1, borderStyle: 'dashed', paddingHorizontal: 10, paddingVertical: 5,
    borderTopLeftRadius: 5, borderTopRightRadius: 3, borderBottomRightRadius: 6, borderBottomLeftRadius: 4,
    transform: [{ rotate: '-1deg' }],
  },
  emptyChat: { alignItems: 'center', justifyContent: 'center', padding: 40 },
  replyBar: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, marginBottom: 8, padding: 10, gap: 12, backgroundColor: 'transparent' },
  replyAccent: { width: 3.5, alignSelf: 'stretch', borderRadius: 2 },
  editBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 20, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderStyle: 'dashed',
  },
  // The raised, irregular composer gives the bottom of the conversation a torn-paper feel.
  composerWrap: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 20, paddingBottom: 22, paddingTop: 12, gap: 12, borderTopWidth: 1, borderTopColor: t.graphiteLine, borderStyle: 'dashed' },
  inputBar: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 12, minHeight: 48, borderTopLeftRadius: 5, borderTopRightRadius: 3, borderBottomRightRadius: 6, borderBottomLeftRadius: 4 },
  input: { flex: 1, ...type.bodyLg, color: t.text, maxHeight: 110, paddingVertical: 11, outlineStyle: 'none' },
  sendBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  recDot: { width: 9, height: 9, borderRadius: radius.full },
  lightbox: { flex: 1, backgroundColor: 'rgba(28,27,27,0.95)', alignItems: 'center', justifyContent: 'center' },
  lightboxImg: { width: '92%', height: '78%' },
  lightboxClose: { position: 'absolute', top: 44, right: 22, padding: 8 },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  timerSheet: {
    width: '100%', maxWidth: 360, borderWidth: 3, padding: 20,
    borderTopLeftRadius: 6, borderTopRightRadius: 12,
    borderBottomRightRadius: 6, borderBottomLeftRadius: 10,
  },
  timerOpt: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 11 },
  searchWrap: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 10 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchInput: { flex: 1, ...type.bodyLg, paddingVertical: 6, outlineStyle: 'none' },
  searchResults: { marginTop: 10, gap: 4 },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 4 },
});
