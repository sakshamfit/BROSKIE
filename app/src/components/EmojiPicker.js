import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, TextInput, FlatList } from 'react-native';
import Icon from '../icons/Icon';
import Emoji from '../icons/Emoji';
import { useTheme } from '../store/ThemeContext';
import { FadeSlide, SpringPressable } from '../motion';
import { inkBox, marker, type, dashedRule } from '../theme';
import META from '../icons/emojiMeta.json';

/**
 * Real, full-vector emoji picker — every glyph is rendered by <Emoji> from
 * the (now 1445-strong) Twemoji SVG set, so nothing here ever falls back to
 * a system font glyph (the old 32-emoji picker + regex fallback meant most
 * emoji people actually reach for rendered as ugly, inconsistent system
 * glyphs mixed in with the hand-picked vector ones — this fixes that by
 * covering the vast majority of commonly-used emoji as real SVGs).
 *
 * Tabbed by category (Smileys, People, Nature, Food, Travel, Activities,
 * Objects, Symbols) with a search box that matches against each emoji's
 * official CLDR name, so "fire" finds 🔥 even without knowing the tab.
 */
const CATEGORIES = [
  { key: 'smileys', label: 'Smileys', icon: 'happy-outline' },
  { key: 'people', label: 'People', icon: 'body-outline' },
  { key: 'nature', label: 'Nature', icon: 'paw-outline' },
  { key: 'food', label: 'Food', icon: 'pizza-outline' },
  { key: 'travel', label: 'Travel', icon: 'airplane-outline' },
  { key: 'activities', label: 'Activities', icon: 'football-outline' },
  { key: 'objects', label: 'Objects', icon: 'bulb-outline' },
  { key: 'symbols', label: 'Symbols', icon: 'heart-outline' },
];

const ALL_CHARS = CATEGORIES.flatMap((c) => META.categories[c.key] || []);

export default function EmojiPicker({ visible, onSelect }) {
  const { theme } = useTheme();
  const [tab, setTab] = useState('smileys');
  const [query, setQuery] = useState('');
  const s = makeStyles(theme);

  const grid = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q) {
      return ALL_CHARS.filter((ch) => (META.names[ch] || '').toLowerCase().includes(q)).slice(0, 200);
    }
    return META.categories[tab] || [];
  }, [tab, query]);

  if (!visible) return null;

  return (
    <FadeSlide from="up" distance={14} duration={220}>
    <View style={[styles.wrap, { backgroundColor: theme.card }, inkBox(theme, 'ink')]}>
      <View style={styles.searchRow}>
        <Icon name="search" size={15} color={theme.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search emoji…"
          placeholderTextColor={theme.muted}
          style={[styles.searchInput, { color: theme.text }]}
        />
        {!!query && (
          <Pressable onPress={() => setQuery('')} hitSlop={8}>
            <Icon name="close" size={15} color={theme.muted} />
          </Pressable>
        )}
      </View>

      {!query && (
        <View style={[styles.tabRow, { borderBottomColor: theme.graphiteLine }]}>
          {CATEGORIES.map((c) => {
            const active = tab === c.key;
            return (
              <Pressable
                key={c.key}
                onPress={() => setTab(c.key)}
                style={[styles.tabBtn, active && { backgroundColor: theme.highlighterWash }]}
              >
                <Icon name={c.icon} size={16} color={active ? theme.ink : theme.muted} />
              </Pressable>
            );
          })}
        </View>
      )}

      <FlatList
        data={grid}
        key={query ? 'search' : tab}
        keyExtractor={(ch, i) => ch + i}
        numColumns={8}
        style={styles.grid}
        contentContainerStyle={styles.gridContent}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <SpringPressable onPress={() => onSelect(item)} style={styles.emojiBtn} scaleTo={0.82}>
            <Emoji char={item} size={26} />
          </SpringPressable>
        )}
        ListEmptyComponent={
          <Text style={[type.bodySm, { color: theme.muted, textAlign: 'center', paddingVertical: 20 }]}>
            No emoji found.
          </Text>
        }
      />
    </View>
    </FadeSlide>
  );
}

const makeStyles = (t) => StyleSheet.create({
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  searchInput: { flex: 1, ...type.bodySm, paddingVertical: 4, outlineStyle: 'none' },
});

const styles = StyleSheet.create({
  wrap: { marginHorizontal: 16, marginBottom: 8, overflow: 'hidden' },
  tabRow: { flexDirection: 'row', borderBottomWidth: 1, borderStyle: 'dashed' },
  tabBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 9 },
  grid: { maxHeight: 220 },
  gridContent: { paddingVertical: 6, paddingHorizontal: 4 },
  emojiBtn: { width: '12.5%', alignItems: 'center', paddingVertical: 6 },
});
