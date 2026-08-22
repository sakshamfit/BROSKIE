import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, TextInput, ScrollView,
  ActivityIndicator, RefreshControl, Platform, Animated,
} from 'react-native';
import Icon from '../icons/Icon';
import { EmojiText } from '../icons/Emoji';
import { api } from '../api';
import { useAuth } from '../store/AuthContext';
import { useChat } from '../store/ChatContext';
import { useTheme } from '../store/ThemeContext';
import useResponsive from '../hooks/useResponsive';
import AffiliationPicker, { AFFILIATION_TYPES, affiliationType } from '../components/AffiliationPicker';
import TodayStrip from '../components/TodayStrip';
import { Avatar, InkField, TapeChip, handleFor, rippleFor, GoldTick, hasGoldTick } from '../components/common';
import { openNetworkFeed } from '../push/routing';
import { useDebouncedCallback } from '../rateLimit';
import { type, inkBox, marker, dashedRule, raised } from '../theme';
import { SpringPressable, motion } from '../motion';

const FILTERS = [{ key: '', short: 'All', icon: 'globe-outline' }, ...AFFILIATION_TYPES];
const CARD_TILTS = ['0.5deg', '-0.8deg', '1deg'];

/**
 * Colleague discovery is intentionally place-based: a person only appears
 * after both accounts have joined at least one same institution,
 * organization or workplace. Connection requests turn that shared context
 * into an accepted friend/contact relationship.
 */
