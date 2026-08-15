import React, { useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet, Modal } from 'react-native';
import Icon from '../icons/Icon';
import Emoji, { EmojiText } from '../icons/Emoji';
import { useTheme } from '../store/ThemeContext';
import { Ticks, formatTime, ClayCard } from './common';
import { mediaUrl } from '../api';
import { colorFor, radius, type, clayFor, clayPressed, AVATAR_INK } from '../theme';
import VoiceNote from './VoiceNote';

const QUICK = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export default function MessageBubble({ message, isMine, isGroup, senderName, onReply, onReact, onDelete, onImagePress }) {
  const { theme } = useTheme();
  const [menu, setMenu] = useState(false);
  const s = makeStyles(theme);

  if (message.type === 'system') {
    return (
      <View style={s.systemWrap}>
        <View style={[s.systemPill, { backgroundColor: theme.card }, clayFor(theme, 1)]}>
          <EmojiText style={[type.bodySm, { color: theme.subtext, fontSize: 12.5, textAlign: 'center' }]}>{message.body}</EmojiText>
        </View>
      </View>
    );
  }

  const grouped = {};
  (message.reactions || []).forEach((r) => { grouped[r.emoji] = (grouped[r.emoji] || 0) + 1; });
  const reactionList = Object.entries(grouped);

  const ink = isMine ? theme.onBubbleOut : theme.onBubbleIn;
  const subInk = isMine ? 'rgba(0,33,19,0.55)' : theme.muted;

  // asymmetric clay corners replace the WhatsApp tail
  const shape = isMine
    ? { borderTopLeftRadius: radius.bubble, borderTopRightRadius: radius.bubble, borderBottomLeftRadius: radius.bubble, borderBottomRightRadius: radius.bubbleTail }
    : { borderTopLeftRadius: radius.bubble, borderTopRightRadius: radius.bubble, borderBottomRightRadius: radius.bubble, borderBottomLeftRadius: radius.bubbleTail };

  return (
    <>
      <Pressable onLongPress={() => setMenu(true)} delayLongPress={280} style={[s.wrap, isMine ? s.wrapMine : s.wrapTheirs]}>
        <View style={[s.bubble, shape, { backgroundColor: isMine ? theme.bubbleOut : theme.bubbleIn }, clayFor(theme, isMine ? 2 : 1)]}>
          {isGroup && !isMine && (
            <Text style={[type.labelMd, { color: theme.primary, marginBottom: 5, letterSpacing: 0.3 }]}>{senderName}</Text>
          )}

          {message.replyTo && (
            <View style={[s.reply, { backgroundColor: isMine ? 'rgba(255,255,255,0.42)' : theme.cardAlt }]}>
              <View style={[s.replyAccent, { backgroundColor: theme.primary }]} />
              <View style={{ flex: 1 }}>
                <Text style={[type.labelMd, { color: theme.primary, letterSpacing: 0.2 }]} numberOfLines={1}>
                  {message.replyTo.senderName}
                </Text>
                {message.replyTo.type === 'image' || message.replyTo.type === 'voice' ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <Emoji char={message.replyTo.type === 'image' ? '📷' : '🎤'} size={13} />
                    <Text style={[type.bodySm, { color: isMine ? 'rgba(0,33,19,0.7)' : theme.subtext, fontSize: 13 }]}>
                      {message.replyTo.type === 'image' ? 'Photo' : 'Voice message'}
                    </Text>
                  </View>
                ) : (
                  <EmojiText style={[type.bodySm, { color: isMine ? 'rgba(0,33,19,0.7)' : theme.subtext, fontSize: 13 }]} numberOfLines={2}>
                    {message.replyTo.body}
                  </EmojiText>
                )}
              </View>
            </View>
          )}

          {message.deleted ? (
            <View style={s.deletedRow}>
              <Icon name="ban-outline" size={15} color={subInk} />
              <Text style={[type.bodyLg, { color: subInk, fontStyle: 'italic', fontSize: 15 }]}>This message was deleted</Text>
            </View>
          ) : message.type === 'image' ? (
            <Pressable onPress={() => onImagePress?.(mediaUrl(message.mediaUrl))}>
              <Image source={{ uri: mediaUrl(message.mediaUrl) }} style={s.image} resizeMode="cover" />
              {!!message.body && <EmojiText style={[type.bodyLg, { color: ink, marginTop: 8 }]}>{message.body}</EmojiText>}
            </Pressable>
          ) : message.type === 'voice' ? (
            <VoiceNote uri={mediaUrl(message.mediaUrl)} duration={message.duration} isMine={isMine} />
          ) : (
            <EmojiText style={[type.bodyLg, { color: ink }]}>{message.body}</EmojiText>
          )}

          <View style={s.meta}>
            <Text style={[type.bodySm, { fontSize: 11, color: subInk, letterSpacing: 0.2 }]}>{formatTime(message.createdAt)}</Text>
            {isMine && <Ticks status={message.status} size={14} />}
          </View>

          {reactionList.length > 0 && (
            <View style={[s.reactions, { backgroundColor: theme.card }, clayFor(theme, 1)]}>
              {reactionList.map(([emoji, count]) => (
                <View key={emoji} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                  <Emoji char={emoji} size={14} />
                  {count > 1 && (
                    <Text style={[type.bodySm, { fontSize: 11, color: theme.subtext }]}>{count}</Text>
                  )}
                </View>
              ))}
            </View>
          )}
        </View>
      </Pressable>

      <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)}>
        <Pressable style={[s.overlay, { backgroundColor: theme.overlay }]} onPress={() => setMenu(false)}>
          <ClayCard style={s.menu} level={3}>
            <View style={s.quickRow}>
              {QUICK.map((e) => (
                <Pressable
                  key={e}
                  onPress={() => { onReact(message.id, e); setMenu(false); }}
                  style={({ pressed }) => [s.quickBtn, { backgroundColor: theme.cardAlt }, pressed ? clayPressed(theme.shadowTint) : clayFor(theme, 1)]}
                >
                  <Emoji char={e} size={26} />
                </Pressable>
              ))}
            </View>
            <Pressable style={s.menuItem} onPress={() => { onReply(message); setMenu(false); }}>
              <Icon name="arrow-undo-outline" size={20} color={theme.primary} />
              <Text style={[type.bodyLg, { color: theme.text }]}>Reply</Text>
            </Pressable>
            {isMine && !message.deleted && (
              <Pressable style={s.menuItem} onPress={() => { onDelete(message.id); setMenu(false); }}>
                <Icon name="trash-outline" size={20} color={theme.danger} />
                <Text style={[type.bodyLg, { color: theme.danger }]}>Delete for everyone</Text>
              </Pressable>
            )}
          </ClayCard>
        </Pressable>
      </Modal>
    </>
  );
}

