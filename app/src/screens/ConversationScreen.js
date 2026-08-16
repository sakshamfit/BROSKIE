import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View, Text, FlatList, TextInput, Pressable, StyleSheet, KeyboardAvoidingView,
  Platform, Modal, Image, ActivityIndicator,
} from 'react-native';
import Icon from '../icons/Icon';
import Emoji, { EmojiText } from '../icons/Emoji';
import * as ImagePicker from 'expo-image-picker';
import { useChat } from '../store/ChatContext';
import { useAuth } from '../store/AuthContext';
import { useTheme } from '../store/ThemeContext';
import {
  Avatar, EmojiPicker, formatDayLabel, lastSeenText, InkField, InkIconButton, Rule,
} from '../components/common';
import MessageBubble from '../components/MessageBubble';
import { api, mediaUrl } from '../api';
import { radius, type, inkBox, marker, dashedRule, stroke } from '../theme';

export default function ConversationScreen({ route, navigation, embedded = false }) {
  const { chatId } = route.params;
  const { chats, messages, typing, loadMessages, sendMessage, markRead, setTypingState, react, deleteMessage } = useChat();
  const { user } = useAuth();
  const { theme } = useTheme();

  const chat = chats.find((c) => c.id === chatId);
  const list = messages[chatId] || [];
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const listRef = useRef(null);
  const typingTimer = useRef(null);
  const recTimer = useRef(null);

  const s = makeStyles(theme);

  useEffect(() => { loadMessages(chatId).catch(() => {}); }, [chatId, loadMessages]);
  useEffect(() => { if (list.length) markRead(chatId); }, [chatId, list.length, markRead]);

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

  if (!chat) {
    return <View style={[s.center, { backgroundColor: theme.bg }]}><ActivityIndicator color={theme.primary} /></View>;
  }

  const subtitle = typers.length
    ? (chat.type === 'group' ? `${typers[0]} is typing…` : 'typing…')
    : chat.type === 'group'
      ? chat.members.map((m) => (m.id === user.id ? 'You' : m.name.split(' ')[0])).join(', ')
      : lastSeenText(chat.isOnline, chat.lastSeen);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.chatBg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* header — floating clay bar */}
      <View style={s.headerWrap}>
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
          <InkIconButton name="videocam" size={36} iconSize={17} />
          <InkIconButton name="call" size={36} iconSize={15} />
        </View>
        <Rule style={{ marginHorizontal: 20, marginTop: 10, marginBottom: 0 }} />
      </View>

      <FlatList
        ref={listRef}
        data={rows}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ paddingVertical: 14, flexGrow: 1, justifyContent: 'flex-end' }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        renderItem={({ item }) =>
          item._type === 'day' ? (
            <View style={s.dayWrap}>
              <View style={[dashedRule(theme), { flex: 1 }]} />
              <Text style={[type.labelXs, { color: theme.muted }]}>{item.label}</Text>
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
            />
          )
        }
        ListEmptyComponent={
          <View style={s.emptyChat}>
            <View style={{ alignItems: 'center', gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <Emoji char="🔒" size={15} />
                <Text style={[type.bodySm, { color: theme.muted }]}>Messages are end-to-end encrypted.</Text>
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

      <EmojiPicker visible={showEmoji} onSelect={(e) => setText((v) => v + e)} />

      {/* composer */}
      <View style={s.composerWrap}>
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
              placeholder="Message"
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
            <Pressable onPress={pickImage} hitSlop={6} disabled={uploading}>
              {uploading
                ? <ActivityIndicator size="small" color={theme.muted} />
                : <Icon name="attach" size={22} color={theme.muted} style={{ transform: [{ rotate: '45deg' }] }} />}
            </Pressable>
            {!text.trim() && (
              <Pressable onPress={pickImage} hitSlop={6}>
                <Icon name="camera-outline" size={22} color={theme.muted} />
              </Pressable>
            )}
          </InkField>
        )}

        <Pressable
          onPress={() => { if (text.trim()) send(); else if (recording) stopRecording(); else setRecording(true); }}
          style={({ pressed }) => [
            s.sendBtn,
            inkBox(theme, 'bold'),
            { backgroundColor: pressed ? theme.highlighter : theme.ink },
          ]}
        >
          <Icon
            name={text.trim() ? 'send' : recording ? 'checkmark' : 'mic'}
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
    </KeyboardAvoidingView>
  );
}

const makeStyles = (t) => StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerWrap: { paddingTop: 18, paddingBottom: 4 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingVertical: 10 },
  backBtn: { padding: 4 },
  headerInfo: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  dayWrap: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 16, paddingHorizontal: 24 },
    emptyChat: { alignItems: 'center', justifyContent: 'center', padding: 40 },
  replyBar: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, marginBottom: 8, padding: 10, gap: 12, backgroundColor: 'transparent' },
  replyAccent: { width: 3.5, alignSelf: 'stretch', borderRadius: 2 },
  composerWrap: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 20, paddingBottom: 22, paddingTop: 8, gap: 12 },
  inputBar: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, gap: 12, minHeight: 48 },
  input: { flex: 1, ...type.bodyLg, color: t.text, maxHeight: 110, paddingVertical: 11, outlineStyle: 'none' },
  sendBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  recDot: { width: 9, height: 9, borderRadius: radius.full },
  lightbox: { flex: 1, backgroundColor: 'rgba(28,27,27,0.95)', alignItems: 'center', justifyContent: 'center' },
  lightboxImg: { width: '92%', height: '78%' },
  lightboxClose: { position: 'absolute', top: 44, right: 22, padding: 8 },
});