export default function ColleaguesScreen({ onOpenChat }) {
  const { theme } = useTheme();
  const { user, refreshUser } = useAuth();
  const { upsertChat, onColleagueEvent } = useChat();
  const { isTablet } = useResponsive();
  const [colleagues, setColleagues] = useState([]);
  const [places, setPlaces] = useState([]);
  const [requests, setRequests] = useState([]);
  const [query, setQuery] = useState('');
  const [activeType, setActiveType] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [todayReload, setTodayReload] = useState(0);
  const scrollY = useRef(new Animated.Value(0)).current;
  const s = makeStyles(theme);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const [peopleResult, placesResult, requestsResult] = await Promise.all([
        api.colleagues({ q: query.trim(), type: activeType || undefined }),
        api.affiliations({ q: query.trim(), type: activeType || undefined }),
        api.colleagueRequests(),
      ]);
      setColleagues(peopleResult.colleagues || []);
      setPlaces(placesResult.affiliations || []);
      setRequests(requestsResult.requests || []);
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [query, activeType]);

  // Debounce text search; filter changes feel immediate. While a query is
  // active the server is hit once per typing pause; clearing the search
  // reloads at once instead of waiting out the debounce window.
  const debouncedLoad = useDebouncedCallback(() => load(), 220);
  useEffect(() => {
    if (!query.trim()) {
      debouncedLoad.cancel();
      load();
      return undefined;
    }
    debouncedLoad();
    return undefined;
  }, [query, load, debouncedLoad]);

  // A request accepted on another device or a newly joined colleague should
  // appear without leaving/re-entering the screen.
  useEffect(() => {
    if (!onColleagueEvent) return undefined;
    return onColleagueEvent(() => load({ quiet: true }));
  }, [onColleagueEvent, load]);

  const refresh = async () => {
    setRefreshing(true);
    setTodayReload((k) => k + 1);
    try { await load({ quiet: true }); } finally { setRefreshing(false); }
  };

  const run = async (key, work) => {
    setBusy(key);
    setError('');
    try {
      await work();
      await load({ quiet: true });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const sendRequest = (person) => run(`person:${person.id}`, () => api.requestColleague(person.id));
  const respond = (requestId, action) => run(`request:${requestId}:${action}`, () => api.respondColleagueRequest(requestId, action));
  const cancelRequest = (requestId) => run(`request:${requestId}:cancel`, () => api.cancelColleagueRequest(requestId));

  const joinPlace = (place) => run(`place:${place.id}`, async () => {
    await api.joinAffiliation(place.id);
    await refreshUser();
  });

  const openMessage = (person) => run(`message:${person.id}`, async () => {
    const { chat } = await api.directChat(person.id);
    upsertChat(chat);
    onOpenChat?.(chat.id);
  });

  // Today strip taps pass a bare user id (the strip only has publicUser data).
  const openMessageById = (userId) => run(`message:${userId}`, async () => {
    const { chat } = await api.directChat(userId);
    upsertChat(chat);
    onOpenChat?.(chat.id);
  });

  const joinedPlaces = useMemo(() => {
    const base = user?.affiliations || [];
    // keep colleges / institutions at the top when showing All
    if (!activeType) {
      const order = { institution: 0, organization: 1, workplace: 2 };
      return [...base].sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9));
    }
    return base;
  }, [user?.affiliations, activeType]);

  const discoverPlaces = useMemo(() => {
    const base = places.slice(0, query.trim() ? 20 : 8);
    // colleges / institutions should appear first so "college should be up"
    if (!activeType) {
      const order = { institution: 0, organization: 1, workplace: 2 };
      return [...base].sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9));
    }
    return base;
  }, [places, query, activeType]);

  const relationshipButton = (person) => {
    const relation = person.relationship || { status: 'none' };
    if (relation.status === 'connected') {
      return <ActionButton theme={theme} label="Message" icon="chatbubble-outline" onPress={() => openMessage(person)} busy={busy === `message:${person.id}`} filled />;
    }
    if (relation.status === 'outgoing') {
      return <ActionButton theme={theme} label="Request sent" icon="hourglass-outline" onPress={() => cancelRequest(relation.requestId)} busy={busy === `request:${relation.requestId}:cancel`} subtle />;
    }
    if (relation.status === 'incoming') {
      return (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <ActionButton theme={theme} label="Accept" icon="checkmark" onPress={() => respond(relation.requestId, 'accept')} busy={busy === `request:${relation.requestId}:accept`} filled />
          <ActionButton theme={theme} label="Decline" onPress={() => respond(relation.requestId, 'decline')} busy={busy === `request:${relation.requestId}:decline`} />
        </View>
      );
    }
    return <ActionButton theme={theme} label="Connect" icon="person-add-outline" onPress={() => sendRequest(person)} busy={busy === `person:${person.id}`} />;
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Animated.ScrollView
        contentContainerStyle={[s.content, isTablet && s.contentWide]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.ink} />}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
      >
        <Animated.View
          style={[
            s.hero,
            {
              opacity: scrollY.interpolate({ inputRange: [0, 120], outputRange: [1, 0.82], extrapolate: 'clamp' }),
              transform: [{ translateY: scrollY.interpolate({ inputRange: [0, 160], outputRange: [0, 14], extrapolate: 'clamp' }) }],
            },
          ]}
        >
          <Text style={s.title}>Find Colleagues</Text>
          <View style={[s.brush, { backgroundColor: theme.ink }]} />
          <Text style={[type.bodyLg, { color: theme.subtext, marginTop: 14, maxWidth: 620 }]}>
            Discover people from your college, institution, organization or workplace — then send a connection request.
          </Text>
        </Animated.View>

        {/* Today at your place — who's around / online from your places,
            one-tap "I'm around", and today's place posts. The greeter's
            handoff lands here. Hidden for users without places. */}
        <TodayStrip
          reloadKey={todayReload}
          onOpenChat={openMessageById}
          onSeePosts={() => openNetworkFeed('places')}
        />

        <InkField style={s.search} focused={!!query}>
          <Icon name="search" size={19} color={theme.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search people or places"
            placeholderTextColor={theme.muted}
            autoCorrect={false}
            style={s.searchInput}
          />
          {!!query && (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <Icon name="close" size={17} color={theme.muted} />
            </Pressable>
          )}
        </InkField>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filters}>
          {FILTERS.map((filter, index) => {
            const active = activeType === filter.key;
            return (
              <SpringPressable
                key={filter.key || 'all'}
                onPress={() => setActiveType(filter.key)}
                style={({ pressed }) => [
                  s.filter,
                  inkBox(theme, active ? 'ink' : 'thin', active ? theme.ink : theme.graphite),
                  !active && { borderStyle: 'dashed' },
                  active && marker(theme, 1),
                  pressed && marker(theme, 1),
                  { transform: [{ rotate: index % 2 ? '1deg' : '-1deg' }] },
                ]}
                scaleTo={motion.scale.row}
                haptic="selection"
              >
                <Icon name={filter.icon} size={14} color={active ? theme.ink : theme.graphite} />
                <Text style={[type.labelSm, { color: active ? theme.ink : theme.graphite }]}>{filter.short.toUpperCase()}</Text>
              </SpringPressable>
            );
          })}
        </ScrollView>

        {!!error && (
          <View style={[s.error, { backgroundColor: theme.dangerContainer, borderColor: theme.danger }]}>
            <Icon name="alert-circle-outline" size={17} color={theme.danger} />
            <Text style={[type.bodySm, { color: theme.danger, flex: 1 }]}>{error}</Text>
          </View>
        )}

        <SectionTitle theme={theme} title="Your places" note={`${joinedPlaces.length} JOINED`} />
        {joinedPlaces.length ? (
          <View style={s.joinedWrap}>
            {joinedPlaces.map((place) => (
              <TapeChip
                key={place.id}
                label={`${place.name}${place.title ? ` · ${place.title}` : ''}`.toUpperCase()}
                tone="accent"
                style={{ maxWidth: '100%' }}
              />
            ))}
            <SpringPressable onPress={() => setPickerOpen(true)} style={({ pressed }) => [s.addPlaceChip, inkBox(theme, 'thin'), pressed && marker(theme, 1)]} scaleTo={motion.scale.row} haptic="selection">
              <Icon name="add" size={15} color={theme.ink} />
              <Text style={[type.labelXs, { color: theme.ink }]}>ADD A PLACE</Text>
            </SpringPressable>
          </View>
        ) : (
          <View style={[s.onboarding, inkBox(theme, 'ink')]}>
            <View style={[s.onboardingIcon, { backgroundColor: theme.highlighter }]}>
              <Icon name="school-outline" size={27} color={theme.ink} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[type.headlineSm, { color: theme.text }]}>Start with your college or workplace</Text>
              <Text style={[type.bodySm, { color: theme.subtext, marginTop: 5 }]}>
                Add a place to your profile. Everyone who joins that same place appears here.
              </Text>
              <SpringPressable onPress={() => setPickerOpen(true)} style={({ pressed }) => [s.onboardingButton, inkBox(theme, 'ink'), pressed && marker(theme, 1)]} scaleTo={motion.scale.row} haptic="selection">
                <Icon name="add" size={16} color={theme.ink} />
                <Text style={[type.labelSm, { color: theme.ink }]}>ADD YOUR FIRST PLACE</Text>
              </SpringPressable>
            </View>
          </View>
        )}

        {/* Discover places moved to the top so colleges / institutions are visible first */}
        <SectionTitle theme={theme} title="Discover places" note="JOIN DIRECTLY" />
        <View style={{ gap: 10 }}>
          {discoverPlaces.map((place) => {
            const meta = affiliationType(place.type);
            return (
              <View key={place.id} style={[s.placeRow, inkBox(theme, 'thin')]}>
                <View style={s.placeIcon}>
                  <Icon name={meta.icon} size={20} color={theme.ink} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[type.bodyStrong, { color: theme.text }]} numberOfLines={1}>{place.name}</Text>
                  <Text style={[type.labelXs, { color: theme.muted, marginTop: 3 }]}>
                    {meta.short.toUpperCase()} · {place.memberCount} {place.memberCount === 1 ? 'MEMBER' : 'MEMBERS'}
                  </Text>
                </View>
                {place.joined ? (
                  <TapeChip label="JOINED" tone="accent" />
                ) : (
                  <ActionButton theme={theme} label="Join" icon="add" onPress={() => joinPlace(place)} busy={busy === `place:${place.id}`} />
                )}
              </View>
            );
          })}
          {!discoverPlaces.length && !loading && (
            <Text style={[type.bodySm, { color: theme.muted, paddingVertical: 14 }]}>No registered places match this search.</Text>
          )}
        </View>

        <SpringPressable onPress={() => setPickerOpen(true)} style={({ pressed }) => [s.registerButton, inkBox(theme, 'ink'), pressed && marker(theme, 1)]} scaleTo={motion.scale.row} haptic="selection">
          <Icon name="add-circle-outline" size={19} color={theme.ink} />
          <Text style={[type.labelSm, { color: theme.ink }]}>REGISTER OR ADD ANOTHER PLACE</Text>
        </SpringPressable>

        {requests.length > 0 && (
          <>
            <SectionTitle theme={theme} title="Requests waiting" note={`${requests.length} NEW`} />
            <View style={[s.requestPanel, inkBox(theme, 'ink')]}>
              {requests.map((request, index) => (
                <View key={request.id}>
                  <View style={s.requestRow}>
                    <Avatar uri={request.user.avatar} name={request.user.name} id={request.user.id} size={46} profileId={request.user.id} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <EmojiText style={[type.bodyStrong, { color: theme.text, flexShrink: 1 }]}>{request.user.name}</EmojiText>
                        {hasGoldTick(request.user) && <GoldTick size={14} />}
                      </View>
                      <Text style={[type.labelXs, { color: theme.muted, marginTop: 3 }]} numberOfLines={1}>
                        {request.user.sharedAffiliations?.map((a) => a.name).join(' · ').toUpperCase()}
                      </Text>
                    </View>
                    <ActionButton theme={theme} label="Accept" onPress={() => respond(request.id, 'accept')} busy={busy === `request:${request.id}:accept`} filled />
                    <Pressable onPress={() => respond(request.id, 'decline')} hitSlop={8} style={{ padding: 6 }}>
                      <Icon name="close" size={18} color={theme.muted} />
                    </Pressable>
                  </View>
                  {index < requests.length - 1 && <View style={[dashedRule(theme), { marginVertical: 8 }]} />}
                </View>
              ))}
            </View>
          </>
        )}

        {/* Dedicated section for colleagues — all discovered people live inside "Your colleagues" */}
        <View style={s.colleaguesSection}>
          <SectionTitle theme={theme} title="Your colleagues" note={`${colleagues.length} FOUND`} />

          {loading ? (
            <ActivityIndicator color={theme.ink} style={{ marginVertical: 50 }} />
          ) : colleagues.length ? (
            <View style={s.cardGrid}>
              {colleagues.map((person, index) => {
                const lead = person.sharedAffiliations?.[0];
                return (
                  <View
                    key={person.id}
                    style={[
                      s.card,
                      isTablet && s.cardWide,
                      raised(theme, index % 3 === 2 ? 2 : 1),
                      inkBox(theme, index % 3 === 2 ? 'ink' : 'thin', index % 3 === 2 ? theme.ink : theme.graphiteLine),
                      { transform: [{ rotate: CARD_TILTS[index % CARD_TILTS.length] }] },
                    ]}
                  >
                    <View style={[s.tape, { backgroundColor: theme.cardAlt, left: index % 2 ? 24 : '42%', transform: [{ rotate: index % 2 ? '5deg' : '-4deg' }] }]} />
                    <View style={s.cardHead}>
                      <View style={{ transform: [{ rotate: index % 2 ? '-3deg' : '5deg' }] }}>
                        <Avatar uri={person.avatar} name={person.name} id={person.id} size={62} online={person.isOnline} weight={index % 3 === 0 ? 'ink' : 'thin'} profileId={person.id} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <EmojiText style={[type.headlineSm, { color: theme.text, fontSize: 21, flexShrink: 1 }]} numberOfLines={1}>{person.name}</EmojiText>
                          {hasGoldTick(person) && <GoldTick size={16} />}
                        </View>
                        <Text style={[type.labelXs, { color: theme.graphite, marginTop: 4 }]} numberOfLines={2}>
                          {lead?.title ? `${lead.title} @ ${lead.name}` : lead?.name || handleFor(person)}
                        </Text>
                      </View>
                    </View>

                    <View style={[dashedRule(theme), { marginTop: 14, marginBottom: 11 }]} />
                    <EmojiText style={[type.bodySm, { color: theme.text, minHeight: 42 }]} numberOfLines={2}>
                      {person.about || 'A colleague from your shared network.'}
                    </EmojiText>

                    <View style={s.cardTags}>
                      {(person.sharedAffiliations || []).slice(0, 2).map((place) => (
                        <TapeChip key={place.id} label={place.name.toUpperCase()} />
                      ))}
                    </View>

                    <View style={{ marginTop: 15 }}>{relationshipButton(person)}</View>
                  </View>
                );
              })}
            </View>
          ) : (
            <View style={[s.empty, inkBox(theme, 'thin')]}>
              <Icon name="people-outline" size={31} color={theme.muted} />
              <Text style={[type.headlineSm, { color: theme.text, marginTop: 12, textAlign: 'center' }]}>No colleagues found yet</Text>
              <Text style={[type.bodySm, { color: theme.subtext, marginTop: 6, textAlign: 'center', maxWidth: 360 }]}>
                {joinedPlaces.length
                  ? 'Invite people to add the same place to their profile, or try another search.'
                  : 'Add an institution, organization or workplace to begin.'}
              </Text>
            </View>
          )}
        </View>
      </Animated.ScrollView>

      <AffiliationPicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onChanged={() => load({ quiet: true })}
      />
    </View>
  );
}

