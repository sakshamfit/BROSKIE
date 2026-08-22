import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, Modal, TextInput,
  ActivityIndicator, Image, KeyboardAvoidingView, Platform, Keyboard, Animated, Easing, PanResponder,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../icons/Icon';
import { EmojiText } from '../icons/Emoji';
import { api, mediaUrl } from '../api';
import { useAuth } from '../store/AuthContext';
import { useTheme } from '../store/ThemeContext';
import { useChat } from '../store/ChatContext';
import { Avatar, formatChatTime, rippleFor, FrostedBackdrop, GoldTick, hasGoldTick } from './common';
import { AUDIENCE } from './audienceMeta';
import SongCard from './SongCard';
import { radius, type, marker, stroke, raised } from '../theme';
import { FadeSlide, Skeleton, motion, SpringPressable, haptic, useReducedMotion, Pop, Stagger } from '../motion';
import { lazyComponent } from '../lazy';
import { editorConfigFor } from '../imageEditor/config';
import GridPaper from './GridPaper';
import StatusRing from './StatusRing';
import Emoji from '../icons/Emoji';

const AudiencePicker = lazyComponent(() => import('./AudiencePicker'));
const UniversalImageEditor = lazyComponent(() => import('./UniversalImageEditor'));
const SongPicker = lazyComponent(() => import('./SongPicker'));

const BG_COLORS = ['#FFE24D', '#fdf8f8', '#e2e3de', '#5d5f5b', '#1c1b1b', '#39444c'];
const REACTIONS = ['❤️', '😂', '🔥', '😮', '👏'];
const STICKERS = [
  { id: 'love', glyph: '💛' }, { id: 'fire', glyph: '🔥' }, { id: 'party', glyph: '🎉' },
  { id: 'travel', glyph: '✈️' }, { id: 'food', glyph: '🍜' }, { id: 'work', glyph: '✏️' },
  { id: 'sport', glyph: '⚽' }, { id: 'sun', glyph: '☀️' }, { id: 'laugh', glyph: '😂' },
];
const TEXT_ALIGNS = ['center', 'left', 'right'];

// WhatsApp-style status privacy, with +one's public option retained. The
// existing status_recipients table stores inclusions for "selected" and
// exclusions for "contacts_except".
const STATUS_AUDIENCES = [
  { ...AUDIENCE.public, label: 'Public', sub: 'Everyone on +one can see this update' },
  { ...AUDIENCE.contacts, label: 'My friends', sub: 'Only people you already chat with' },
  { ...AUDIENCE.contacts_except, label: 'My friends except…', sub: 'Hide this update from the friends you choose' },
  { ...AUDIENCE.selected, label: 'Only share with…', sub: 'A private update for only the people you choose' },
];

const privacyMeta = (key) => STATUS_AUDIENCES.find((option) => option.key === key) || STATUS_AUDIENCES[0];

function foregroundFor(status) {
  if (!status || status.type === 'image') return '#ffffff';
  return ['#1c1b1b', '#5d5f5b', '#39444c'].includes(status.bg) ? '#ffffff' : '#1c1b1b';
}

/**
 * The See section, merged into the Network feed — Instagram-style story
 * rings. A horizontal strip of avatar circles sits at the top of the feed:
 * your own profile circle first (tap it to view your update, tap its +
 * badge to upload a new one), then a circle for everyone with a live
 * 24-hour update. Unseen updates wear a bold ink ring, seen ones fade to
 * graphite. Tapping a circle opens the same full-screen story viewer the
 * old See tab used, replies included.
 */
