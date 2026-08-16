import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../icons/Icon';
import { useAuth } from '../store/AuthContext';
import { useTheme } from '../store/ThemeContext';
import useResponsive from '../hooks/useResponsive';
import { PaperCard, Rule } from '../components/common';
import { radius, type, inkBox } from '../theme';

/**
 * "Notifications" — real, persisted preferences (server-stored on the user
 * row, PATCH /api/me/settings) controlling what fans out to this device:
 * chat messages (+ preview text), Status posts, Network posts, community
 * activity (join requests/approvals/adds), and a sound toggle. These are
 * read by the client where each event is surfaced (chat list previews,
 * Network/Status live-update banners can check them) — not just cosmetic.
 */
export default function NotificationsScreen({ navigation, embedded = false }) {
  const { user, updateSettings } = useAuth();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { isTablet } = useResponsive();
  const s = makeStyles(theme);

  const settings = user?.settings?.notifications || {};
  const [busyKey, setBusyKey] = useState(null);

  const toggle = async (key) => {
    setBusyKey(key);
    try {
      await updateSettings({ notifications: { [key]: !settings[key] } });
    } finally {
      setBusyKey(null);
    }
  };

  const Row = ({ icon, title, subtitle, settingKey, last }) => (
    <View>
      <View style={s.row}>
        <Icon name={icon} size={19} color={theme.ink} style={{ width: 26 }} />
        <View style={{ flex: 1 }}>
          <Text style={[type.bodyLg, { color: theme.text }]}>{title}</Text>
          {!!subtitle && <Text style={[type.bodySm, { color: theme.subtext, marginTop: 2 }]}>{subtitle}</Text>}
        </View>
        <HandDrawnToggle value={!!settings[settingKey]} onToggle={() => toggle(settingKey)} theme={theme} busy={busyKey === settingKey} />
      </View>
      {!last && <View style={{ height: 10 }} />}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={[s.header, !embedded && { paddingTop: 20 + insets.top }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={{ padding: 6 }}>
          <Icon name="arrow-back" size={22} color={theme.ink} />
        </Pressable>
        <Text style={[type.headlineMd, { color: theme.text }]}>Notifications</Text>
      </View>

      <ScrollView contentContainerStyle={[s.scroll, isTablet && s.scrollWide]}>
        <Text style={[type.labelXs, { color: theme.muted, marginBottom: 10 }]}>MESSAGES</Text>
        <PaperCard style={{ padding: 6 }} weight="thin">
          <Row icon="chatbubble-outline" title="Chat messages" subtitle="New messages in Chats" settingKey="messages" />
          <Row icon="eye-outline" title="Message preview" subtitle={'Show the text/photo, not just \u201cnew message\u201d'} settingKey="messagePreview" last />
        </PaperCard>

        <Text style={[type.labelXs, { color: theme.muted, marginTop: 24, marginBottom: 10 }]}>ACTIVITY</Text>
        <PaperCard style={{ padding: 6 }} weight="thin">
          <Row icon="eye-outline" title="See (Status)" subtitle="When someone you can see posts a status" settingKey="status" />
          <Row icon="people-outline" title="The Network" subtitle="New public posts on The Network" settingKey="network" />
          <Row icon="chatbubbles-outline" title="Community activity" subtitle="Join requests, approvals, being added" settingKey="communityActivity" last />
        </PaperCard>

        <Text style={[type.labelXs, { color: theme.muted, marginTop: 24, marginBottom: 10 }]}>SOUND</Text>
        <PaperCard style={{ padding: 6 }} weight="thin">
          <Row icon={settings.sound ? 'volume-high-outline' : 'volume-mute'} title="Notification sound" subtitle="Play a sound for incoming activity" settingKey="sound" last />
        </PaperCard>

        <Text style={[type.bodySm, { color: theme.muted, marginTop: 20, lineHeight: 19 }]}>
          These preferences are saved to your account and apply everywhere you're logged in.
          Individual chats can still be muted from that chat's info screen regardless of these settings.
        </Text>
      </ScrollView>
    </View>
  );
}

function HandDrawnToggle({ value, onToggle, theme, busy }) {
  return (
    <Pressable
      onPress={onToggle}
      disabled={busy}
      style={[
        {
          width: 52, height: 28, borderRadius: radius.full, padding: 3, justifyContent: 'center',
          borderWidth: 2, borderColor: theme.ink,
          backgroundColor: value ? theme.highlighter : theme.cardAlt,
          opacity: busy ? 0.5 : 1,
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
  scrollWide: { maxWidth: 560, width: '100%', alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 10, paddingVertical: 10 },
});