function SectionTitle({ theme, title, note }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginTop: 30, marginBottom: 12 }}>
      <View>
        <Text style={[type.headlineMd, { color: theme.text, fontSize: 22 }]}>{title}</Text>
        <View style={{ height: 3, backgroundColor: theme.ink, borderRadius: 3, marginTop: 3, transform: [{ rotate: '-1deg' }] }} />
      </View>
      <Text style={[type.labelXs, { color: theme.muted, marginBottom: 3 }]}>{note}</Text>
    </View>
  );
}

function ActionButton({ theme, label, icon, onPress, busy, filled, subtle }) {
  return (
    <SpringPressable
      onPress={onPress}
      disabled={busy}
      android_ripple={rippleFor(theme)}
      style={({ pressed }) => [
        styles.actionButton,
        inkBox(theme, filled ? 'ink' : 'thin'),
        filled && { backgroundColor: theme.ink },
        subtle && { borderStyle: 'dashed' },
        pressed && Platform.OS !== 'android' && !filled ? marker(theme, 1) : null,
        busy && { opacity: 0.55 },
      ]}
      scaleTo={motion.scale.row}
      haptic="selection"
    >
      {busy
        ? <ActivityIndicator size="small" color={filled ? theme.onPrimary : theme.ink} />
        : <>
            {!!icon && <Icon name={icon} size={14} color={filled ? theme.onPrimary : theme.ink} />}
            <Text style={[type.labelSm, { color: filled ? theme.onPrimary : theme.ink }]}>{label.toUpperCase()}</Text>
          </>}
    </SpringPressable>
  );
}

