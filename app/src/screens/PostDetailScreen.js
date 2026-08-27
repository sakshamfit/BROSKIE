import React, { useCallback, useEffect, useState } from 'react';
import {
  View, FlatList, Pressable, StyleSheet,
  ActivityIndicator, Platform, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../icons/Icon';
import { EmojiText } from '../icons/Emoji';
import { api } from '../api';
import { useChatActions } from '../store/ChatContext';
import { useTheme } from '../store/ThemeContext';
import { confirm } from '../hooks/confirm';
import PostCard from '../components/PostCard';
import { Avatar, EmptyState, handleFor, formatChatTime, GoldTick, hasGoldTick } from '../components/common';
import ImageLightbox from '../components/ImageLightbox';
import { stopPreview } from '../previewPlayer';
import { type, inkBox, stroke } from '../theme';
import { SpringPressable, motion } from '../motion';
import { Text } from '../components/Text';
import ChatInput from '../components/ChatInput';

/**
 * One post, full screen — the destination when you tap a "liked your post" /
 * "commented on your post" activity row, or a post push notification.
 * Double-tap the card (or its photo) to like, comment inline below.
 */
export default function PostDetailScreen({ navigation, route, embedded = false }) {
  const postId = route?.params?.postId;
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { onPostEvent } = useChatActions();
  const [post, setPost] = useState(null);
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const s = makeStyles(theme);

  const load = useCallback(async () => {
    if (!postId) return;
    setLoading(true);
    setError('');
    try {
      const [{ post: p }, { comments: list }] = await Promise.all([
        api.post(postId),
        api.comments(postId),
      ]);
      setPost(p);
      setComments(list || []);
    } catch (e) {
      setError(e?.status === 404 ? 'This post is no longer available.' : (e.message || 'Could not load the post.'));
    } finally {
      setLoading(false);
    }
  }, [postId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => () => stopPreview(), []);

  /* live counts while the post is open */
  useEffect(() => {
    if (!onPostEvent) return undefined;
    return onPostEvent((ev, payload) => {
      if (!payload || payload.id !== postId) return;
      if (ev === 'post:likes') setPost((prev) => (prev ? { ...prev, likes: payload.likes } : prev));
      else if (ev === 'post:comments') setPost((prev) => (prev ? { ...prev, comments: payload.comments } : prev));
      else if (ev === 'post:deleted') setError('This post is no longer available.');
    });
  }, [onPostEvent, postId]);

  const toggleLike = async (p) => {
    setPost((prev) => (prev ? { ...prev, liked: !prev.liked, likes: prev.likes + (prev.liked ? -1 : 1) } : prev));
    try {
      const r = await api.likePost(p.id);
      setPost((prev) => (prev ? { ...prev, liked: r.liked, likes: r.likes } : prev));
    } catch {
      setPost((prev) => (prev ? { ...prev, liked: p.liked, likes: p.likes } : prev));
    }
  };

  const toggleFollow = async (p) => {
    if (p.mine || typeof p.following !== 'boolean') return;
    const next = !p.following;
    setPost((prev) => (prev ? { ...prev, following: next } : prev));
    try {
      if (next) await api.follow(p.userId);
      else await api.unfollow(p.userId);
    } catch {
      setPost((prev) => (prev ? { ...prev, following: !next } : prev));
    }
  };

  const removePost = async (p) => {
    const ok = await confirm('Tear up this post?', { title: 'Delete post', confirmLabel: 'Delete', destructive: true });
    if (!ok) return;
    try {
      await api.deletePost(p.id);
      navigation?.goBack?.();
    } catch (e) {
      setError(e.message || 'Could not delete the post.');
    }
  };

  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const { comment } = await api.addComment(postId, body);
      setComments((prev) => [...prev, comment]);
      setPost((prev) => (prev ? { ...prev, comments: (prev.comments || 0) + 1 } : prev));
      setText('');
    } catch {} finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: 'transparent' }}>
      <View style={[s.header, !embedded && { paddingTop: 14 + insets.top }]}>
        <Pressable onPress={() => navigation?.goBack?.()} hitSlop={9} style={{ padding: 6 }}>
          <Icon name="arrow-back" size={22} color={theme.ink} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[type.headlineMd, { color: theme.text }]}>Post</Text>
          {!!post && (
            <Text style={[type.labelXs, { color: theme.muted, marginTop: 3 }]} numberOfLines={1}>
              BY {handleFor(post.author).toUpperCase()}
            </Text>
          )}
        </View>
        <Icon name="document-outline" size={22} color={theme.ink} />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={theme.ink} />
      ) : error ? (
        <EmptyState icon="document-outline" title="Post unavailable" subtitle={error} />
      ) : post ? (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <FlatList
            data={comments}
            keyExtractor={(c) => c.id}
            contentContainerStyle={s.list}
            ListHeaderComponent={
              <View>
                <PostCard
                  post={post}
                  index={0}
                  tilted={false}
                  onToggleLike={toggleLike}
                  onToggleFollow={toggleFollow}
                  onDelete={removePost}
                  onOpenImage={setLightbox}
                  playbackActive
                />
                <Text style={[type.labelXs, { color: theme.muted, marginBottom: 10 }]}>
                  {post.comments === 1 ? '1 COMMENT' : `${post.comments || 0} COMMENTS`}
                </Text>
              </View>
            }
            ListEmptyComponent={
              <Text style={[type.bodySm, { color: theme.muted, textAlign: 'center', paddingVertical: 26 }]}>
                No comments yet — say the first thing.
              </Text>
            }
            renderItem={({ item }) => (
              <View style={s.comment}>
                <Avatar uri={item.author.avatar} name={item.author.name} id={item.author.id} size={32} profileId={item.author.id} />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={[type.labelXs, { color: theme.ink }]}>{handleFor(item.author)}</Text>
                    {hasGoldTick(item.author) && <GoldTick size={11} />}
                    <Text style={[type.labelXs, { color: theme.muted, fontSize: 9 }]}>{formatChatTime(item.createdAt)}</Text>
                  </View>
                  <EmojiText style={[type.bodySm, { color: theme.text, marginTop: 3 }]}>{item.body}</EmojiText>
                </View>
              </View>
            )}
          />

          <ChatInput
            size="comment"
            value={text}
            onChangeText={setText}
            placeholder="Add a comment…"
            onSubmit={send}
            style={[s.commentBar, { paddingBottom: Math.max(insets.bottom, 12) }]}
            send={
              <SpringPressable
                accessibilityRole="button"
                accessibilityLabel="Post comment"
                onPress={send}
                disabled={busy || !text.trim()}
                style={({ pressed }) => [
                  s.commentSend,
                  inkBox(theme, 'ink'),
                  { backgroundColor: pressed ? theme.highlighter : theme.ink },
                  (busy || !text.trim()) && { opacity: 0.4 },
                ]}
                scaleTo={motion.scale.row}
                haptic="selection"
              >
                <Icon name="send" size={15} color={theme.onPrimary} />
              </SpringPressable>
            }
          />
        </KeyboardAvoidingView>
      ) : null}

      {/* shared viewer: springs open, drag it away in any vertical
          direction, backdrop fades with the finger */}
      <ImageLightbox uri={lightbox} onClose={() => setLightbox(null)} />
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 13,
    paddingHorizontal: 18, paddingVertical: 14,
    borderBottomWidth: stroke.ink, borderBottomColor: t.ink,
  },
  list: { width: '100%', maxWidth: 640, alignSelf: 'center', paddingHorizontal: 18, paddingTop: 18, paddingBottom: 24 },
  comment: { flexDirection: 'row', gap: 12, paddingVertical: 10, width: '100%', maxWidth: 640, alignSelf: 'center' },
  // The row layout, the 640dp content cap and the field box now come from
  // components/ChatInput; this is only the chrome drawn around it, kept at
  // the same 18dp gutter as the comment list above.
  commentBar: {
    borderTopWidth: 1, borderTopColor: t.graphiteLine,
    paddingTop: 10, paddingHorizontal: 18,
  },
  // 44×44 is the smallest tap target Apple's HIG allows, and it matches the
  // 44dp comment field sitting next to it.
  commentSend: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