const makeStyles = (t) => StyleSheet.create({
  wrap: { paddingHorizontal: 20, marginVertical: 6 },
  wrapMine: { alignItems: 'flex-end' },
  wrapTheirs: { alignItems: 'flex-start' },
  bubble: { maxWidth: '84%', minWidth: 96, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, marginBottom: 8 },
  deletedRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  image: { width: 232, height: 232, borderRadius: radius.DEFAULT, backgroundColor: t.cardAlt },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 5, marginTop: 6 },
  reply: { flexDirection: 'row', gap: 10, padding: 10, marginBottom: 8, borderRadius: radius.DEFAULT },
  replyAccent: { width: 3.5, borderRadius: 2, alignSelf: 'stretch' },
  reactions: {
    position: 'absolute', bottom: -14, left: 14, flexDirection: 'row', gap: 3,
    borderRadius: radius.full, paddingHorizontal: 9, paddingVertical: 4,
  },
  systemWrap: { alignItems: 'center', marginVertical: 12, paddingHorizontal: 40 },
  systemPill: { paddingHorizontal: 18, paddingVertical: 9, borderRadius: radius.full },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  menu: { width: '100%', maxWidth: 350, padding: 16 },
  quickRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginBottom: 8 },
  quickBtn: { width: 46, height: 46, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 12, paddingVertical: 15 },
});
