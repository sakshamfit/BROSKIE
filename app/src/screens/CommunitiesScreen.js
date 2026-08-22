import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator, RefreshControl, Modal } from 'react-native';
import Icon from '../icons/Icon';
import { EmojiText } from '../icons/Emoji';
import { api } from '../api';
import { useChat } from '../store/ChatContext';
import { useTheme } from '../store/ThemeContext';
import useResponsive from '../hooks/useResponsive';
import { Avatar, EmptyState, TapeChip, rippleFor } from '../components/common';
import { CATEGORY_LIST, categoryMeta } from '../components/communityMeta';
import { onOpenCommunity, consumePendingCommunity } from '../push/routing';
import { type, inkBox, marker, radius, raised } from '../theme';
import { lazyComponent } from '../lazy';

const NewCommunityScreen = lazyComponent(() => import('./NewCommunityScreen'));
const CommunityDetailScreen = lazyComponent(() => import('./CommunityDetailScreen'));

const tiltFor = (i) => (i % 2 === 0 ? '-0.7deg' : '0.6deg');

/**
 * Discover/manage purpose-based Communities — the "people create groups
 * according to what they're planning" feature. Grid of category-tagged
 * cards (club night, house party, chai chat, trip planning, running…),
 * a filter row, "My communities" vs "Discover" toggle, and a FAB that
 * opens the New Community composer. Tapping a card opens the detail
 * screen with join/request/manage actions.
 */
