import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, TextInput, Modal, ActivityIndicator } from 'react-native';
import Icon from '../icons/Icon';
import { useAuth } from '../store/AuthContext';
import { useTheme } from '../store/ThemeContext';
import { PaperCard, InkField, InkButton, handleFor } from '../components/common';
import { type, inkBox, marker } from '../theme';

/** "Personal Information" — Name, Username, About, Phone. */
export default function PersonalInfoScreen({ navigation }) {
  const { user, updateProfile } = useAuth();
  const { theme } = useTheme();
  const s = makeStyles(theme);

  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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
      const value = editing === 'username' ? draft.trim().toLowerCase() : draft.trim();
      await updateProfile({ [editing]: value });
      setEditing(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const Row = ({ icon, label, value, onPress }) => (
    <Pressable
      style={({ pressed, hovered }) => [s.row, inkBox(theme, 'thin'), (pressed || hovered) ? { backgroundColor: theme.cardAlt } : null]}
      onPress={onPress}
    >
      <Icon name={icon} size={19} color={theme.graphite} style={{ width: 26 }} />
      <View style={{ flex: 1 }}>
        <Text style={[type.bodyMd, { color: theme.text }]}>{label}</Text>
        <Text style={[type.bodySm, { color: theme.subtext, marginTop: 2 }]} numberOfLines={1}>{value || 'Not set'}</Text>
      </View>
      <Icon name="chevron-forward-outline" size={16} color={theme.muted} />
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={s.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={{ padding: 6 }}>
          <Icon name="arrow-back" size={22} color={theme.ink} />
        </Pressable>
        <Text style={[type.headlineMd, { color: theme.text }]}>Personal Information</Text>
      </View>

      <ScrollView contentContainerStyle={s.scroll}>
        <Text style={[type.labelXs, { color: theme.muted, marginBottom: 10 }]}>IDENTITY</Text>
        <View style={{ gap: 10, marginBottom: 24 }}>
          <Row icon="person-outline" label="Name" value={user?.name} onPress={() => openEdit('name')} />
          <Row icon="id-card-outline" label="Username" value={user?.username ? `@${user.username}` : null} onPress={() => openEdit('username')} />
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
      </ScrollView>

      <Modal visible={!!editing} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <View style={[s.overlay, { backgroundColor: theme.overlay }]}>
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 14, paddingVertical: 13 },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  dialog: { width: '100%', maxWidth: 360 },
  dialogInputWrap: { paddingHorizontal: 2, minHeight: 48, justifyContent: 'center' },
  dialogInput: { ...type.bodyLg, color: t.text, paddingVertical: 11, outlineStyle: 'none' },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 14, marginTop: 22 },
  dialogBtn: { paddingHorizontal: 14, paddingVertical: 10 },
});