const makeStyles = (t) => StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 100 },
  contentWide: { maxWidth: 1080, width: '100%', alignSelf: 'center', paddingHorizontal: 30 },
  hero: { marginBottom: 22 },
  title: { ...type.headlineLg, color: t.text, transform: [{ rotate: '-1deg' }] },
  brush: { height: 5, width: 210, marginTop: 5, borderRadius: 5, transform: [{ rotate: '-1deg' }] },
  search: { marginBottom: 14 },
  searchInput: { flex: 1, ...type.bodyMd, color: t.text, paddingVertical: 10, outlineStyle: 'none' },
  filters: { gap: 10, paddingVertical: 3, paddingRight: 10 },
  filter: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 9, paddingHorizontal: 13 },
  error: { flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, padding: 11, marginTop: 12 },
  joinedWrap: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  addPlaceChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 9, borderStyle: 'dashed' },
  onboarding: { flexDirection: 'row', alignItems: 'flex-start', gap: 15, padding: 17 },
  onboardingIcon: { width: 50, height: 50, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  onboardingButton: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 7, paddingVertical: 8, paddingHorizontal: 11, marginTop: 13 },
  requestPanel: { padding: 14 },
  requestRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 18 },
  card: { width: '100%', padding: 18, paddingBottom: 20, backgroundColor: t.card, position: 'relative', marginTop: 4 },
  cardWide: { width: '48%' },
  tape: { position: 'absolute', width: 50, height: 15, top: -8, opacity: 0.86 },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  cardTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 11 },
  empty: { alignItems: 'center', padding: 32, borderStyle: 'dashed' },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13 },
  placeIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  registerButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingVertical: 12, marginTop: 14 },
  colleaguesSection: { marginTop: 8, paddingTop: 2 },
});

const styles = StyleSheet.create({
  actionButton: {
    minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 8, paddingHorizontal: 12,
  },
});
