import React, { useMemo, useState } from 'react';
import { View, Pressable, StyleSheet, TextInput, FlatList } from 'react-native';
import Icon from '../icons/Icon';
import Emoji from '../icons/Emoji';
import { useTheme } from '../store/ThemeContext';
import { FadeSlide, SpringPressable, haptic } from '../motion';
import { inkBox, type } from '../theme';
import META from '../icons/emojiMeta.json';
import { Text } from './Text';

/**
 * Cross-platform emoji picker. Every glyph renders through <Emoji> from the
 * complete Fluent Emoji 3D table, with per-sequence Twemoji vector fallbacks
 * only where Microsoft has no exact 3D asset. Flags, keycaps, ZWJ families,
 * and newer emoji therefore never render blank.
 *
 * Tabbed by category (Smileys … Symbols, Flags), CLDR-name + keyword-tag
 * search ("fire" finds 🔥, "lit" finds it too), and WhatsApp-style
 * skin-tone variants: long-press any person/hand emoji to slide open the
 * tone strip, then tap the exact tone you want.
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
  { key: 'flags', label: 'Flags', icon: 'flag-outline' },
];

const ALL_CHARS = CATEGORIES.flatMap((c) => META.categories[c.key] || []);

export default function EmojiPicker({ visible, onSelect }) {
  const { theme } = useTheme();
  const [tab, setTab] = useState('smileys');
  const [query, setQuery] = useState('');
  const [toneFor, setToneFor] = useState(null); // base char whose tone strip is open
  const s = makeStyles(theme);

  const grid = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q) {
      return ALL_CHARS.filter((ch) => {
        if ((META.names[ch] || '').toLowerCase().includes(q)) return true;
        const tags = META.tags?.[ch];
        return !!tags && tags.some((t) => t.includes(q));
      }).slice(0, 240);
    }
    return META.categories[tab] || [];
  }, [tab, query]);

  if (!visible) return null;

  const toneChoices = toneFor ? [toneFor, ...(META.tones?.[toneFor] || [])] : null;

  return (
    <FadeSlide from="up" distance={14} duration={220}>
    <View style={[styles.wrap, { backgroundColor: theme.card }, inkBox(theme, 'ink')]}>
      <View style={styles.searchRow}>
        <Icon name="search" size={15} color={theme.muted} />
        <TextInput
          value={query}
          onChangeText={(t) => { setQuery(t); if (t) setToneFor(null); }}
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
                onPress={() => { setTab(c.key); setToneFor(null); }}
                accessibilityLabel={c.label}
                accessibilityRole="button"
                style={[styles.tabBtn, active && { backgroundColor: theme.highlighterWash }]}
              >
                <Icon name={c.icon} size={16} color={active ? theme.ink : theme.muted} />
              </Pressable>
            );
          })}
        </View>
      )}

      {toneChoices && (
        <View style={[styles.toneBar, { borderBottomColor: theme.graphiteLine, backgroundColor: theme.cardAlt || theme.card }]}>
          <Text style={[type.labelXs, { color: theme.muted }]}>TONE</Text>
          <View style={styles.toneOpts}>
            {toneChoices.map((ch) => (
              <SpringPressable
                key={ch}
                onPress={() => { haptic('selection'); onSelect(ch); setToneFor(null); }}
                style={styles.toneBtn}
                scaleTo={0.82}
              >
                <Emoji char={ch} size={26} />
              </SpringPressable>
            ))}
          </View>
          <Pressable onPress={() => setToneFor(null)} hitSlop={8} style={styles.toneClose}>
            <Icon name="close" size={14} color={theme.muted} />
          </Pressable>
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
        initialNumToRender={64}
        renderItem={({ item }) => (
          <SpringPressable
            onPress={() => onSelect(item)}
            onLongPress={META.tones?.[item] ? () => { haptic('selection'); setToneFor(item); } : undefined}
            delayLongPress={260}
            style={styles.emojiBtn}
            scaleTo={0.82}
          >
            <Emoji char={item} size={27} />
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
  toneBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 7,
    borderBottomWidth: 1, borderStyle: 'dashed',
  },
  toneOpts: { flex: 1, flexDirection: 'row', justifyContent: 'space-evenly' },
  toneBtn: { alignItems: 'center', justifyContent: 'center', padding: 3 },
  toneClose: { padding: 4 },
  grid: { maxHeight: 220 },
  gridContent: { paddingVertical: 6, paddingHorizontal: 4 },
  emojiBtn: { width: '12.5%', alignItems: 'center', paddingVertical: 6 },
});
