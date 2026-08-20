import React, { useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet, Modal } from 'react-native';
import Icon from '../icons/Icon';
import Emoji, { EmojiText } from '../icons/Emoji';
import { useTheme } from '../store/ThemeContext';
import { Ticks, formatTime, PaperCard, Rule, FrostedBackdrop, GoldTick, hasGoldTick } from './common';
import { mediaUrl } from '../api';
import { radius, type, inkBox, marker, dashedRule, stroke } from '../theme';
import VoiceNote from './VoiceNote';

const QUICK = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

/** Disappearing-message presets (seconds) — keep in sync with the server. */
export const DISAPPEAR_OPTIONS = [
  { seconds: 30, label: '30s' },
  { seconds: 300, label: '5m' },
  { seconds: 3600, label: '1h' },
  { seconds: 86400, label: '24h' },
];
export const disappearLabel = (seconds) =>
  DISAPPEAR_OPTIONS.find((o) => o.seconds === seconds)?.label || 'Off';

export default function MessageBubble({
  message, isMine, isGroup, senderName, senderUser,
  onReply, onReact, onDelete, onImagePress,
  onEdit, onForward, onStar, onSetTimer, onVotePoll,
}) {
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

  const canEdit = isMine && !message.deleted && message.type === 'text';
  const canForward = !message.deleted && message.type !== 'poll';

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
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 }}>
              <Text style={[type.labelXs, { color: theme.graphite }]}>{senderName.toUpperCase()}</Text>
              {hasGoldTick(senderUser) && <GoldTick size={11} />}
            </View>
          )}

          {message.forwarded && !message.deleted && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 }}>
              <Icon name="arrow-redo-outline" size={12} color={subInk} />
              <Text style={[type.labelXs, { color: subInk, letterSpacing: 0.8 }]}>FORWARDED</Text>
            </View>
          )}

          {message.statusReply && !message.deleted && (
            <View style={[s.statusReply, { borderLeftColor: isMine ? subInk : theme.ink, backgroundColor: isMine ? 'rgba(255,255,255,0.14)' : theme.cardAlt }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Icon name="eye-outline" size={12} color={subInk} />
                <Text style={[type.labelXs, { color: subInk, letterSpacing: 0.6 }]} numberOfLines={1}>
                  {message.statusReply.expired ? 'REPLIED TO STATUS · NO LONGER AVAILABLE' : `REPLIED TO ${String(message.statusReply.author?.name || 'STATUS').toUpperCase()}'S STATUS`}
                </Text>
              </View>
              {!message.statusReply.expired && (
                <>
                  {message.statusReply.type === 'image' && message.statusReply.mediaUrl ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
                      <Image source={{ uri: mediaUrl(message.statusReply.mediaUrl) }} style={{ width: 42, height: 42, borderWidth: 1, borderColor: theme.ink }} resizeMode="cover" />
                      <EmojiText style={[type.bodySm, { color: isMine ? ink : theme.text, flex: 1 }]} numberOfLines={2}>
                        {message.statusReply.body ? message.statusReply.body : 'Photo status'}
                      </EmojiText>
                    </View>
                  ) : (
                    <View style={{ marginTop: 6, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 6, backgroundColor: isMine ? 'rgba(0,0,0,0.14)' : theme.card, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.graphiteLine }}>
                      <EmojiText style={[type.bodySm, { color: isMine ? ink : theme.text }]} numberOfLines={2}>
                        {message.statusReply.body || (message.statusReply.song ? `🎵 ${message.statusReply.song.name || ''}` : 'Status')}
                      </EmojiText>
                    </View>
                  )}
                </>
              )}
            </View>
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
          ) : message.type === 'poll' && message.poll ? (
            <PollBody messageId={message.id} poll={message.poll} isMine={isMine} ink={ink} onVotePoll={onVotePoll} />
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
            {message.edited && !message.deleted && (
              <Text style={[type.labelXs, { color: subInk, fontSize: 9, fontStyle: 'italic' }]}>edited</Text>
            )}
            {!!message.expiresAt && !message.deleted && (
              <Icon name="timer-outline" size={11} color={subInk} />
            )}
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
        <Pressable style={[s.overlay, { backgroundColor: 'transparent' }]} onPress={() => setMenu(false)}>
          <FrostedBackdrop />
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
            {canForward && (
              <Pressable style={({ pressed }) => [s.menuItem, pressed ? marker(theme, 1) : null]} onPress={() => { onForward(message); setMenu(false); }}>
                <Icon name="arrow-redo-outline" size={18} color={theme.ink} />
                <Text style={[type.bodyMd, { color: theme.text }]}>Forward</Text>
              </Pressable>
            )}
            {!message.deleted && message.type !== 'poll' && (
              <Pressable style={({ pressed }) => [s.menuItem, pressed ? marker(theme, 1) : null]} onPress={() => { onStar(message); setMenu(false); }}>
                <Icon name={message.starred ? 'star' : 'star-outline'} size={18} color={message.starred ? theme.highlighter : theme.ink} />
                <Text style={[type.bodyMd, { color: theme.text }]}>{message.starred ? 'Unstar message' : 'Star message'}</Text>
              </Pressable>
            )}
            {canEdit && (
              <Pressable style={({ pressed }) => [s.menuItem, pressed ? marker(theme, 1) : null]} onPress={() => { onEdit(message); setMenu(false); }}>
                <Icon name="create-outline" size={18} color={theme.ink} />
                <Text style={[type.bodyMd, { color: theme.text }]}>Edit</Text>
              </Pressable>
            )}
            {!message.deleted && (
              <Pressable style={({ pressed }) => [s.menuItem, pressed ? marker(theme, 1) : null]} onPress={() => { onSetTimer(message); setMenu(false); }}>
                <Icon name="timer-outline" size={18} color={theme.ink} />
                <Text style={[type.bodyMd, { color: theme.text }]}>Disappear in…</Text>
              </Pressable>
            )}
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

/** The poll card rendered inside a 'poll' message bubble. */
function PollBody({ messageId, poll, ink, isMine, onVotePoll }) {
  const { theme } = useTheme();
  return (
    <View style={{ minWidth: 230, maxWidth: 280 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <Icon name="bar-chart-outline" size={14} color={ink} />
        <Text style={[type.labelXs, { color: ink, letterSpacing: 0.7 }]}>
          POLL{isMine ? ' · YOU' : ` · ${poll.createdByName.toUpperCase()}`}
        </Text>
      </View>
      <EmojiText style={[type.bodyStrong, { color: ink, marginBottom: 10 }]}>{poll.question}</EmojiText>

      {poll.options.map((opt) => {
        const mine = poll.myVote === opt.index;
        const pct = poll.totalVotes ? Math.round((opt.votes / poll.totalVotes) * 100) : 0;
        return (
          <Pressable
            key={opt.index}
            onPress={() => onVotePoll?.(messageId, poll.id, opt.index)}
            style={({ pressed }) => [
              s.pollOption,
              inkBox(theme, 'thin'),
              mine ? { backgroundColor: theme.highlighterSoft, borderColor: theme.ink } : null,
              pressed ? marker(theme, 1) : null,
            ]}
          >
            <View style={s.pollOptionTop}>
              <EmojiText style={[type.bodyMd, { color: ink, flex: 1 }]} numberOfLines={2}>{opt.text}</EmojiText>
              <Text style={[type.labelSm, { color: ink }]}>{pct}%</Text>
            </View>
            <View style={[s.pollBar, { backgroundColor: theme.bg }]}>
              <View
                style={[s.pollBarFill, { width: `${pct}%`, backgroundColor: mine ? theme.ink : theme.graphiteLine }]}
              />
            </View>
            {mine && (
              <Text style={[type.labelXs, { color: theme.ink, marginTop: 4 }]}>YOUR VOTE ✓</Text>
            )}
          </Pressable>
        );
      })}

      <Text style={[type.labelXs, { color: ink, opacity: 0.75, marginTop: 8 }]}>
        {poll.totalVotes} vote{poll.totalVotes === 1 ? '' : 's'} · tap an option to vote
      </Text>
    </View>
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

  statusReply: { borderLeftWidth: 3, paddingLeft: 9, paddingVertical: 7, paddingRight: 9, marginBottom: 8, borderRadius: 7 },
  pollOption: { paddingHorizontal: 10, paddingVertical: 8, marginBottom: 7 },
  pollOptionTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pollBar: { height: 6, marginTop: 7, borderWidth: 1, borderColor: t.ink, overflow: 'hidden', borderRadius: 2 },
  pollBarFill: { height: '100%', minWidth: 2 },
});
