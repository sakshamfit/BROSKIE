import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, TextInput, Pressable, StyleSheet, Image, Animated,
  ActivityIndicator, RefreshControl, Modal, Platform, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../icons/Icon';
import Emoji, { EmojiText } from '../icons/Emoji';
import { api } from '../api';
import { useAuth } from '../store/AuthContext';
import { useChatActions } from '../store/ChatContext';
import { useTheme } from '../store/ThemeContext';
import { Avatar, EmptyState, TapeChip, Rule, handleFor, formatChatTime, rippleFor, FrostedBackdrop, GoldTick, hasGoldTick } from '../components/common';
import BrandHeader from '../components/BrandHeader';
import TodayStrip from '../components/TodayStrip';
import StoriesRow from '../components/Stories';
import PostCard from '../components/PostCard';
import ImageLightbox from '../components/ImageLightbox';
import { PostSkeletonList } from '../components/PostSkeleton';
import { SpringPressable, motion, haptic, useReducedMotion } from '../motion';
import { type, inkBox, stroke, raised } from '../theme';
import useResponsive from '../hooks/useResponsive';
import { confirm } from '../hooks/confirm';
import { onNetworkFilterRequest, consumePendingNetworkFilter, onOpenCommunity, consumePendingCommunity, onProfileWillOpen, onCommunitiesTabRequest, peekCommunitiesTab } from '../push/routing';
import NewPostScreen from './NewPostScreen';
import CommunitiesScreen from './CommunitiesScreen';
import { stopPreview } from '../previewPlayer';
import { pickActiveSongPostId, SONG_SETTLE_MS } from '../feedAudio';

/* Phase 2 feed lenses: the whole world, your college/workplace people, or
 * just the authors you follow. */
const FEED_FILTERS = [
  { key: 'worldwide', label: 'WORLDWIDE' },
  { key: 'places', label: 'MY PLACES' },
  { key: 'following', label: 'FOLLOWING' },
];
const INSTAGRAM_HEART = '#ED4956';

