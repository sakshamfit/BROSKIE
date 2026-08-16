import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, TextInput, Switch, Modal } from 'react-native';
import Icon from '../icons/Icon';
import { EmojiText } from '../icons/Emoji';
import { useAuth } from '../store/AuthContext';
import { useTheme } from '../store/ThemeContext';
import { useChat } from '../store/ChatContext';
import { Avatar, PaperCard, InkButton, InkField, Rule, handleFor } from '../components/common';
import { radius, type, inkBox, marker, dashedRule } from '../theme';

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
      <Icon name={icon} size={19} color={danger ? theme.danger : theme.ink} style={{ width: 26 }} />
      <View style={{ flex: 1 }}>
        <Text style={[type.bodyMd, { color: danger ? theme.danger : theme.text }]}>{label}</Text>
        {!!value && <EmojiText style={[type.bodySm, { color: theme.subtext, marginTop: 2 }]} numberOfLines={1}>{value}</EmojiText>}
      </View>
      {right}
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={s.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={{ padding: 6 }}>
          <Icon name="arrow-back" size={22} color={theme.ink} />
        </Pressable>
        <Text style={[type.headlineMd, { color: theme.text }]}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={s.scroll}>
        <PaperCard style={s.profile} weight="ink">
          <Avatar uri={user?.avatar} name={user?.name} id={user?.id} size={80} />
          <View style={{ flex: 1 }}>
            <EmojiText style={[type.headlineMd, { color: theme.text }]}>{user?.name}</EmojiText>
            <Text style={[type.labelXs, { color: theme.graphite, marginTop: 4 }]}>
              {handleFor(user?.name, user?.phone)}
            </Text>
            <View style={s.connRow}>
              <View style={[s.dot, { backgroundColor: connected ? theme.highlighter : theme.danger, borderWidth: 1, borderColor: theme.ink }]} />
              <Text style={[type.labelXs, { color: theme.subtext }]}>
                {connected ? 'Connected' : 'Reconnecting…'}
              </Text>
            </View>
          </View>
        </PaperCard>

        <PaperCard style={s.group}>
          <Row icon="person-outline" label="Name" value={user?.name} onPress={() => openEdit('name')} />
          <Row icon="information-circle-outline" label="About" value={user?.about} onPress={() => openEdit('about')} />
          <Row icon="call-outline" label="Phone" value={user?.phone} />
        </PaperCard>

        <PaperCard style={s.group}>
          <Row
            icon={mode === 'dark' ? 'moon' : 'sunny-outline'}
            label="Dark mode"
            value={mode === 'dark' ? 'On' : 'Off'}
            onPress={toggle}
            right={
              <Switch
                value={mode === 'dark'}
                onValueChange={toggle}
                trackColor={{ true: theme.highlighter, false: theme.cardAlt }}
                thumbColor={theme.ink}
              />
            }
          />
          <Row icon="notifications-outline" label="Notifications" value="Message tones, groups" />
          <Row icon="lock-closed-outline" label="Privacy" value="Last seen, read receipts" />
          <Row icon="cloud-upload-outline" label="Chat backup" value="Never backed up" />
        </PaperCard>

        <InkButton label="Log out" icon="log-out-outline" onPress={logout} danger />

        <Text style={[type.labelXs, { textAlign: 'center', color: theme.muted, marginTop: 10, lineHeight: 16 }]}>
          友達 · GRAPHITE & PULP{'\n'}NOT AFFILIATED WITH WHATSAPP
        </Text>
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
                onChangeText={setDraft}
                autoFocus
                multiline={editing === 'about'}
                placeholderTextColor={theme.muted}
              />
            </InkField>
            <View style={s.dialogActions}>
              <Pressable onPress={() => setEditing(null)} style={s.dialogBtn}>
                <Text style={[type.labelSm, { color: theme.subtext }]}>CANCEL</Text>
              </Pressable>
              <InkButton label={saving ? 'Saving…' : 'Save'} onPress={save} disabled={saving} filled style={{ paddingVertical: 10, paddingHorizontal: 22 }} />
            </View>
          </PaperCard>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 14 },
  scroll: { padding: 20, paddingBottom: 40, gap: 20 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  connRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 8 },
  dot: { width: 9, height: 9, borderRadius: radius.full },
  group: { padding: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 12, paddingVertical: 13 },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  dialog: { width: '100%', maxWidth: 360 },
  dialogInputWrap: { paddingHorizontal: 2, minHeight: 48, justifyContent: 'center' },
  dialogInput: { ...type.bodyLg, color: t.text, paddingVertical: 11, outlineStyle: 'none' },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 14, marginTop: 22 },
  dialogBtn: { paddingHorizontal: 14, paddingVertical: 10 },
});
