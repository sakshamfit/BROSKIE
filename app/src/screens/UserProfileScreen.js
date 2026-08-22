import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../icons/Icon';
import { EmojiText } from '../icons/Emoji';
import { api } from '../api';
import { useAuth } from '../store/AuthContext';
import { useTheme } from '../store/ThemeContext';
import PostCard from '../components/PostCard';
import { Avatar, EmptyState, TapeChip, Rule, handleFor, GoldTick, hasGoldTick } from '../components/common';
import ImageLightbox from '../components/ImageLightbox';
import { openPost } from '../push/routing';
import { type, inkBox, marker, stroke } from '../theme';
import { SpringPressable, motion } from '../motion';

/**
 * Someone's profile — what opens when you tap their avatar circle anywhere
 * in the app. Shows who they are, their places, follower counts, and their
 * posts (audience-filtered by the server). Follow and Message from here.
 */
export default function UserProfileScreen({ navigation, route, embedded = false, onOpenChat }) {
  const userId = route?.params?.userId;
  const { user: me } = useAuth();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [profile, setProfile] = useState(null);
  const [posts, setPosts] = useState([]);
  const [nextBefore, setNextBefore] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lightbox, setLightbox] = useState(null);
  const s = makeStyles(theme);

  const load = useCallback(async () => {
    if (!userId) return;
    setError('');
    try {
      const [{ profile: p }, { posts: list, nextBefore: nb }] = await Promise.all([
        api.userProfile(userId),
        api.posts({ userId }),
      ]);
      setProfile(p);
      setPosts(list || []);
      setNextBefore(nb);
    } catch (e) {
      setError(e?.status === 404 ? 'This profile is not available.' : (e.message || 'Could not load the profile.'));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  };

  const loadMore = async () => {
    if (!nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const { posts: more, nextBefore: nb } = await api.posts({ userId, before: nextBefore });
      setPosts((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...more.filter((p) => !seen.has(p.id))];
      });
      setNextBefore(nb);
    } catch {} finally { setLoadingMore(false); }
  };

  const toggleFollow = async () => {
    if (!profile || profile.isSelf || busy) return;
    const next = !profile.following;
    setProfile((prev) => prev && ({
      ...prev,
      following: next,
      stats: { ...prev.stats, followers: Math.max(0, (prev.stats?.followers || 0) + (next ? 1 : -1)) },
    }));
    setPosts((prev) => prev.map((p) => (typeof p.following === 'boolean' ? { ...p, following: next } : p)));
    try {
      if (next) await api.follow(userId);
      else await api.unfollow(userId);
    } catch {
      setProfile((prev) => prev && ({
        ...prev,
        following: !next,
        stats: { ...prev.stats, followers: Math.max(0, (prev.stats?.followers || 0) + (next ? -1 : 1)) },
      }));
    }
  };

  const message = async () => {
    if (!profile || profile.isSelf || busy) return;
    setBusy(true);
    try {
      const { chat } = await api.directChat(userId);
      if (onOpenChat) onOpenChat(chat.id);
      else navigation?.navigate?.('Conversation', { chatId: chat.id });
    } catch (e) {
      setError(e.message || 'Could not open the chat.');
    } finally {
      setBusy(false);
    }
  };

  const toggleLike = async (post) => {
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

  const u = profile?.user;
  const isSelf = profile?.isSelf || userId === me?.id;

  const Header = profile ? (
    <View>
      <View style={s.hero}>
        <Avatar uri={u.avatar} name={u.name} id={u.id} size={92} shape="sketch" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <EmojiText style={[type.headlineMd, { color: theme.text, flexShrink: 1 }]} numberOfLines={2}>
              {u.name}
            </EmojiText>
            {hasGoldTick(u) && <GoldTick size={17} />}
          </View>
          {!!u.username && (
            <Text style={[type.labelSm, { color: theme.muted, marginTop: 3 }]}>{handleFor(u)}</Text>
          )}
          {profile.followsYou && !isSelf && (
            <View style={{ marginTop: 7, alignSelf: 'flex-start' }}>
              <TapeChip label="FOLLOWS YOU" tone="ink" />
            </View>
          )}
        </View>
      </View>

      {!!u.about && (
        <EmojiText style={[type.bodyMd, { color: theme.subtext, marginTop: 12 }]}>{u.about}</EmojiText>
      )}

      {(profile.affiliations || []).length > 0 && (
        <View style={s.chips}>
          {profile.affiliations.map((a) => (
            <TapeChip
              key={a.id}
              label={`${a.name}${a.title ? ` · ${a.title}` : ''}`.toUpperCase()}
              tone="ink"
            />
          ))}
        </View>
      )}

      <View style={[s.statsRow, inkBox(theme, 'thin')]}>
        <Stat theme={theme} label="POSTS" value={profile.stats?.posts || 0} />
        <View style={s.statDivider} />
        <Stat theme={theme} label="FOLLOWERS" value={profile.stats?.followers || 0} />
        <View style={s.statDivider} />
        <Stat theme={theme} label="FOLLOWING" value={profile.stats?.following || 0} />
      </View>

      <View style={s.actionRow}>
        {isSelf ? (
          <ActionButton
            theme={theme}
            icon="create-outline"
            label="EDIT PROFILE"
            onPress={() => navigation?.navigate?.('PersonalInfo')}
          />
        ) : (
          <>
            <ActionButton
              theme={theme}
              filled={!profile.following}
              icon={profile.following ? 'checkmark' : 'person-add-outline'}
              label={profile.following ? 'FOLLOWING' : 'FOLLOW'}
              onPress={toggleFollow}
            />
            <ActionButton
              theme={theme}
              icon="chatbubble-outline"
              label="MESSAGE"
              busy={busy}
              onPress={message}
            />
          </>
        )}
      </View>

      <Rule style={{ marginTop: 20, marginBottom: 14 }} />
      <Text style={[type.labelXs, { color: theme.muted, marginBottom: 12 }]}>
        {isSelf ? 'YOUR POSTS' : `POSTS BY ${(u.name || '').toUpperCase()}`}
      </Text>
    </View>
  ) : null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={[s.header, !embedded && { paddingTop: 14 + insets.top }]}>
        <Pressable onPress={() => navigation?.goBack?.()} hitSlop={9} style={{ padding: 6 }}>
          <Icon name="arrow-back" size={22} color={theme.ink} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[type.headlineMd, { color: theme.text }]} numberOfLines={1}>
            {u ? u.name : 'Profile'}
          </Text>
          {!!u?.username && (
            <Text style={[type.labelXs, { color: theme.muted, marginTop: 3 }]}>{handleFor(u)}</Text>
          )}
        </View>
        <Icon name="person-circle-outline" size={24} color={theme.ink} />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={theme.ink} />
      ) : error && !profile ? (
        <EmptyState icon="person-outline" title="Profile unavailable" subtitle={error} />
      ) : (
        <FlatList
          data={posts}
          keyExtractor={(p) => p.id}
          contentContainerStyle={s.list}
          ListHeaderComponent={Header}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.ink} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          renderItem={({ item, index }) => (
            <PostCard
              post={item}
              index={index}
              onToggleLike={toggleLike}
              onOpenComments={(p) => openPost(p.id)}
              onOpenImage={setLightbox}
              showFollow={false}
            />
          )}
          ListFooterComponent={
            loadingMore ? <ActivityIndicator style={{ marginVertical: 22 }} color={theme.ink} /> : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="albums-outline"
              title="No posts yet"
              subtitle={isSelf ? 'Your posts will show up here.' : 'When they post to the Network, it shows up here.'}
            />
          }
        />
      )}

      {/* shared viewer: springs open, drag it away in any vertical
          direction, backdrop fades with the finger */}
      <ImageLightbox uri={lightbox} onClose={() => setLightbox(null)} />
    </View>
  );
}