function NetworkScreen({ navigation, onOpenChat, active = true }) {
  const { user } = useAuth();
  const { onPostEvent } = useChatActions();
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
  const [activeSongPostId, setActiveSongPostId] = useState(null);

  const s = makeStyles(theme);
  const reducedMotion = useReducedMotion();

  /* --------- scroll-aware compose button ---------
     Reading is the primary action in a feed, so the compose button retreats
     while the thumb is pulling content up and returns on any upward scroll.
     Direction is tracked with a dead-zone so a jittery finger never flickers
     it, and the whole thing is one native-driven spring — no re-renders. */
  const fabY = useRef(new Animated.Value(0)).current;
  const fabOpacity = useRef(new Animated.Value(1)).current;
  const lastScrollY = useRef(0);
  const fabHidden = useRef(false);

  const setFabHidden = useCallback((hidden) => {
    if (fabHidden.current === hidden || reducedMotion) return;
    fabHidden.current = hidden;
    Animated.parallel([
      Animated.spring(fabY, { toValue: hidden ? 96 : 0, ...motion.springSettle, useNativeDriver: true }),
      Animated.timing(fabOpacity, {
        toValue: hidden ? 0 : 1, duration: motion.fast, easing: motion.easing.out, useNativeDriver: true,
      }),
    ]).start();
  }, [fabY, fabOpacity, reducedMotion]);

  const onFeedScroll = useCallback((e) => {
    const y = e.nativeEvent.contentOffset.y;
    const dy = y - lastScrollY.current;
    if (Math.abs(dy) < 6) return;          // dead zone: ignore finger jitter
    lastScrollY.current = y;
    setFabHidden(dy > 0 && y > 120);       // never hide at the top of the feed
  }, [setFabHidden]);

  /* ---------------- data ---------------- */

  const load = useCallback(async (tag, filter = activeFilter) => {
    const { posts: list, nextBefore: nb } = await api.posts({ tag: tag || undefined, filter });
    setPosts(list);
    setNextBefore(nb);
  }, [activeFilter]);

  useEffect(() => {
    if (!active) return undefined;
    (async () => {
      try {
        const [, tagResult] = await Promise.all([
          load(activeTag, activeFilter),
          api.postTags(),
        ]);
        setTags(tagResult.tags || []);
      } catch (e) {
        // non-fatal — feed just starts empty
      } finally {
        setLoading(false);
      }
    })();
  }, [active, load, activeTag, activeFilter]);

  // Filter jumps requested from elsewhere (Today strip, greeter handoff).
  useEffect(() => onNetworkFilterRequest((filter) => {
    if (filter) setActiveFilter(filter);
  }), []);

  // Community deep links (invite links, or the marketing /app?tab=communities
  // handoff): jump to the Communities section. The detail sheet itself is
  // opened by CommunitiesScreen; the category filter is consumed there too
  // (peeked here — must not be eaten before the grid mounts).
  useEffect(() => {
    const pending = consumePendingCommunity();
    if (pending) setSection('communities');
    if (peekCommunitiesTab()) setSection('communities');
    const unCommunity = onOpenCommunity(() => setSection('communities'));
    const unTab = onCommunitiesTabRequest(() => setSection('communities'));
    return () => { unCommunity(); unTab(); };
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
    try {
      const [, tagResult] = await Promise.all([
        load(activeTag, activeFilter),
        api.postTags(),
      ]);
      setTags(tagResult.tags || []);
    } catch {} finally { setRefreshing(false); }
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
  const toggleFollow = useCallback(async (post) => {
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
  }, []);

  const toggleLike = useCallback(async (post) => {
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
  }, []);

  const removePost = useCallback(async (post) => {
    const ok = await confirm('Tear up this post?', { title: 'Delete post', confirmLabel: 'Delete', destructive: true });
    if (!ok) return;
    setPosts((prev) => prev.filter((p) => p.id !== post.id));
    try { await api.deletePost(post.id); } catch { load(activeTag); }
  }, [activeTag, load]);

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

  const onTagPress = useCallback((tag) => {
    setActiveTag((current) => (tag === current ? null : tag));
  }, []);
  // Trailing coalesce for viewability changes — see feedAudio.js.
  const songSettle = useRef(null);
  useEffect(() => {
    if (!active) {
      clearTimeout(songSettle.current);
      stopPreview();
    }
  }, [active]);
  useEffect(() => () => clearTimeout(songSettle.current), []);

  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    const next = pickActiveSongPostId(viewableItems);
    clearTimeout(songSettle.current);
    songSettle.current = setTimeout(() => setActiveSongPostId(next), SONG_SETTLE_MS);
  }).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 55, minimumViewTime: 180 }).current;

  const renderPost = useCallback(({ item, index }) => (
    <PostCard
      post={item}
      index={index}
      onToggleLike={toggleLike}
      onOpenComments={setCommentsFor}
      onToggleFollow={toggleFollow}
      onDelete={removePost}
      onTagPress={onTagPress}
      activeTag={activeTag}
      onOpenImage={setLightbox}
      playbackActive={active && !commentsFor && !composerOpen && activeSongPostId === item.id}
    />
  ), [toggleLike, toggleFollow, removePost, onTagPress, activeTag, active, commentsFor, composerOpen, activeSongPostId]);

  const SectionToggle = (
    <View style={s.sectionRow}>
      <SpringPressable
        onPress={() => setSection('feed')}
        scaleTo={motion.scale.chip}
        haptic="selection"
        style={[s.sectionBtn, section === 'feed' && s.sectionActive, { borderColor: theme.ink }]}
      >
        <Icon name="albums-outline" size={14} color={section === 'feed' ? theme.onPrimary : theme.text} />
        <Text style={[type.labelSm, { color: section === 'feed' ? theme.onPrimary : theme.text }]}>FEED</Text>
      </SpringPressable>
      <SpringPressable
        onPress={() => setSection('communities')}
        scaleTo={motion.scale.chip}
        haptic="selection"
        style={[s.sectionBtn, section === 'communities' && s.sectionActive, { borderColor: theme.ink }]}
      >
        <Icon name="people-outline" size={14} color={section === 'communities' ? theme.onPrimary : theme.text} />
        <Text style={[type.labelSm, { color: section === 'communities' ? theme.onPrimary : theme.text }]}>COMMUNITIES</Text>
      </SpringPressable>
    </View>
  );

  const ListHeader = (
    <View style={s.headerWrap}>
      <Text style={s.pageTitle}>The Network</Text>
      <Text style={[type.labelXs, { color: theme.muted, marginBottom: 14 }]}>
        SHARE PUBLICLY, WITH FRIENDS, OR JUST THE PEOPLE YOU PICK
      </Text>

      {SectionToggle}

      {/* BROSKIE Status — grid-lined home, segmented rings, immersive viewer. */}
      <StoriesRow active={active} reloadKey={todayReload} />

      {/* Today at your place — who's around/online from your college or
          workplace, one-tap "I'm around", today's place posts. Hidden for
          users with no places on their profile. */}
      <TodayStrip
        active={active}
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
          <SpringPressable
            key={f.key}
            accessibilityRole="button"
            onPress={() => setActiveFilter(f.key)}
            scaleTo={motion.scale.chip}
            haptic="selection"
            style={[s.filterBtn, activeFilter === f.key && s.filterBtnActive, { borderColor: theme.ink }]}
          >
            <Text style={[type.labelSm, { color: activeFilter === f.key ? theme.onPrimary : theme.text }]}>
              {f.label}
            </Text>
          </SpringPressable>
        ))}
      </View>

      {tags.length > 0 && (
        <View style={s.tagsWrap}>
          <SpringPressable onPress={() => setActiveTag(null)} scaleTo={motion.scale.chip} haptic="selection">
            <TapeChip label="ALL" tone={!activeTag ? 'accent' : 'ink'} />
          </SpringPressable>
          {tags.map((t) => (
            <SpringPressable
              key={t.tag}
              onPress={() => setActiveTag(t.tag === activeTag ? null : t.tag)}
              scaleTo={motion.scale.chip}
              haptic="selection"
            >
              <TapeChip label={`#${t.tag} ${t.count}`} tone={t.tag === activeTag ? 'accent' : 'ink'} />
            </SpringPressable>
          ))}
        </View>
      )}

      <Rule style={{ marginTop: 18, marginBottom: 4 }} />
    </View>
  );

  if (section === 'communities') {
    return (
      <View style={{ flex: 1, backgroundColor: 'transparent' }}>
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
    // Placeholders in the shape of real posts, not a spinner in the middle
    // of an empty screen: the feed looks like it is already arriving, and
    // nothing shifts when it does.
    return (
      <View style={{ flex: 1, backgroundColor: 'transparent' }}>
        <BrandHeader navigation={navigation} />
        <PostSkeletonList count={3} style={[s.list, isTablet && s.listWide]} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: 'transparent' }}>
      <BrandHeader navigation={navigation} />
      <FlatList
        data={posts}
        keyExtractor={(i) => i.id}
        renderItem={renderPost}
        ListHeaderComponent={ListHeader}
        contentContainerStyle={[s.list, isTablet && s.listWide]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.ink} />}
        onScroll={onFeedScroll}
        scrollEventThrottle={16}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
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

      {/* Compose gets out of the way while you are reading down the feed
          and comes straight back the moment you scroll up. */}
      <Animated.View style={[s.fabWrap, { transform: [{ translateY: fabY }], opacity: fabOpacity }]}>
        <SpringPressable
          accessibilityRole="button"
          accessibilityLabel="Write a post"
          onPress={() => setComposerOpen(true)}
          scaleTo={motion.scale.button}
          haptic="impact"
          android_ripple={rippleFor(theme, { borderless: false, radius: 30 })}
          style={({ pressed }) => [
            s.fab,
            { backgroundColor: pressed && Platform.OS !== 'android' ? '#242321' : '#050505', borderColor: '#000000' },
          ]}
        >
          <Icon name="create-outline" size={21} color="#ffffff" />
        </SpringPressable>
      </Animated.View>

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

      {/* shared viewer: springs open, drag it away in any vertical
          direction, backdrop fades with the finger */}
      <ImageLightbox uri={lightbox} onClose={() => setLightbox(null)} />
    </View>
  );
}

