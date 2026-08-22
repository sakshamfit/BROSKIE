import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, TextInput, Modal, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../icons/Icon';
import { api } from '../api';
import { useAuth } from '../store/AuthContext';
import { useTheme } from '../store/ThemeContext';
import useResponsive from '../hooks/useResponsive';
import { confirm } from '../hooks/confirm';
import { affiliationType } from '../components/affiliationMeta';
import { PaperCard, InkField, InkButton, TapeChip, FrostedBackdrop, GoldTick, hasGoldTick } from '../components/common';
import { type, inkBox, marker } from '../theme';
import { lazyComponent } from '../lazy';

const AffiliationPicker = lazyComponent(() => import('../components/AffiliationPicker'));

/** "Personal Information" — Name, Username, About, Phone. */
export default function PersonalInfoScreen({ navigation, embedded = false }) {
  const { user, refreshUser, updateProfile } = useAuth();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { isTablet } = useResponsive();
  const s = makeStyles(theme);

  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [affiliationPicker, setAffiliationPicker] = useState(false);
  const [removingAffiliation, setRemovingAffiliation] = useState(null);

  const openEdit = (field) => {
    setError('');
    setDraft(
      field === 'name' ? user.name
        : field === 'username' ? user.username
        : field === 'about' ? user.about
        : user.phone && !user.phone.startsWith('unset:') ? user.phone : ''
    );
    setEditing(field);
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const value = draft.trim();
      await updateProfile({ [editing]: value });
      setEditing(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const removeAffiliation = async (item) => {
    const ok = await confirm(`Remove ${item.name} from your profile?`, {
      title: 'Remove place', confirmLabel: 'Remove', destructive: true,
    });
    if (!ok) return;
    setRemovingAffiliation(item.id);
    try {
      await api.leaveAffiliation(item.id);
      await refreshUser();
    } catch (e) {
      setError(e.message);
    } finally {
      setRemovingAffiliation(null);
    }
  };

  const Row = ({ icon, label, value, onPress, verified = false }) => (
    <Pressable
      style={({ pressed, hovered }) => [s.row, inkBox(theme, 'thin'), (pressed || hovered) ? { backgroundColor: theme.cardAlt } : null]}
      onPress={onPress}
    >
      <Icon name={icon} size={19} color={theme.graphite} style={{ width: 26 }} />
      <View style={{ flex: 1 }}>
        <Text style={[type.bodyMd, { color: theme.text }]}>{label}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
          <Text style={[type.bodySm, { color: theme.subtext, flexShrink: 1 }]} numberOfLines={1}>{value || 'Not set'}</Text>
          {verified && <GoldTick size={13} />}
        </View>
      </View>
      <Icon name="chevron-forward-outline" size={16} color={theme.muted} />
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={[s.header, !embedded && { paddingTop: 20 + insets.top }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={{ padding: 6 }}>
          <Icon name="arrow-back" size={22} color={theme.ink} />
        </Pressable>
        <Text style={[type.headlineMd, { color: theme.text }]}>Personal Information</Text>
      </View>

      <ScrollView contentContainerStyle={[s.scroll, isTablet && s.scrollWide]}>
        <Text style={[type.labelXs, { color: theme.muted, marginBottom: 10 }]}>IDENTITY</Text>
        <View style={{ gap: 10, marginBottom: 24 }}>
          <Row icon="person-outline" label="Name" value={user?.name} onPress={() => openEdit('name')} />
          <Row icon="id-card-outline" label="Username" value={user?.username ? `@${user.username}` : null} onPress={() => openEdit('username')} verified={hasGoldTick(user)} />
          <Row icon="information-circle-outline" label="About" value={user?.about} onPress={() => openEdit('about')} />
        </View>

        <Text style={[type.labelXs, { color: theme.muted, marginBottom: 10 }]}>CONTACT</Text>
        <View style={{ gap: 10 }}>
          <Row
            icon="call-outline"
            label="Phone"
            value={user?.phone && !user.phone.startsWith('unset:') ? user.phone : null}
            onPress={() => openEdit('phone')}
          />
        </View>

        <View style={{ marginTop: 26, marginBottom: 10 }}>
          <Text style={[type.labelXs, { color: theme.muted }]}>COLLEGE, ORGANIZATION & WORK</Text>
          <Text style={[type.bodySm, { color: theme.subtext, marginTop: 5 }]}>Add a place to discover and connect with colleagues there.</Text>
          {!!error && !editing && <Text style={[type.bodySm, { color: theme.danger, marginTop: 6 }]}>{error}</Text>}
        </View>

        <View style={{ gap: 10 }}>
          {(user?.affiliations || []).map((item) => {
            const meta = affiliationType(item.type);
            return (
              <View key={item.id} style={[s.affiliationRow, inkBox(theme, 'thin')]}>
                <View style={s.affiliationIcon}>
                  <Icon name={meta.icon} size={20} color={theme.ink} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[type.bodyStrong, { color: theme.text }]} numberOfLines={2}>{item.name}</Text>
                  <Text style={[type.labelXs, { color: theme.muted, marginTop: 3 }]} numberOfLines={1}>
                    {meta.short.toUpperCase()}{item.title ? ` · ${item.title.toUpperCase()}` : ''}
                  </Text>
                </View>
                <TapeChip label={`${item.memberCount || 1} ${(item.memberCount || 1) === 1 ? 'MEMBER' : 'MEMBERS'}`} />
                <Pressable onPress={() => removeAffiliation(item)} disabled={!!removingAffiliation} hitSlop={8} style={{ padding: 5 }}>
                  {removingAffiliation === item.id
                    ? <ActivityIndicator size="small" color={theme.ink} />
                    : <Icon name="close" size={17} color={theme.muted} />}
                </Pressable>
              </View>
            );
          })}

          <Pressable
            onPress={() => setAffiliationPicker(true)}
            style={({ pressed }) => [s.addAffiliation, inkBox(theme, 'ink'), pressed && marker(theme, 1)]}
          >
            <View style={[s.addIcon, { backgroundColor: theme.ink }]}>
              <Icon name="add" size={18} color={theme.onPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[type.bodyStrong, { color: theme.text }]}>Add college or workplace</Text>
              <Text style={[type.labelXs, { color: theme.muted, marginTop: 3 }]}>INSTITUTION · ORGANIZATION · WORKPLACE</Text>
            </View>
            <Icon name="chevron-forward-outline" size={17} color={theme.muted} />
          </Pressable>
        </View>
      </ScrollView>

      <AffiliationPicker
        visible={affiliationPicker}
        onClose={() => setAffiliationPicker(false)}
        onChanged={() => setError('')}
      />

      <Modal visible={!!editing} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <View style={[s.overlay, { backgroundColor: 'transparent' }]}>
          <FrostedBackdrop />
          <PaperCard style={s.dialog} weight="ink">
            <Text style={[type.headlineMd, { color: theme.text, marginBottom: 18, textTransform: 'capitalize' }]}>
              Edit {editing}
            </Text>
            <InkField style={s.dialogInputWrap}>
              <TextInput
                style={s.dialogInput}
                value={draft}
                onChangeText={(v) => { setDraft(v); if (error) setError(''); }}
                autoFocus
                multiline={editing === 'about'}
                autoCapitalize={editing === 'username' ? 'none' : 'sentences'}
                maxLength={editing === 'username' ? 64 : editing === 'about' ? 180 : 80}
                keyboardType={editing === 'phone' ? 'phone-pad' : 'default'}
                placeholderTextColor={theme.muted}
              />
            </InkField>
            {!!error && (
              <Text style={[type.bodySm, { color: theme.danger, marginTop: -10, marginBottom: 10 }]}>{error}</Text>
            )}
            <View style={s.dialogActions}>
              <Pressable onPress={() => setEditing(null)} style={s.dialogBtn}>
                <Text style={[type.labelSm, { color: theme.subtext }]}>CANCEL</Text>
              </Pressable>
              <InkButton
                label={saving ? 'Saving…' : 'Save'}
                onPress={save}
                disabled={saving}
                filled
                style={{ paddingVertical: 10, paddingHorizontal: 22 }}
              />
            </View>
          </PaperCard>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 14 },
  scroll: { padding: 20, paddingBottom: 40 },
  scrollWide: { maxWidth: 560, width: '100%', alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 14, paddingVertical: 13 },
  affiliationRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 13, paddingVertical: 12 },
  affiliationIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  addAffiliation: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 13, paddingVertical: 13 },
  addIcon: { width: 34, height: 34, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  dialog: { width: '100%', maxWidth: 360 },
  dialogInputWrap: { paddingHorizontal: 2, minHeight: 48, justifyContent: 'center' },
  dialogInput: { ...type.bodyLg, color: t.text, paddingVertical: 11, outlineStyle: 'none' },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 14, marginTop: 22 },
  dialogBtn: { paddingHorizontal: 14, paddingVertical: 10 },
});
