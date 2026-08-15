import React, { useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet, Modal } from 'react-native';
import Icon from '../icons/Icon';
import Emoji, { EmojiText } from '../icons/Emoji';
import { useTheme } from '../store/ThemeContext';
import { Ticks, formatTime, PaperCard, Rule } from './common';
import { mediaUrl } from '../api';
import { radius, type, inkBox, marker, dashedRule, stroke } from '../theme';
import VoiceNote from './VoiceNote';

const QUICK = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export default function MessageBubble({ message, isMine, isGroup, senderName, onReply, onReact, onDelete, onImagePress }) {
  const { theme } = useTheme();
  const [menu, setMenu] = useState(false);
  const s = makeStyles(theme);

  if (message.type === 'system') {
    return (
      <View style={s.systemWrap}>
        <View style={[dashedRule(theme), s.systemLine]} />
        <EmojiText style={[type.labelXs, { color: theme.muted, textAlign: 'center' }]}>{message.body}</EmojiText>
        <View style={[dashedRule(theme), s.systemLine]} />
      </View>
    );
  }

  const grouped = {};
  (message.reactions || []).forEach((r) => { grouped[r.emoji] = (grouped[r.emoji] || 0) + 1; });
  const reactionList = Object.entries(grouped);

  const ink = isMine ? theme.onBubbleOut : theme.onBubbleIn;
  const subInk = isMine ? (theme.dark ? 'rgba(28,27,27,0.55)' : 'rgba(255,255,255,0.62)') : theme.muted;

  // hand-drawn asymmetry: the "tail" corner is squared off
  const shape = isMine
    ? { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.md, borderBottomLeftRadius: radius.lg, borderBottomRightRadius: 0 }
    : { borderTopLeftRadius: radius.md, borderTopRightRadius: radius.lg, borderBottomRightRadius: radius.lg, borderBottomLeftRadius: 0 };

  return (
    <>
      <Pressable onLongPress={() => setMenu(true)} delayLongPress={280} style={[s.wrap, isMine ? s.wrapMine : s.wrapTheirs]}>
        <View
          style={[
            s.bubble,
            shape,
            {
              backgroundColor: isMine ? theme.bubbleOut : theme.bubbleIn,
              borderWidth: stroke.ink,
              borderColor: theme.ink,
            },
          ]}
        >
          {isGroup && !isMine && (
            <Text style={[type.labelXs, { color: theme.graphite, marginBottom: 4 }]}>{senderName.toUpperCase()}</Text>
          )}

          {message.replyTo && (
            <View style={[s.reply, { borderLeftColor: isMine ? subInk : theme.graphiteLine }]}>
              <Text style={[type.labelXs, { color: isMine ? subInk : theme.graphite }]} numberOfLines={1}>
                {message.replyTo.senderName.toUpperCase()}
              </Text>
              {message.replyTo.type === 'image' || message.replyTo.type === 'voice' ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }}>
                  <Emoji char={message.replyTo.type === 'image' ? '📷' : '🎤'} size={12} />
                  <Text style={[type.bodySm, { color: isMine ? subInk : theme.subtext, fontSize: 12.5 }]}>
                    {message.replyTo.type === 'image' ? 'Photo' : 'Voice message'}
                  </Text>
                </View>
              ) : (
                <EmojiText style={[type.bodySm, { color: isMine ? subInk : theme.subtext, fontSize: 12.5, marginTop: 2 }]} numberOfLines={2}>
                  {message.replyTo.body}
                </EmojiText>
              )}
            </View>
          )}

          {message.deleted ? (
            <View style={s.deletedRow}>
              <Icon name="ban-outline" size={14} color={subInk} />
              <Text style={[type.bodyMd, { color: subInk, fontStyle: 'italic' }]}>message deleted</Text>
            </View>
          ) : message.type === 'image' ? (
            <Pressable onPress={() => onImagePress?.(mediaUrl(message.mediaUrl))}>
              <Image source={{ uri: mediaUrl(message.mediaUrl) }} style={[s.image, { borderColor: theme.ink }]} resizeMode="cover" />
              {!!message.body && <EmojiText style={[type.bodyMd, { color: ink, marginTop: 7 }]}>{message.body}</EmojiText>}
            </Pressable>
          ) : message.type === 'voice' ? (
            <VoiceNote uri={mediaUrl(message.mediaUrl)} duration={message.duration} isMine={isMine} />
          ) : (
            <EmojiText style={[type.bodyMd, { color: ink }]}>{message.body}</EmojiText>
          )}

          <View style={s.meta}>
            <Text style={[type.labelXs, { color: subInk, fontSize: 9 }]}>{formatTime(message.createdAt)}</Text>
            {isMine && <Ticks status={message.status} size={13} color={message.status === 'read' ? theme.highlighter : subInk} />}
          </View>

          {reactionList.length > 0 && (
            <View style={[s.reactions, { backgroundColor: theme.bg, borderColor: theme.ink }]}>
              {reactionList.map(([emoji, count]) => (
                <View key={emoji} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                  <Emoji char={emoji} size={13} />
                  {count > 1 && <Text style={[type.labelXs, { color: theme.ink, fontSize: 9 }]}>{count}</Text>}
                </View>
              ))}
            </View>
          )}
        </View>
      </Pressable>

      <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)}>
        <Pressable style={[s.overlay, { backgroundColor: theme.overlay }]} onPress={() => setMenu(false)}>
          <PaperCard weight="ink" style={s.menu}>
            <View style={s.quickRow}>
              {QUICK.map((e) => (
                <Pressable
                  key={e}
                  onPress={() => { onReact(message.id, e); setMenu(false); }}
                  style={({ pressed }) => [s.quickBtn, inkBox(theme, 'thin'), pressed ? marker(theme, 2) : null]}
                >
                  <Emoji char={e} size={22} />
                </Pressable>
              ))}
            </View>
            <Rule style={{ marginVertical: 10 }} />
            <Pressable style={({ pressed }) => [s.menuItem, pressed ? marker(theme, 1) : null]} onPress={() => { onReply(message); setMenu(false); }}>
              <Icon name="arrow-undo-outline" size={18} color={theme.ink} />
              <Text style={[type.bodyMd, { color: theme.text }]}>Reply</Text>
            </Pressable>
            {isMine && !message.deleted && (
              <Pressable style={({ pressed }) => [s.menuItem, pressed ? marker(theme, 1) : null]} onPress={() => { onDelete(message.id); setMenu(false); }}>
                <Icon name="trash-outline" size={18} color={theme.danger} />
                <Text style={[type.bodyMd, { color: theme.danger }]}>Delete for everyone</Text>
              </Pressable>
            )}
          </PaperCard>
        </Pressable>
      </Modal>
    </>
  );
}

const makeStyles = (t) => StyleSheet.create({
  wrap: { paddingHorizontal: 20, marginVertical: 5 },
  wrapMine: { alignItems: 'flex-end' },
  wrapTheirs: { alignItems: 'flex-start' },
  bubble: { maxWidth: '84%', minWidth: 88, paddingHorizontal: 13, paddingTop: 9, paddingBottom: 7, marginBottom: 7 },
  deletedRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  image: { width: 224, height: 224, borderWidth: 1 },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 5, marginTop: 5 },
  reply: { borderLeftWidth: 2, paddingLeft: 8, paddingVertical: 2, marginBottom: 7 },
  reactions: {
    position: 'absolute', bottom: -12, left: 10, flexDirection: 'row', gap: 4,
    paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1,
    borderTopLeftRadius: 1, borderTopRightRadius: 4, borderBottomRightRadius: 1, borderBottomLeftRadius: 3,
  },
  systemWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 14, paddingHorizontal: 28 },
  systemLine: { flex: 1 },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  menu: { width: '100%', maxWidth: 340, padding: 14 },
  quickRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 6 },
  quickBtn: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 6, paddingVertical: 12 },
});
