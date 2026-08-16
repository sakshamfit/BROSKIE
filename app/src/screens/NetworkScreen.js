import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, TextInput, Pressable, StyleSheet, Image,
  ActivityIndicator, RefreshControl, Modal, Platform, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../icons/Icon';
import Emoji, { EmojiText } from '../icons/Emoji';
import * as ImagePicker from 'expo-image-picker';
import { api, mediaUrl } from '../api';
import { useAuth } from '../store/AuthContext';
import { useChat } from '../store/ChatContext';
import { useTheme } from '../store/ThemeContext';
import { Avatar, EmptyState, TapeChip, Rule, handleFor, formatChatTime, rippleFor } from '../components/common';
import { type, inkBox, marker, dashedRule, stroke, radius } from '../theme';
import useResponsive from '../hooks/useResponsive';
import { confirm } from '../hooks/confirm';

/* Sticky notes alternate their tilt, like scraps pinned to a board. */
const tiltFor = (i) => (i % 2 === 0 ? '-0.8deg' : '0.7deg');

export default function NetworkScreen() {
  const { user } = useAuth();
  const { onPostEvent } = useChat();
  const { theme } = useTheme();
  const { isTablet } = useResponsive();

  const [posts, setPosts] = useState([]);
  const [tags, setTags] = useState([]);
  const [activeTag, setActiveTag] = useState(null);
  const [nextBefore, setNextBefore] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [draft, setDraft] = useState('');
  const [draftTag, setDraftTag] = useState('');
  const [draftImage, setDraftImage] = useState(null);
  const [showTagInput, setShowTagInput] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');

  const [commentsFor, setCommentsFor] = useState(null);
  const [lightbox, setLightbox] = useState(null);

  const s = makeStyles(theme);

  /* ---------------- data ---------------- */

  const load = useCallback(async (tag) => {
    const { posts: list, nextBefore: nb } = await api.posts({ tag: tag || undefined });
    setPosts(list);
    setNextBefore(nb);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await load(activeTag);
        setTags((await api.postTags()).tags);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [load, activeTag]);

  /* live updates from other users */
  useEffect(() => {
    if (!onPostEvent) return;
    return onPostEvent((ev, payload) => {
      if (ev === 'post:new') {
        setPosts((prev) => {
          if (prev.some((p) => p.id === payload.id)) return prev;
          if (activeTag && payload.tag !== activeTag) return prev;
          return [{ ...payload, mine: payload.userId === user?.id }, ...prev];
        });
      } else if (ev === 'post:deleted') {
        setPosts((prev) => prev.filter((p) => p.id !== payload.id));
      } else if (ev === 'post:likes') {
        setPosts((prev) => prev.map((p) => (p.id === payload.id ? { ...p, likes: payload.likes } : p)));
      } else if (ev === 'post:comments') {
        setPosts((prev) => prev.map((p) => (p.id === payload.id ? { ...p, comments: payload.comments } : p)));
      }
    });
  }, [onPostEvent, activeTag, user]);

  const onRefresh = async () => {
    setRefreshing(true);
    try { await load(activeTag); setTags((await api.postTags()).tags); }
    catch {} finally { setRefreshing(false); }
  };

  const loadMore = async () => {
    if (!nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const { posts: more, nextBefore: nb } = await api.posts({ before: nextBefore, tag: activeTag || undefined });
      setPosts((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...more.filter((p) => !seen.has(p.id))];
      });
      setNextBefore(nb);
    } catch {} finally { setLoadingMore(false); }
  };

  /* ---------------- actions ---------------- */

  const pickImage = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
      if (res.canceled || !res.assets?.length) return;
      setDraftImage(res.assets[0]);
    } catch (e) { setError(e.message); }
  };

  const submit = async () => {
    const body = draft.trim();
    if (!body && !draftImage) { setError('Scribble something first.'); return; }
    setPosting(true);
    setError('');
    try {
      let url = null;
      if (draftImage) {
        const up = await api.uploadFile(draftImage.uri, draftImage.fileName || 'post.jpg', draftImage.mimeType || 'image/jpeg');
        url = up.url;
      }
      const { post } = await api.createPost({ body, tag: draftTag.trim() || null, mediaUrl: url });
      setPosts((prev) => (prev.some((p) => p.id === post.id) ? prev : [post, ...prev]));
      setDraft(''); setDraftTag(''); setDraftImage(null); setShowTagInput(false);
      api.postTags().then((r) => setTags(r.tags)).catch(() => {});
    } catch (e) {
      setError(e.message);
    } finally {
      setPosting(false);
    }
  };

  const toggleLike = async (post) => {
    // optimistic
    setPosts((prev) => prev.map((p) =>
      p.id === post.id ? { ...p, liked: !p.liked, likes: p.likes + (p.liked ? -1 : 1) } : p));
    try {
      const r = await api.likePost(post.id);
      setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, liked: r.liked, likes: r.likes } : p)));
    } catch {
      setPosts((prev) => prev.map((p) =>
        p.id === post.id ? { ...p, liked: post.liked, likes: post.likes } : p));
    }
  };

  const removePost = async (post) => {
    const ok = await confirm('Tear up this post?', { title: 'Delete post', confirmLabel: 'Delete', destructive: true });
    if (!ok) return;
    setPosts((prev) => prev.filter((p) => p.id !== post.id));
    try { await api.deletePost(post.id); } catch { load(activeTag); }
  };

  /* ---------------- render ---------------- */

  const renderPost = ({ item, index }) => (
    <View style={[s.note, { transform: [{ rotate: tiltFor(index) }], backgroundColor: index % 2 ? theme.cardAlt : theme.card }]}>
      <View style={s.noteHead}>
        <Avatar uri={item.author.avatar} name={item.author.name} id={item.author.id} size={38} />
        <View style={{ flex: 1 }}>
          <Text style={[type.labelSm, { color: theme.ink }]} numberOfLines={1}>
            {handleFor(item.author)}
          </Text>
          <Text style={[type.labelXs, { color: theme.muted, marginTop: 3 }]}>
            {formatChatTime(item.createdAt)}
          </Text>
        </View>
        {item.mine && (
          <Pressable onPress={() => removePost(item)} hitSlop={8} style={{ padding: 4 }}>
            <Icon name="trash-outline" size={16} color={theme.muted} />
          </Pressable>
        )}
      </View>

      {!!item.title && (
        <EmojiText style={[type.headlineSm, { color: theme.text, marginTop: 12 }]}>{item.title}</EmojiText>
      )}
      {!!item.body && (
        <EmojiText style={[type.bodyMd, { color: theme.text, marginTop: item.title ? 6 : 12 }]}>
          {item.body}
        </EmojiText>
      )}

      {!!item.mediaUrl && (
        <Pressable onPress={() => setLightbox(mediaUrl(item.mediaUrl))} style={[s.noteImage, inkBox(theme, 'ink')]}>
          <Image source={{ uri: mediaUrl(item.mediaUrl) }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        </Pressable>
      )}

      {!!item.tag && (
        <View style={{ marginTop: 12, alignSelf: 'flex-start' }}>
          <Pressable onPress={() => setActiveTag(item.tag === activeTag ? null : item.tag)}>
            <TapeChip label={`#${item.tag}`} tone={item.tag === activeTag ? 'accent' : 'ink'} />
          </Pressable>
        </View>
      )}

      <View style={[dashedRule(theme), { marginTop: 16, marginBottom: 12 }]} />

      <View style={s.actions}>
        <Pressable onPress={() => toggleLike(item)} style={({ pressed }) => [s.action, pressed && marker(theme, 1)]} hitSlop={6}>
          <Icon name={item.liked ? 'heart' : 'heart-outline'} size={17} color={item.liked ? theme.ink : theme.graphite} />
          <Text style={[type.labelSm, { color: item.liked ? theme.ink : theme.graphite }]}>{item.likes}</Text>
        </Pressable>
        <Pressable onPress={() => setCommentsFor(item)} style={({ pressed }) => [s.action, pressed && marker(theme, 1)]} hitSlop={6}>
          <Icon name="chatbubble-outline" size={16} color={theme.graphite} />
          <Text style={[type.labelSm, { color: theme.graphite }]}>{item.comments}</Text>
        </Pressable>
      </View>
    </View>
  );

  const Composer = (
    <View style={s.composerWrap}>
      <Text style={s.pageTitle}>The Network</Text>
      <Text style={[type.labelXs, { color: theme.muted, marginBottom: 18 }]}>
        PUBLIC · EVERYONE CAN SEE THIS
      </Text>

      <View style={[s.composer, inkBox(theme, 'ink')]}>
        <TextInput
          style={s.composerInput}
          placeholder="Scribble a thought…"
          placeholderTextColor={theme.muted}
          value={draft}
          onChangeText={(v) => { setDraft(v); if (error) setError(''); }}
          multiline
          maxLength={2000}
        />

        {!!draftImage && (
          <View style={[s.draftImageWrap, inkBox(theme, 'thin')]}>
            <Image source={{ uri: draftImage.uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
            <Pressable onPress={() => setDraftImage(null)} style={[s.draftImageX, { backgroundColor: theme.ink }]}>
              <Icon name="close" size={13} color={theme.onPrimary} />
            </Pressable>
          </View>
        )}

        {showTagInput && (
          <View style={s.tagRow}>
            <Text style={[type.labelSm, { color: theme.graphite }]}>#</Text>
            <TextInput
              style={s.tagInput}
              placeholder="tag"
              placeholderTextColor={theme.muted}
              value={draftTag}
              onChangeText={setDraftTag}
              autoCapitalize="none"
              maxLength={24}
            />
          </View>
        )}

        <View style={[dashedRule(theme), { marginVertical: 12 }]} />

        <View style={s.composerBar}>
          <View style={{ flexDirection: 'row', gap: 16 }}>
            <Pressable onPress={pickImage} hitSlop={8}>
              <Icon name="image-outline" size={19} color={theme.graphite} />
            </Pressable>
            <Pressable onPress={() => setShowTagInput((v) => !v)} hitSlop={8}>
              <Icon name="pricetag-outline" size={18} color={showTagInput ? theme.ink : theme.graphite} />
            </Pressable>
          </View>
          <Pressable
            onPress={submit}
            disabled={posting}
            style={({ pressed }) => [s.postBtn, inkBox(theme, 'ink'), pressed ? marker(theme, 2) : null, posting && { opacity: 0.5 }]}
          >
            {posting
              ? <ActivityIndicator size="small" color={theme.ink} />
              : <Text style={[type.labelSm, { color: theme.ink }]}>POST</Text>}
          </Pressable>
        </View>
      </View>

      {!!error && (
        <View style={s.errorRow}>
          <Icon name="alert-circle" size={14} color={theme.danger} />
          <Text style={[type.bodySm, { color: theme.danger }]}>{error}</Text>
        </View>
      )}

      {tags.length > 0 && (
        <View style={s.tagsWrap}>
          <Pressable onPress={() => setActiveTag(null)}>
            <TapeChip label="ALL" tone={!activeTag ? 'accent' : 'ink'} />
          </Pressable>
          {tags.map((t) => (
            <Pressable key={t.tag} onPress={() => setActiveTag(t.tag === activeTag ? null : t.tag)}>
              <TapeChip label={`#${t.tag} ${t.count}`} tone={t.tag === activeTag ? 'accent' : 'ink'} />
            </Pressable>
          ))}
        </View>
      )}

      <Rule style={{ marginTop: 18, marginBottom: 4 }} />
    </View>
  );

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.ink} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <FlatList
        data={posts}
        keyExtractor={(i) => i.id}
        renderItem={renderPost}
        ListHeaderComponent={Composer}
        contentContainerStyle={[s.list, isTablet && s.listWide]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.ink} />}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          loadingMore ? <ActivityIndicator style={{ marginVertical: 24 }} color={theme.ink} />
            : posts.length > 0 && !nextBefore
              ? <Text style={[type.labelXs, { color: theme.muted, textAlign: 'center', marginVertical: 28 }]}>
                  END OF THE ROLL
                </Text>
              : null
        }
        ListEmptyComponent={
          <EmptyState
            icon="globe-outline"
            title={activeTag ? `Nothing tagged #${activeTag}` : 'Nothing pinned yet'}
            subtitle={activeTag ? 'Try another tag, or clear the filter.' : 'Be the first to scribble something for the world.'}
          />
        }
      />

      <CommentsSheet
        post={commentsFor}
        onClose={() => setCommentsFor(null)}
        onCounted={(id, n) => setPosts((prev) => prev.map((p) => (p.id === id ? { ...p, comments: n } : p)))}
      />

      <Modal visible={!!lightbox} transparent animationType="fade" onRequestClose={() => setLightbox(null)}>
        <Pressable style={s.lightbox} onPress={() => setLightbox(null)}>
          <Image source={{ uri: lightbox }} style={{ width: '92%', height: '78%' }} resizeMode="contain" />
        </Pressable>
      </Modal>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* comments                                                            */
