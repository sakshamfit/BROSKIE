import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, TextInput, Pressable, StyleSheet, Image,
  ActivityIndicator, RefreshControl, Modal, Platform, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../icons/Icon';
import Emoji, { EmojiText } from '../icons/Emoji';
import { api, mediaUrl } from '../api';
import { useAuth } from '../store/AuthContext';
import { useChat } from '../store/ChatContext';
import { useTheme } from '../store/ThemeContext';
import { Avatar, EmptyState, TapeChip, Rule, handleFor, formatChatTime, rippleFor, FrostedBackdrop, GoldTick, hasGoldTick } from '../components/common';
import { AUDIENCE } from '../components/audienceMeta';
import BrandHeader from '../components/BrandHeader';
import SongCard from '../components/SongCard';
import TodayStrip from '../components/TodayStrip';
import { type, inkBox, marker, dashedRule, stroke, radius, raised } from '../theme';
import useResponsive from '../hooks/useResponsive';
import { confirm } from '../hooks/confirm';
import { onNetworkFilterRequest, consumePendingNetworkFilter, onOpenCommunity, consumePendingCommunity } from '../push/routing';
import { lazyComponent } from '../lazy';

const NewPostScreen = lazyComponent(() => import('./NewPostScreen'));
const CommunitiesScreen = lazyComponent(() => import('./CommunitiesScreen'));

/* Sticky notes alternate their tilt, like scraps pinned to a board. */
const tiltFor = (i) => (i % 2 === 0 ? '-0.8deg' : '0.7deg');

/* Phase 2 feed lenses: the whole world, your college/workplace people, or
 * just the authors you follow. */
const FEED_FILTERS = [
  { key: 'worldwide', label: 'WORLDWIDE' },
  { key: 'places', label: 'MY PLACES' },
  { key: 'following', label: 'FOLLOWING' },
];
const INSTAGRAM_HEART = '#ED4956';

