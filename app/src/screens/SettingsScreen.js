import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, TextInput, Switch, Modal } from 'react-native';
import Icon from '../icons/Icon';
import { EmojiText } from '../icons/Emoji';
import { useAuth } from '../store/AuthContext';
import { useTheme } from '../store/ThemeContext';
import { useChat } from '../store/ChatContext';
import { Avatar, ClayCard, ClayButton, ClayInset, handleFor } from '../components/common';
import { radius, type, clayFor, clayPressed } from '../theme';

export default function SettingsScreen({ navigation }) {
  const { user, logout, updateProfile } = useAuth();
  const { theme, mode, toggle } = useTheme();
  const { connected } = useChat();
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const s = makeStyles(theme);

  const openEdit = (field) => {
    setDraft(field === 'name' ? user.name : user.about);
    setEditing(field);
  };

  const save = async () => {
    setSaving(true);
    try { await updateProfile({ [editing]: draft.trim() }); setEditing(null); }
    finally { setSaving(false); }
  };

  const Row = ({ icon, label, value, onPress, right, danger, last }) => (
    <Pressable
      style={({ pressed }) => [s.row, pressed && onPress ? { opacity: 0.7 } : null]}
      onPress={onPress}
    >
      <View style={[s.rowIcon, { backgroundColor: danger ? theme.dangerContainer : theme.cardAlt }]}>
        <Icon name={icon} size={19} color={danger ? theme.danger : theme.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[type.bodyLg, { color: danger ? theme.danger : theme.text, fontFamily: type.fontFamily(500) }]}>{label}</Text>
        {!!value && <EmojiText style={[type.bodySm, { color: theme.subtext, marginTop: 2 }]} numberOfLines={1}>{value}</EmojiText>}
      </View>
      {right}
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={s.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={{ padding: 6 }}>
          <Icon name="arrow-back" size={23} color={theme.primary} />
        </Pressable>
        <Text style={[type.headlineMd, { color: theme.text }]}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={s.scroll}>
        <ClayCard style={s.profile} level={2}>
          <Avatar uri={user?.avatar} name={user?.name} id={user?.id} size={80} />
          <View style={{ flex: 1 }}>
            <EmojiText style={[type.headlineMd, { color: theme.text }]}>{user?.name}</EmojiText>
            <Text style={[type.labelMd, { color: theme.primary, marginTop: 3, letterSpacing: 0.3 }]}>
              {handleFor(user?.name, user?.phone)}
            </Text>
            <View style={s.connRow}>
              <View style={[s.dot, { backgroundColor: connected ? theme.badge : theme.danger }]} />
              <Text style={[type.bodySm, { color: theme.subtext, fontSize: 12 }]}>
                {connected ? 'Connected' : 'Reconnecting…'}
              </Text>
            </View>
          </View>
        </ClayCard>

        <ClayCard style={s.group}>
          <Row icon="person-outline" label="Name" value={user?.name} onPress={() => openEdit('name')} />
          <Row icon="information-circle-outline" label="About" value={user?.about} onPress={() => openEdit('about')} />
          <Row icon="call-outline" label="Phone" value={user?.phone} />
        </ClayCard>

        <ClayCard style={s.group}>
          <Row
            icon={mode === 'dark' ? 'moon' : 'sunny-outline'}
            label="Dark mode"
            value={mode === 'dark' ? 'On' : 'Off'}
            onPress={toggle}
            right={
              <Switch
                value={mode === 'dark'}
                onValueChange={toggle}
                trackColor={{ true: theme.accent, false: theme.cardAlt }}
                thumbColor={theme.card}
              />
            }
          />
          <Row icon="notifications-outline" label="Notifications" value="Message tones, groups" />
          <Row icon="lock-closed-outline" label="Privacy" value="Last seen, read receipts" />
          <Row icon="cloud-upload-outline" label="Chat backup" value="Never backed up" />
        </ClayCard>

        <ClayButton
          label="Log out"
          icon="log-out-outline"
          onPress={logout}
          color={theme.dangerContainer}
          textColor={theme.danger}
          level={1}
        />

        <Text style={[type.bodySm, { textAlign: 'center', color: theme.muted, fontSize: 12, marginTop: 8, lineHeight: 18 }]}>
          BROSKIE · built on Arena{'\n'}Not affiliated with WhatsApp
        </Text>
      </ScrollView>

      <Modal visible={!!editing} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <View style={[s.overlay, { backgroundColor: theme.overlay }]}>
          <ClayCard style={s.dialog} level={3}>
            <Text style={[type.headlineMd, { color: theme.text, marginBottom: 18, textTransform: 'capitalize' }]}>
              Edit {editing}
            </Text>
            <ClayInset style={s.dialogInputWrap}>
              <TextInput
                style={s.dialogInput}
                value={draft}
                onChangeText={setDraft}
                autoFocus
                multiline={editing === 'about'}
                placeholderTextColor={theme.muted}
              />
            </ClayInset>
            <View style={s.dialogActions}>
              <Pressable onPress={() => setEditing(null)} style={s.dialogBtn}>
                <Text style={[type.bodySm, { color: theme.subtext, fontFamily: type.fontFamily(600) }]}>CANCEL</Text>
              </Pressable>
              <ClayButton label={saving ? 'Saving…' : 'Save'} onPress={save} disabled={saving} style={{ paddingVertical: 12, paddingHorizontal: 26 }} />
            </View>
          </ClayCard>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 14 },
  scroll: { padding: 20, paddingBottom: 40, gap: 20 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  connRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 8 },
  dot: { width: 9, height: 9, borderRadius: radius.full },
  group: { padding: 10, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 12, paddingVertical: 14 },
  rowIcon: { width: 42, height: 42, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  dialog: { width: '100%', maxWidth: 360 },
  dialogInputWrap: { paddingHorizontal: 18, minHeight: 54, justifyContent: 'center' },
  dialogInput: { ...type.bodyLg, color: t.text, paddingVertical: 15, outlineStyle: 'none' },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 14, marginTop: 22 },
  dialogBtn: { paddingHorizontal: 14, paddingVertical: 10 },
});
