import React from 'react';
import { View, Pressable, Image, StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withSequence, withDelay } from 'react-native-reanimated';
import Icon from '../icons/Icon';
import { EmojiText } from '../icons/Emoji';
import { mediaUrl } from '../api';
import { useTheme } from '../store/ThemeContext';
import { Avatar, TapeChip, handleFor, formatChatTime, GoldTick, hasGoldTick } from './common';
import { AUDIENCE } from './AudiencePicker';
import SongCard from './SongCard';
import DoubleTapLike from './DoubleTapLike';
import { openProfile } from '../push/routing';
import { SpringPressable, IconSwap, Bloom, Pop, motion, haptic } from '../motion';
import { type, inkBox, dashedRule, raised } from '../theme';
import { Text } from './Text';

const INSTAGRAM_HEART = '#ED4956';

/* Sticky notes alternate their tilt, like scraps pinned to a board. */
const tiltFor = (i) => (i % 2 === 0 ? '-0.8deg' : '0.7deg');

/**
 * One post, drawn as a pinned sticky note. Shared by the Network feed, the
 * profile page, and the single-post detail screen so liking behaves the
 * same everywhere:
 *   - double-tap anywhere on the card (or the photo) to like, with the
 *     Instagram heart burst;
 *   - tapping the author's avatar circle opens their profile.
 */
const PostCard = React.memo(function PostCard({
  post,
  index = 0,
  tilted = true,
  onToggleLike,
  onOpenComments,
  onToggleFollow,
  onDelete,
  onTagPress,
  activeTag = null,
  onOpenImage,
  showFollow = true,
  playbackActive = false,
}) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const audienceMeta = AUDIENCE[post.audience] || AUDIENCE.public;

  const likeFromDoubleTap = () => {
    // Instagram semantics: a double tap only ever likes — it never unlikes.
    if (!post.liked) onToggleLike?.(post);
  };

  return (
    <DoubleTapLike
      onDoubleTap={likeFromDoubleTap}
      style={[
        s.note,
        raised(theme, 1),
        tilted && { transform: [{ rotate: tiltFor(index) }] },
        { backgroundColor: index % 2 ? theme.cardAlt : theme.card },
      ]}
    >
      <View style={s.noteHead}>
        <Avatar uri={post.author.avatar} name={post.author.name} id={post.author.id} size={38} profileId={post.author.id} />
        <Pressable style={{ flex: 1 }} onPress={() => openProfile(post.author.id)}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Text style={[type.labelSm, { color: theme.ink, flexShrink: 1 }]} numberOfLines={1}>
              {handleFor(post.author)}
            </Text>
            {hasGoldTick(post.author) && <GoldTick size={13} />}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 }}>
            <Icon name={audienceMeta.icon} size={11} color={theme.muted} />
            <Text style={[type.labelXs, { color: theme.muted }]}>
              {formatChatTime(post.createdAt)} · {audienceMeta.label}
            </Text>
          </View>
        </Pressable>
        {showFollow && !post.mine && typeof post.following === 'boolean' && !!onToggleFollow && (
          <SpringPressable
            accessibilityRole="button"
            accessibilityLabel={post.following ? `Unfollow ${post.author.name}` : `Follow ${post.author.name}`}
            onPress={() => { haptic(post.following ? 'selection' : 'success'); onToggleFollow(post); }}
            scaleTo={motion.scale.chip}
            hitSlop={8}
            style={[
              s.followBtn,
              {
                borderColor: post.following ? theme.graphiteLine : theme.ink,
                backgroundColor: post.following ? 'transparent' : theme.cardAlt,
              },
            ]}
          >
            {/* the icon turns over (add → check) instead of being swapped out,
                so following someone reads as a state settling, not a redraw */}
            <View style={s.followInner}>
              <IconSwap
                active={post.following}
                size={12}
                spin={45}
                on={<Icon name="checkmark" size={12} color={theme.muted} />}
                off={<Icon name="person-add-outline" size={12} color={theme.ink} />}
              />
              <Text style={[type.labelXs, { color: post.following ? theme.muted : theme.ink }]}>
                {post.following ? 'FOLLOWING' : 'FOLLOW'}
              </Text>
            </View>
          </SpringPressable>
        )}
        {post.mine && !!onDelete && (
          <SpringPressable
            accessibilityRole="button"
            accessibilityLabel="Delete post"
            onPress={() => onDelete(post)}
            scaleTo={motion.scale.icon}
            haptic="warning"
            hitSlop={8}
            style={{ padding: 4 }}
          >
            <Icon name="trash-outline" size={16} color={theme.muted} />
          </SpringPressable>
        )}
      </View>

      {/* Instagram-style: the song rides with the username in the card header,
          aligned under the handle — never floating over the photo. */}
      {!!post.song && !!post.mediaUrl && (
        <View style={s.songInHeader}>
          <SongCard song={post.song} variant="sticker" autoPlay={playbackActive} />
        </View>
      )}

      {!!post.title && (
        <EmojiText style={[type.headlineSm, { color: theme.text, marginTop: 12 }]}>{post.title}</EmojiText>
      )}
      {!!post.body && (
        <EmojiText style={[type.bodyMd, { color: theme.text, marginTop: post.title ? 6 : 12 }]}>
          {post.body}
        </EmojiText>
      )}

      {!!post.mediaUrl && (
        <DoubleTapLike
          onDoubleTap={likeFromDoubleTap}
          onSingleTap={onOpenImage ? () => onOpenImage(mediaUrl(post.mediaUrl)) : undefined}
          heartSize={96}
          style={[
            s.noteImage,
            inkBox(theme, 'ink'),
            {
              aspectRatio: post.mediaAspect || 16 / 9,
              width: (post.mediaAspect || 16 / 9) < 0.7 ? '62%' : (post.mediaAspect || 16 / 9) < 1 ? '80%' : '100%',
            },
          ]}
        >
          <Image source={{ uri: mediaUrl(post.mediaUrl) }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        </DoubleTapLike>
      )}

      {!!post.song && !post.mediaUrl && (
        <View style={[s.songOnly, inkBox(theme, 'thin')]}>
          {(post.song.artwork || post.song.albumArt) ? (
            <Image source={{ uri: post.song.artwork || post.song.albumArt }} style={StyleSheet.absoluteFill} blurRadius={18} />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.cardAlt }]} />
          )}
          <View style={s.songOnlyScrim} />
          <SongCard song={post.song} variant="sticker" autoPlay={playbackActive} />
        </View>
      )}

      {!!post.tag && (
        <View style={{ marginTop: 12, alignSelf: 'flex-start' }}>
          <SpringPressable
            onPress={onTagPress ? () => onTagPress(post.tag) : undefined}
            disabled={!onTagPress}
            scaleTo={motion.scale.chip}
            haptic={onTagPress ? 'selection' : undefined}
          >
            <TapeChip label={`#${post.tag}`} tone={post.tag === activeTag ? 'accent' : 'ink'} />
          </SpringPressable>
        </View>
      )}

      <View style={[dashedRule(theme), { marginTop: 16, marginBottom: 12 }]} />

      <View style={s.actions}>
        <LikeAction post={post} onToggleLike={onToggleLike} theme={theme} s={s} />
        <SpringPressable
          accessibilityRole="button"
          accessibilityLabel="Comments"
          onPress={onOpenComments ? () => onOpenComments(post) : undefined}
          disabled={!onOpenComments}
          scaleTo={motion.scale.chip}
          haptic="selection"
          style={s.action}
          hitSlop={8}
        >
          <View style={s.actionInner}>
            <Icon name="chatbubble-outline" size={16} color={theme.graphite} />
            <Text style={[type.labelSm, { color: theme.graphite }]}>{post.comments}</Text>
          </View>
        </SpringPressable>
      </View>
    </DoubleTapLike>
  );
});

