import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Pressable, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import Icon from '../icons/Icon';
import { api } from '../api';
import { useTheme } from '../store/ThemeContext';
import { Avatar, PaperCard } from './common';
import { type, inkBox, radius } from '../theme';
import { haptic, SpringPressable, motion } from '../motion';
import { Text } from './Text';

/** Local midnight in ms — "today" follows the viewer's day, not UTC's. */
function localMidnight() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const hoursLeft = (expiresAt) => Math.max(1, Math.round((expiresAt - Date.now()) / 3600000));

/**
 * Today at your place — the Phase 2 campus strip, mounted at the top of
 * Colleagues and the Network feed. Shows who's around (the 12-hour "I'm
 * around" flag) and who's online from your shared college/workplace, a
 * one-tap "I'M AROUND", and a jump into today's posts from your places.
 *
 * Renders nothing for users with no places on their profile and nothing
 * while the first load is in flight — the rest of the screen never waits.
 */
export default function TodayStrip({ reloadKey = 0, onOpenChat, onSeePosts, active = true }) {
  const { theme } = useTheme();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const s = makeStyles(theme);

  const load = useCallback(async () => {
    try {
      const result = await api.today(localMidnight());
      setData(result);
    } catch {
      // The strip is a bonus layer — never block or error the host screen.
      setData((prev) => prev || { places: [], around: [], online: [], posts: [], postsCount: 0, me: {} });
    }
  }, []);

  useEffect(() => {
    if (active) load();
  }, [active, load, reloadKey]);

  const hasPlaces = !!data?.places?.length;
  const people = useMemo(() => {
    if (!data) return [];
    const aroundIds = new Set(data.around.map((a) => a.user.id));
    return [
      ...data.around.map((a) => ({ user: a.user, around: true })),
      ...data.online.filter((u) => !aroundIds.has(u.id)).map((u) => ({ user: u, around: false })),
    ].slice(0, 12);
  }, [data]);

  const toggleAround = async () => {
    if (busy) return;
    haptic('selection');
    setBusy(true);
    const next = !data?.me?.around;
    // Optimistic: the pill flips immediately; the server's authoritative
    // state (with the fresh 12h window) replaces it on response.
    setData((prev) => (prev ? { ...prev, me: { around: next, expiresAt: next ? Date.now() + 12 * 3600 * 1000 : null } } : prev));
    try {
      const result = await api.setAround(next);
      setData((prev) => (prev ? { ...prev, me: { around: result.around, expiresAt: result.expiresAt } } : prev));
      if (next) load(); // show myself context refresh (others' lists refresh on their next visit)
    } catch {
      setData((prev) => (prev ? { ...prev, me: { around: !next, expiresAt: !next ? Date.now() + 11 * 3600 * 1000 : null } } : prev));
    } finally {
      setBusy(false);
    }
  };

  if (!data || !hasPlaces) return null;

  const placeName = data.places[0]?.name || 'your places';
  const label = data.placeLabel === 'workplace' ? 'WORKPLACE' : 'COLLEGE';

  return (
    <PaperCard style={s.card} weight="thin">
      <View style={s.headRow}>
        <View style={{ flex: 1 }}>
          <Text style={[type.labelXs, { color: theme.muted }]}>TODAY AT YOUR {label}</Text>
          <Text style={[type.headlineSm, { color: theme.text, marginTop: 2 }]} numberOfLines={1}>
            {placeName}
          </Text>
        </View>
        <SpringPressable
          accessibilityRole="button"
          accessibilityLabel={data.me.around ? "I'm not around" : "I'm around"}
          onPress={toggleAround}
          disabled={busy}
          style={({ pressed }) => [
            s.aroundBtn,
            {
              borderColor: theme.ink,
              backgroundColor: data.me.around ? theme.highlighter : pressed ? theme.cardAlt : 'transparent',
              opacity: busy ? 0.6 : 1,
            },
          ]}
          scaleTo={motion.scale.row}
          haptic="selection"
        >
          <Icon name={data.me.around ? 'checkmark' : 'walk-outline'} size={13} color={theme.ink} />
          <Text style={[type.labelSm, { color: theme.ink }]}>
            {data.me.around ? `AROUND · ${hoursLeft(data.me.expiresAt || Date.now())}H` : "I'M AROUND"}
          </Text>
        </SpringPressable>
      </View>

      {people.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.peopleRow}>
          {people.map(({ user, around }) => (
            <Pressable key={user.id} style={s.person} onPress={() => onOpenChat?.(user.id)} hitSlop={4}>
              <View style={around ? [s.aroundRing, { borderColor: theme.highlighter }] : null}>
                <Avatar uri={user.avatar} name={user.name} id={user.id} size={around ? 44 : 40} online={!around && true} profileId={user.id} />
              </View>
              <Text style={[type.labelXs, { color: around ? theme.text : theme.muted, marginTop: 4 }]} numberOfLines={1}>
                {user.name?.split(' ')[0] || user.username}
              </Text>
              {around && <Text style={[type.labelXs, { color: theme.muted, fontSize: 8 }]}>AROUND</Text>}
            </Pressable>
          ))}
        </ScrollView>
      ) : (
        <Text style={[type.bodySm, { color: theme.muted, marginTop: 10 }]}>
          Nobody from your {data.placeLabel || 'place'} is around yet — tap “I’M AROUND” and be the first.
        </Text>
      )}

      {(data.postsCount > 0 || data.around?.length > 0) && (
        <SpringPressable
          accessibilityRole="button"
          onPress={() => { haptic('selection'); onSeePosts?.(); }}
          style={({ pressed }) => [s.postsRow, pressed && { opacity: 0.6 }]}
          scaleTo={motion.scale.row}
          haptic="selection"
        >
          <Icon name="albums-outline" size={14} color={theme.ink} />
          <Text style={[type.labelSm, { color: theme.ink, flex: 1 }]} numberOfLines={1}>
            {data.postsCount > 0
              ? `${data.postsCount} post${data.postsCount === 1 ? '' : 's'} from your ${data.placeLabel || 'place'} today`
              : `${data.around.length} ${data.around.length === 1 ? 'person' : 'people'} around now`}
          </Text>
          <Icon name="arrow-forward" size={14} color={theme.muted} />
        </SpringPressable>
      )}
    </PaperCard>
  );
}

const makeStyles = (t) => StyleSheet.create({
  card: { padding: 14, marginBottom: 16 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  aroundBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1.5, borderRadius: radius.full,
    paddingHorizontal: 12, paddingVertical: 8,
    ...inkBox(t, 'thin'),
  },
  peopleRow: { flexDirection: 'row', gap: 14, marginTop: 14, paddingRight: 4 },
  person: { alignItems: 'center', width: 60 },
  aroundRing: {
    padding: 2, borderRadius: radius.full, borderWidth: 2, borderStyle: 'dashed',
  },
  postsRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: 14, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: t.graphiteLine,
  },
});
