import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, Modal, TextInput, RefreshControl,
  ActivityIndicator, Image, FlatList, useWindowDimensions,
} from 'react-native';
import Icon from '../icons/Icon';
import { EmojiText } from '../icons/Emoji';
import { api, mediaUrl } from '../api';
import { useAuth } from '../store/AuthContext';
import { useTheme } from '../store/ThemeContext';
import { useChat } from '../store/ChatContext';
import { Avatar, formatChatTime } from '../components/common';
import AudiencePicker, { AUDIENCE } from '../components/AudiencePicker';
import SongCard from '../components/SongCard';
import { radius, type, inkBox, marker, dashedRule, stroke, tokens } from '../theme';
import * as ImagePicker from 'expo-image-picker';

// paper-and-ink status backgrounds
const BG_COLORS = ['#FFE24D', '#1c1b1b', '#e2e3de', '#fdf8f8', '#c8c6c5', '#5d5f5b'];
const TILTS = [-1.2, 0.9, -0.6, 1.4, -0.9, 0.6, -1.4, 1.1];

export default function StatusScreen() {
  const { user } = useAuth();
  const { theme } = useTheme();
  const { onStatusEvent } = useChat();
  const { width } = useWindowDimensions();
  const [data, setData] = useState({ mine: null, others: [] });
  const [composer, setComposer] = useState(false);
  const [viewer, setViewer] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const s = makeStyles(theme);
  const columns = width >= 900 ? 3 : width >= 640 ? 2 : 1;

  const load = useCallback(async () => {
    try { setData(await api.statuses()); } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // live: someone posted a status we're allowed to see
  useEffect(() => {
    if (!onStatusEvent) return;
    return onStatusEvent(() => load());
  }, [onStatusEvent, load]);

  const openViewer = async (group) => {
    setViewer({ group, index: 0 });
    if (group.items[0]) { await api.viewStatus(group.items[0].id); }
  };

  const nextStatus = async () => {
    if (!viewer) return;
    const next = viewer.index + 1;
    if (next >= viewer.group.items.length) { setViewer(null); load(); return; }
    setViewer({ ...viewer, index: next });
    await api.viewStatus(viewer.group.items[next].id);
  };

  const current = viewer?.group.items[viewer.index];

  // Flatten every visible status into a feed of "Trending" cards, newest first —
  // this is the mockup's masonry grid, built from real status content.
  const feed = useMemo(() => {
    const groups = [...(data.mine ? [data.mine] : []), ...data.others];
    const items = [];
    groups.forEach((g) => g.items.forEach((it) => items.push({ ...it, author: g.user })));
    return items.sort((a, b) => b.createdAt - a.createdAt);
  }, [data]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={theme.ink} />
      ) : (
        <ScrollView
          contentContainerStyle={s.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={theme.ink} />}
        >
          <View style={s.headerRow}>
            <View>
              <Text style={s.pageTitle}>Discover</Text>
              <Text style={[type.bodyMd, { color: theme.subtext, marginTop: 6, maxWidth: 420 }]}>
                Share a page publicly, with friends, or just the people you pick — text, a photo, or a song.
              </Text>
            </View>
          </View>

          {/* ---------------- Fresh Ink: story rail ---------------- */}
          <View style={s.storiesSection}>
            <View style={s.sectionTitleRow}>
              <Text style={s.sectionTitle}>Fresh Ink</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.storiesRow}>
              <Pressable
                onPress={() => (data.mine ? openViewer(data.mine) : setComposer(true))}
                style={s.storyItem}
              >
                <View style={[s.storyRing, s.storyAdd, { borderColor: theme.graphiteLine }]}>
                  <Avatar uri={user?.avatar} name={user?.name} id={user?.id} size={64} />
                  <Pressable onPress={() => setComposer(true)} style={[s.plusBadge, { backgroundColor: theme.highlighter, borderColor: theme.ink }]}>
                    <Icon name="add" size={13} color={theme.ink} />
                  </Pressable>
                </View>
                <Text style={[type.labelXs, { color: theme.text, marginTop: 6 }]} numberOfLines={1}>Your page</Text>
              </Pressable>

              {data.mine && (
                <Pressable onPress={() => openViewer(data.mine)} style={s.storyItem}>
                  <View style={[s.storyRing, { borderColor: theme.ink, borderWidth: 3 }]}>
                    <Avatar uri={user?.avatar} name={user?.name} id={user?.id} size={64} />
                  </View>
                  <Text style={[type.labelXs, { color: theme.text, fontWeight: '700', marginTop: 6 }]} numberOfLines={1}>
                    {data.mine.items.length} update{data.mine.items.length > 1 ? 's' : ''}
                  </Text>
                </Pressable>
              )}

              {data.others.map((g) => (
                <Pressable key={g.user.id} onPress={() => openViewer(g)} style={s.storyItem}>
                  <View style={[s.storyRing, { borderColor: g.allViewed ? theme.graphiteLine : theme.ink, borderWidth: g.allViewed ? 2 : 3 }]}>
                    <Avatar uri={g.user.avatar} name={g.user.name} id={g.user.id} size={64} />
                  </View>
                  <Text style={[type.labelXs, { color: g.allViewed ? theme.secondary : theme.text, fontWeight: g.allViewed ? '400' : '700', marginTop: 6 }]} numberOfLines={1}>
                    @{g.user.name.split(' ')[0].toLowerCase()}
                  </Text>
                </Pressable>
              ))}

              {!data.others.length && !data.mine && (
                <Text style={[type.bodySm, { color: theme.muted, paddingVertical: 20, paddingHorizontal: 4 }]}>
                  No pages yet — be the first to sketch one.
                </Text>
              )}
            </ScrollView>
          </View>

          {/* ---------------- Trending: masonry-ish feed ---------------- */}
          {feed.length > 0 && (
            <>
              <View style={s.dividerWrap}>
                <View style={[dashedRule(theme), { flex: 1 }]} />
                <Text style={[type.labelXs, { color: theme.secondary, marginHorizontal: 12 }]}>TRENDING</Text>
                <View style={[dashedRule(theme), { flex: 1 }]} />
              </View>

              <View style={[s.grid, { gap: 20 }]}>
                {feed.map((item, i) => (
                  <View key={item.id} style={{ width: columns === 1 ? '100%' : `${100 / columns}%` }}>
                    <View style={{ paddingHorizontal: 10 }}>
                      <TrendingCard
                        item={item}
                        theme={theme}
                        tilt={TILTS[i % TILTS.length]}
                        onPress={() => {
                          const g = item.author.id === user.id ? data.mine : data.others.find((x) => x.user.id === item.author.id);
                          if (!g) return;
                          const idx = g.items.findIndex((x) => x.id === item.id);
                          setViewer({ group: g, index: Math.max(idx, 0) });
                          api.viewStatus(item.id);
                        }}
                      />
                    </View>
                  </View>
                ))}
              </View>
            </>
          )}
        </ScrollView>
      )}

      <Pressable
        onPress={() => setComposer(true)}
        style={({ pressed }) => [s.fab, inkBox(theme, 'bold'), { backgroundColor: pressed ? theme.highlighter : theme.ink }]}
      >
        <Icon name="create-outline" size={21} color={theme.onPrimary} />
      </Pressable>

      <Composer visible={composer} onClose={() => setComposer(false)} onPosted={load} />

      {/* viewer */}
      <Modal visible={!!viewer} animationType="fade" onRequestClose={() => { setViewer(null); load(); }}>
        {current && (
          <View style={[s.viewer, { backgroundColor: current.type === 'image' ? '#111' : current.bg }]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={nextStatus} />
            <View style={s.progressRow} pointerEvents="none">
              {viewer.group.items.map((_, i) => (
                <View key={i} style={[s.progressBar, { backgroundColor: i <= viewer.index ? (current.type === 'image' ? '#fff' : tokens.onSurface) : 'rgba(120,120,120,0.35)' }]} />
              ))}
            </View>
            <View style={s.viewerHeader} pointerEvents="box-none">
              <Avatar uri={viewer.group.user.avatar} name={viewer.group.user.name} id={viewer.group.user.id} size={42} />
              <View style={{ flex: 1 }}>
                <EmojiText style={[type.headlineSm, { color: current.type === 'image' ? '#fff' : tokens.onSurface }]}>
                  {viewer.group.user.id === user.id ? 'My page' : viewer.group.user.name}
                </EmojiText>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Icon name={AUDIENCE[current.audience]?.icon || 'earth-outline'} size={11} color={current.type === 'image' ? 'rgba(255,255,255,0.7)' : 'rgba(28,27,27,0.55)'} />
                  <Text style={[type.labelXs, { color: current.type === 'image' ? 'rgba(255,255,255,0.7)' : 'rgba(28,27,27,0.55)' }]}>
                    {formatChatTime(current.createdAt)} · {AUDIENCE[current.audience]?.label || 'Public'}
                  </Text>
                </View>
              </View>
              <Pressable onPress={() => { setViewer(null); load(); }} hitSlop={10} style={{ padding: 4 }}>
                <Icon name="close" size={23} color={current.type === 'image' ? '#fff' : tokens.onSurface} />
              </Pressable>
            </View>

            <View style={s.viewerBody} pointerEvents="box-none">
              {current.type === 'image' ? (
                <Image source={{ uri: mediaUrl(current.mediaUrl) }} style={s.viewerImage} resizeMode="contain" />
              ) : (
                <EmojiText style={[s.viewerText, { color: tokens.onSurface }]}>{current.body}</EmojiText>
              )}
              {!!current.song && (
                <View style={s.viewerSong} pointerEvents="box-none">
                  <SongCard song={current.song} tint={current.type === 'image' ? '#fff' : tokens.onSurface} />
                </View>
              )}
              {current.type === 'image' && !!current.body && (
                <Text style={[type.bodyMd, { color: '#fff', textAlign: 'center', marginTop: 14, paddingHorizontal: 20 }]}>
                  {current.body}
                </Text>
              )}
            </View>

            <Text style={[type.labelXs, { color: current.type === 'image' ? 'rgba(255,255,255,0.5)' : 'rgba(28,27,27,0.4)', textAlign: 'center', paddingBottom: 34 }]}>
              Tap anywhere to continue
            </Text>
          </View>
        )}
      </Modal>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* trending card — polaroid/tape/torn-paper treatments from the mockup */
/* ------------------------------------------------------------------ */

function TrendingCard({ item, theme, tilt, onPress }) {
  const s = makeStyles(theme);
  const audienceMeta = AUDIENCE[item.audience] || AUDIENCE.public;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        s.card,
        inkBox(theme, item.type === 'image' ? 'bold' : 'thin'),
        { backgroundColor: item.type === 'text' && item.bg && item.bg !== '#fdf8f8' ? item.bg : theme.card },
        { transform: [{ rotate: `${tilt}deg` }, { translateY: pressed ? -2 : 0 }] },
      ]}
    >
      <View style={[s.tape, { backgroundColor: theme.cardAlt, borderColor: theme.graphiteLine }]} />

      <View style={s.cardHead}>
        <Avatar uri={item.author.avatar} name={item.author.name} id={item.author.id} size={30} />
        <View style={{ flex: 1 }}>
          <Text style={[type.labelSm, { color: cardFg(item, theme) }]} numberOfLines={1}>@{item.author.name.split(' ')[0].toLowerCase()}</Text>
          <Text style={[type.labelXs, { color: cardFg(item, theme), opacity: 0.6, marginTop: 2 }]}>{formatChatTime(item.createdAt)}</Text>
        </View>
        <Icon name={audienceMeta.icon} size={13} color={cardFg(item, theme)} style={{ opacity: 0.7 }} />
      </View>

      {item.type === 'image' && (
        <View style={[s.cardImageWrap, inkBox(theme, 'thin')]}>
          <Image source={{ uri: mediaUrl(item.mediaUrl) }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        </View>
      )}

      {!!item.body && (
        <EmojiText
          style={[
            item.type === 'text' ? type.bodyLg : type.bodyMd,
            { color: cardFg(item, theme), marginTop: item.type === 'image' ? 10 : 4, fontStyle: item.type === 'text' ? 'italic' : 'normal' },
          ]}
          numberOfLines={item.type === 'text' ? 6 : 3}
        >
          {item.body}
        </EmojiText>
      )}

      {!!item.song && (
        <View style={{ marginTop: 10 }}>
          <SongCard song={item.song} compact tint={cardFg(item, theme)} />
        </View>
      )}
    </Pressable>
  );
}

