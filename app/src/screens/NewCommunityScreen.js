import React, { useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView, TextInput, ActivityIndicator,
  KeyboardAvoidingView, Platform, Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../icons/Icon';
import { useTheme } from '../store/ThemeContext';
import { api } from '../api';
import useResponsive from '../hooks/useResponsive';
import { rippleFor } from '../components/common';
import { CATEGORY_LIST, JOIN_POLICY_LIST } from '../components/communityMeta';
import { dashedRule, marker, radius, type, raised } from '../theme';

/**
 * Full-screen "New Community" composer — mirrors NewPostScreen's structure
 * (close X, centered sketch-underlined title, canvas-style inputs, a
 * category grid, a join-policy picker, fixed-bottom transmit button) so
 * creating a purpose-based group (club night, house party, trip planning,
 * running group, chai chat…) feels native to the rest of the app.
 */
export default function NewCommunityScreen({ visible, onClose, onCreated }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { isTablet } = useResponsive();
  const s = makeStyles(theme);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('custom');
  const [joinPolicy, setJoinPolicy] = useState('request');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setName(''); setDescription(''); setCategory('custom'); setJoinPolicy('request'); setError('');
  };
  const close = () => { reset(); onClose(); };

  const submit = async () => {
    if (!name.trim()) { setError('Give your community a name.'); return; }
    setBusy(true);
    setError('');
    try {
      const { community } = await api.createCommunity({
        name: name.trim(), description: description.trim(), category, joinPolicy, visibility: 'public',
      });
      onCreated?.(community);
      close();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView
        style={[s.root, { backgroundColor: theme.bg }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
      >
        <View style={[s.header, { paddingTop: 20 + insets.top, borderBottomColor: theme.graphiteLine }]}>
          <Pressable
            onPress={close}
            hitSlop={8}
            android_ripple={rippleFor(theme, { borderless: true, radius: 22 })}
            style={[s.closeBtn, { borderColor: theme.ink }]}
          >
            <Icon name="close" size={19} color={theme.ink} />
          </Pressable>
          <View style={s.headerTitleWrap}>
            <Text style={[type.headlineMd, { fontSize: 22, color: theme.text }]}>New Community</Text>
            <View style={[s.underline, { backgroundColor: theme.ink, transform: [{ rotate: '-1deg' }] }]} />
          </View>
          <View style={{ width: 38 }} />
        </View>

        <ScrollView
          contentContainerStyle={[s.scroll, isTablet && s.scrollWide]}
          keyboardShouldPersistTaps="handled"
        >
          <View>
            <Text style={[type.labelXs, { color: theme.muted, marginBottom: 8 }]}>WHAT ARE YOU PLANNING?</Text>
            <TextInput
              style={[s.nameInput, raised(theme, 1), { borderColor: theme.ink, backgroundColor: theme.card, color: theme.text }]}
              placeholder="e.g. Saturday Club Night, Rishikesh Trip…"
              placeholderTextColor={theme.muted}
              value={name}
              onChangeText={(v) => { setName(v); if (error) setError(''); }}
              maxLength={60}
            />
          </View>

          <View>
            <Text style={[type.labelXs, { color: theme.muted, marginBottom: 8, marginTop: 20 }]}>DETAILS (OPTIONAL)</Text>
            <TextInput
              style={[s.descInput, raised(theme, 1), { borderColor: theme.ink, backgroundColor: theme.card, color: theme.text }]}
              placeholder="Who's invited, when, where, the vibe…"
              placeholderTextColor={theme.muted}
              value={description}
              onChangeText={setDescription}
              multiline
              maxLength={280}
              textAlignVertical="top"
            />
          </View>

          <View style={{ marginTop: 24 }}>
            <Text style={[s.sketchLabel, { color: theme.graphite }]}>Pick a category…</Text>
            <View style={s.categoryGrid}>
              {CATEGORY_LIST.map((c) => {
                const active = category === c.key;
                return (
                  <Pressable
                    key={c.key}
                    onPress={() => setCategory(c.key)}
                    style={({ pressed }) => [
                      s.categoryCard,
                      raised(theme, active ? 2 : 1),
                      { borderColor: theme.graphiteLine, backgroundColor: theme.card, transform: [{ translateY: pressed ? 2 : 0 }] },
                      active && { backgroundColor: theme.highlighter, borderColor: theme.ink },
                      pressed && !active ? marker(theme, 1) : null,
                    ]}
                  >
                    <Icon name={c.icon} size={20} color={theme.text} />
                    <Text style={[type.labelSm, { color: theme.text, marginTop: 6, textAlign: 'center' }]}>{c.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={{ marginTop: 24 }}>
            <Text style={[s.sketchLabel, { color: theme.graphite }]}>Who can join…</Text>
            <View style={{ gap: 10, marginTop: 4 }}>
              {JOIN_POLICY_LIST.map((p) => {
                const active = joinPolicy === p.key;
                return (
                  <Pressable
                    key={p.key}
                    onPress={() => setJoinPolicy(p.key)}
                    style={({ pressed }) => [
                      s.policyRow,
                      raised(theme, active ? 2 : 1),
                      { borderColor: theme.graphiteLine, backgroundColor: theme.card, transform: [{ translateY: pressed ? 2 : 0 }] },
                      active && { backgroundColor: theme.highlighter, borderColor: theme.ink },
                      pressed && !active ? marker(theme, 1) : null,
                    ]}
                  >
                    <Icon name={p.icon} size={18} color={theme.text} />
                    <View style={{ flex: 1 }}>
                      <Text style={[type.bodyMd, { color: theme.text }]}>{p.label}</Text>
                      <Text style={[type.bodySm, { color: theme.subtext, marginTop: 1 }]}>{p.blurb}</Text>
                    </View>
                    {active && <Icon name="checkmark-circle" size={18} color={theme.ink} />}
                  </Pressable>
                );
              })}
            </View>
            <Text style={[type.labelXs, { color: theme.muted, marginTop: 10 }]}>
              As the creator, you'll be the admin — only admins can approve requests, add or remove
              members, and manage this community.
            </Text>
          </View>

          {!!error && (
            <View style={s.errorRow}>
              <Icon name="alert-circle" size={14} color={theme.danger} />
              <Text style={[type.bodySm, { color: theme.danger }]}>{error}</Text>
            </View>
          )}

          <View style={{ height: 100 }} />
        </ScrollView>

        <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={isTablet ? s.footerInnerWide : s.footerInner}>
            <Pressable
              onPress={submit}
              disabled={busy}
              android_ripple={rippleFor(theme, { color: 'rgba(255,255,255,0.25)' })}
              style={({ pressed }) => [
                s.createBtn,
                raised(theme, 2),
                { backgroundColor: pressed && Platform.OS !== 'android' ? '#242321' : '#050505', borderColor: '#000000' },
                busy && { opacity: 0.6 },
              ]}
            >
              {busy ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <>
                  <Icon name="people-outline" size={19} color="#ffffff" />
                  <Text style={[type.headlineSm, { fontSize: 17, color: '#ffffff', textTransform: 'uppercase', letterSpacing: 1 }]}>
                    Start Community
                  </Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (t) => StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1, borderStyle: 'dashed',
  },
  closeBtn: { width: 38, height: 38, borderRadius: 4, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  headerTitleWrap: { alignItems: 'center' },
  underline: { height: 3, width: '110%', borderRadius: 3, marginTop: 2, opacity: 0.85 },

  scroll: { padding: 20, paddingTop: 24 },
  scrollWide: { maxWidth: 640, width: '100%', alignSelf: 'center' },

  nameInput: { width: '100%', borderWidth: 2, borderRadius: 6, padding: 16, ...type.bodyLg, outlineStyle: 'none' },
  descInput: { width: '100%', minHeight: 90, borderWidth: 1, borderRadius: 6, padding: 14, ...type.bodyMd, outlineStyle: 'none' },

  sketchLabel: { fontFamily: 'Caveat_700Bold', fontSize: 26, transform: [{ rotate: '-1deg' }], marginBottom: 10 },

  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  categoryCard: {
    width: '31%', aspectRatio: 1.05, borderWidth: 2, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6,
  },
  policyRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 2, borderRadius: 10, padding: 14 },

  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16 },

  footer: { paddingHorizontal: 20, paddingTop: 12 },
  footerInner: { width: '100%' },
  footerInnerWide: { maxWidth: 640, width: '100%', alignSelf: 'center' },
  createBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    paddingVertical: 16, borderWidth: 3, borderRadius: 8,
  },
});
