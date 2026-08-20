import React, { useState, useRef, useEffect } from 'react';
import { View, Text, Image, Pressable, StyleSheet, Modal, Animated, PanResponder, Platform } from 'react-native';
import Icon from '../icons/Icon';
import Emoji, { EmojiText } from '../icons/Emoji';
import { useTheme } from '../store/ThemeContext';
import { Ticks, formatTime, PaperCard, Rule, FrostedBackdrop, GoldTick, hasGoldTick } from './common';
import { mediaUrl } from '../api';
import { radius, type, inkBox, marker, dashedRule, stroke } from '../theme';
import { alpha } from '../chatThemes';
import { Pop, SheetSpringIn, HeartBurst, haptic, useReducedMotion, motion } from '../motion';
import VoiceNote from './VoiceNote';

const QUICK = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

// ---- swipe-to-reply gesture tuning (dp) ----
const SWIPE_MAX = 72;                  // max visual travel the bubble allows
const SWIPE_THRESHOLD = 48;            // releasing at/after this commits the reply
const SWIPE_RESIST_START = SWIPE_MAX * 0.7; // linear tracking until here…
const SWIPE_RESIST = 0.3;              // …then each extra pixel counts for 30%

/** Map raw finger dx to resisted, capped visual travel. */
const visualTravel = (dx) => {
  if (dx <= SWIPE_RESIST_START) return dx;
  return SWIPE_RESIST_START + (dx - SWIPE_RESIST_START) * SWIPE_RESIST;
};

/** Claim only rightward, horizontal-dominant drags — vertical scroll, taps,
 * long-press and the double-tap ❤️ all keep working. */
const shouldClaimSwipe = (g) => g.dx > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.15;

