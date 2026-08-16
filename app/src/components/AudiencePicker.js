import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, TextInput, FlatList, ActivityIndicator } from 'react-native';
import Icon from '../icons/Icon';
import { useTheme } from '../store/ThemeContext';
import { api } from '../api';
import { Avatar, InkCheckbox, EmptyState } from './common';
import { EmojiText } from '../icons/Emoji';
import { type, inkBox, marker, dashedRule } from '../theme';

export const AUDIENCE = {
  public: { key: 'public', label: 'Public', sub: 'Everyone on 友達 can see this', icon: 'earth-outline' },
  contacts: { key: 'contacts', label: 'Friends', sub: 'Only people you already chat with', icon: 'people-outline' },
  selected: { key: 'selected', label: 'Selected people', sub: 'Pick exactly who sees it', icon: 'person-add-outline' },
};

/**
 * Three-way audience selector for a status post: Public / Friends (contacts)
 * / Selected people. Choosing "Selected" opens an inline contact picker with
 * checkboxes, matching the app's existing InkCheckbox / list treatment.
 */
export default function AudiencePicker({ audience, onChange, recipientIds, onChangeRecipients }) {
  const { theme } = useTheme();
  const [users, setUsers] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const s = makeStyles(theme);

  useEffect(() => {
    if (audience !== 'selected' || users.length) return;
    setLoading(true);
    api.users().then(({ users }) => setUsers(users)).catch(() => {}).finally(() => setLoading(false));
  }, [audience]);

  const filtered = users.filter((u) => {
    const q = query.toLowerCase();
    return u.name.toLowerCase().includes(q) || (u.username && u.username.includes(q));
  });

  const toggle = (id) => {
    onChangeRecipients(recipientIds.includes(id) ? recipientIds.filter((x) => x !== id) : [...recipientIds, id]);
  };

  return (
    <View>
      <View style={s.optionsRow}>
        {Object.values(AUDIENCE).map((opt) => {
          const active = audience === opt.key;
          return (
            <Pressable
              key={opt.key}
              onPress={() => onChange(opt.key)}
              style={({ pressed }) => [
                s.option,
                inkBox(theme, active ? 'ink' : 'thin'),
                active ? { backgroundColor: theme.highlighterWash } : null,
                pressed && !active ? marker(theme, 1) : null,
              ]}
            >
              <Icon name={opt.icon} size={18} color={theme.ink} />
              <Text style={[type.labelSm, { color: theme.ink, textAlign: 'center', marginTop: 6 }]}>{opt.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[type.bodySm, { color: theme.subtext, marginTop: 8 }]}>{AUDIENCE[audience]?.sub}</Text>

      {audience === 'selected' && (
        <View style={[s.pickerWrap, inkBox(theme, 'thin')]}>
          <View style={s.searchRow}>
            <Icon name="search" size={16} color={theme.muted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search people…"
              placeholderTextColor={theme.muted}
              style={s.searchInput}
            />
          </View>
          {loading ? (
            <ActivityIndicator color={theme.ink} style={{ marginVertical: 20 }} />
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(u) => u.id}
              style={{ maxHeight: 220 }}
              ItemSeparatorComponent={() => <View style={[dashedRule(theme), { marginHorizontal: 4 }]} />}
              ListEmptyComponent={<EmptyState icon="person-outline" title="No one found" />}
              renderItem={({ item }) => {
                const checked = recipientIds.includes(item.id);
                return (
                  <Pressable onPress={() => toggle(item.id)} style={({ pressed }) => [s.personRow, pressed ? marker(theme, 1) : null]}>
                    <InkCheckbox checked={checked} onPress={() => toggle(item.id)} size={18} />
                    <Avatar uri={item.avatar} name={item.name} id={item.id} size={34} />
                    <EmojiText style={[type.bodyMd, { color: theme.text, flex: 1 }]} numberOfLines={1}>{item.name}</EmojiText>
                  </Pressable>
                );
              }}
            />
          )}
          {!!recipientIds.length && (
            <Text style={[type.labelXs, { color: theme.muted, marginTop: 8 }]}>
              {recipientIds.length} selected
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  optionsRow: { flexDirection: 'row', gap: 8 },
  option: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, paddingHorizontal: 4 },
  pickerWrap: { marginTop: 12, padding: 10 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4, paddingBottom: 8 },
  searchInput: { flex: 1, color: t.text, paddingVertical: 6, outlineStyle: 'none' },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, paddingHorizontal: 4 },
});
