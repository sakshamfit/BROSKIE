import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, TextInput, FlatList, ActivityIndicator } from 'react-native';
import Icon from '../icons/Icon';
import { useTheme } from '../store/ThemeContext';
import { api } from '../api';
import { Avatar, InkCheckbox, EmptyState, GoldTick, hasGoldTick } from './common';
import { EmojiText } from '../icons/Emoji';
import { type, inkBox, marker, dashedRule } from '../theme';
import { SpringPressable, motion } from '../motion';

export const AUDIENCE = {
  public: { key: 'public', label: 'Public', sub: 'Everyone on +one can see this', icon: 'earth-outline' },
  places: { key: 'places', label: 'My places', sub: 'People who share your college or workplace', icon: 'school-outline' },
  contacts: { key: 'contacts', label: 'Friends', sub: 'Only people you already chat with', icon: 'people-outline' },
  contacts_except: { key: 'contacts_except', label: 'Friends except…', sub: 'All friends except the people you choose', icon: 'person-remove-outline' },
  selected: { key: 'selected', label: 'Private', sub: 'Only the people you choose can see it', icon: 'lock-closed-outline' },
};

const DEFAULT_OPTIONS = ['public', 'places', 'contacts', 'selected'];

/**
 * Reusable audience selector. Network uses the default Public / Friends /
 * Private grid; Status can pass the WhatsApp-style Friends-except option and
 * a vertical radio-list layout. Inclusion/exclusion people are picked inline.
 */
export default function AudiencePicker({
  audience, onChange, recipientIds, onChangeRecipients, options = DEFAULT_OPTIONS, layout = 'grid',
  contactsOnly = false,
}) {
  const { theme } = useTheme();
  const [users, setUsers] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const s = makeStyles(theme);
  const optionItems = options
    .map((option) => (typeof option === 'string' ? AUDIENCE[option] : option))
    .filter(Boolean);
  const choosingPeople = audience === 'selected' || audience === 'contacts_except';
  const activeMeta = optionItems.find((option) => option.key === audience) || AUDIENCE[audience];
  const listLayout = layout === 'list';

  useEffect(() => {
    if (!choosingPeople || users.length) return;
    setLoading(true);
    (async () => {
      try {
        const { users: list } = await api.users('', { contactsOnly });
        setUsers(list);
      } catch {} finally {
        setLoading(false);
      }
    })();
  }, [choosingPeople, contactsOnly, users.length]);

  const filtered = users.filter((u) => {
    const q = query.toLowerCase();
    return u.name.toLowerCase().includes(q) || (u.username && u.username.includes(q));
  });

  const toggle = (id) => {
    onChangeRecipients(recipientIds.includes(id) ? recipientIds.filter((x) => x !== id) : [...recipientIds, id]);
  };

  return (
    <View>
      <View style={listLayout ? s.optionsList : s.optionsRow}>
        {optionItems.map((opt) => {
          const active = audience === opt.key;
          return (
            <SpringPressable
              key={opt.key}
              onPress={() => onChange(opt.key)}
              style={({ pressed }) => [
                listLayout ? s.optionList : s.option,
                listLayout ? { borderBottomColor: theme.graphiteLine } : inkBox(theme, active ? 'ink' : 'thin'),
                !listLayout && active ? { backgroundColor: theme.highlighterWash } : null,
                pressed && !active ? marker(theme, 1) : null,
              ]}
              scaleTo={motion.scale.row}
              haptic="selection"
            >
              <Icon name={opt.icon} size={listLayout ? 21 : 18} color={theme.ink} />
              {listLayout ? (
                <>
                  <View style={{ flex: 1 }}>
                    <Text style={[type.bodyStrong, { color: theme.text }]}>{opt.label}</Text>
                    <Text style={[type.bodySm, { color: theme.subtext, marginTop: 2 }]}>{opt.sub}</Text>
                  </View>
                  <View style={[s.radio, { borderColor: active ? theme.ink : theme.graphiteLine }]}>
                    {active && <View style={[s.radioDot, { backgroundColor: theme.ink }]} />}
                  </View>
                </>
              ) : (
                <Text style={[type.labelSm, { color: theme.ink, textAlign: 'center', marginTop: 6 }]}>{opt.label}</Text>
              )}
            </SpringPressable>
          );
        })}
      </View>
      {!listLayout && (
        <Text style={[type.bodySm, { color: theme.subtext, marginTop: 8 }]}>{activeMeta?.sub}</Text>
      )}

      {choosingPeople && (
        <View style={[s.pickerWrap, inkBox(theme, 'thin')]}>
          <View style={s.searchRow}>
            <Icon name="search" size={16} color={theme.muted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={audience === 'contacts_except' ? 'Search people to exclude…' : 'Search people…' }
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
                  <SpringPressable onPress={() => toggle(item.id)} style={({ pressed }) => [s.personRow, pressed ? marker(theme, 1) : null]} scaleTo={motion.scale.row} haptic="selection">
                    <InkCheckbox checked={checked} onPress={() => toggle(item.id)} size={18} />
                    <Avatar uri={item.avatar} name={item.name} id={item.id} size={34} />
                    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      <EmojiText style={[type.bodyMd, { color: theme.text, flexShrink: 1 }]} numberOfLines={1}>{item.name}</EmojiText>
                      {hasGoldTick(item) && <GoldTick size={13} />}
                    </View>
                  </SpringPressable>
                );
              }}
            />
          )}
          {!!recipientIds.length && (
            <Text style={[type.labelXs, { color: theme.muted, marginTop: 8 }]}>
              {recipientIds.length} {audience === 'contacts_except' ? 'excluded' : 'selected'}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  optionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optionsList: { width: '100%' },
  option: { flex: 1, flexBasis: '40%', minWidth: 0, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, paddingHorizontal: 4 },
  optionList: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 4, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  radio: { width: 22, height: 22, borderRadius: 999, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 11, height: 11, borderRadius: 999 },
  pickerWrap: { marginTop: 12, padding: 10 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4, paddingBottom: 8 },
  searchInput: { flex: 1, color: t.text, paddingVertical: 6, outlineStyle: 'none' },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, paddingHorizontal: 4 },
});