export default function CommunitiesScreen({ onOpenChat }) {
  const { theme } = useTheme();
  const { onCommunityEvent } = useChat();
  const { isTablet } = useResponsive();
  const s = makeStyles(theme);

  const [scope, setScope] = useState('discover'); // discover | mine
  const [activeCategory, setActiveCategory] = useState(null);
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [openId, setOpenId] = useState(null);

  // Invite-link deep links: open this community's detail sheet. Consuming
  // the pending id on mount covers links that arrived while this page was
  // not mounted (the swipe pager keeps only neighbours alive).
  useEffect(() => {
    const pending = consumePendingCommunity();
    if (pending) setOpenId(pending);
    return onOpenCommunity((id) => setOpenId(id));
  }, []);

  const load = useCallback(async (nextScope, nextCategory) => {
    const { communities } = await api.communities({
      mine: nextScope === 'mine' ? 1 : undefined,
      category: nextCategory || undefined,
    });
    setList(communities);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try { await load(scope, activeCategory); } finally { setLoading(false); }
    })();
  }, [scope, activeCategory, load]);

  useEffect(() => {
    if (!onCommunityEvent) return;
    return onCommunityEvent(() => load(scope, activeCategory));
  }, [onCommunityEvent, scope, activeCategory, load]);

  const onRefresh = async () => {
    setRefreshing(true);
    try { await load(scope, activeCategory); } catch {} finally { setRefreshing(false); }
  };

  const onCreated = (community) => {
    setScope('mine');
    setActiveCategory(null);
    setList((prev) => [community, ...prev]);
  };

  const renderCard = ({ item, index }) => {
    const cat = categoryMeta(item.category);
    return (
      <Pressable
        onPress={() => setOpenId(item.id)}
        android_ripple={rippleFor(theme)}
        style={({ pressed }) => [
          s.card,
          raised(theme, 1),
          {
            transform: [{ rotate: tiltFor(index) }, { translateY: pressed ? 3 : 0 }],
            backgroundColor: index % 2 ? theme.cardAlt : theme.card,
            borderColor: theme.ink,
          },
          pressed && marker(theme, 1),
        ]}
      >
        <View style={s.cardHead}>
          <View style={[s.catBadge, inkBox(theme, 'thin')]}>
            <Icon name={cat.icon} size={16} color={theme.ink} />
          </View>
          {item.isMember && <TapeChip label={item.role === 'admin' ? 'ADMIN' : 'MEMBER'} tone="accent" />}
        </View>
        <EmojiText style={[type.headlineSm, { color: theme.text, marginTop: 12 }]} numberOfLines={2}>
          {item.name}
        </EmojiText>
        {!!item.description && (
          <Text style={[type.bodySm, { color: theme.subtext, marginTop: 6 }]} numberOfLines={2}>
            {item.description}
          </Text>
        )}
        <View style={s.cardFoot}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Icon name="people-outline" size={13} color={theme.muted} />
            <Text style={[type.labelXs, { color: theme.muted }]}>
              {item.memberCount} {item.memberCount === 1 ? 'MEMBER' : 'MEMBERS'}
            </Text>
          </View>
          <Text style={[type.labelXs, { color: theme.muted }]}>{cat.label.toUpperCase()}</Text>
        </View>
      </Pressable>
    );
  };

  const ListHeader = (
    <View style={s.headerWrap}>
      <View style={s.scopeRow}>
        <Pressable
          onPress={() => setScope('discover')}
          style={({ pressed }) => [s.scopeBtn, raised(theme, scope === 'discover' ? 2 : 1), { borderColor: theme.ink, backgroundColor: scope === 'discover' ? '#050505' : theme.card }, pressed && { transform: [{ translateY: 2 }] }]}
        >
          <Text style={[type.labelSm, { color: scope === 'discover' ? '#ffffff' : theme.text }]}>DISCOVER</Text>
        </Pressable>
        <Pressable
          onPress={() => setScope('mine')}
          style={({ pressed }) => [s.scopeBtn, raised(theme, scope === 'mine' ? 2 : 1), { borderColor: theme.ink, backgroundColor: scope === 'mine' ? '#050505' : theme.card }, pressed && { transform: [{ translateY: 2 }] }]}
        >
          <Text style={[type.labelSm, { color: scope === 'mine' ? '#ffffff' : theme.text }]}>MY COMMUNITIES</Text>
        </Pressable>
      </View>

      <View style={s.catRow}>
        <Pressable onPress={() => setActiveCategory(null)}>
          <TapeChip label="ALL" tone={!activeCategory ? 'accent' : 'ink'} />
        </Pressable>
        {CATEGORY_LIST.map((c) => (
          <Pressable key={c.key} onPress={() => setActiveCategory(c.key === activeCategory ? null : c.key)}>
            <TapeChip label={c.label} tone={c.key === activeCategory ? 'accent' : 'ink'} />
          </Pressable>
        ))}
      </View>
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
        data={list}
        keyExtractor={(i) => i.id}
        renderItem={renderCard}
        numColumns={isTablet ? 2 : 1}
        columnWrapperStyle={isTablet ? { gap: 16 } : undefined}
        key={isTablet ? 'grid' : 'list'}
        ListHeaderComponent={ListHeader}
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.ink} />}
        ListEmptyComponent={
          <EmptyState
            icon="people-outline"
            title={scope === 'mine' ? 'No communities yet' : 'Nothing here yet'}
            subtitle={
              scope === 'mine'
                ? 'Start one for your next club night, trip, or run.'
                : activeCategory
                  ? `No communities tagged ${categoryMeta(activeCategory).label} yet.`
                  : 'Be the first to start a community.'
            }
          />
        }
      />

      <View style={s.createFabWrap} pointerEvents="box-none">
        <View pointerEvents="none" style={s.createFabDepth} />
        <Pressable
          accessibilityLabel="Create community"
          onPress={() => setComposerOpen(true)}
          android_ripple={rippleFor(theme, { borderless: false, radius: 28 })}
          style={({ pressed }) => [s.fab, pressed && { transform: [{ translateX: 2 }, { translateY: 4 }], backgroundColor: '#242321' }]}
        >
          <View style={[s.fabIcon, { backgroundColor: theme.highlighter }]}>
            <Icon name="add" size={19} color="#050505" />
          </View>
          <Text style={[type.labelSm, { color: '#ffffff' }]}>CREATE COMMUNITY</Text>
        </Pressable>
      </View>

      <NewCommunityScreen visible={composerOpen} onClose={() => setComposerOpen(false)} onCreated={onCreated} />

      <Modal visible={!!openId} animationType="slide" onRequestClose={() => setOpenId(null)}>
        <CommunityDetailScreen
          communityId={openId}
          onClose={() => setOpenId(null)}
          onOpenChat={(chatId) => { setOpenId(null); onOpenChat?.(chatId); }}
        />
      </Modal>
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  list: { paddingHorizontal: 20, paddingBottom: 120 },
  headerWrap: { paddingTop: 6, paddingBottom: 16, gap: 14 },
  scopeRow: { flexDirection: 'row', gap: 10 },
  scopeBtn: { flex: 1, borderWidth: 2, borderRadius: 999, paddingVertical: 11, alignItems: 'center' },
  catRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  card: {
    flex: 1, padding: 17, marginBottom: 22, borderWidth: 2,
    borderTopLeftRadius: 7, borderTopRightRadius: 12, borderBottomRightRadius: 7, borderBottomLeftRadius: 10,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  catBadge: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 },

  createFabWrap: {
    position: 'absolute', right: 24, bottom: 26, width: 196, height: 58,
    shadowColor: '#000000', shadowOffset: { width: 3, height: 8 }, shadowOpacity: 0.36, shadowRadius: 7,
    elevation: 12,
  },
  createFabDepth: {
    position: 'absolute', left: 5, right: -5, top: 7, bottom: -7,
    backgroundColor: '#8d7900', borderWidth: 2, borderColor: '#000000', borderRadius: 15,
  },
  fab: {
    width: '100%', height: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    paddingHorizontal: 14, backgroundColor: '#050505', borderWidth: 3, borderColor: '#000000', borderRadius: 15,
    overflow: 'hidden',
  },
  fabIcon: { width: 30, height: 30, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
});