export default PostCard;

/**
 * The like control. Three things happen on one tap, all native driven:
 *   - the button compresses and springs back (the finger is answered),
 *   - the heart morphs outline → filled with a pop (the state changed),
 *   - a ring blooms outward once (the energy of the action).
 * Un-liking gets the morph but no bloom and no impact haptic — taking
 * something back should feel quieter than giving it.
 */
function LikeAction({ post, onToggleLike, theme, s }) {
  const liked = !!post.liked;
  const scale = useSharedValue(1);
  const colorValue = useSharedValue(liked ? 1 : 0);

  const animatedScale = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const animatedColor = useAnimatedStyle(() => ({
    opacity: colorValue.value,
  }));

  const handlePress = () => {
    haptic(liked ? 'selection' : 'impact');
    // Native-thread sequence: bounce up, hold briefly, spring back — smooth on all devices
    scale.value = withSequence(
      withSpring(1.3, { damping: 12, stiffness: 300, mass: 0.7 }),
      withDelay(100, withSpring(1, { damping: 15, stiffness: 320, mass: 0.75 }))
    );
    colorValue.value = withSpring(liked ? 0 : 1, { damping: 15, stiffness: 320, mass: 0.75 });
    onToggleLike?.(post);
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={liked ? 'Unlike' : 'Like'}
      onPress={handlePress}
      onPressIn={() => { scale.value = 0.88; }}
      onPressOut={() => { scale.value = 1; }}
      style={s.action}
      hitSlop={10}
    >
      <Animated.View style={[animatedScale, { alignItems: 'center', justifyContent: 'center' }]}>
        <View style={s.actionInner}>
          <View style={{ alignItems: 'center', justifyContent: 'center' }}>
            <Animated.View style={[animatedColor, { position: 'absolute' }]}>
              <Icon name="heart" size={24} color={INSTAGRAM_HEART} />
            </Animated.View>
            <IconSwap
              active={liked}
              size={24}
              on={<Icon name="heart" size={24} color={INSTAGRAM_HEART} />}
              off={<Icon name="heart-outline" size={24} color={theme.ink} />}
            />
          </View>
          {post.likes > 0 && (
            <Pop trigger={post.likes} firstStatic from={0.6}>
              <Text style={[type.labelSm, { color: liked ? INSTAGRAM_HEART : theme.ink }]}>{post.likes}</Text>
            </Pop>
          )}
        </View>
      </Animated.View>
    </Pressable>
  );
}

const makeStyles = (t) => StyleSheet.create({
  note: {
    padding: 18, marginBottom: 22, borderWidth: 1, borderColor: t.graphiteLine,
    borderTopLeftRadius: 2, borderTopRightRadius: 5, borderBottomRightRadius: 2, borderBottomLeftRadius: 4,
    overflow: 'hidden',
  },
  noteHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  noteImage: { marginTop: 14, overflow: 'hidden', alignSelf: 'center', backgroundColor: t.cardAlt },
  // avatar (38) + noteHead gap (12) — lines the chip up under the handle
  songInHeader: { marginTop: 8, marginLeft: 50, alignSelf: 'flex-start', maxWidth: '100%' },
  songOnly: {
    marginTop: 14, minHeight: 168, justifyContent: 'flex-end', padding: 12,
    overflow: 'hidden', position: 'relative', backgroundColor: t.cardAlt,
  },
  songOnlyScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.28)' },
  actions: { flexDirection: 'row', gap: 22 },
  action: { paddingVertical: 2, paddingHorizontal: 2 },
  actionInner: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  followBtn: {
    borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5,
    alignSelf: 'flex-start', marginLeft: 8,
  },
  followInner: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
