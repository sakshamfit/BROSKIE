import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../icons/Icon';
import { EmojiText } from '../icons/Emoji';
import { api } from '../api';
import { useChat } from '../store/ChatContext';
import { useTheme } from '../store/ThemeContext';
import { confirm } from '../hooks/confirm';
import {
  Avatar, EmptyState, formatChatTime, handleFor, GoldTick, hasGoldTick,
} from '../components/common';
import { openPost, openProfile } from '../push/routing';
import { type, inkBox, marker, stroke } from '../theme';

const INSTAGRAM_HEART = '#ED4956';

/**
 * Instagram-style activity: message requests, likes, comments, calls,
 * colleague and community requests in one place.
 */
export default function ActivityScreen({ navigation, embedded = false, onOpenChat }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const {
    upsertChat, refreshChats, refreshActivity, startCall, call,
    onChatRequestEvent, onColleagueEvent, onCommunityEvent, onPostEvent,
  } = useChat();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const s = makeStyles(theme);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const result = await api.activity();
      setItems(result.activity || []);
      setError('');
      refreshActivity?.();
    } catch (e) {
      setError(e.message || 'Could not load activity');
    } finally {
      setLoading(false);
    }
  }, [refreshActivity]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const unsubs = [];
    if (onChatRequestEvent) unsubs.push(onChatRequestEvent(() => load({ quiet: true })));
    if (onColleagueEvent) unsubs.push(onColleagueEvent(() => load({ quiet: true })));
    if (onCommunityEvent) unsubs.push(onCommunityEvent(() => load({ quiet: true })));
    if (onPostEvent) unsubs.push(onPostEvent(() => load({ quiet: true })));
    return () => unsubs.forEach((fn) => fn?.());
  }, [load, onChatRequestEvent, onColleagueEvent, onCommunityEvent, onPostEvent]);

  const onRefresh = async () => {
    setRefreshing(true);
    try { await load({ quiet: true }); } finally { setRefreshing(false); }
  };

  const openChat = (chatId) => {
    if (!chatId) return;
    if (onOpenChat) onOpenChat(chatId);
    else navigation.navigate('Conversation', { chatId });
  };

  const respondMessage = async (item, action) => {
    if (action !== 'accept') {
      const ok = await confirm(
        action === 'block' ? `Block ${item.user?.name || 'this person'} and delete the request?` : 'Delete this message request?',
        { title: action === 'block' ? 'Block sender' : 'Delete request', confirmLabel: action === 'block' ? 'Block' : 'Delete', destructive: true }
      );
      if (!ok) return;
    }
    setBusy(`${item.id}:${action}`);
    setError('');
    try {
      const result = await api.respondChatRequest(item.chatId, action);
      setItems((prev) => prev.filter((row) => row.id !== item.id));
      refreshActivity?.();
      if (action === 'accept' && result.chat) {
        upsertChat(result.chat);
        await refreshChats();
        openChat(result.chat.id);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const respondColleague = async (item, action) => {
    setBusy(`${item.id}:${action}`);
    setError('');
    try {
      await api.respondColleagueRequest(item.requestId, action);
      setItems((prev) => prev.filter((row) => row.id !== item.id));
      refreshActivity?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const respondCommunity = async (item, action) => {
    setBusy(`${item.id}:${action}`);
    setError('');
    try {
      await api.respondCommunityRequest(item.communityId, item.user.id, action);
      setItems((prev) => prev.filter((row) => row.id !== item.id));
      refreshActivity?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const callBack = (item) => {
    if (!item.chatId || !item.user?.id || call) return;
    startCall(item.chatId, item.user.id, item.callType || 'audio');
  };

  const copyFor = (item) => {
    const name = item.user?.name || 'Someone';
    if (item.type === 'message_request') return `${name} sent you a message request`;
    if (item.type === 'connect_request') return `${name} sent you a +one request`;
    if (item.type === 'colleague_request') return `${name} wants to connect`;
    if (item.type === 'community_request') return `${name} asked to join ${item.communityName || 'your community'}`;
    if (item.type === 'like_group') {
      const names = (item.users || []).map((u) => u.name).filter(Boolean);
      const n = item.count || names.length || 1;
      if (n <= 1) return `${name} liked your post`;
      if (n === 2) return `${names[0] || name} and ${names[1] || 'someone'} liked your post`;
      return `${n} people liked your post`;
    }
    if (item.type === 'comment_group') {
      const n = item.count || 1;
      if (n <= 1) return `${name} commented: ${item.preview || ''}`;
      return `${n} people commented on your post — latest: ${item.preview || ''}`;
    }
    if (item.type === 'like') return `${name} liked your post`;
    if (item.type === 'comment') return `${name} commented: ${item.preview || ''}`;
    if (item.type === 'call') {
      if (item.status === 'missed' && item.direction === 'incoming') return `Missed ${item.callType === 'video' ? 'video' : 'voice'} call from ${name}`;
      if (item.direction === 'incoming') return `${name} called you`;
      return `You called ${name}`;
    }
    return name;
  };

  const iconFor = (item) => {
    if (item.type === 'like_group' || item.type === 'like') return { name: 'heart', color: INSTAGRAM_HEART };
    if (item.type === 'comment_group') return { name: 'chatbubble', color: theme.ink };
    if (item.type === 'comment') return { name: 'chatbubble', color: theme.ink };
    if (item.type === 'call') return { name: item.callType === 'video' ? 'videocam' : 'call', color: item.status === 'missed' ? theme.danger : theme.ink };
    if (item.type === 'connect_request') return { name: 'add-circle-outline', color: theme.ink };
    if (item.type === 'colleague_request') return { name: 'school-outline', color: theme.ink };
    if (item.type === 'community_request') return { name: 'people', color: theme.ink };
    return { name: 'mail-unread-outline', color: theme.ink };
  };

  const renderItem = ({ item }) => {
    const person = item.user || {};
    const ic = iconFor(item);
    // Every row deep-links somewhere: like/comment rows open the post that
    // was liked or commented on, call rows open that conversation, request
    // rows open the requester's profile (the buttons still accept/decline).
    const rowTarget = item.postId
      ? () => openPost(item.postId)
      : item.type === 'call' && item.chatId
        ? () => openChat(item.chatId)
        : (item.type === 'colleague_request' || item.type === 'community_request') && person.id
          ? () => openProfile(person.id)
          : null;
    return (
      <Pressable
        onPress={rowTarget || undefined}
        disabled={!rowTarget}
        style={({ pressed }) => [s.row, pressed && rowTarget && marker(theme, 1)]}
      >
        <View style={s.avatarWrap}>
          {(item.users?.length || 0) > 1 ? (
            // A little stack of the most recent faces — the count text
            // carries the truth ("7 people liked your post").
            <View style={s.avatarStack}>
              {item.users.slice(0, 3).map((u, i) => (
                <View key={u.id || i} style={[s.avatarStackItem, { zIndex: 3 - i, marginLeft: i ? -14 : 0 }]}>
                  <Avatar uri={u.avatar} name={u.name} id={u.id} size={i === 0 ? 44 : 38} profileId={u.id} />
                </View>
              ))}
            </View>
          ) : (
            <Avatar uri={person.avatar} name={person.name} id={person.id} size={48} profileId={person.id} />
          )}
          <View style={[s.typeBadge, { backgroundColor: theme.bg, borderColor: theme.ink }]}>
            <Icon name={ic.name} size={10} color={ic.color} />
          </View>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <EmojiText style={[type.bodyStrong, { color: theme.text, flexShrink: 1 }]} numberOfLines={2}>
              {copyFor(item)}
            </EmojiText>
            {hasGoldTick(person) && <GoldTick size={13} />}
          </View>
          {!!person.username && (
            <Text style={[type.labelXs, { color: theme.muted, marginTop: 2 }]}>{handleFor(person)}</Text>
          )}
          {(item.type === 'message_request' || item.type === 'connect_request') && !!item.preview && (
            <EmojiText style={[type.bodySm, { color: theme.subtext, marginTop: 4 }]} numberOfLines={2}>
              {item.preview}
            </EmojiText>
          )}
          {(item.type === 'like_group' || item.type === 'like') && !!item.preview && (
            <EmojiText style={[type.bodySm, { color: theme.subtext, marginTop: 4 }]} numberOfLines={1}>
              {item.preview}
            </EmojiText>
          )}
          {!!item.postId && (
            <Text style={[type.labelXs, { color: theme.muted, marginTop: 4 }]}>TAP TO OPEN THE POST</Text>
          )}
          <Text style={[type.labelXs, { color: theme.muted, marginTop: 5 }]}>{formatChatTime(item.createdAt)}</Text>
        </View>
        {(item.type === 'message_request' || item.type === 'connect_request') && (
          <View style={s.actions}>
            <MiniButton
              theme={theme}
              label="Accept"
              filled
              busy={busy === `${item.id}:accept`}
              disabled={!!busy}
              onPress={() => respondMessage(item, 'accept')}
            />
            <MiniButton
              theme={theme}
              label="Delete"
              busy={busy === `${item.id}:delete`}
              disabled={!!busy}
              onPress={() => respondMessage(item, 'delete')}
            />
          </View>
        )}
        {item.type === 'colleague_request' && (
          <View style={s.actions}>
            <MiniButton
              theme={theme}
              label="Accept"
              filled
              busy={busy === `${item.id}:accept`}
              disabled={!!busy}
              onPress={() => respondColleague(item, 'accept')}
            />
            <MiniButton
              theme={theme}
              label="Decline"
              busy={busy === `${item.id}:decline`}
              disabled={!!busy}
              onPress={() => respondColleague(item, 'decline')}
            />
          </View>
        )}
        {item.type === 'community_request' && (
          <View style={s.actions}>
            <MiniButton
              theme={theme}
              label="Approve"
              filled
              busy={busy === `${item.id}:approve`}
              disabled={!!busy}
              onPress={() => respondCommunity(item, 'approve')}
            />
            <MiniButton
              theme={theme}
              label="Decline"
              busy={busy === `${item.id}:decline`}
              disabled={!!busy}
              onPress={() => respondCommunity(item, 'decline')}
            />
          </View>
        )}
        {item.type === 'call' && (
          <Pressable onPress={() => callBack(item)} hitSlop={8} style={[s.callBtn, inkBox(theme, 'thin')]}>
            <Icon name={item.callType === 'video' ? 'videocam' : 'call'} size={16} color={theme.ink} />
          </Pressable>
        )}
        {item.type === 'like' && (
          <Icon name="heart" size={18} color={INSTAGRAM_HEART} />
        )}
        {!!item.postId && (
          <Icon name="chevron-forward-outline" size={16} color={theme.muted} style={{ marginTop: 14 }} />
        )}
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={[s.header, !embedded && { paddingTop: 14 + insets.top }]}>
        {!embedded && (
          <Pressable onPress={() => navigation.goBack()} hitSlop={9} style={{ padding: 6 }}>
            <Icon name="arrow-back" size={22} color={theme.ink} />
          </Pressable>
        )}
        <View style={{ flex: 1 }}>
          <Text style={[type.headlineMd, { color: theme.text }]}>Activity</Text>
          <Text style={[type.labelXs, { color: theme.muted, marginTop: 3 }]}>REQUESTS · LIKES · CALLS</Text>
        </View>
        <Icon name="heart-outline" size={23} color={theme.ink} />
      </View>

      {!!error && (
        <View style={[s.error, { borderColor: theme.danger, backgroundColor: theme.dangerContainer }]}>
          <Icon name="alert-circle-outline" size={16} color={theme.danger} />
          <Text style={[type.bodySm, { color: theme.danger, flex: 1 }]}>{error}</Text>
        </View>
      )}

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={theme.ink} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.ink} />}
          contentContainerStyle={[s.list, !items.length && { flexGrow: 1 }]}
          ItemSeparatorComponent={() => <View style={s.sep} />}
          ListHeaderComponent={items.length ? (
            <Text style={[type.bodySm, { color: theme.subtext, marginBottom: 16 }]}>
              Message requests, likes, comments and calls. Tap a like or comment to open the post — tap any avatar to open a profile.
            </Text>
          ) : null}
          ListEmptyComponent={
            <EmptyState
              icon="heart-outline"
              title="No activity yet"
              subtitle="When someone likes a post, sends a request, or calls you, it shows up here."
            />
          }
        />
      )}
    </View>
  );
}

function MiniButton({ theme, label, filled, busy, disabled, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.mini,
        inkBox(theme, filled ? 'ink' : 'thin'),
        filled && { backgroundColor: theme.ink },
        pressed && !filled && marker(theme, 1),
        disabled && { opacity: busy ? 1 : 0.5 },
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={filled ? theme.onPrimary : theme.ink} />
      ) : (
        <Text style={[type.labelXs, { color: filled ? theme.onPrimary : theme.ink }]}>{label.toUpperCase()}</Text>
      )}
    </Pressable>
  );
}

const makeStyles = (t) => StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 13,
    paddingHorizontal: 18, paddingVertical: 14,
    borderBottomWidth: stroke.ink, borderBottomColor: t.ink,
  },
  list: { width: '100%', maxWidth: 680, alignSelf: 'center', paddingHorizontal: 18, paddingTop: 16, paddingBottom: 70 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 10 },
  avatarWrap: { position: 'relative' },
  avatarStack: { flexDirection: 'row', alignItems: 'center' },
  avatarStackItem: {
    borderWidth: 2, borderRadius: 999, borderColor: 'transparent', overflow: 'hidden',
  },
  typeBadge: {
    position: 'absolute', right: -4, bottom: -4, width: 18, height: 18, borderRadius: 18,
    borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
  actions: { gap: 6, alignItems: 'stretch', minWidth: 84 },
  callBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  sep: { height: 1, backgroundColor: t.graphiteLine, opacity: 0.55 },
  error: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, padding: 10, marginHorizontal: 18, marginTop: 12 },
});

const styles = StyleSheet.create({
  mini: { minHeight: 32, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 7 },
});