export default React.memo(NetworkScreen);

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

  // Tapping a commenter's avatar opens their profile — close this sheet so
  // the profile screen is actually visible underneath.
  useEffect(() => onProfileWillOpen(() => onClose?.()), [onClose]);

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
                  <Avatar uri={item.author.avatar} name={item.author.name} id={item.author.id} size={30} profileId={item.author.id} />
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
            <SpringPressable
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

  communitiesHeaderWrap: { paddingTop: 22, paddingHorizontal: 20 },
  sectionRow: { flexDirection: 'row', gap: 7, marginBottom: 4 },
  sectionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderWidth: 1, borderRadius: 999, paddingVertical: 9, paddingHorizontal: 8 },
  sectionActive: { backgroundColor: t.ink },

  fabWrap: { position: 'absolute', right: 24, bottom: 26 },
  fab: {
    width: 58, height: 58,
    alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderRadius: 14,
    overflow: 'hidden',
  },


  sheetOverlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, maxHeight: '85%' },
  sheetHead: { flexDirection: 'row', alignItems: 'center' },
  comment: { flexDirection: 'row', gap: 12, paddingVertical: 11 },
  commentBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginTop: 10,
    borderTopWidth: 1, borderTopColor: t.graphiteLine, paddingTop: 12 },
  commentInput: { flex: 1, ...type.bodyMd, color: t.text, maxHeight: 90, paddingVertical: 8, outlineStyle: 'none' },
  commentSend: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