export default function NetworkScreen({ navigation, onOpenChat }) {
  const { user } = useAuth();
  const { onPostEvent } = useChat();
  const { theme } = useTheme();
  const { isTablet } = useResponsive();
  const [section, setSection] = useState('feed'); // feed | communities — colleagues lives as its own top-level tab, not inside Network

  const [posts, setPosts] = useState([]);
  const [tags, setTags] = useState([]);
  const [activeTag, setActiveTag] = useState(null);
  const [nextBefore, setNextBefore] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // A "places" jump from the Today strip or the greeter can arrive while this
  // page is unmounted (the swipe pager only keeps neighbours alive) — the
  // requested filter is parked in routing.js and consumed here on mount.
  const [activeFilter, setActiveFilter] = useState(() => consumePendingNetworkFilter() || 'worldwide');
  const [todayReload, setTodayReload] = useState(0);

  const [composerOpen, setComposerOpen] = useState(false);
  const [commentsFor, setCommentsFor] = useState(null);
  const [lightbox, setLightbox] = useState(null);

  const s = makeStyles(theme);

  /* ---------------- data ---------------- */

  const load = useCallback(async (tag, filter = activeFilter) => {
    const { posts: list, nextBefore: nb } = await api.posts({ tag: tag || undefined, filter });
    setPosts(list);
    setNextBefore(nb);
  }, [activeFilter]);

  useEffect(() => {
    (async () => {
      try {
        await load(activeTag, activeFilter);
        setTags((await api.postTags()).tags);
      } catch (e) {
        // non-fatal — feed just starts empty
      } finally {
        setLoading(false);
      }
    })();
  }, [load, activeTag, activeFilter]);

  // Filter jumps requested from elsewhere (Today strip, greeter handoff).
  useEffect(() => onNetworkFilterRequest((filter) => {
    if (filter) setActiveFilter(filter);
  }), []);

  // Community deep links (invite links): jump to the Communities section.
  // The detail sheet itself is opened by CommunitiesScreen.
  useEffect(() => {
    const pending = consumePendingCommunity();
    if (pending) setSection('communities');
    return onOpenCommunity(() => setSection('communities'));
  }, []);

  /* live updates from other users (audience-filtered server-side) */
  useEffect(() => {
    if (!onPostEvent) return;
    return onPostEvent((ev, payload) => {
      if (ev === 'post:new') {
        setPosts((prev) => {
          if (prev.some((p) => p.id === payload.id)) return prev;
          if (activeTag && payload.tag !== activeTag) return prev;
          // Filter lenses: only prepend posts that belong to the current
          // lens. 'places' can't be verified from the payload (no affiliation
          // data on the post), so it simply waits for the next refresh —
          // never shows a post under the wrong lens.
          if (activeFilter === 'following' && !payload.mine && !payload.following) return prev;
          if (activeFilter === 'places' && !payload.mine) return prev;
          return [payload, ...prev];
        });
      } else if (ev === 'post:deleted') {
        setPosts((prev) => prev.filter((p) => p.id !== payload.id));
      } else if (ev === 'post:likes') {
        setPosts((prev) => prev.map((p) => (p.id === payload.id ? { ...p, likes: payload.likes } : p)));
      } else if (ev === 'post:comments') {
        setPosts((prev) => prev.map((p) => (p.id === payload.id ? { ...p, comments: payload.comments } : p)));
      }
    });
  }, [onPostEvent, activeTag, activeFilter, user]);

  const onRefresh = async () => {
    setRefreshing(true);
    setTodayReload((k) => k + 1);
    try { await load(activeTag, activeFilter); setTags((await api.postTags()).tags); }
    catch {} finally { setRefreshing(false); }
  };

  const loadMore = async () => {
    if (!nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const { posts: more, nextBefore: nb } = await api.posts({ before: nextBefore, tag: activeTag || undefined, filter: activeFilter });
      setPosts((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...more.filter((p) => !seen.has(p.id))];
      });
      setNextBefore(nb);
    } catch {} finally { setLoadingMore(false); }
  };

  /* ---------------- actions ---------------- */

  const onPosted = (post) => {
    setPosts((prev) => (prev.some((p) => p.id === post.id) ? prev : [post, ...prev]));
    (async () => {
      try {
        const r = await api.postTags();
        setTags(r.tags);
      } catch {}
    })();
    // A fresh post always belongs at the top of the worldwide lens.
    setTodayReload((k) => k + 1);
  };

  /** Follow / unfollow an author from any of their posts — every card by the
   *  same author updates, so the Following lens stays truthful. */
  const toggleFollow = async (post) => {
    if (post.mine || typeof post.following !== 'boolean') return;
    const authorId = post.userId;
    const next = !post.following;
    setPosts((prev) => prev.map((p) => (p.userId === authorId && !p.mine ? { ...p, following: next } : p)));
    try {
      if (next) await api.follow(authorId);
      else await api.unfollow(authorId);
    } catch {
      setPosts((prev) => prev.map((p) => (p.userId === authorId && !p.mine ? { ...p, following: !next } : p)));
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

  const emptyTitle = activeTag
    ? `Nothing tagged #${activeTag}`
    : activeFilter === 'places'
      ? 'Nothing from your places yet'
      : activeFilter === 'following'
        ? 'You are not following anyone yet'
        : 'Nothing pinned yet';
  const emptySubtitle = activeTag
    ? 'Try another tag, or clear the filter.'
    : activeFilter === 'places'
      ? 'Be the first — tap the pencil and post to My places.'
      : activeFilter === 'following'
        ? 'Tap FOLLOW on a post to build your own feed.'
        : 'Tap the pencil to sketch the first page.';

  const renderPost = ({ item, index }) => {
    const audienceMeta = AUDIENCE[item.audience] || AUDIENCE.public;
    return (
      <View style={[s.note, raised(theme, 1), { transform: [{ rotate: tiltFor(index) }], backgroundColor: index % 2 ? theme.cardAlt : theme.card }]}>
        <View style={s.noteHead}>
          <Avatar uri={item.author.avatar} name={item.author.name} id={item.author.id} size={38} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Text style={[type.labelSm, { color: theme.ink, flexShrink: 1 }]} numberOfLines={1}>
                {handleFor(item.author)}
              </Text>
              {hasGoldTick(item.author) && <GoldTick size={13} />}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 }}>
              <Icon name={audienceMeta.icon} size={11} color={theme.muted} />
              <Text style={[type.labelXs, { color: theme.muted }]}>
                {formatChatTime(item.createdAt)} · {audienceMeta.label}
              </Text>
            </View>
          </View>
          {!item.mine && typeof item.following === 'boolean' && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={item.following ? `Unfollow ${item.author.name}` : `Follow ${item.author.name}`}
              onPress={() => toggleFollow(item)}
              hitSlop={6}
              style={({ pressed }) => [
                s.followBtn,
                {
                  borderColor: item.following ? theme.graphiteLine : theme.ink,
                  backgroundColor: item.following ? 'transparent' : pressed ? theme.cardAlt : theme.cardAlt,
                },
              ]}
            >
              <Icon
                name={item.following ? 'checkmark' : 'person-add-outline'}
                size={12}
                color={item.following ? theme.muted : theme.ink}
              />
              <Text style={[type.labelXs, { color: item.following ? theme.muted : theme.ink }]}>
                {item.following ? 'FOLLOWING' : 'FOLLOW'}
              </Text>
            </Pressable>
          )}
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
          <Pressable
            onPress={() => setLightbox(mediaUrl(item.mediaUrl))}
            style={[
              s.noteImage,
              inkBox(theme, 'ink'),
              {
                aspectRatio: item.mediaAspect || 16 / 9,
                width: (item.mediaAspect || 16 / 9) < 0.7 ? '62%' : (item.mediaAspect || 16 / 9) < 1 ? '80%' : '100%',
              },
            ]}
          >
            <Image source={{ uri: mediaUrl(item.mediaUrl) }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          </Pressable>
        )}

        {!!item.song && (
          <View style={{ marginTop: 12 }}>
            <SongCard song={item.song} compact />
          </View>
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.liked ? 'Unlike' : 'Like'}
            onPress={() => toggleLike(item)}
            style={({ pressed }) => [s.action, pressed && { transform: [{ scale: 1.12 }] }]}
            hitSlop={8}
          >
            <Icon name={item.liked ? 'heart' : 'heart-outline'} size={24} color={item.liked ? INSTAGRAM_HEART : theme.ink} />
            {item.likes > 0 && (
              <Text style={[type.labelSm, { color: item.liked ? INSTAGRAM_HEART : theme.ink }]}>{item.likes}</Text>
            )}
          </Pressable>
          <Pressable onPress={() => setCommentsFor(item)} style={({ pressed }) => [s.action, pressed && marker(theme, 1)]} hitSlop={6}>
            <Icon name="chatbubble-outline" size={16} color={theme.graphite} />
            <Text style={[type.labelSm, { color: theme.graphite }]}>{item.comments}</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  const SectionToggle = (
    <View style={s.sectionRow}>
      <Pressable onPress={() => setSection('feed')} style={[s.sectionBtn, section === 'feed' && s.sectionActive, { borderColor: theme.ink }]}>
        <Icon name="albums-outline" size={14} color={section === 'feed' ? theme.onPrimary : theme.text} />
        <Text style={[type.labelSm, { color: section === 'feed' ? theme.onPrimary : theme.text }]}>FEED</Text>
      </Pressable>
      <Pressable onPress={() => setSection('communities')} style={[s.sectionBtn, section === 'communities' && s.sectionActive, { borderColor: theme.ink }]}>
        <Icon name="people-outline" size={14} color={section === 'communities' ? theme.onPrimary : theme.text} />
        <Text style={[type.labelSm, { color: section === 'communities' ? theme.onPrimary : theme.text }]}>COMMUNITIES</Text>
      </Pressable>
    </View>
  );

  const ListHeader = (
    <View style={s.headerWrap}>
      <Text style={s.pageTitle}>The Network</Text>
      <Text style={[type.labelXs, { color: theme.muted, marginBottom: 14 }]}>
        SHARE PUBLICLY, WITH FRIENDS, OR JUST THE PEOPLE YOU PICK
      </Text>

      {SectionToggle}

      {/* Today at your place — who's around/online from your college or
          workplace, one-tap "I'm around", today's place posts. Hidden for
          users with no places on their profile. */}
      <TodayStrip
        reloadKey={todayReload}
        onOpenChat={async (userId) => {
          try {
            const { chat } = await api.directChat(userId);
            onOpenChat?.(chat.id);
          } catch {}
        }}
        onSeePosts={() => setActiveFilter('places')}
      />

      <View style={s.filterRow}>
        {FEED_FILTERS.map((f) => (
          <Pressable
            key={f.key}
            accessibilityRole="button"
            onPress={() => setActiveFilter(f.key)}
            style={[s.filterBtn, activeFilter === f.key && s.filterBtnActive, { borderColor: theme.ink }]}
          >
            <Text style={[type.labelSm, { color: activeFilter === f.key ? theme.onPrimary : theme.text }]}>
              {f.label}
            </Text>
          </Pressable>
        ))}
      </View>

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

  if (section === 'communities') {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <View style={[s.communitiesHeaderWrap, isTablet && s.listWide]}>
          <Text style={s.pageTitle}>The Network</Text>
          <Text style={[type.labelXs, { color: theme.muted, marginBottom: 14 }]}>
            SHARE PUBLICLY, WITH FRIENDS, OR JUST THE PEOPLE YOU PICK
          </Text>
          {SectionToggle}
        </View>
        <CommunitiesScreen onOpenChat={onOpenChat} />
      </View>
    );
  }

  // colleagues now lives as a dedicated top-level tab (see Navigation / DesktopLayout),
  // so Network only toggles between feed and communities

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <BrandHeader navigation={navigation} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.ink} />
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <BrandHeader navigation={navigation} />
      <FlatList
        data={posts}
        keyExtractor={(i) => i.id}
        renderItem={renderPost}
        ListHeaderComponent={ListHeader}
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
            title={emptyTitle}
            subtitle={emptySubtitle}
          />
        }
      />

      <Pressable
        onPress={() => setComposerOpen(true)}
        android_ripple={rippleFor(theme, { borderless: false, radius: 30 })}
        style={({ pressed }) => [
          s.fab,
          { backgroundColor: pressed && Platform.OS !== 'android' ? '#242321' : '#050505', borderColor: '#000000' },
        ]}
      >
        <Icon name="create-outline" size={21} color="#ffffff" />
      </Pressable>

      <NewPostScreen
        visible={composerOpen}
        onClose={() => setComposerOpen(false)}
        onPosted={onPosted}
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
    (async () => {
      try {
        const r = await api.comments(post.id);
        setList(r.comments);
      } catch {} finally {
        setLoading(false);
      }
    })();
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
      <View style={[s.sheetOverlay, { backgroundColor: 'transparent' }]}>
        <FrostedBackdrop />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[
            s.sheet,
            raised(theme, 2),
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

  headerWrap: { paddingTop: 22 },
  pageTitle: { ...type.headlineLg, color: t.text, transform: [{ rotate: '-1deg' }] },
  tagsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  filterRow: { flexDirection: 'row', gap: 7, marginTop: 4, marginBottom: 6 },
  filterBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 8,
  },
  filterBtnActive: { backgroundColor: t.ink },
  followBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5,
    alignSelf: 'flex-start', marginLeft: 8,
  },

  communitiesHeaderWrap: { paddingTop: 22, paddingHorizontal: 20 },
  sectionRow: { flexDirection: 'row', gap: 7, marginBottom: 4 },
  sectionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderWidth: 1, borderRadius: 999, paddingVertical: 9, paddingHorizontal: 8 },
  sectionActive: { backgroundColor: t.ink },

  note: { padding: 18, marginBottom: 22, borderWidth: 1, borderColor: t.graphiteLine,
    borderTopLeftRadius: 2, borderTopRightRadius: 5, borderBottomRightRadius: 2, borderBottomLeftRadius: 4 },
  noteHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  noteImage: { marginTop: 14, overflow: 'hidden', alignSelf: 'center' },
  actions: { flexDirection: 'row', gap: 22 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 2, paddingHorizontal: 2 },

  fab: {
    position: 'absolute', right: 24, bottom: 26, width: 58, height: 58,
    alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderRadius: 14,
    overflow: 'hidden',
  },

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