function Stat({ theme, label, value }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', paddingVertical: 12 }}>
      <Text style={[type.headlineSm, { color: theme.text }]}>{value}</Text>
      <Text style={[type.labelXs, { color: theme.muted, marginTop: 2 }]}>{label}</Text>
    </View>
  );
}

function ActionButton({ theme, icon, label, onPress, filled = false, busy = false }) {
  return (
    <SpringPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [
        styles.actionBtn,
        inkBox(theme, filled ? 'ink' : 'thin'),
        filled && { backgroundColor: theme.ink },
        pressed && !filled && marker(theme, 1),
        busy && { opacity: 0.6 },
      ]}
      scaleTo={motion.scale.row}
      haptic="selection"
    >
      {busy ? (
        <ActivityIndicator size="small" color={filled ? theme.onPrimary : theme.ink} />
      ) : (
        <>
          <Icon name={icon} size={15} color={filled ? theme.onPrimary : theme.ink} />
          <Text style={[type.labelSm, { color: filled ? theme.onPrimary : theme.ink }]}>{label}</Text>
        </>
      )}
    </SpringPressable>
  );
}

const makeStyles = (t) => StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 13,
    paddingHorizontal: 18, paddingVertical: 14,
    borderBottomWidth: stroke.ink, borderBottomColor: t.ink,
  },
  list: { width: '100%', maxWidth: 640, alignSelf: 'center', paddingHorizontal: 18, paddingTop: 20, paddingBottom: 70 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  statsRow: { flexDirection: 'row', alignItems: 'stretch', marginTop: 16 },
  statDivider: { width: 1, backgroundColor: t.graphiteLine },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
});

const styles = StyleSheet.create({
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 7, minHeight: 42, paddingHorizontal: 12, paddingVertical: 9,
  },
});
