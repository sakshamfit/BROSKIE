import React, { useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, TextInput, Modal, ActivityIndicator, FlatList } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../icons/Icon';
import { useTheme } from '../store/ThemeContext';
import { api } from '../api';
import { useDebouncedCallback } from '../rateLimit';
import SongCard from './SongCard';
import { type, inkBox, marker, dashedRule } from '../theme';
import { SpringPressable, motion } from '../motion';

/**
 * Full-screen song search sheet — shared by the Status composer and
 * the Network "New Post" composer so attaching a song works identically
 * (and looks identical) in both places. Results come from the iTunes
 * Search API (zero-config, 30-second previews); full-length Jamendo
 * tracks are appended when the server has a JAMENDO_CLIENT_ID.
 */
export default function SongPicker({ visible, onClose, onSelect }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const s = makeStyles(theme);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [notice, setNotice] = useState('');

  // Debounce the Jamendo lookup: the picker is typed into rapidly, and each
  // keystroke used to fire a full server-side song search. The input itself
  // (`query`) updates instantly; only the network call waits for a pause.
  // `searchSeq` discards out-of-order responses.
  const searchSeq = useRef(0);
  const searchSongs = useDebouncedCallback(async (q, seq) => {
    if (q.trim().length < 2) { setResults([]); return; }
    setLoading(true);
    try {
      const { tracks, configured: c, error } = await api.searchSongs(q.trim());
      if (searchSeq.current !== seq) return;
      setResults(tracks);
      setConfigured(c !== false);
      setNotice(error || '');
    } catch {
      if (searchSeq.current === seq) setResults([]);
    } finally {
      if (searchSeq.current === seq) setLoading(false);
    }
  }, 300);

  const search = (q) => {
    setQuery(q);
    const seq = ++searchSeq.current;
    if (q.trim().length < 2) { setResults([]); setLoading(false); searchSongs.cancel(); return; }
    searchSongs(q, seq);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[s.screen, { backgroundColor: theme.bg, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
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
          />
        </View>

        {!configured && (
          <Text style={[type.bodySm, { color: theme.muted, marginTop: 16, paddingHorizontal: 4 }]}>
            Song search isn't available on the server right now.
          </Text>
        )}
        {configured && !!notice && (
          <Text style={[type.bodySm, { color: theme.muted, marginTop: 16, paddingHorizontal: 4 }]}>
            Song search is temporarily unavailable ({notice}). You can still post text and photos.
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
              <SpringPressable onPress={() => onSelect(item)} style={({ pressed }) => [pressed ? marker(theme, 1) : null]} scaleTo={motion.scale.row} haptic="selection">
                <SongCard song={item} />
              </SpringPressable>
            )}
          />
        )}
      </View>
    </Modal>
  );
}

const makeStyles = (t) => StyleSheet.create({
  screen: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 18 },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, minHeight: 48, marginHorizontal: 20 },
  searchInput: { flex: 1, ...type.bodyLg, color: t.text, paddingVertical: 10, outlineStyle: 'none' },
});