/* ------------------------------------------------------------------ */

function CommentsSheet({ post, onClose, onCounted }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [list, setList] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const s = makeStyles(theme);

  useEffect(() => {
    if (!post) { setList([]); setText(''); return; }
    setLoading(true);
    api.comments(post.id)
      .then((r) => setList(r.comments))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [post]);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    try {
      const { comment } = await api.addComment(post.id, body);
      setList((prev) => [...prev, comment]);
      setText('');
      onCounted?.(post.id, list.length + 1);
    } catch {} finally { setBusy(false); }
  };

  return (
    <Modal visible={!!post} animationType="slide" transparent onRequestClose={onClose}>
      <View style={[s.sheetOverlay, { backgroundColor: theme.overlay }]}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[
            s.sheet,
            { backgroundColor: theme.bg, borderTopWidth: stroke.bold, borderTopColor: theme.ink, paddingBottom: Math.max(insets.bottom, 24) },
          ]}
        >
          <View style={s.sheetHead}>
            <Text style={[type.headlineSm, { color: theme.text, flex: 1 }]}>Comments</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Icon name="close" size={22} color={theme.ink} />
            </Pressable>
          </View>
          <Rule style={{ marginTop: 0, marginBottom: 8 }} />

          {loading ? (
            <ActivityIndicator style={{ marginVertical: 30 }} color={theme.ink} />
          ) : (
            <FlatList
              data={list}
              keyExtractor={(c) => c.id}
              style={{ maxHeight: 320 }}
              contentContainerStyle={{ paddingBottom: 8 }}
              ListEmptyComponent={
                <Text style={[type.bodySm, { color: theme.muted, textAlign: 'center', paddingVertical: 28 }]}>
                  No comments yet — say the first thing.
                </Text>
              }
              renderItem={({ item }) => (
                <View style={s.comment}>
                  <Avatar uri={item.author.avatar} name={item.author.name} id={item.author.id} size={30} />
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                      <Text style={[type.labelXs, { color: theme.ink }]}>{handleFor(item.author)}</Text>
                      <Text style={[type.labelXs, { color: theme.muted, fontSize: 9 }]}>{formatChatTime(item.createdAt)}</Text>
                    </View>
                    <EmojiText style={[type.bodySm, { color: theme.text, marginTop: 3 }]}>{item.body}</EmojiText>
                  </View>
                </View>
              )}
            />
          )}

          <View style={s.commentBar}>
            <TextInput
              style={s.commentInput}
              placeholder="Add a comment…"
              placeholderTextColor={theme.muted}
              value={text}
              onChangeText={setText}
              multiline
              onKeyPress={(e) => {
                if (Platform.OS === 'web' && e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) {
                  e.preventDefault?.();
                  send();
                }
              }}
            />
            <Pressable
              onPress={send}
              disabled={busy || !text.trim()}
              style={({ pressed }) => [
                s.commentSend,
                inkBox(theme, 'ink'),
                { backgroundColor: pressed ? theme.highlighter : theme.ink },
                (busy || !text.trim()) && { opacity: 0.4 },
              ]}
            >
              <Icon name="send" size={15} color={theme.onPrimary} />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const makeStyles = (t) => StyleSheet.create({
  list: { paddingHorizontal: 20, paddingBottom: 120 },
  listWide: { maxWidth: 640, width: '100%', alignSelf: 'center' },

  composerWrap: { paddingTop: 22 },
  pageTitle: { ...type.headlineLg, color: t.text, transform: [{ rotate: '-1deg' }] },
  composer: { padding: 14, backgroundColor: t.card, marginTop: 4 },
  composerInput: { ...type.bodyMd, color: t.text, minHeight: 62, textAlignVertical: 'top', outlineStyle: 'none' },
  composerBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  postBtn: { paddingHorizontal: 18, paddingVertical: 7, minWidth: 74, alignItems: 'center' },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10 },
  tagInput: { flex: 1, ...type.labelSm, color: t.text, paddingVertical: 6, outlineStyle: 'none' },
  draftImageWrap: { width: '100%', height: 150, marginTop: 12, overflow: 'hidden' },
  draftImageX: { position: 'absolute', top: 6, right: 6, width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  tagsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 18 },

  note: { padding: 18, marginBottom: 22, borderWidth: 1, borderColor: t.graphiteLine,
    borderTopLeftRadius: 2, borderTopRightRadius: 5, borderBottomRightRadius: 2, borderBottomLeftRadius: 4 },
  noteHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  noteImage: { width: '100%', height: 190, marginTop: 14, overflow: 'hidden' },
  actions: { flexDirection: 'row', gap: 22 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2, paddingHorizontal: 2 },

  lightbox: { flex: 1, backgroundColor: 'rgba(28,27,27,0.95)', alignItems: 'center', justifyContent: 'center' },

  sheetOverlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, maxHeight: '85%' },
  sheetHead: { flexDirection: 'row', alignItems: 'center' },
  comment: { flexDirection: 'row', gap: 12, paddingVertical: 11 },
  commentBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginTop: 10,
    borderTopWidth: 1, borderTopColor: t.graphiteLine, paddingTop: 12 },
  commentInput: { flex: 1, ...type.bodyMd, color: t.text, maxHeight: 90, paddingVertical: 8, outlineStyle: 'none' },
  commentSend: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
