import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, TextInput, Modal, ScrollView,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../icons/Icon';
import { api } from '../api';
import { useAuth } from '../store/AuthContext';
import { useTheme } from '../store/ThemeContext';
import { InkButton, InkField, TapeChip } from './common';
import { type, inkBox, marker, dashedRule, stroke } from '../theme';
import { SpringPressable, motion } from '../motion';

export const AFFILIATION_TYPES = [
  { key: 'institution', label: 'College / Institution', short: 'Institution', icon: 'school-outline' },
  { key: 'organization', label: 'Organization', short: 'Organization', icon: 'people-outline' },
  { key: 'workplace', label: 'Workplace', short: 'Workplace', icon: 'construct-outline' },
];

export function affiliationType(typeKey) {
  return AFFILIATION_TYPES.find((item) => item.key === typeKey) || AFFILIATION_TYPES[0];
}

/**
 * Search an existing place or register a new one. Joining a place writes it
 * to the profile and immediately makes its members discoverable in Colleagues.
 */
export default function AffiliationPicker({ visible, onClose, onChanged }) {
  const { theme } = useTheme();
  const { refreshUser } = useAuth();
  const insets = useSafeAreaInsets();
  const [selectedType, setSelectedType] = useState('institution');
  const [query, setQuery] = useState('');
  const [title, setTitle] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const s = makeStyles(theme);

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    setTitle('');
    setError('');
    setSelectedType('institution');
  }, [visible]);

  useEffect(() => {
    if (!visible) return undefined;
    let alive = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const { affiliations } = await api.affiliations({ q: query.trim(), type: selectedType });
        if (alive) setResults(affiliations);
      } catch (e) {
        if (alive) setError(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    }, 180);
    return () => { alive = false; clearTimeout(timer); };
  }, [visible, query, selectedType]);

  const exactMatch = useMemo(() => {
    const normalized = query.trim().toLowerCase().replace(/\s+/g, ' ');
    return results.some((item) => item.name.toLowerCase().replace(/\s+/g, ' ') === normalized);
  }, [query, results]);

  const finish = async (work, id) => {
    setBusyId(id);
    setError('');
    try {
      await work();
      const fresh = await refreshUser();
      onChanged?.(fresh.affiliations || []);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  };

  const join = (item) => finish(() => api.joinAffiliation(item.id, title.trim()), item.id);
  const create = () => {
    const name = query.trim();
    if (name.length < 2) { setError('Enter the full name of your college, organization or workplace.'); return; }
    finish(() => api.createAffiliation({ name, type: selectedType, title: title.trim() }), 'create');
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={[s.root, { backgroundColor: theme.bg, paddingTop: insets.top, paddingBottom: insets.bottom }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={s.header}>
          <Pressable onPress={onClose} hitSlop={10} style={{ padding: 6 }}>
            <Icon name="close" size={23} color={theme.ink} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={[type.headlineMd, { color: theme.text }]}>Add your place</Text>
            <Text style={[type.labelXs, { color: theme.muted, marginTop: 3 }]}>FIND THE PEOPLE YOU STUDY OR WORK WITH</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          <Text style={[type.labelXs, { color: theme.muted, marginBottom: 10 }]}>WHAT KIND OF PLACE?</Text>
          <View style={s.typeRow}>
            {AFFILIATION_TYPES.map((item, index) => {
              const active = item.key === selectedType;
              return (
                <SpringPressable
                  key={item.key}
                  onPress={() => { setSelectedType(item.key); setError(''); }}
                  style={({ pressed }) => [
                    s.typeButton,
                    inkBox(theme, active ? 'ink' : 'thin', active ? theme.ink : theme.graphite),
                    active && marker(theme, 1),
                    pressed && marker(theme, 1),
                    { transform: [{ rotate: index === 1 ? '1deg' : '-1deg' }] },
                  ]}
                  scaleTo={motion.scale.row}
                  haptic="selection"
                >
                  <Icon name={item.icon} size={17} color={active ? theme.ink : theme.graphite} />
                  <Text style={[type.labelXs, { color: active ? theme.ink : theme.graphite }]}>{item.short.toUpperCase()}</Text>
                </SpringPressable>
              );
            })}
          </View>

          <Text style={[type.labelXs, { color: theme.muted, marginTop: 24, marginBottom: 7 }]}>PLACE NAME</Text>
          <InkField focused={!!query}>
            <Icon name="search" size={18} color={theme.muted} />
            <TextInput
              value={query}
              onChangeText={(value) => { setQuery(value); if (error) setError(''); }}
              placeholder={`Search ${affiliationType(selectedType).label.toLowerCase()}…`}
              placeholderTextColor={theme.muted}
              autoCapitalize="words"
              autoCorrect={false}
              style={s.input}
            />
          </InkField>

          <Text style={[type.labelXs, { color: theme.muted, marginTop: 22, marginBottom: 7 }]}>COURSE, DEPARTMENT OR ROLE · OPTIONAL</Text>
          <InkField>
            <Icon name="id-card-outline" size={18} color={theme.muted} />
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. B.Tech CSE, Design, Product Lead"
              placeholderTextColor={theme.muted}
              maxLength={80}
              style={s.input}
            />
          </InkField>

          {!!error && <Text style={[type.bodySm, { color: theme.danger, marginTop: 14 }]}>{error}</Text>}

          <View style={[dashedRule(theme), { marginTop: 24 }]} />
          <Text style={[type.labelXs, { color: theme.muted, marginTop: 18, marginBottom: 10 }]}>MATCHING PLACES</Text>

          {loading ? (
            <ActivityIndicator color={theme.ink} style={{ marginVertical: 28 }} />
          ) : results.length ? (
            <View style={{ gap: 10 }}>
              {results.map((item) => (
                <View key={item.id} style={[s.result, inkBox(theme, 'thin')]}>
                  <View style={s.resultIcon}>
                    <Icon name={affiliationType(item.type).icon} size={20} color={theme.ink} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[type.bodyStrong, { color: theme.text }]} numberOfLines={2}>{item.name}</Text>
                    <Text style={[type.labelXs, { color: theme.muted, marginTop: 3 }]}>
                      {affiliationType(item.type).short.toUpperCase()} · {item.memberCount} {item.memberCount === 1 ? 'MEMBER' : 'MEMBERS'}
                    </Text>
                  </View>
                  {item.joined ? (
                    <TapeChip label="JOINED" tone="accent" />
                  ) : (
                    <InkButton
                      label={busyId === item.id ? 'Joining…' : 'Join'}
                      onPress={() => join(item)}
                      disabled={!!busyId}
                      style={{ paddingVertical: 8, paddingHorizontal: 13 }}
                      textStyle={type.labelSm}
                    />
                  )}
                </View>
              ))}
            </View>
          ) : (
            <Text style={[type.bodySm, { color: theme.subtext, paddingVertical: 18 }]}>
              {query.trim() ? 'No matching place yet. Register it below.' : 'Start typing to find an existing place.'}
            </Text>
          )}

          {!!query.trim() && !exactMatch && (
            <SpringPressable
              onPress={create}
              disabled={!!busyId}
              style={({ pressed }) => [s.createCard, inkBox(theme, 'ink'), pressed && marker(theme, 1), !!busyId && { opacity: 0.5 }]}
              scaleTo={motion.scale.row}
              haptic="selection"
            >
              <View style={[s.plus, { backgroundColor: theme.ink }]}>
                {busyId === 'create'
                  ? <ActivityIndicator size="small" color={theme.onPrimary} />
                  : <Icon name="add" size={19} color={theme.onPrimary} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[type.bodyStrong, { color: theme.text }]}>Register “{query.trim()}”</Text>
                <Text style={[type.labelXs, { color: theme.muted, marginTop: 3 }]}>CREATE & JOIN AS {affiliationType(selectedType).short.toUpperCase()}</Text>
              </View>
              <Icon name="arrow-forward" size={18} color={theme.ink} />
            </SpringPressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (t) => StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: stroke.ink, borderBottomColor: t.ink,
  },
  content: { width: '100%', maxWidth: 640, alignSelf: 'center', padding: 22, paddingBottom: 70 },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  typeButton: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, paddingVertical: 10 },
  input: { flex: 1, ...type.bodyMd, color: t.text, paddingVertical: 10, outlineStyle: 'none' },
  result: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, backgroundColor: t.card },
  resultIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  createCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginTop: 18 },
  plus: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 999 },
});
