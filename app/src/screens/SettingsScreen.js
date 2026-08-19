import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Linking, Modal, TextInput } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../icons/Icon';
import { EmojiText } from '../icons/Emoji';
import { useAuth } from '../store/AuthContext';
import { useTheme } from '../store/ThemeContext';
import { useChat } from '../store/ChatContext';
import useResponsive from '../hooks/useResponsive';
import { Avatar, InkButton, InkField, PaperCard, TapeChip, handleFor, MotionIn, FrostedBackdrop } from '../components/common';
import { confirm } from '../hooks/confirm';
import { api } from '../api';
import { radius, type, inkBox, marker, dashedRule } from '../theme';

/**
 * Settings hub — profile hero (editable avatar) + two grouped sections
 * (Account Settings, Preferences) whose rows drill into their own screens,
 * matching the supplied "Settings" mockup.
 */
export default function SettingsScreen({ navigation, embedded = false }) {
  const { user, logout } = useAuth();
  const { theme, mode, preference, toggle } = useTheme();
  const { connected } = useChat();
  const insets = useSafeAreaInsets();
  const { isTablet } = useResponsive();
  const s = makeStyles(theme);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const joinYear = user?.createdAt ? new Date(user.createdAt).getFullYear() : null;

  const handleLogout = async () => {
    const ok = await confirm('Are you sure you want to log out?', {
      title: 'Log out', confirmLabel: 'Log out', destructive: true,
    });
    if (ok) await logout();
  };

  const closeDelete = () => {
    if (deleteBusy) return;
    setDeleteOpen(false);
    setDeletePassword('');
    setDeleteError('');
  };

  const handleDeleteAccount = async () => {
    if (!deletePassword) {
      setDeleteError('Enter your current password to continue.');
      return;
    }
    const confirmed = await confirm(
      'This permanently deletes your One ID, profile, posts, statuses, direct chats and messages. This cannot be undone.',
      { title: 'Delete One ID?', confirmLabel: 'Delete permanently', destructive: true }
    );
    if (!confirmed) return;
    setDeleteBusy(true);
    setDeleteError('');
    try {
      await api.deleteAccount(deletePassword);
      setDeleteOpen(false);
      await logout();
    } catch (error) {
      setDeleteError(error.message || 'Could not delete your One ID.');
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={[s.header, !embedded && { paddingTop: 20 + insets.top }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={{ padding: 6 }}>
          <Icon name="arrow-back" size={22} color={theme.ink} />
        </Pressable>
        <Text style={[type.headlineMd, { color: theme.text }]}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={[s.scroll, isTablet && s.scrollWide]}>
        {/* -------- Profile hero -------- */}
        <MotionIn><ProfileHero user={user} theme={theme} joinYear={joinYear} connected={connected} /></MotionIn>

        {/* -------- Account Settings -------- */}
        <MotionIn delay={60}><SectionHeading theme={theme} label="Account Settings" tilt="-1deg" />
        <View style={s.group}>
          <NavRow
            theme={theme}
            icon="person-outline"
            title="Personal Information"
            subtitle="Name, Username, Phone, College & Work"
            onPress={() => navigation.navigate('PersonalInfo')}
          />
          <Divider theme={theme} />
          <NavRow
            theme={theme}
            icon="lock-closed-outline"
            title="Security & Privacy"
            subtitle="Password, Sessions"
            onPress={() => navigation.navigate('Security')}
          />
          <Divider theme={theme} />
          <NavRow
            theme={theme}
            icon="shield-checkmark-outline"
            title="Privacy"
            subtitle="Last seen, read receipts, blocked contacts"
            onPress={() => navigation.navigate('Privacy')}
          />
        </View></MotionIn>

        {/* -------- Preferences -------- */}
        <MotionIn delay={110}><SectionHeading theme={theme} label="Preferences" tilt="1deg" />
        <View style={s.group}>
          <View style={[s.row, s.rowStatic, inkBox(theme, 'thin')]}>
            <Icon name={theme.dark ? 'moon' : 'sunny-outline'} size={19} color={theme.ink} style={{ width: 26 }} />
            <View style={{ flex: 1 }}>
              <Text style={[type.bodyLg, { color: theme.text }]}>Dark mode</Text>
              <Text style={[type.labelXs, { color: theme.graphite, marginTop: 3 }]}>
                {preference === 'system' ? `SYSTEM (${mode.toUpperCase()})` : theme.dark ? 'ON' : 'OFF'}
              </Text>
            </View>
            <HandDrawnToggle value={theme.dark} onToggle={toggle} theme={theme} />
          </View>
          <Divider theme={theme} />
          <NavRow
            theme={theme}
            icon="color-palette-outline"
            title="Appearance"
            subtitle="Theme, Typography"
            onPress={() => navigation.navigate('Appearance')}
          />
          <Divider theme={theme} />
          <NavRow
            theme={theme}
            icon="notifications-outline"
            title="Notifications"
            subtitle="Messages, Status, Network, Sound"
            onPress={() => navigation.navigate('Notifications')}
          />
          {!embedded && (
            <>
              <Divider theme={theme} />
              <NavRow
                theme={theme}
                icon="call-outline"
                title="Calls"
                subtitle="Recent voice and video call history"
                onPress={() => navigation.navigate('Calls')}
              />
            </>
          )}
          <Divider theme={theme} />
          <NavRow
            theme={theme}
            icon="star-outline"
            title="Starred messages"
            subtitle="Messages you've bookmarked"
            onPress={() => navigation.navigate('Starred')}
          />
        </View></MotionIn>

        {/* -------- Support -------- */}
        <SectionHeading theme={theme} label="Support" tilt="-1deg" />
        <View style={s.group}>
          <NavRow
            theme={theme}
            icon="help-circle-outline"
            title="Help & Guide"
            subtitle="How to use every key feature"
            onPress={() => navigation.navigate('Help')}
          />
        </View>

        {/* -------- Danger zone -------- */}
        <SectionHeading theme={theme} label="Danger Zone" tilt="1deg" />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Delete One ID"
          onPress={() => setDeleteOpen(true)}
          style={({ pressed }) => [
            s.deleteRow,
            inkBox(theme, 'ink', theme.danger),
            pressed && { backgroundColor: theme.dangerContainer },
          ]}
        >
          <Icon name="trash-outline" size={20} color={theme.danger} />
          <View style={{ flex: 1 }}>
            <Text style={[type.bodyStrong, { color: theme.danger }]}>Delete One ID</Text>
            <Text style={[type.labelXs, { color: theme.subtext, marginTop: 3 }]}>PASSWORD CONFIRMATION REQUIRED · PERMANENT</Text>
          </View>
          <Icon name="chevron-forward-outline" size={17} color={theme.danger} />
        </Pressable>

        <InkButton label="Log out" icon="log-out-outline" onPress={handleLogout} danger style={{ marginTop: 18 }} />

        <View style={{ marginTop: 18, alignItems: 'center' }}>
          <Text style={[type.labelXs, { textAlign: 'center', color: theme.text, fontWeight: '700' }]}>
            SAKSHAMFIT
          </Text>
          <Pressable onPress={() => Linking.openURL('https://instagram.com/saxamfit')} hitSlop={6} style={{ marginTop: 4 }}>
            <Text style={[type.labelXs, { textAlign: 'center', color: theme.muted, lineHeight: 16 }]}>
              CRAFTED & SKETCHED BY{' '}
              <Text style={{ color: theme.ink, textDecorationLine: 'underline' }}>@saxamfit</Text>
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      <Modal visible={deleteOpen} transparent animationType="fade" onRequestClose={closeDelete}>
        <View style={[s.deleteOverlay, { backgroundColor: 'transparent' }]}>
          <FrostedBackdrop />
          <PaperCard weight="ink" style={s.deleteDialog}>
            <View style={s.deleteDialogHead}>
              <View style={[s.deleteIcon, { backgroundColor: theme.dangerContainer }]}>
                <Icon name="trash-outline" size={24} color={theme.danger} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[type.headlineMd, { color: theme.text }]}>Delete One ID</Text>
                <Text style={[type.labelXs, { color: theme.danger, marginTop: 4 }]}>PERMANENT ACCOUNT DELETION</Text>
              </View>
              <Pressable onPress={closeDelete} disabled={deleteBusy} hitSlop={8}>
                <Icon name="close" size={21} color={theme.muted} />
              </Pressable>
            </View>

            <Text style={[type.bodySm, { color: theme.subtext, marginTop: 16 }]}>
              Your profile, posts, statuses, direct conversations and authored messages will be permanently removed. Shared groups and institutions transfer safely to remaining members.
            </Text>
            <Text style={[type.labelXs, { color: theme.muted, marginTop: 18, marginBottom: 6 }]}>CURRENT PASSWORD</Text>
            <InkField focused={!!deletePassword}>
              <Icon name="lock-closed-outline" size={18} color={theme.muted} />
              <TextInput
                value={deletePassword}
                onChangeText={(value) => { setDeletePassword(value); if (deleteError) setDeleteError(''); }}
                placeholder="Confirm your password"
                placeholderTextColor={theme.muted}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                editable={!deleteBusy}
                onSubmitEditing={handleDeleteAccount}
                style={[s.deleteInput, { color: theme.text }]}
              />
            </InkField>
            {!!deleteError && <Text style={[type.bodySm, { color: theme.danger, marginTop: 10 }]}>{deleteError}</Text>}

            <View style={s.deleteActions}>
              <Pressable onPress={closeDelete} disabled={deleteBusy} style={{ paddingHorizontal: 13, paddingVertical: 11 }}>
                <Text style={[type.labelSm, { color: theme.subtext }]}>CANCEL</Text>
              </Pressable>
              <InkButton
                label={deleteBusy ? 'Deleting…' : 'Delete permanently'}
                icon="trash-outline"
                onPress={handleDeleteAccount}
                disabled={!deletePassword || deleteBusy}
                busy={deleteBusy}
                danger
                filled
                style={{ paddingVertical: 10, paddingHorizontal: 15 }}
              />
            </View>
          </PaperCard>
        </View>
      </Modal>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* profile hero                                                        */
/* ------------------------------------------------------------------ */

/**
 * Profile photo can be added, replaced, or removed. The server receives an
 * explicit null only for removal; a cancelled picker never clears a photo.
 */
function ProfileHero({ user, theme, joinYear, connected }) {
  const { updateProfile } = useAuth();
  const [uploading, setUploading] = useState(false);
  const s = makeStyles(theme);

  const removeAvatar = async () => {
    const ok = await confirm('Remove your profile photo?', { title: 'Remove photo', confirmLabel: 'Remove', destructive: true });
    if (!ok) return;
    try {
      setUploading(true);
      await updateProfile({ avatar: null });
    } catch (e) {
      console.warn('avatar removal failed', e.message);
    } finally {
      setUploading(false);
    }
  };

  const pickAvatar = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'], quality: 0.8, allowsEditing: true, aspect: [1, 1],
      });
      if (res.canceled || !res.assets?.length) return;
      setUploading(true);
      const asset = res.assets[0];
      const { url } = await api.uploadFile(asset.uri, asset.fileName || 'avatar.jpg', asset.mimeType || 'image/jpeg');
      await updateProfile({ avatar: url });
    } catch (e) {
      console.warn('avatar upload failed', e.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <View style={s.hero}>
      <View style={s.avatarArea}>
      <Pressable onPress={pickAvatar} style={s.avatarWrap} disabled={uploading}>
        <Avatar uri={user?.avatar} name={user?.name} id={user?.id} size={112} shape="sketch" weight="bold" />
        <View style={[s.editBadge, inkBox(theme, 'ink'), { backgroundColor: theme.card }]}>
          {uploading ? (
            <ActivityIndicator size="small" color={theme.ink} />
          ) : (
            <Icon name="create-outline" size={15} color={theme.ink} />
          )}
        </View>
      </Pressable>
      {!!user?.avatar && !uploading && (
        <Pressable onPress={removeAvatar} hitSlop={8} style={s.removeAvatar}>
          <Text style={[type.labelXs, { color: theme.danger }]}>REMOVE PHOTO</Text>
        </Pressable>
      )}
      </View>

      <View style={s.heroBody}>
        <EmojiText style={[type.headlineLg, { fontSize: 30, color: theme.text }]}>{user?.name}</EmojiText>
        <Text style={[type.labelSm, { color: theme.graphite, marginTop: 4 }]}>{handleFor(user)}</Text>
        {!!user?.about && (
          <EmojiText style={[type.bodyMd, { color: theme.subtext, marginTop: 10 }]} numberOfLines={2}>
            {user.about}
          </EmojiText>
        )}
        <View style={s.chipsRow}>
          <View style={[s.connDot, { backgroundColor: connected ? theme.highlighter : theme.danger, borderColor: theme.ink }]} />
          <Text style={[type.labelXs, { color: theme.subtext, marginRight: 10 }]}>
            {connected ? 'CONNECTED' : 'RECONNECTING…'}
          </Text>
          {!!joinYear && <TapeChip label={`JOINED ${joinYear}`} />}
        </View>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* shared pieces                                                       */
/* ------------------------------------------------------------------ */

function SectionHeading({ theme, label, tilt }) {
  return (
    <View style={{ marginTop: 28, marginBottom: 12 }}>
      <View style={{ alignSelf: 'flex-start' }}>
        <Text style={[type.headlineMd, { fontSize: 22, color: theme.text }]}>{label}</Text>
        <View style={{ height: 3, backgroundColor: theme.ink, opacity: 0.75, borderRadius: 3, marginTop: 4, transform: [{ rotate: tilt }] }} />
      </View>
    </View>
  );
}

function NavRow({ theme, icon, title, subtitle, onPress }) {
  const s = makeStyles(theme);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed, hovered }) => [s.row, inkBox(theme, 'thin'), (pressed || hovered) ? { backgroundColor: theme.cardAlt } : null]}
    >
      <Icon name={icon} size={19} color={theme.graphite} style={{ width: 26 }} />
      <View style={{ flex: 1 }}>
        <Text style={[type.bodyLg, { color: theme.text }]}>{title}</Text>
        <Text style={[type.labelXs, { color: theme.graphite, marginTop: 3 }]}>{subtitle.toUpperCase()}</Text>
      </View>
      <Icon name="chevron-forward-outline" size={17} color={theme.muted} />
    </Pressable>
  );
}