function cardFg(item, theme) {
  if (item.type === 'text' && (item.bg === '#1c1b1b' || item.bg === '#5d5f5b')) return '#fdf8f8';
  return theme.text;
}

/* ------------------------------------------------------------------ */
/* composer                                                            */
/* ------------------------------------------------------------------ */

function Composer({ visible, onClose, onPosted }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const [body, setBody] = useState('');
  const [bg, setBg] = useState(BG_COLORS[0]);
  const [image, setImage] = useState(null);
  const [song, setSong] = useState(null);
  const [songPicker, setSongPicker] = useState(false);
  const [audience, setAudience] = useState('public');
  const [recipientIds, setRecipientIds] = useState([]);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setBody(''); setBg(BG_COLORS[0]); setImage(null); setSong(null);
    setAudience('public'); setRecipientIds([]); setError('');
  };

  const pickImage = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.75 });
      if (res.canceled || !res.assets?.length) return;
      setImage(res.assets[0]);
    } catch (e) { setError(e.message); }
  };

  const post = async () => {
    if (!body.trim() && !image && !song) { setError('Write something, or attach a photo or a song.'); return; }
    if (audience === 'selected' && !recipientIds.length) { setError('Pick at least one person.'); return; }
    setPosting(true);
    setError('');
    try {
      let mediaUrlOut = null;
      let type = 'text';
      if (image) {
        const up = await api.uploadFile(image.uri, image.fileName || 'status.jpg', image.mimeType || 'image/jpeg');
        mediaUrlOut = up.url;
        type = 'image';
      }
      await api.postStatus({
        type, body: body.trim(), mediaUrl: mediaUrlOut, bg,
        song, audience, recipientIds: audience === 'selected' ? recipientIds : [],
      });
      reset();
      onClose();
      onPosted?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setPosting(false);
    }
  };

  return (
    <>
      <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
        <View style={[s.composerScreen, { backgroundColor: theme.bg }]}>
          <ScrollView contentContainerStyle={s.composerScroll} keyboardShouldPersistTaps="handled">
            <View style={s.composerTopBar}>
              <Pressable onPress={onClose} hitSlop={8} style={{ padding: 6 }}>
                <Icon name="close" size={24} color={theme.ink} />
              </Pressable>
              <Text style={[type.headlineSm, { color: theme.text }]}>New page</Text>
              <View style={{ width: 36 }} />
            </View>

            <View style={[s.previewCard, { backgroundColor: image ? theme.card : bg }, inkBox(theme, 'ink')]}>
              {image ? (
                <>
                  <Image source={{ uri: image.uri }} style={s.previewImage} resizeMode="cover" />
                  <Pressable onPress={() => setImage(null)} style={[s.previewImageX, { backgroundColor: theme.ink }]}>
                    <Icon name="close" size={14} color={theme.onPrimary} />
                  </Pressable>
                </>
              ) : null}
              <TextInput
                style={[s.previewInput, { color: bg === '#1c1b1b' && !image ? '#fdf8f8' : image ? theme.text : tokens.onSurface }]}
                placeholder="Type a status…"
                placeholderTextColor={image ? theme.muted : (bg === '#1c1b1b' ? 'rgba(253,248,248,0.45)' : 'rgba(28,27,27,0.4)')}
                value={body}
                onChangeText={setBody}
                multiline
                textAlign="center"
              />
              {!!song && (
                <View style={s.previewSong}>
                  <SongCard song={song} tint={bg === '#1c1b1b' && !image ? '#fdf8f8' : tokens.onSurface} />
                  <Pressable onPress={() => setSong(null)} hitSlop={8} style={{ padding: 6 }}>
                    <Icon name="close" size={16} color={theme.muted} />
                  </Pressable>
                </View>
              )}
            </View>

            {!image && (
              <View style={s.colorRow}>
                {BG_COLORS.map((c) => (
                  <Pressable
                    key={c}
                    onPress={() => setBg(c)}
                    style={[s.swatch, { backgroundColor: c, borderColor: tokens.onSurface }, bg === c && s.swatchActive]}
                  />
                ))}
              </View>
            )}

            <View style={s.attachRow}>
              <Pressable onPress={pickImage} style={({ pressed }) => [s.attachBtn, inkBox(theme, 'thin'), pressed ? marker(theme, 1) : null]}>
                <Icon name="image-outline" size={17} color={theme.ink} />
                <Text style={[type.labelSm, { color: theme.ink }]}>Photo</Text>
              </Pressable>
              <Pressable onPress={() => setSongPicker(true)} style={({ pressed }) => [s.attachBtn, inkBox(theme, 'thin'), pressed ? marker(theme, 1) : null]}>
                <Icon name="musical-notes-outline" size={17} color={theme.ink} />
                <Text style={[type.labelSm, { color: theme.ink }]}>Song</Text>
              </Pressable>
            </View>

            <Text style={[type.labelXs, { color: theme.muted, marginTop: 22, marginBottom: 10 }]}>WHO CAN SEE THIS</Text>
            <AudiencePicker
              audience={audience}
              onChange={setAudience}
              recipientIds={recipientIds}
              onChangeRecipients={setRecipientIds}
            />

            {!!error && (
              <View style={s.errorRow}>
                <Icon name="alert-circle" size={14} color={theme.danger} />
                <Text style={[type.bodySm, { color: theme.danger }]}>{error}</Text>
              </View>
            )}

            <Pressable
              onPress={post}
              disabled={posting}
              style={({ pressed }) => [
                s.postBtn, inkBox(theme, 'bold'),
                { backgroundColor: pressed ? theme.highlighter : theme.ink },
                posting && { opacity: 0.6 },
              ]}
            >
              {posting ? <ActivityIndicator color={theme.onPrimary} /> : (
                <>
                  <Icon name="send" size={16} color={theme.onPrimary} />
                  <Text style={[type.bodyStrong, { color: theme.onPrimary }]}>Post page</Text>
                </>
              )}
            </Pressable>
          </ScrollView>
        </View>
      </Modal>

      <SongPicker visible={songPicker} onClose={() => setSongPicker(false)} onSelect={(t) => { setSong(t); setSongPicker(false); }} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* song picker (Jamendo search)                                        */
/* ------------------------------------------------------------------ */

function SongPicker({ visible, onClose, onSelect }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [notice, setNotice] = useState('');

  const search = async (q) => {
    setQuery(q);
    if (q.trim().length < 2) { setResults([]); return; }
    setLoading(true);
    try {
      const { tracks, configured: c, error } = await api.searchSongs(q.trim());
      setResults(tracks);
      setConfigured(c !== false);
      setNotice(error || '');
    } catch { setResults([]); } finally { setLoading(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[s.composerScreen, { backgroundColor: theme.bg }]}>
        <View style={s.composerTopBar}>
          <Pressable onPress={onClose} hitSlop={8} style={{ padding: 6 }}>
            <Icon name="close" size={24} color={theme.ink} />
          </Pressable>
          <Text style={[type.headlineSm, { color: theme.text }]}>Add a song</Text>
          <View style={{ width: 36 }} />
        </View>

        <View style={[s.searchWrap, inkBox(theme, 'ink')]}>
          <Icon name="search" size={18} color={theme.muted} />
          <TextInput
            value={query}
            onChangeText={search}
            placeholder="Search songs or artists…"
            placeholderTextColor={theme.muted}
            style={s.searchWrapInput}
            autoFocus
          />
        </View>

        {!configured && (
          <Text style={[type.bodySm, { color: theme.muted, marginTop: 16, paddingHorizontal: 4 }]}>
            Song search isn't configured on the server yet — set JAMENDO_CLIENT_ID.
          </Text>
        )}
        {configured && !!notice && (
          <Text style={[type.bodySm, { color: theme.muted, marginTop: 16, paddingHorizontal: 4 }]}>
            Song search is temporarily unavailable ({notice}). You can still post text and photo pages.
          </Text>
        )}

        {loading ? (
          <ActivityIndicator color={theme.ink} style={{ marginTop: 30 }} />
        ) : (
          <FlatList
            data={results}
            keyExtractor={(t) => t.id}
            contentContainerStyle={{ paddingTop: 12, paddingBottom: 40 }}
            ItemSeparatorComponent={() => <View style={[dashedRule(theme), { marginVertical: 2 }]} />}
            renderItem={({ item }) => (
              <Pressable onPress={() => onSelect(item)} style={({ pressed }) => [pressed ? marker(theme, 1) : null]}>
                <SongCard song={item} />
              </Pressable>
            )}
          />
        )}
      </View>
    </Modal>
  );
}

const makeStyles = (t) => StyleSheet.create({
  scroll: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 120, maxWidth: 1080, width: '100%', alignSelf: 'center' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 8 },
  pageTitle: { ...type.headlineLg, color: t.text },

  storiesSection: { marginTop: 22 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  sectionTitle: { ...type.headlineSm, fontSize: 20, color: t.text },
  storiesRow: { flexDirection: 'row', gap: 18, paddingVertical: 4, paddingHorizontal: 2 },
  storyItem: { alignItems: 'center', width: 76 },
  storyRing: { width: 70, height: 70, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  storyAdd: { borderWidth: 2, borderStyle: 'dashed' },
  plusBadge: { position: 'absolute', right: -2, bottom: -2, width: 22, height: 22, borderRadius: radius.full, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },

  dividerWrap: { flexDirection: 'row', alignItems: 'center', marginTop: 30, marginBottom: 18 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -10 },

  card: { padding: 14, position: 'relative', overflow: 'hidden' },
  tape: { position: 'absolute', top: -8, left: '50%', marginLeft: -28, width: 56, height: 20, borderWidth: 1, borderStyle: 'dashed', opacity: 0.85, transform: [{ rotate: '-3deg' }] },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  cardImageWrap: { width: '100%', aspectRatio: 1.1, marginTop: 12, overflow: 'hidden' },

  fab: { position: 'absolute', right: 24, bottom: 26, width: 54, height: 54, alignItems: 'center', justifyContent: 'center' },

  composerScreen: { flex: 1 },
  composerScroll: { padding: 20, paddingBottom: 60, maxWidth: 560, width: '100%', alignSelf: 'center' },
  composerTopBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  previewCard: { minHeight: 220, alignItems: 'center', justifyContent: 'center', padding: 20, position: 'relative', overflow: 'hidden' },
  previewImage: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.9 },
  previewImageX: { position: 'absolute', top: 10, right: 10, width: 26, height: 26, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  previewInput: { ...type.headlineMd, fontSize: 22, textAlign: 'center', width: '100%', maxHeight: 200, outlineStyle: 'none' },
  previewSong: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, width: '100%' },
  colorRow: { flexDirection: 'row', justifyContent: 'center', gap: 12, marginTop: 16 },
  swatch: { width: 28, height: 28, borderWidth: 1.5 },
  swatchActive: { borderWidth: 3 },

  attachRow: { flexDirection: 'row', gap: 12, marginTop: 20 },
  attachBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10 },

  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16 },
  postBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, marginTop: 24 },

  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, minHeight: 48, marginHorizontal: 20 },
  searchWrapInput: { flex: 1, ...type.bodyLg, color: t.text, paddingVertical: 10, outlineStyle: 'none' },

  viewer: { flex: 1, paddingTop: 48 },
  progressRow: { flexDirection: 'row', gap: 5, paddingHorizontal: 16, marginBottom: 14 },
  progressBar: { flex: 1, height: 3 },
  viewerHeader: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20 },
  viewerBody: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  viewerText: { ...type.headlineMd, fontSize: 26, textAlign: 'center', lineHeight: 40 },
  viewerImage: { width: '100%', height: '70%' },
  viewerSong: { marginTop: 20, width: '100%', maxWidth: 340 },
});