export default function StoriesRow({ reloadKey = 0 }) {
  const { user } = useAuth();
  const { theme } = useTheme();
  const { onStatusEvent } = useChat();
  const [data, setData] = useState({ mine: null, others: [] });
  const [loading, setLoading] = useState(true);
  const [composerMode, setComposerMode] = useState(null); // choose | text | photo
  const [viewerGroup, setViewerGroup] = useState(null);
  const s = makeStyles(theme);

  const load = useCallback(async () => {
    try { setData(await api.statuses()); } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load, reloadKey]);
  useEffect(() => {
    if (!onStatusEvent) return undefined;
    return onStatusEvent(() => load());
  }, [onStatusEvent, load]);

  const closeViewer = () => {
    setViewerGroup(null);
    load(); // rings should dim for everything just viewed
  };

  // Unseen updates cluster first (recency order within each group), like
  // every story rail you have ever used.
  const others = [...data.others].sort((a, b) => Number(!!a.allViewed) - Number(!!b.allViewed));
  const hasMine = !!data.mine?.items?.length;

  const latestMine = hasMine ? data.mine.items[data.mine.items.length - 1] : null;

  return (
    <View style={s.storiesWrap}>
      <View style={s.statusHead}>
        <Text style={[type.labelSm, { color: theme.muted }]}>STATUS</Text>
        <SpringPressable
          accessibilityRole="button"
          accessibilityLabel="Add a status update"
          onPress={() => { haptic('selection'); setComposerMode('choose'); }}
          style={s.statusAddBtn}
          scaleTo={motion.scale.chip}
          haptic="selection"
        >
          <Icon name="add" size={16} color={theme.ink} />
        </SpringPressable>
      </View>

      <GridPaper
        color={theme.graphiteLine}
        opacity={theme.dark ? 0.28 : 0.22}
        style={[s.heroCard, { borderColor: theme.ink, backgroundColor: theme.card }]}
      >
        <SpringPressable
          accessibilityRole="button"
          accessibilityLabel={hasMine ? 'View your status update' : 'Add a status update'}
          onPress={() => (hasMine ? setViewerGroup(data.mine) : setComposerMode('choose'))}
          style={s.heroInner}
          scaleTo={motion.scale.row}
          haptic="selection"
        >
          <StatusRing
            size={72}
            segments={data.mine?.items?.length || 1}
            seen={false}
            empty={!hasMine}
            active={hasMine}
            color={theme.ink}
            seenColor={theme.graphiteLine}
          >
            <Avatar uri={user?.avatar} name={user?.name} id={user?.id} size={56} />
          </StatusRing>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[type.headlineSm, { color: theme.text }]}>Your status</Text>
            <Text style={[type.bodySm, { color: theme.subtext, marginTop: 2 }]} numberOfLines={1}>
              {hasMine
                ? `${data.mine.items.length} live · ${formatChatTime(latestMine.createdAt)}`
                : 'Share a photo, a line, or a moment'}
            </Text>
          </View>
          <SpringPressable
            onPress={() => setComposerMode('choose')}
            style={[s.heroCta, { backgroundColor: theme.ink }]}
            scaleTo={motion.scale.chip}
            haptic="selection"
          >
            <Icon name="add" size={14} color={theme.onPrimary} />
            <Text style={[type.labelXs, { color: theme.onPrimary }]}>ADD</Text>
          </SpringPressable>
        </SpringPressable>
      </GridPaper>

      {(others.length > 0 || loading) && (
        <>
          <Text style={[type.labelXs, { color: theme.muted, marginTop: 16, marginBottom: 8 }]}>RECENT</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.storiesRow}
          >
            {others.map((group, i) => (
              <Stagger key={group.user.id} index={i}>
                <StoryCircle
                  accessibilityLabel={`View ${group.user.name}'s status update`}
                  onPress={() => setViewerGroup(group)}
                  segments={group.items.length}
                  seen={!!group.allViewed}
                  avatar={group.user}
                  label={group.user.name}
                  theme={theme}
                  styles={s}
                />
              </Stagger>
            ))}
            {loading && [0, 1, 2, 3].map((i) => (
              <View key={`sk-${i}`} style={s.circleCol}>
                <Skeleton width={68} height={68} radius={999} />
                <Skeleton width={44} height={9} radius={4} />
              </View>
            ))}
          </ScrollView>
        </>
      )}

      {others.length > 0 && (
        <>
          <Text style={[type.labelXs, { color: theme.muted, marginTop: 16, marginBottom: 8 }]}>PEOPLE</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.cardRow}>
            {others.slice(0, 12).map((group) => {
              const last = group.items[group.items.length - 1];
              return (
                <SpringPressable
                  key={`card-${group.user.id}`}
                  onPress={() => setViewerGroup(group)}
                  style={[s.personCard, { borderColor: theme.ink, backgroundColor: theme.card }]}
                  scaleTo={motion.scale.card}
                  haptic="selection"
                >
                  <GridPaper color={theme.graphiteLine} opacity={0.16} animate={false} style={s.personPreview}>
                    {last?.type === 'image' && last.mediaUrl ? (
                      <Image source={{ uri: mediaUrl(last.mediaUrl) }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                    ) : (
                      <View style={[StyleSheet.absoluteFill, { backgroundColor: last?.bg || theme.highlighter, alignItems: 'center', justifyContent: 'center', padding: 8 }]}>
                        <EmojiText style={[type.labelXs, { color: foregroundFor(last), textAlign: 'center' }]} numberOfLines={4}>
                          {last?.body || 'Status'}
                        </EmojiText>
                      </View>
                    )}
                  </GridPaper>
                  <View style={s.personMeta}>
                    <StatusRing
                      size={28}
                      segments={group.items.length}
                      seen={!!group.allViewed}
                      color={theme.ink}
                      seenColor={theme.graphiteLine}
                    >
                      <Avatar uri={group.user.avatar} name={group.user.name} id={group.user.id} size={20} />
                    </StatusRing>
                    <EmojiText style={[type.labelXs, { color: theme.text, flex: 1 }]} numberOfLines={1}>
                      {group.user.name}
                    </EmojiText>
                  </View>
                </SpringPressable>
              );
            })}
          </ScrollView>
        </>
      )}

      <StatusComposer
        visible={!!composerMode}
        initialMode={composerMode || 'choose'}
        onClose={() => setComposerMode(null)}
        onPosted={load}
      />

      <StatusViewer group={viewerGroup} onClose={closeViewer} />
    </View>
  );
}