function Divider({ theme }) {
  return <View style={{ height: 10 }} />;
}

/** Hand-drawn pill toggle — ink outline, sketch-square thumb. */
function HandDrawnToggle({ value, onToggle, theme }) {
  return (
    <Pressable
      onPress={onToggle}
      style={[
        {
          width: 52, height: 28, borderRadius: radius.full, padding: 3, justifyContent: 'center',
          borderWidth: 2, borderColor: theme.ink,
          backgroundColor: value ? theme.highlighter : theme.cardAlt,
        },
      ]}
    >
      <View
        style={{
          width: 20, height: 20, borderRadius: radius.full, backgroundColor: theme.ink,
          borderWidth: 1, borderColor: theme.ink,
          transform: [{ translateX: value ? 22 : 0 }],
        }}
      />
    </Pressable>
  );
}

const makeStyles = (t) => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 14 },
  scroll: { padding: 20, paddingBottom: 40 },
  scrollWide: { maxWidth: 640, width: '100%', alignSelf: 'center' },

  hero: { flexDirection: 'row', alignItems: 'center', gap: 20, marginBottom: 8 },
  avatarArea: { alignItems: 'center', gap: 8 },
  avatarWrap: { position: 'relative' },
  removeAvatar: { paddingVertical: 3 },
  avatarFrame: { padding: 4, borderRadius: 999 },
  editBadge: {
    position: 'absolute', right: -2, bottom: -2, width: 30, height: 30, borderRadius: 999,
    alignItems: 'center', justifyContent: 'center',
  },
  heroBody: { flex: 1, minWidth: 0 },
  chipsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, flexWrap: 'wrap', gap: 6 },
  connDot: { width: 9, height: 9, borderRadius: radius.full, borderWidth: 1 },

  group: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 14, paddingVertical: 14, backgroundColor: 'transparent' },
  rowStatic: { paddingVertical: 12 },
  deleteRow: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 14, paddingVertical: 14 },
  deleteOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  deleteDialog: { width: '100%', maxWidth: 470, padding: 20 },
  deleteDialogHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  deleteIcon: { width: 46, height: 46, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  deleteInput: { flex: 1, ...type.bodyMd, paddingVertical: 11, outlineStyle: 'none' },
  deleteActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginTop: 20 },
});
