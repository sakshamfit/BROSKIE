import React from 'react';
import { View, Text, Pressable, Image, StyleSheet } from 'react-native';
import Icon from '../icons/Icon';
import { EmojiText } from '../icons/Emoji';
import { mediaUrl } from '../api';
import { useTheme } from '../store/ThemeContext';
import { Avatar, TapeChip, handleFor, formatChatTime, GoldTick, hasGoldTick } from './common';
import { AUDIENCE } from './AudiencePicker';
import SongCard from './SongCard';
import DoubleTapLike from './DoubleTapLike';
import { openProfile } from '../push/routing';
import { type, inkBox, marker, dashedRule, raised } from '../theme';

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
export default function PostCard({
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={post.following ? `Unfollow ${post.author.name}` : `Follow ${post.author.name}`}
            onPress={() => onToggleFollow(post)}
            hitSlop={6}
            style={({ pressed }) => [
              s.followBtn,
              {
                borderColor: post.following ? theme.graphiteLine : theme.ink,
                backgroundColor: post.following ? 'transparent' : pressed ? theme.cardAlt : theme.cardAlt,
              },
            ]}
          >
            <Icon
              name={post.following ? 'checkmark' : 'person-add-outline'}
              size={12}
              color={post.following ? theme.muted : theme.ink}
            />
            <Text style={[type.labelXs, { color: post.following ? theme.muted : theme.ink }]}>
              {post.following ? 'FOLLOWING' : 'FOLLOW'}
            </Text>
          </Pressable>
        )}
        {post.mine && !!onDelete && (
          <Pressable onPress={() => onDelete(post)} hitSlop={8} style={{ padding: 4 }}>
            <Icon name="trash-outline" size={16} color={theme.muted} />
          </Pressable>
        )}
      </View>

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

      {!!post.song && (
        <View style={{ marginTop: 12 }}>
          <SongCard song={post.song} compact />
        </View>
      )}

      {!!post.tag && (
        <View style={{ marginTop: 12, alignSelf: 'flex-start' }}>
          <Pressable onPress={onTagPress ? () => onTagPress(post.tag) : undefined} disabled={!onTagPress}>
            <TapeChip label={`#${post.tag}`} tone={post.tag === activeTag ? 'accent' : 'ink'} />
          </Pressable>
        </View>
      )}

      <View style={[dashedRule(theme), { marginTop: 16, marginBottom: 12 }]} />

      <View style={s.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={post.liked ? 'Unlike' : 'Like'}
          onPress={() => onToggleLike?.(post)}
          style={({ pressed }) => [s.action, pressed && { transform: [{ scale: 1.12 }] }]}
          hitSlop={8}
        >
          <Icon name={post.liked ? 'heart' : 'heart-outline'} size={24} color={post.liked ? INSTAGRAM_HEART : theme.ink} />
          {post.likes > 0 && (
            <Text style={[type.labelSm, { color: post.liked ? INSTAGRAM_HEART : theme.ink }]}>{post.likes}</Text>
          )}
        </Pressable>
        <Pressable
          onPress={onOpenComments ? () => onOpenComments(post) : undefined}
          disabled={!onOpenComments}
          style={({ pressed }) => [s.action, pressed && marker(theme, 1)]}
          hitSlop={6}
        >
          <Icon name="chatbubble-outline" size={16} color={theme.graphite} />
          <Text style={[type.labelSm, { color: theme.graphite }]}>{post.comments}</Text>
        </Pressable>
      </View>
    </DoubleTapLike>
  );
}

const makeStyles = (t) => StyleSheet.create({
  note: {
    padding: 18, marginBottom: 22, borderWidth: 1, borderColor: t.graphiteLine,
    borderTopLeftRadius: 2, borderTopRightRadius: 5, borderBottomRightRadius: 2, borderBottomLeftRadius: 4,
  },
  noteHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  noteImage: { marginTop: 14, overflow: 'hidden', alignSelf: 'center' },
  actions: { flexDirection: 'row', gap: 22 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 2, paddingHorizontal: 2 },
  followBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5,
    alignSelf: 'flex-start', marginLeft: 8,
  },
});