// Message ids that already played their entrance animation this session.
// Keeps FlatList row recycling (scroll away + back) from re-animating old
// content while still animating genuinely new messages once.
const ANIMATED_IDS = new Set();
const MAX_TRACKED_IDS = 4000;

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
  onOpenReply, highlighted,
}) {
  const { theme } = useTheme();
  const reduced = useReducedMotion();
  const [menu, setMenu] = useState(false);
  const [burst, setBurst] = useState(false);
  const lastTapAt = useRef(0);
  const s = makeStyles(theme);

  // ---- long-press lift: the message rises slightly out of the thread while
  // its context menu is open, then settles back when it closes ----
  const lift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) return undefined;
    if (menu) Animated.spring(lift, { toValue: 1, friction: 6, tension: 170, useNativeDriver: true }).start();
    else Animated.spring(lift, { toValue: 0, friction: 7, tension: 220, useNativeDriver: true }).start();
  }, [menu, reduced, lift]);

  // ---- entrance: only genuinely new messages animate (once per id) ----
  const shouldAnimateIn = !!message._new && !ANIMATED_IDS.has(message.id);
  const appear = useRef(new Animated.Value(shouldAnimateIn ? 0 : 1)).current;
  const entranceStarted = useRef(false);
  useEffect(() => {
    if (!shouldAnimateIn || entranceStarted.current) return undefined;
    entranceStarted.current = true;
    ANIMATED_IDS.add(message.id);
    if (ANIMATED_IDS.size > MAX_TRACKED_IDS) {
      const oldest = ANIMATED_IDS.values().next().value;
      if (oldest) ANIMATED_IDS.delete(oldest);
    }
    if (reduced) { appear.setValue(1); return undefined; }
    Animated.spring(appear, { toValue: 1, friction: 9, tension: 110, useNativeDriver: true }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const appearOpacity = appear.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const appearY = appear.interpolate({ inputRange: [0, 1], outputRange: [10, 0] });
  const appearScale = appear.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] });

  // ---- double-tap → heart burst + ❤️ reaction (original +one interaction) ----
  const handleTap = () => {
    const now = Date.now();
    if (now - lastTapAt.current < 320) {
      lastTapAt.current = 0;
      haptic('impact');
      setBurst(true);
      onReact?.(message.id, '❤️');
    } else {
      lastTapAt.current = now;
    }
  };

  // ---- swipe-to-reply (touch only). The bubble tracks the finger with a
  // native-driver translateX (no re-renders, 60fps) and reveals a themed ↩
  // badge. Web gets a hover-reveal reply button instead. ----
  const isWeb = Platform.OS === 'web';
  const translateX = useRef(new Animated.Value(0)).current;
  const badgeScale = useRef(new Animated.Value(1)).current;
  const armedRef = useRef(false);
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const liveRef = useRef({ message, onReply });
  liveRef.current = { message, onReply };

  const badgeOpacity = translateX.interpolate({
    inputRange: [0, SWIPE_MAX * 0.25, SWIPE_MAX * 0.75, SWIPE_MAX],
    outputRange: [0, 0, 1, 1],
    extrapolate: 'clamp',
  });

  const snapBack = () => {
    if (reducedRef.current) { translateX.setValue(0); return; }
    Animated.spring(translateX, { toValue: 0, ...motion.springBack, useNativeDriver: true }).start();
  };

  const panResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponderCapture: (e, g) => !isWeb && shouldClaimSwipe(g),
    onMoveShouldSetPanResponder: (e, g) => !isWeb && shouldClaimSwipe(g),
    onPanResponderGrant: () => { armedRef.current = false; translateX.setValue(0); },
    onPanResponderMove: (e, g) => {
      const v = Math.min(visualTravel(Math.max(0, g.dx)), SWIPE_MAX);
      translateX.setValue(v);
      // crossing the threshold arms the reply once per drag: badge pops + haptic
      if (!armedRef.current && v >= SWIPE_THRESHOLD) {
        armedRef.current = true;
        haptic('impact');
        if (!reducedRef.current) {
          Animated.sequence([
            Animated.spring(badgeScale, { toValue: 1.18, ...motion.springPop, useNativeDriver: true }),
            Animated.spring(badgeScale, { toValue: 1, ...motion.springBack, useNativeDriver: true }),
          ]).start();
        }
      }
    },
    onPanResponderRelease: (e, g) => {
      const committed = Math.min(visualTravel(Math.max(0, g.dx)), SWIPE_MAX) >= SWIPE_THRESHOLD;
      snapBack();
      if (committed) liveRef.current.onReply?.(liveRef.current.message);
    },
    onPanResponderTerminate: () => snapBack(),
    // once the swipe is committed, don't let the FlatList steal the gesture back
    onPanResponderTerminationRequest: () => false,
  })).current;

  // ---- web hover → small ↩ reply button (swipe stays touch-only on desktop) ----
  const [hovered, setHovered] = useState(false);
  const hoverOpacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) { hoverOpacity.setValue(hovered ? 1 : 0); return undefined; }
    Animated.timing(hoverOpacity, {
      toValue: hovered ? 1 : 0, duration: motion.fast, easing: motion.easing.out, useNativeDriver: true,
    }).start();
    return undefined;
  }, [hovered, reduced, hoverOpacity]);

  // ---- brief highlighter wash when scrolled-to from a reply-quote tap ----
  const hlOpacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) { hlOpacity.setValue(highlighted ? 1 : 0); return undefined; }
    Animated.timing(hlOpacity, {
      toValue: highlighted ? 1 : 0,
      duration: highlighted ? 220 : 420,
      easing: motion.easing.out,
      useNativeDriver: true,
    }).start();
    return undefined;
  }, [highlighted, reduced, hlOpacity]);

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
  // Metadata inside a bubble is the bubble's own ink at reduced opacity —
  // adapts to any chat theme instead of hard-coding light/dark pairs.
  const subInk = isMine ? alpha(ink, 0.62) : theme.muted;

  // hand-drawn asymmetry: the "tail" corner is squared off
  const shape = isMine
    ? { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.md, borderBottomLeftRadius: radius.lg, borderBottomRightRadius: 0 }
    : { borderTopLeftRadius: radius.md, borderTopRightRadius: radius.lg, borderBottomRightRadius: radius.lg, borderBottomLeftRadius: 0 };

  const canEdit = isMine && !message.deleted && message.type === 'text';
  const canForward = !message.deleted && message.type !== 'poll';

  const liftY = lift.interpolate({ inputRange: [0, 1], outputRange: [0, -3] });
  const liftScale = lift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.02] });
  // Compose the swipe translateX with the entrance + long-press lift so a
  // single native-driven transform drives all three (they never overlap).
  const bubbleTransform = [
    { translateX },
    ...(shouldAnimateIn ? [{ translateY: appearY }, { scale: appearScale }] : []),
    ...(menu && !reduced ? [{ translateY: liftY }, { scale: liftScale }] : []),
  ];

  return (
    <>
      <View
        {...(isWeb ? {} : panResponder.panHandlers)}
        style={[s.wrap, isMine ? s.wrapMine : s.wrapTheirs]}
      >
        <View style={[s.bubbleSlot, isMine ? s.slotMine : s.slotTheirs]}>
          {!isWeb && (
            <Animated.View
              pointerEvents="none"
              style={[s.swipeBadge, { opacity: badgeOpacity, transform: [{ scale: badgeScale }] }]}
            >
              <View style={[s.swipeBadgeDot, { borderColor: theme.ink, backgroundColor: theme.replyPreview }]}>
                <Icon name="arrow-undo-outline" size={17} color={theme.ink} />
              </View>
            </Animated.View>
          )}
          {isWeb && (
            <Animated.View pointerEvents="box-none" style={[s.hoverBadge, { opacity: hoverOpacity }]}>
              <Pressable
                accessibilityLabel="Reply"
                accessibilityRole="button"
                onPress={() => onReply?.(message)}
                hitSlop={8}
                style={({ pressed }) => [
                  s.hoverBtn,
                  { borderColor: theme.ink, backgroundColor: theme.replyPreview },
                  pressed && { backgroundColor: theme.highlighterSoft },
                ]}
              >
                <Icon name="arrow-undo-outline" size={16} color={theme.ink} />
              </Pressable>
            </Animated.View>
          )}
          <Pressable
            onPress={handleTap}
            onLongPress={() => { haptic('selection'); setMenu(true); }}
            delayLongPress={280}
            onHoverIn={isWeb ? () => setHovered(true) : undefined}
            onHoverOut={isWeb ? () => setHovered(false) : undefined}
          >
            <Animated.View
              style={[
                s.bubble,
                shape,
                {
                  backgroundColor: isMine ? theme.bubbleOut : theme.bubbleIn,
                  borderWidth: stroke.ink,
                  borderColor: theme.ink,
                },
                shouldAnimateIn && { opacity: appearOpacity },
                { transform: bubbleTransform },
              ]}
            >
            <Animated.View
              pointerEvents="none"
              style={[s.highlightWash, shape, { opacity: hlOpacity, backgroundColor: theme.highlighterWash }]}
            />
            {burst && <HeartBurst onDone={() => setBurst(false)} reduced={reduced} />}
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
            <View style={[s.statusReply, { borderLeftColor: isMine ? subInk : theme.ink, backgroundColor: isMine ? alpha(ink, 0.14) : theme.cardAlt }]}>
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
                    <View style={{ marginTop: 6, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 6, backgroundColor: isMine ? alpha(ink, 0.12) : theme.card, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.graphiteLine }}>
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
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="View original message"
              onPress={() => onOpenReply?.(message.replyTo.id)}
              style={({ pressed }) => [
                s.reply,
                { borderLeftColor: isMine ? subInk : theme.graphiteLine },
                pressed && { backgroundColor: alpha(ink, 0.06) },
              ]}
            >
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
            </Pressable>
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
            // Pop (firstStatic) = existing reactions stay put on load; a new
            // reaction or count change springs the pill subtly.
            <Pop trigger={reactionList.map(([e, c]) => `${e}${c}`).join(',')} firstStatic>
              <View style={[s.reactions, { backgroundColor: theme.reactionAccent || theme.bg, borderColor: theme.ink }]}>
                {reactionList.map(([emoji, count]) => (
                  <View key={emoji} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                    <Emoji char={emoji} size={13} />
                    {count > 1 && <Text style={[type.labelXs, { color: theme.ink, fontSize: 9 }]}>{count}</Text>}
                  </View>
                ))}
              </View>
            </Pop>
          )}
            </Animated.View>
          </Pressable>
        </View>
      </View>

      <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)}>
        <Pressable style={[s.overlay, { backgroundColor: 'transparent' }]} onPress={() => setMenu(false)}>
          <FrostedBackdrop />
          <SheetSpringIn style={{ width: '100%', maxWidth: 340, alignItems: 'center' }}>
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
          </SheetSpringIn>
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
  bubbleSlot: { position: 'relative', maxWidth: '84%', minWidth: 88 },
  slotMine: { alignSelf: 'flex-end' },
  slotTheirs: { alignSelf: 'flex-start' },
  bubble: { width: '100%', paddingHorizontal: 13, paddingTop: 9, paddingBottom: 7, marginBottom: 7 },
  swipeBadge: { position: 'absolute', left: 8, top: 0, bottom: 7, justifyContent: 'center' },
  swipeBadgeDot: { width: 30, height: 30, borderRadius: 999, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  hoverBadge: { position: 'absolute', left: -14, top: 0, bottom: 7, justifyContent: 'center', zIndex: 5 },
  hoverBtn: { width: 30, height: 30, borderRadius: 999, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  highlightWash: { ...StyleSheet.absoluteFillObject },
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