/** One avatar ring in the strip. `badge` (your own +) overlays the ring. */
function StoryCircle({ accessibilityLabel, onPress, avatar, label, badge, theme, styles: s, segments = 1, seen = false, empty = false }) {
  return (
    <View style={s.circleCol}>
      <View style={s.circlePress}>
        <SpringPressable
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          onPress={onPress}
          scaleTo={motion.scale.row}
          haptic="selection"
          style={({ pressed }) => [pressed && { opacity: 0.72 }]}
        >
          <StatusRing
            size={68}
            segments={segments}
            seen={seen}
            empty={empty}
            color={theme.ink}
            seenColor={theme.graphiteLine}
          >
            <Avatar uri={avatar?.uri || avatar?.avatar} name={avatar?.name} id={avatar?.id} size={54} />
          </StatusRing>
        </SpringPressable>
        {badge}
      </View>
      <EmojiText style={[type.labelXs, { color: theme.subtext }]} numberOfLines={1} ellipsizeMode="tail">
        {label}
      </EmojiText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* full-screen story viewer (unchanged behaviour, extracted from the   */
/* old See screen so the Network feed can host it)                     */
/* ------------------------------------------------------------------ */

export function StatusViewer({ group, startIndex = 0, onClose }) {
  const { user } = useAuth();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const s = makeStyles(theme);

  const [index, setIndex] = useState(0);
  const [replyText, setReplyText] = useState('');
  const [replySending, setReplySending] = useState(false);
  const [replyFeedback, setReplyFeedback] = useState('');
  const [replyFocused, setReplyFocused] = useState(false);
  const [burst, setBurst] = useState(null);
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS === 'web') return undefined;

    const keyboardHeightFrom = (event) => {
      const eventHeight = Number(event?.endCoordinates?.height) || 0;
      const metricsHeight = Number(Keyboard.metrics?.()?.height) || 0;
      const height = Math.max(eventHeight, metricsHeight);
      if (height > 0) setKbHeight(height);
    };
    const onHide = () => setKbHeight(0);
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, keyboardHeightFrom);
    const hideSub = Keyboard.addListener(hideEvent, onHide);
    const frameSub = Platform.OS === 'android'
      ? Keyboard.addListener('keyboardDidChangeFrame', keyboardHeightFrom)
      : null;

    return () => {
      showSub.remove();
      hideSub.remove();
      frameSub?.remove();
    };
  }, []);

  const current = group?.items[Math.min(index, (group?.items?.length || 1) - 1)];
  const isOwnStatus = group?.user.id === user?.id;
  const [held, setHeld] = useState(false); // story hold-to-pause
  const reducedMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const progressVal = useRef(0);
  const segIdRef = useRef(null);
  const moveRef = useRef(null);

  const closeViewer = useCallback(() => {
    setReplyText('');
    setReplyFeedback('');
    setReplyFocused(false);
    onClose?.();
  }, [onClose]);

  const moveStatus = async (direction) => {
    if (!group) return;
    const next = index + direction;
    if (next >= group.items.length) { closeViewer(); return; }
    if (next < 0) return;
    setIndex(next);
  };
  moveRef.current = moveStatus;

  // Opening a story — and landing on each next segment — marks it viewed
  // so the ring fades to graphite for everyone afterwards.
  useEffect(() => {
    if (!current) return undefined;
    api.viewStatus(current.id).catch(() => {});
    return undefined;
  }, [current?.id]);

  // Each group opens at its first (oldest) segment, with a fresh progress
  // bar — even when you reopen the same one-segment story you just watched.
  useEffect(() => {
    setIndex(group ? Math.max(0, Math.min(startIndex, group.items.length - 1)) : 0);
    if (group) {
      segIdRef.current = null;
      progressVal.current = 0;
      progress.setValue(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.user?.id]);

  const sendReaction = async (emoji) => {
    if (!current || isOwnStatus) return;
    setBurst(emoji);
    haptic('selection');
    try {
      await api.replyToStatus(current.id, emoji);
      setReplyFeedback(`${emoji} sent`);
      setTimeout(() => setReplyFeedback(''), 1800);
    } catch {
      setReplyFeedback('Could not react');
      setTimeout(() => setReplyFeedback(''), 2000);
    }
    setTimeout(() => setBurst(null), 900);
  };

  const sendStatusReply = async () => {
    const text = replyText.trim();
    if (!text || !current || !group) return;
    if (group.user.id === user.id) return;
    setReplySending(true);
    setReplyFeedback('');
    try {
      await api.replyToStatus(current.id, text);
      setReplyText('');
      setReplyFeedback('Reply sent \u2713  · check Chats');
      setTimeout(() => setReplyFeedback(''), 2400);
    } catch (e) {
      setReplyFeedback(e.message || 'Could not send reply');
      setTimeout(() => setReplyFeedback(''), 2600);
    } finally {
      setReplySending(false);
    }
  };

  // Progress-bar engine: each segment's bar animates 0 → 1 over its display
  // duration, pauses while held (finger down) or while the reply input is
  // focused, resumes from where it stopped, and auto-advances on completion.
  useEffect(() => {
    if (!current) return undefined;
    const id = progress.addListener(({ value }) => { progressVal.current = value; });
    if (segIdRef.current !== current.id) {
      segIdRef.current = current.id;
      progressVal.current = 0;
      progress.setValue(0);
    }
    if (held || replyFocused) {
      progress.stopAnimation();
      return () => progress.removeListener(id);
    }
    const durationMs = current.type === 'image' ? 6500 : 5500;
    const remaining = Math.max(50, (1 - progressVal.current) * durationMs);
    progress.setValue(progressVal.current);
    const anim = Animated.timing(progress, {
      toValue: 1, duration: remaining, easing: Easing.linear, useNativeDriver: true,
    });
    anim.start(({ finished }) => { if (finished) moveRef.current(1); });
    return () => { anim.stop(); progress.removeListener(id); };
    // The current id is the segment boundary; moveStatus intentionally uses
    // the viewer snapshot associated with that id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, held, replyFocused]);

  const progressScaleX = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

  /* ---- story viewer gestures ----
     `dismissY` follows a downward drag 1:1 (upward is heavily resisted) and
     the story scales down as it travels, so letting go feels like handing
     the card back. Holding to pause eases the same scale slightly, giving
     the pause a visible state as well as a felt one. */
  const dismissY = useRef(new Animated.Value(0)).current;
  const holdScale = useRef(new Animated.Value(1)).current;
  const closeViewerRef = useRef(closeViewer);
  closeViewerRef.current = closeViewer;

  useEffect(() => {
    if (reducedMotion) { holdScale.setValue(1); return undefined; }
    const anim = Animated.spring(holdScale, {
      toValue: held ? 0.985 : 1, ...motion.springBack, useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [held, holdScale, reducedMotion]);

  useEffect(() => { dismissY.setValue(0); }, [group?.user?.id, dismissY]);

  const viewerPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (e, g) => g.dy > 12 && g.dy > Math.abs(g.dx) * 1.4,
      onPanResponderGrant: () => { dismissY.stopAnimation(); },
      onPanResponderMove: (e, g) => dismissY.setValue(g.dy > 0 ? g.dy : g.dy * 0.1),
      onPanResponderRelease: (e, g) => {
        if (g.dy > 110 || g.vy > 0.7) {
          haptic('selection');
          Animated.timing(dismissY, {
            toValue: 700, duration: motion.fast, easing: motion.easing.out, useNativeDriver: true,
          }).start(() => { dismissY.setValue(0); closeViewerRef.current(); });
          return;
        }
        Animated.spring(dismissY, { toValue: 0, velocity: g.vy, ...motion.springBack, useNativeDriver: true }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(dismissY, { toValue: 0, ...motion.springBack, useNativeDriver: true }).start();
      },
      onPanResponderTerminationRequest: () => false,
    }),
  ).current;

  // Drag distance also shrinks the story, so the gesture reads as physical.
  const dragScale = dismissY.interpolate({
    inputRange: [0, 320], outputRange: [1, 0.88], extrapolate: 'clamp',
  });
  const viewerScale = Animated.multiply(holdScale, dragScale);

  return (
    <Modal visible={!!group} animationType="fade" onRequestClose={closeViewer}>
      {current && (
        // Viewer opens with a soft scale/settle — the avatar's story
        // "expands" into the full screen without a jarring pop.
        <FadeSlide key={`story-${group.user.id}`} from="up" distance={16} scale={0.985} duration={motion.normal} style={{ flex: 1 }}>
        {/* The story itself is draggable: pull it down and it follows the
            finger, shrinking slightly, then lets go past ~110px. Holding
            to pause also eases it back a touch, so "paused" is something
            you can see as well as feel. */}
        <Animated.View
          {...viewerPan.panHandlers}
          style={[
            s.viewer,
            {
              backgroundColor: current.type === 'image' ? '#090909' : current.bg,
              paddingTop: Math.max(insets.top, 14) + 14,
              paddingBottom: Math.max(insets.bottom, 16),
              transform: [{ translateY: dismissY }, { scale: viewerScale }],
            },
          ]}
        >
          <View style={s.tapZones}>
            <Pressable
              style={{ flex: 0.34 }}
              onPress={() => moveStatus(-1)}
              onPressIn={() => setHeld(true)}
              onPressOut={() => setHeld(false)}
            />
            <Pressable
              style={{ flex: 0.66 }}
              onPress={() => moveStatus(1)}
              onPressIn={() => setHeld(true)}
              onPressOut={() => setHeld(false)}
            />
          </View>

          {/* progress bars — the active segment animates 0 → 100%, pauses
              on hold, and resumes cleanly */}
          <View style={s.progressRow} pointerEvents="none">
            {group.items.map((item, itemIndex) => {
              const done = itemIndex < index;
              const active = itemIndex === index;
              return (
                <View key={itemIndex} style={[s.progressBar, { backgroundColor: 'rgba(160,160,160,0.42)', overflow: 'hidden' }]}>
                  {done && <View style={[StyleSheet.absoluteFill, { backgroundColor: foregroundFor(item) }]} />}
                  {active && (
                    <Animated.View
                      style={[StyleSheet.absoluteFill, { backgroundColor: foregroundFor(item), transform: [{ scaleX: progressScaleX }], transformOrigin: 'left' }]}
                    />
                  )}
                </View>
              );
            })}
          </View>

          <View style={s.viewerHeader}>
            <Avatar uri={group.user.avatar} name={group.user.name} id={group.user.id} size={40} />
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <EmojiText style={[type.bodyStrong, { color: foregroundFor(current), flexShrink: 1 }]} numberOfLines={1}>
                  {group.user.id === user?.id ? 'My status' : group.user.name}
                </EmojiText>
                {group.user.id !== user?.id && hasGoldTick(group.user) && <GoldTick size={14} />}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }}>
                <Icon name={privacyMeta(current.audience).icon} size={11} color={foregroundFor(current)} style={{ opacity: 0.68 }} />
                <Text style={[type.labelXs, { color: foregroundFor(current), opacity: 0.68 }]}>
                  {formatChatTime(current.createdAt)} · {privacyMeta(current.audience).label}
                </Text>
              </View>
            </View>
            <Pressable onPress={closeViewer} hitSlop={10} style={{ padding: 5 }}>
              <Icon name="close" size={23} color={foregroundFor(current)} />
            </Pressable>
          </View>

          <View style={s.viewerBody} pointerEvents="none">
            {/* each story segment enters with a soft settle */}
            <FadeSlide key={current.id} from="up" distance={14} scale={0.985} style={{ flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center' }}>
            {current.type === 'image' ? (
              <View
                style={[
                  s.viewerImageFrame,
                  {
                    aspectRatio: current.mediaAspect || 9 / 16,
                    width: (current.mediaAspect || 9 / 16) < 0.7 ? '72%' : '100%',
                  },
                ]}
              >
                <Image source={{ uri: mediaUrl(current.mediaUrl) }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              </View>
            ) : (
              <EmojiText style={[s.viewerText, { color: foregroundFor(current) }]}>{current.body}</EmojiText>
            )}

            {!!current.song && (
              <View style={s.viewerSong}>
                <SongCard song={current.song} tint={foregroundFor(current)} />
              </View>
            )}

            {current.type === 'image' && !!current.body && (
              <View style={s.viewerCaption}>
                <EmojiText style={[type.bodyMd, { color: '#ffffff', textAlign: 'center' }]}>{current.body}</EmojiText>
              </View>
            )}
            </FadeSlide>
          </View>

          {/* ── gentle update: reply composer (not a rebuild) ── */}
          {burst ? (
            <View pointerEvents="none" style={s.reactBurst}>
              <Pop trigger={burst}><Emoji char={burst} size={64} /></Pop>
            </View>
          ) : null}

          {isOwnStatus ? (
            <View style={[s.replyHintWrap, { paddingBottom: (Platform.OS === 'android' && kbHeight > 0 ? kbHeight + 10 : Math.max(insets.bottom, 12)) }]} pointerEvents="none">
              <Text style={[type.labelXs, { color: foregroundFor(current), opacity: 0.72, textAlign: 'center' }]}>
                Replies to your update appear as messages in Chats
              </Text>
            </View>
          ) : (
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              enabled={Platform.OS === 'ios'}
              style={[s.replyBarWrap, { paddingBottom: (Platform.OS === 'android' && kbHeight > 0 ? kbHeight + 10 : Math.max(insets.bottom, 12)) }]}
            >
              <View style={s.reactRow}>
                {REACTIONS.map((emoji) => (
                  <SpringPressable
                    key={emoji}
                    onPress={() => sendReaction(emoji)}
                    style={s.reactChip}
                    scaleTo={motion.scale.chip}
                    haptic="selection"
                    accessibilityLabel={`React ${emoji}`}
                  >
                    <Emoji char={emoji} size={22} />
                  </SpringPressable>
                ))}
              </View>
              <View style={s.replyBar}>
                <TextInput
                  value={replyText}
                  onChangeText={setReplyText}
                  onFocus={() => setReplyFocused(true)}
                  onBlur={() => setReplyFocused(false)}
                  placeholder={`Reply to ${group.user.name.split(' ')[0]}...`}
                  placeholderTextColor="rgba(28,27,27,0.48)"
                  style={s.replyInput}
                  returnKeyType="send"
                  onSubmitEditing={sendStatusReply}
                  editable={!replySending}
                  maxLength={700}
                />
                <SpringPressable
                  onPress={sendStatusReply}
                  disabled={replySending || !replyText.trim()}
                  style={({ pressed }) => [
                    s.replySend,
                    (replySending || !replyText.trim()) && { opacity: 0.42 },
                    pressed && { opacity: 0.82 },
                  ]}
                  scaleTo={motion.scale.row}
                  haptic="selection"
                >
                  {replySending ? (
                    <ActivityIndicator color="#050505" size="small" />
                  ) : (
                    <Icon name="send" size={18} color="#050505" />
                  )}
                </SpringPressable>
              </View>
              {!!replyFeedback && (
                <Text style={[type.labelXs, { color: '#ffffff', textAlign: 'center', marginTop: 7, opacity: 0.94 }]}>
                  {replyFeedback}
                </Text>
              )}
            </KeyboardAvoidingView>
          )}
        </Animated.View>
        </FadeSlide>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* composer                                                            */
/* ------------------------------------------------------------------ */

export function StatusComposer({ visible, initialMode, onClose, onPosted }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const s = makeStyles(theme);
  const [mode, setMode] = useState('choose');
  const [body, setBody] = useState('');
  const [bg, setBg] = useState(BG_COLORS[0]);
  const [image, setImage] = useState(null);
  const [cropPicker, setCropPicker] = useState(false);
  const [editUri, setEditUri] = useState(null);
  const [song, setSong] = useState(null);
  const [songPicker, setSongPicker] = useState(false);
  const [audience, setAudience] = useState('contacts');
  const [recipientIds, setRecipientIds] = useState([]);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');
  const [tool, setTool] = useState(null); // stickers | mention | location | style
  const [align, setAlign] = useState('center');
  const [fontScale, setFontScale] = useState(1);
  const [locationLabel, setLocationLabel] = useState('');
  const [mentionQ, setMentionQ] = useState('');
  const [mentionHits, setMentionHits] = useState([]);
  const [overlays, setOverlays] = useState([]); // stickers + location chips in body extras

  const reset = useCallback(() => {
    setMode('choose');
    setBody('');
    setBg(BG_COLORS[0]);
    setImage(null);
    setCropPicker(false);
    setEditUri(null);
    setSong(null);
    setSongPicker(false);
    setAudience('contacts');
    setRecipientIds([]);
    setPrivacyOpen(false);
    setError('');
    setTool(null);
    setAlign('center');
    setFontScale(1);
    setLocationLabel('');
    setMentionQ('');
    setMentionHits([]);
    setOverlays([]);
  }, []);

  useEffect(() => {
    if (!visible) return undefined;
    const nextMode = ['choose', 'text', 'photo'].includes(initialMode) ? initialMode : 'choose';
    setMode(nextMode);
    if (nextMode === 'photo' && !image) {
      const timer = setTimeout(() => { setEditUri(null); setCropPicker(true); }, 180);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [visible, initialMode]); // image deliberately excluded: only auto-open once

  const close = () => {
    if (posting) return;
    reset();
    onClose?.();
  };

  const startPhoto = () => {
    setMode('photo');
    setError('');
    setEditUri(null);
    setCropPicker(true);
  };

  const openEditor = (uri) => {
    setError('');
    setEditUri(uri || null);
    setCropPicker(true);
  };

  const cycleBackground = () => {
    const index = BG_COLORS.indexOf(bg);
    setBg(BG_COLORS[(index + 1) % BG_COLORS.length]);
  };

  const composeCaption = () => {
    const bits = [body.trim()];
    overlays.forEach((o) => {
      if (o.kind === 'sticker') bits.push(o.glyph);
      if (o.kind === 'location') bits.push(`📍 ${o.label}`);
    });
    return bits.filter(Boolean).join(' ').trim();
  };

  useEffect(() => {
    if (tool !== 'mention') return undefined;
    const q = mentionQ.replace(/^@/, '').trim();
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await api.users(q, { contactsOnly: true });
        if (!cancelled) setMentionHits((r.users || []).slice(0, 8));
      } catch {
        if (!cancelled) setMentionHits([]);
      }
    }, 180);
    return () => { cancelled = true; clearTimeout(t); };
  }, [tool, mentionQ]);

  const addMention = (u) => {
    const handle = `@${u.username || u.name}`;
    setBody((prev) => `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}${handle} `);
    setTool(null);
    setMentionQ('');
  };

  const addSticker = (sticker) => {
    setOverlays((prev) => [...prev, { kind: 'sticker', glyph: sticker.glyph, id: `${sticker.id}-${prev.length}` }]);
    setTool(null);
  };

  const applyLocation = async () => {
    if (locationLabel.trim()) {
      setOverlays((prev) => [...prev.filter((o) => o.kind !== 'location'), { kind: 'location', label: locationLabel.trim() }]);
      setTool(null);
      return;
    }
    try {
      const Location = require('expo-location');
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        setError('Location needs permission — or type a city name.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const geo = await Location.reverseGeocodeAsync(pos.coords);
      const place = geo?.[0];
      const city = place?.city || place?.subregion || place?.region || 'Nearby';
      setLocationLabel(city);
      setOverlays((prev) => [...prev.filter((o) => o.kind !== 'location'), { kind: 'location', label: city }]);
      setTool(null);
    } catch {
      setError('Could not read location. Type a city instead.');
    }
  };

  const submit = async () => {
    const caption = composeCaption();
    if (!caption && !image && !song) {
      setError(mode === 'photo' ? 'Choose a photo first.' : 'Write something or attach a song.');
      return;
    }
    if (audience === 'selected' && !recipientIds.length) {
      setError('Choose at least one person for this private status.');
      setPrivacyOpen(true);
      return;
    }

    setPosting(true);
    setError('');
    try {
      let uploadedUrl = null;
      if (image) {
        const upload = await api.uploadFile(
          image.uri,
          image.fileName || 'status.jpg',
          image.mimeType || 'image/jpeg'
        );
        uploadedUrl = upload.url;
      }
      await api.postStatus({
        type: image ? 'image' : 'text',
        body: caption,
        mediaUrl: uploadedUrl,
        mediaAspect: image?.displayAspect || null,
        bg,
        song,
        audience,
        recipientIds: audience === 'selected' || audience === 'contacts_except' ? recipientIds : [],
      });
      reset();
      onClose?.();
      onPosted?.();
    } catch (e) {
      setError(e.message || 'Could not share this status.');
    } finally {
      setPosting(false);
    }
  };

  const composerStatus = { type: mode === 'photo' ? 'image' : 'text', bg };
  const foreground = mode === 'choose' ? theme.ink : foregroundFor(composerStatus);
  const composerBg = mode === 'choose' ? theme.bg : mode === 'photo' ? '#090909' : bg;
  const meta = privacyMeta(audience);

  return (
    <>
      <Modal visible={visible} animationType="slide" onRequestClose={close}>
        <KeyboardAvoidingView
          style={[s.composer, { backgroundColor: composerBg, paddingTop: insets.top, paddingBottom: insets.bottom }]}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={s.composerTopBar}>
            <Pressable onPress={close} hitSlop={9} style={s.composerIconButton}>
              <Icon name="close" size={24} color={foreground} />
            </Pressable>
            <Text style={[type.bodyStrong, { color: foreground }]}>New status</Text>
            <View style={s.composerTools}>
              {mode === 'text' && (
                <Pressable onPress={cycleBackground} hitSlop={8} style={s.composerIconButton}>
                  <Icon name="color-palette-outline" size={22} color={foreground} />
                </Pressable>
              )}
              {mode === 'photo' && (
                <Pressable onPress={() => openEditor(image?.uri)} hitSlop={8} style={s.composerIconButton}>
                  <Icon name="image-outline" size={22} color="#ffffff" />
                </Pressable>
              )}
              {mode !== 'choose' && (
                <Pressable onPress={() => setSongPicker(true)} hitSlop={8} style={s.composerIconButton}>
                  <Icon name="musical-notes-outline" size={21} color={foreground} />
                </Pressable>
              )}
            </View>
          </View>

          {mode === 'choose' && (
            <View style={s.chooseStage}>
              <Text style={[type.headlineLg, { color: theme.text, textAlign: 'center' }]}>Share an update</Text>
              <Text style={[type.bodyMd, { color: theme.subtext, textAlign: 'center', marginTop: 8, marginBottom: 28 }]}>
                Preview it, crop it and choose exactly who can see it before posting.
              </Text>
              <SpringPressable
                onPress={startPhoto}
                style={({ pressed }) => [s.chooseCard, { backgroundColor: '#050505', borderColor: '#000000' }, pressed && { backgroundColor: '#242321' }]}
                scaleTo={motion.scale.row}
                haptic="selection"
              >
                <View style={[s.chooseIcon, { backgroundColor: '#ffffff' }]}>
                  <Icon name="camera-outline" size={24} color="#050505" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[type.headlineSm, { color: '#ffffff' }]}>Photo status</Text>
                  <Text style={[type.bodySm, { color: '#c7c3c1', marginTop: 3 }]}>Choose a frame, crop and preview</Text>
                </View>
                <Icon name="chevron-forward-outline" size={20} color="#ffffff" />
              </SpringPressable>
              <SpringPressable
                onPress={() => setMode('text')}
                style={({ pressed }) => [s.chooseCard, { backgroundColor: theme.card, borderColor: theme.ink }, pressed && marker(theme, 1)]}
                scaleTo={motion.scale.row}
                haptic="selection"
              >
                <View style={[s.chooseIcon, { backgroundColor: theme.highlighter }]}>
                  <Icon name="create-outline" size={22} color="#1c1b1b" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[type.headlineSm, { color: theme.text }]}>Text status</Text>
                  <Text style={[type.bodySm, { color: theme.subtext, marginTop: 3 }]}>Write on a colour background</Text>
                </View>
                <Icon name="chevron-forward-outline" size={20} color={theme.ink} />
              </SpringPressable>
            </View>
          )}

          {mode === 'photo' && (
            <View style={s.photoStage}>
              {image ? (
                <>
                  <View
                    style={[
                      s.composerImageFrame,
                      {
                        aspectRatio: image.displayAspect || 9 / 16,
                        width: (image.displayAspect || 9 / 16) < 0.7 ? '72%' : '100%',
                      },
                    ]}
                  >
                    <Image source={{ uri: image.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                    <Pressable onPress={() => openEditor(image.uri)} style={s.editCropButton}>
                      <Icon name="create-outline" size={14} color="#ffffff" />
                      <Text style={[type.labelXs, { color: '#ffffff' }]}>EDIT CROP</Text>
                    </Pressable>
                  </View>
                  <View style={s.captionBar}>
                    <TextInput
                      value={body}
                      onChangeText={(text) => { setBody(text); setError(''); }}
                      placeholder="Add a caption…"
                      placeholderTextColor="rgba(255,255,255,0.58)"
                      style={s.captionInput}
                      multiline
                      maxLength={700}
                    />
                  </View>
                </>
              ) : (
                <Pressable onPress={() => openEditor(null)} style={s.emptyPhoto}>
                  <Icon name="image-outline" size={42} color="rgba(255,255,255,0.72)" />
                  <Text style={[type.headlineSm, { color: '#ffffff', marginTop: 15 }]}>Choose and crop a photo</Text>
                  <Text style={[type.bodySm, { color: 'rgba(255,255,255,0.58)', marginTop: 5, textAlign: 'center' }]}>Original, square, portrait, wide or story frame</Text>
                </Pressable>
              )}
              {!!song && (
                <View style={s.composerSongDark}>
                  <SongCard song={song} tint="#ffffff" />
                  <Pressable onPress={() => setSong(null)} hitSlop={8} style={{ padding: 5 }}>
                    <Icon name="close" size={16} color="#ffffff" />
                  </Pressable>
                </View>
              )}
            </View>
          )}

          {mode === 'text' && (
            <View style={s.textStage}>
              <TextInput
                autoFocus
                value={body}
                onChangeText={(text) => { setBody(text); setError(''); }}
                placeholder="Type a status"
                placeholderTextColor={foreground === '#ffffff' ? 'rgba(255,255,255,0.45)' : 'rgba(28,27,27,0.42)'}
                style={[s.statusTextInput, { color: foreground, fontSize: 29 * fontScale, lineHeight: 40 * fontScale }]}
                multiline
                textAlign={align}
                maxLength={700}
              />
              {!!song && (
                <View style={s.composerSongText}>
                  <SongCard song={song} tint={foreground} />
                  <Pressable onPress={() => setSong(null)} hitSlop={8} style={{ padding: 5 }}>
                    <Icon name="close" size={16} color={foreground} />
                  </Pressable>
                </View>
              )}
            </View>
          )}

          {mode !== 'choose' && overlays.length > 0 && (
            <View style={s.overlayChips}>
              {overlays.map((o) => (
                <View key={o.id || o.label} style={s.overlayChip}>
                  <Text style={[type.labelXs, { color: '#ffffff' }]}>
                    {o.kind === 'location' ? `📍 ${o.label}` : o.glyph}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {mode !== 'choose' && (
            <View style={s.toolRail}>
              {[
                { key: 'style', icon: 'color-palette-outline', label: 'Style' },
                { key: 'stickers', icon: 'happy-outline', label: 'Sticker' },
                { key: 'mention', icon: 'person-outline', label: 'Mention' },
                { key: 'location', icon: 'pin', label: 'Place' },
              ].map((item) => (
                <SpringPressable
                  key={item.key}
                  onPress={() => setTool((cur) => (cur === item.key ? null : item.key))}
                  style={[s.toolBtn, tool === item.key && { backgroundColor: 'rgba(255,255,255,0.16)' }]}
                  scaleTo={motion.scale.chip}
                  haptic="selection"
                >
                  <Icon name={item.icon} size={16} color={foreground} />
                  <Text style={[type.labelXs, { color: foreground, opacity: 0.8 }]}>{item.label}</Text>
                </SpringPressable>
              ))}
              <SpringPressable
                onPress={() => setBody((prev) => `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}#`)}
                style={s.toolBtn}
                scaleTo={motion.scale.chip}
                haptic="selection"
              >
                <Text style={[type.labelXs, { color: foreground }]}># Tag</Text>
              </SpringPressable>
            </View>
          )}

          {tool === 'stickers' && (
            <View style={s.stickerSheet}>
              {STICKERS.map((st) => (
                <SpringPressable key={st.id} onPress={() => addSticker(st)} style={s.stickerCell} scaleTo={0.9} haptic="selection">
                  <Text style={{ fontSize: 28 }}>{st.glyph}</Text>
                </SpringPressable>
              ))}
            </View>
          )}
          {tool === 'style' && mode === 'text' && (
            <View style={s.styleSheet}>
              <SpringPressable onPress={cycleBackground} style={s.styleChip} scaleTo={motion.scale.chip}>
                <Text style={[type.labelXs, { color: foreground }]}>BG</Text>
              </SpringPressable>
              <SpringPressable
                onPress={() => setAlign((a) => TEXT_ALIGNS[(TEXT_ALIGNS.indexOf(a) + 1) % TEXT_ALIGNS.length])}
                style={s.styleChip}
                scaleTo={motion.scale.chip}
              >
                <Text style={[type.labelXs, { color: foreground }]}>{align.toUpperCase()}</Text>
              </SpringPressable>
              <SpringPressable
                onPress={() => setFontScale((n) => (n >= 1.35 ? 0.85 : +(n + 0.15).toFixed(2)))}
                style={s.styleChip}
                scaleTo={motion.scale.chip}
              >
                <Text style={[type.labelXs, { color: foreground }]}>Aa</Text>
              </SpringPressable>
            </View>
          )}
          {tool === 'mention' && (
            <View style={s.mentionSheet}>
              <TextInput
                autoFocus
                value={mentionQ}
                onChangeText={setMentionQ}
                placeholder="@username"
                placeholderTextColor="rgba(255,255,255,0.45)"
                style={s.mentionInput}
              />
              {mentionHits.map((u) => (
                <Pressable key={u.id} onPress={() => addMention(u)} style={s.mentionHit}>
                  <Avatar uri={u.avatar} name={u.name} id={u.id} size={26} />
                  <Text style={[type.bodySm, { color: '#ffffff' }]}>@{u.username || u.name}</Text>
                </Pressable>
              ))}
            </View>
          )}
          {tool === 'location' && (
            <View style={s.mentionSheet}>
              <TextInput
                value={locationLabel}
                onChangeText={setLocationLabel}
                placeholder="City name (no exact pin)"
                placeholderTextColor="rgba(255,255,255,0.45)"
                style={s.mentionInput}
              />
              <SpringPressable onPress={applyLocation} style={s.locGo} scaleTo={motion.scale.chip} haptic="selection">
                <Text style={[type.labelSm, { color: '#050505' }]}>ADD PLACE</Text>
              </SpringPressable>
            </View>
          )}

          {mode !== 'choose' && (
            <View style={s.composerFooter}>
              {!!error && (
                <View style={s.errorRow}>
                  <Icon name="alert-circle" size={14} color={mode === 'photo' ? '#ffb4ab' : theme.danger} />
                  <Text style={[type.bodySm, { color: mode === 'photo' ? '#ffb4ab' : theme.danger, flex: 1 }]}>{error}</Text>
                </View>
              )}
              <View style={s.sendRow}>
                <SpringPressable
                  onPress={() => setPrivacyOpen(true)}
                  style={({ pressed }) => [s.privacyPill, pressed && { backgroundColor: 'rgba(255,255,255,0.18)' }]}
                  scaleTo={motion.scale.row}
                  haptic="selection"
                >
                  <Icon name={meta.icon} size={16} color="#ffffff" />
                  <Text style={[type.labelSm, { color: '#ffffff', flexShrink: 1 }]} numberOfLines={1}>{meta.label}</Text>
                  <Icon name="chevron-down-outline" size={14} color="#ffffff" />
                </SpringPressable>
                <SpringPressable
                  onPress={submit}
                  disabled={posting}
                  android_ripple={rippleFor(theme, { borderless: false, radius: 30 })}
                  style={({ pressed }) => [s.sendButton, pressed && Platform.OS !== 'android' && { opacity: 0.82 }, posting && { opacity: 0.55 }]}
                  scaleTo={motion.scale.row}
                  haptic="selection"
                >
                  {posting ? <ActivityIndicator color="#050505" /> : <Icon name="send" size={21} color="#050505" />}
                </SpringPressable>
              </View>
            </View>
          )}
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={privacyOpen} transparent animationType="slide" onRequestClose={() => setPrivacyOpen(false)}>
        <View style={[s.privacyOverlay, { backgroundColor: 'transparent' }]}>
          <FrostedBackdrop />
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setPrivacyOpen(false)} />
          <View style={[s.privacySheet, raised(theme, 2), { backgroundColor: theme.bg, borderColor: theme.ink, paddingBottom: Math.max(insets.bottom, 20) }]}>
            <View style={s.privacyHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[type.headlineMd, { color: theme.text }]}>Status privacy</Text>
                <Text style={[type.bodySm, { color: theme.subtext, marginTop: 3 }]}>Who can see this update?</Text>
              </View>
              <Pressable onPress={() => setPrivacyOpen(false)} hitSlop={9} style={{ padding: 5 }}>
                <Icon name="close" size={22} color={theme.ink} />
              </Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 8 }}>
              <AudiencePicker
                audience={audience}
                onChange={(next) => {
                  if (next !== audience) setRecipientIds([]);
                  setAudience(next);
                  setError('');
                }}
                recipientIds={recipientIds}
                onChangeRecipients={setRecipientIds}
                options={STATUS_AUDIENCES}
                layout="list"
                contactsOnly
              />
            </ScrollView>
            <Pressable onPress={() => setPrivacyOpen(false)} style={[s.privacyDone, { backgroundColor: '#050505' }]}>
              <Icon name="checkmark" size={17} color="#ffffff" />
              <Text style={[type.bodyStrong, { color: '#ffffff' }]}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <UniversalImageEditor
        visible={cropPicker}
        source={editUri}
        pickOnOpen={!editUri}
        config={editorConfigFor('story')}
        onCancel={() => { setCropPicker(false); setEditUri(null); }}
        onDone={(result) => { setImage(result); setMode('photo'); setCropPicker(false); setEditUri(null); setError(''); }}
      />
      <SongPicker
        visible={songPicker}
        onClose={() => setSongPicker(false)}
        onSelect={(track) => { setSong(track); setSongPicker(false); }}
      />
    </>
  );
}

const makeStyles = (t) => StyleSheet.create({
  /* story ring strip */
  storiesWrap: { marginTop: 14 },
  statusHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  statusAddBtn: { width: 32, height: 32, borderWidth: 1.5, borderColor: t.ink, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  heroCard: { borderWidth: 2, borderRadius: 14, overflow: 'hidden' },
  heroInner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  heroCta: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999 },
  cardRow: { flexDirection: 'row', gap: 10, paddingBottom: 4 },
  personCard: { width: 132, borderWidth: 1.5, borderRadius: 12, overflow: 'hidden' },
  personPreview: { height: 148 },
  personMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 8 },
  storiesRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 2 },
  circleCol: { alignItems: 'center', width: 70 },
  circlePress: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  ring: { width: 68, height: 68, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  ringNew: { borderWidth: 3, borderColor: t.ink },
  ringSeen: { borderWidth: 2, borderColor: t.graphiteLine },
  ringMine: { borderWidth: 3, borderColor: t.ink },
  ringEmpty: { borderWidth: 2, borderColor: t.ink, borderStyle: 'dashed' },
  plusBadge: {
    position: 'absolute', right: -1, bottom: -1, width: 22, height: 22,
    borderRadius: radius.full, borderWidth: 2, alignItems: 'center', justifyContent: 'center',
  },

  viewer: { flex: 1 },
  tapZones: { ...StyleSheet.absoluteFillObject, flexDirection: 'row', zIndex: 1 },
  progressRow: { flexDirection: 'row', gap: 5, paddingHorizontal: 14, marginBottom: 12, zIndex: 3 },
  progressBar: { flex: 1, height: 3, borderRadius: 3 },
  viewerHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, zIndex: 3 },
  viewerBody: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22, paddingVertical: 20, zIndex: 2 },
  viewerText: { ...type.headlineMd, fontSize: 28, lineHeight: 39, textAlign: 'center', maxWidth: 680 },
  viewerImageFrame: { maxWidth: 720, maxHeight: '72%', overflow: 'hidden', backgroundColor: '#111111' },
  viewerSong: { marginTop: 18, width: '100%', maxWidth: 360 },
  viewerCaption: { maxWidth: 620, marginTop: 15, paddingHorizontal: 18, paddingVertical: 11, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.58)' },

  composer: { flex: 1 },
  composerTopBar: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, zIndex: 4 },
  composerIconButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  composerTools: { minWidth: 42, flexDirection: 'row', justifyContent: 'flex-end' },
  chooseStage: { flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center', justifyContent: 'center', padding: 24 },
  chooseCard: { flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 2, borderRadius: 12, padding: 16, marginBottom: 14 },
  chooseIcon: { width: 46, height: 46, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  photoStage: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, paddingBottom: 4 },
  composerImageFrame: { flexShrink: 1, maxWidth: 720, maxHeight: '68%', overflow: 'hidden', backgroundColor: '#111111' },
  editCropButton: { position: 'absolute', right: 10, top: 10, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.72)' },
  emptyPhoto: { minWidth: 260, alignItems: 'center', padding: 32, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.38)', borderRadius: 12 },
  captionBar: { width: '100%', maxWidth: 680, marginTop: 14, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 16 },
  captionInput: { ...type.bodyMd, color: '#ffffff', minHeight: 46, maxHeight: 92, paddingVertical: 11, outlineStyle: 'none' },
  textStage: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  statusTextInput: { ...type.headlineMd, fontSize: 29, lineHeight: 40, width: '100%', maxWidth: 680, maxHeight: '65%', outlineStyle: 'none' },
  composerSongDark: { width: '100%', maxWidth: 420, flexDirection: 'row', alignItems: 'center', marginTop: 12, backgroundColor: 'rgba(0,0,0,0.32)', borderRadius: 8 },
  composerSongText: { width: '100%', maxWidth: 420, flexDirection: 'row', alignItems: 'center', marginTop: 20 },
  composerFooter: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 7, width: '100%', maxWidth: 680, alignSelf: 'center', marginBottom: 8 },
  sendRow: { width: '100%', maxWidth: 680, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 12 },
  privacyPill: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 14, borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.68)' },
  sendButton: { width: 56, height: 56, borderRadius: radius.full, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },

  privacyOverlay: { flex: 1, justifyContent: 'flex-end' },
  privacySheet: { position: 'relative', maxHeight: '88%', borderTopWidth: 3, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingHorizontal: 18, paddingTop: 18 },
  privacyHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  privacyDone: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 8, marginTop: 10 },

  replyBarWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 14, paddingTop: 12, zIndex: 5, backgroundColor: 'rgba(0,0,0,0.18)' },
  replyBar: { width: '100%', maxWidth: 680, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.96)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.08)' },
  replyInput: { flex: 1, ...type.bodyMd, color: '#1c1b1b', paddingVertical: 6, outlineStyle: 'none' },
  replySend: { width: 38, height: 38, borderRadius: radius.full, backgroundColor: '#FFE24D', borderWidth: 2, borderColor: '#1c1b1b', alignItems: 'center', justifyContent: 'center' },
  replyHintWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 10, zIndex: 4, alignItems: 'center' },
});
