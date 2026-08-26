import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, TextInput, Modal, ActivityIndicator,
  ScrollView, Platform, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../icons/Icon';
import { useTheme } from '../store/ThemeContext';
import { useAuth } from '../store/AuthContext';
import { api } from '../api';
import { useDebouncedCallback } from '../rateLimit';
import SongCard from './SongCard';
import { type, inkBox, marker, dashedRule } from '../theme';
import { SpringPressable, motion } from '../motion';

/**
 * Full-screen song search sheet — shared by the Status composer and
 * the Network "New Post" composer. Results come from iTunes + Deezer
 * (proxied), ranked so songs that match the user's vibe land first.
 *
 * Uses a ScrollView (not FlatList) so the list actually scrolls inside
 * a nested Modal — FlatList silently fails to scroll on web / status.
 */
export default function SongPicker({ visible, onClose, onSelect }) {
  const { theme } = useTheme();
  const { user, refreshUser } = useAuth();
  const insets = useSafeAreaInsets();
  const s = makeStyles(theme);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [notice, setNotice] = useState('');
  const [degraded, setDegraded] = useState(false);
  const [favoriteArtists, setFavoriteArtists] = useState(user?.music?.favoriteArtists || []);
  const [sections, setSections] = useState({ forYou: [], recents: [], trending: [] });
  const [suggestedArtists, setSuggestedArtists] = useState([]);
  const [artistDraft, setArtistDraft] = useState('');
  const [artistHits, setArtistHits] = useState([]);
  const [savingTaste, setSavingTaste] = useState(false);
  const [activeArtist, setActiveArtist] = useState(null);

  const searchSeq = useRef(0);

  const persistArtists = async (next) => {
    setFavoriteArtists(next);
    setSavingTaste(true);
    try {
      const data = await api.saveSongTaste(next);
      if (data?.music?.favoriteArtists) setFavoriteArtists(data.music.favoriteArtists);
      refreshUser?.().catch(() => {});
    } catch {
      /* keep optimistic list */
    } finally {
      setSavingTaste(false);
    }
  };

  const toggleArtist = (name) => {
    const clean = String(name || '').trim();
    if (!clean) return;
    const exists = favoriteArtists.some((a) => a.toLowerCase() === clean.toLowerCase());
    const next = exists
      ? favoriteArtists.filter((a) => a.toLowerCase() !== clean.toLowerCase())
      : [...favoriteArtists, clean].slice(0, 12);
    persistArtists(next);
  };

  const searchSongs = useDebouncedCallback(async (q, seq) => {
    if (q.trim().length < 2) { setResults([]); return; }
    setLoading(true);
    try {
      const data = await api.searchSongs(q.trim());
      if (searchSeq.current !== seq) return;
      setResults(data.results || data.tracks || []);
      setConfigured(data.configured !== false);
      setNotice(data.degraded ? '' : (data.error || ''));
      setDegraded(!!data.degraded);
      if (data.music?.favoriteArtists) setFavoriteArtists(data.music.favoriteArtists);
    } catch {
      if (searchSeq.current === seq) { setResults([]); setDegraded(true); }
    } finally {
      if (searchSeq.current === seq) setLoading(false);
    }
  }, 400);

  const searchArtists = useDebouncedCallback(async (q) => {
    const term = q.trim();
    if (term.length < 2) { setArtistHits([]); return; }
    try {
      const data = await api.searchSongs(term);
      const seen = new Set();
      const names = [];
      (data.results || data.tracks || []).forEach((t) => {
        const name = String(t.artist || '').trim();
        const key = name.toLowerCase();
        if (!name || seen.has(key)) return;
        seen.add(key);
        names.push(name);
      });
      setArtistHits(names.slice(0, 8));
    } catch {
      setArtistHits([]);
    }
  }, 350);

  const search = (q) => {
    setQuery(q);
    setActiveArtist(null);
    const seq = ++searchSeq.current;
    if (q.trim().length < 2) { setResults([]); setLoading(false); searchSongs.cancel(); return; }
    searchSongs(q, seq);
  };

  const loadBrowse = async () => {
    setBrowseLoading(true);
    try {
      const data = await api.browseSongs();
      setSections({
        forYou: data.sections?.forYou || [],
        recents: data.sections?.recents || [],
        trending: data.sections?.trending || [],
      });
      if (Array.isArray(data.favoriteArtists)) setFavoriteArtists(data.favoriteArtists);
      setSuggestedArtists(data.suggestedArtists || []);
    } catch {
      setSections({ forYou: [], recents: [], trending: [] });
    } finally {
      setBrowseLoading(false);
    }
  };

  useEffect(() => {
    if (!visible) return undefined;
    setQuery('');
    setResults([]);
    setNotice('');
    setDegraded(false);
    setActiveArtist(null);
    setArtistDraft('');
    setArtistHits([]);
    setFavoriteArtists(user?.music?.favoriteArtists || []);
    loadBrowse();
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const pick = (track) => {
    if (!track) return;
    api.recordSongHistory(track).catch(() => {});
    onSelect(track);
  };

  const openArtist = async (name) => {
    setActiveArtist(name);
    setQuery(name);
    const seq = ++searchSeq.current;
    searchSongs(name, seq);
  };

  const searching = query.trim().length >= 2;
  const showBrowse = !searching;

  const renderSong = (item) => (
    <SpringPressable
      key={item.id || `${item.title}-${item.artist}`}
      onPress={() => pick(item)}
      style={({ pressed }) => [pressed ? marker(theme, 1) : null]}
      scaleTo={motion.scale.row}
      haptic="selection"
    >
      <SongCard song={item} />
    </SpringPressable>
  );

  const Section = ({ title, hint, data }) => {
    if (!data?.length) return null;
    return (
      <View style={{ marginTop: 18 }}>
        <Text style={[type.labelXs, { color: theme.muted, marginBottom: 8 }]}>{title}</Text>
        {!!hint && <Text style={[type.bodySm, { color: theme.subtext, marginTop: -4, marginBottom: 8 }]}>{hint}</Text>}
        {data.map((item, i) => (
          <View key={item.id || `${title}-${i}`}>
            {i > 0 && <View style={[dashedRule(theme), { marginVertical: 2 }]} />}
            {renderSong(item)}
          </View>
        ))}
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[s.screen, { backgroundColor: theme.bg, paddingTop: insets.top, paddingBottom: insets.bottom }]}
      >
        <View style={s.topBar}>
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
            style={s.searchInput}
            autoFocus
            returnKeyType="search"
          />
          {!!query && (
            <Pressable onPress={() => search('')} hitSlop={8} style={{ padding: 4 }}>
              <Icon name="close-circle" size={16} color={theme.muted} />
            </Pressable>
          )}
        </View>

        <View style={s.listWrap}>
          <ScrollView
            style={s.scroller}
            contentContainerStyle={s.scrollContent}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            showsVerticalScrollIndicator
          >
            <View style={s.vibeBlock}>
              <View style={s.vibeHead}>
                <Text style={[type.labelXs, { color: theme.muted }]}>YOUR VIBE</Text>
                {savingTaste ? <ActivityIndicator size="small" color={theme.ink} /> : null}
              </View>
              <Text style={[type.bodySm, { color: theme.subtext, marginTop: 4, marginBottom: 10 }]}>
                Pick favourite artists so songs that match you show up first.
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
                {favoriteArtists.map((name) => (
                  <Pressable
                    key={name}
                    onPress={() => openArtist(name)}
                    onLongPress={() => toggleArtist(name)}
                    style={[s.chip, inkBox(theme, 'ink'), activeArtist === name ? marker(theme, 1) : null]}
                  >
                    <Text style={[type.labelXs, { color: theme.text }]}>{name.toUpperCase()}</Text>
                    <Pressable onPress={() => toggleArtist(name)} hitSlop={6} style={{ paddingLeft: 4 }}>
                      <Icon name="close" size={12} color={theme.muted} />
                    </Pressable>
                  </Pressable>
                ))}
                {suggestedArtists.filter((a) => !favoriteArtists.some((f) => f.toLowerCase() === a.toLowerCase())).slice(0, 4).map((name) => (
                  <Pressable key={`sug-${name}`} onPress={() => toggleArtist(name)} style={[s.chip, inkBox(theme, 'thin')]}>
                    <Icon name="add" size={12} color={theme.ink} />
                    <Text style={[type.labelXs, { color: theme.text }]}>{name.toUpperCase()}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <View style={[s.artistAdd, inkBox(theme, 'thin')]}>
                <TextInput
                  value={artistDraft}
                  onChangeText={(v) => { setArtistDraft(v); searchArtists(v); }}
                  placeholder="Add an artist…"
                  placeholderTextColor={theme.muted}
                  style={s.artistInput}
                  onSubmitEditing={() => {
                    if (artistDraft.trim()) { toggleArtist(artistDraft.trim()); setArtistDraft(''); setArtistHits([]); }
                  }}
                  returnKeyType="done"
                />
                <Pressable
                  onPress={() => {
                    if (artistDraft.trim()) { toggleArtist(artistDraft.trim()); setArtistDraft(''); setArtistHits([]); }
                  }}
                  hitSlop={8}
                  style={{ padding: 6 }}
                >
                  <Icon name="add" size={18} color={theme.ink} />
                </Pressable>
              </View>
              {artistHits.length > 0 && (
                <View style={{ marginTop: 6, gap: 4 }}>
                  {artistHits.map((name) => {
                    const on = favoriteArtists.some((a) => a.toLowerCase() === name.toLowerCase());
                    return (
                      <Pressable key={name} onPress={() => { toggleArtist(name); setArtistDraft(''); setArtistHits([]); }} style={s.artistHit}>
                        <Icon name={on ? 'checkmark' : 'person-outline'} size={14} color={theme.ink} />
                        <Text style={[type.bodySm, { color: theme.text, flex: 1 }]}>{name}</Text>
                        <Text style={[type.labelXs, { color: theme.muted }]}>{on ? 'SAVED' : 'ADD'}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>

            {!configured && (
              <Text style={[type.bodySm, { color: theme.muted, marginTop: 16 }]}>
                Song search isn't available on the server right now.
              </Text>
            )}
            {configured && !!notice && (
              <Text style={[type.bodySm, { color: theme.muted, marginTop: 16 }]}>
                Song search is temporarily unavailable ({notice}). You can still post text and photos.
              </Text>
            )}
            {configured && degraded && !loading && searching && results.length === 0 && (
              <Text style={[type.bodySm, { color: theme.muted, marginTop: 16 }]}>
                Couldn't load songs right now — try again.
              </Text>
            )}

            {searching ? (
              <>
                {loading && results.length === 0 ? (
                  <ActivityIndicator color={theme.ink} style={{ marginTop: 30 }} />
                ) : (
                  <>
                    {loading && (
                      <View style={s.inlineLoad}>
                        <ActivityIndicator size="small" color={theme.ink} />
                        <Text style={[type.labelXs, { color: theme.muted }]}>UPDATING</Text>
                      </View>
                    )}
                    {results.length === 0 && !loading && !degraded && (
                      <Text style={[type.bodySm, { color: theme.muted, marginTop: 20 }]}>
                        No songs matched “{query.trim()}”. Try the artist name too.
                      </Text>
                    )}
                    {results.map((item, i) => (
                      <View key={item.id || `r-${i}`}>
                        {i > 0 && <View style={[dashedRule(theme), { marginVertical: 2 }]} />}
                        {renderSong(item)}
                      </View>
                    ))}
                  </>
                )}
              </>
            ) : (
              <>
                {browseLoading && !sections.forYou.length && !sections.recents.length && !sections.trending.length ? (
                  <ActivityIndicator color={theme.ink} style={{ marginTop: 30 }} />
                ) : (
                  <>
                    <Section title="FOR YOU" hint="Ranked for your artists and recently used songs." data={sections.forYou} />
                    <Section title="RECENT" data={sections.recents} />
                    <Section title="TRENDING ON +ONE" data={sections.trending} />
                    {!browseLoading && !sections.forYou.length && !sections.recents.length && !sections.trending.length && (
                      <Text style={[type.bodySm, { color: theme.muted, marginTop: 22 }]}>
                        Search any song, or add a favourite artist to build your vibe.
                      </Text>
                    )}
                  </>
                )}
              </>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (t) => StyleSheet.create({
  screen: { flex: 1, height: '100%', ...(Platform.OS === 'web' ? { maxHeight: '100vh' } : {}) },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 14 },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, minHeight: 48, marginHorizontal: 20 },
  searchInput: { flex: 1, ...type.bodyLg, color: t.text, paddingVertical: 10, outlineStyle: 'none' },
  listWrap: { flex: 1, minHeight: 0, marginTop: 8 },
  scroller: { flex: 1, ...(Platform.OS === 'web' ? { overflowY: 'auto', height: '100%' } : {}) },
  scrollContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 48, flexGrow: 1 },
  vibeBlock: { marginBottom: 4 },
  vibeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 7 },
  artistAdd: { flexDirection: 'row', alignItems: 'center', minHeight: 42, paddingHorizontal: 10 },
  artistInput: { flex: 1, ...type.bodyMd, color: t.text, paddingVertical: 8, outlineStyle: 'none' },
  artistHit: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  inlineLoad: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, marginBottom: 6 },
});
