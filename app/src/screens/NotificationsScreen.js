import React, { useState, useEffect, useMemo } from 'react';
import { View, Pressable, StyleSheet, ScrollView, TextInput, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../icons/Icon';
import { useAuth } from '../store/AuthContext';
import { useTheme } from '../store/ThemeContext';
import useResponsive from '../hooks/useResponsive';
import { api } from '../api';
import { PaperCard, Rule } from '../components/common';
import { radius, type, inkBox } from '../theme';
import { Text } from '../components/Text';

/**
 * "Notifications" — real, persisted preferences (server-stored on the user
 * row, PATCH /api/me/settings) controlling what fans out to this device:
 * chat messages (+ preview text), requests & activity, likes/comments on
 * your posts, incoming calls, status stories, Network posts, community activity,
 * sound — plus quiet hours, which the SERVER enforces on every push
 * (delivered silently inside the window so nothing buzzes at 3am).
 *
 * These are read by the client where each event is surfaced in-app AND by
 * the server before any push is sent — not cosmetic.
 */
export default function NotificationsScreen({ navigation, embedded = false }) {
  const { user, updateSettings } = useAuth();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { isTablet } = useResponsive();
  const s = makeStyles(theme);

  const settings = user?.settings?.notifications || {};
  const [busyKey, setBusyKey] = useState(null);
  const [devices, setDevices] = useState(null);

  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const r = await api.pushInfo();
        if (!disposed) setDevices(r?.devices || []);
      } catch {
        if (!disposed) setDevices([]);
      }
    })();
    return () => { disposed = true; };
  }, [user?.settings]);

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

  const pushLive = Platform.OS !== 'web' && !!devices?.length;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={[s.header, !embedded && { paddingTop: 20 + insets.top }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={{ padding: 6 }}>
          <Icon name="arrow-back" size={22} color={theme.ink} />
        </Pressable>
        <Text style={[type.headlineMd, { color: theme.text }]}>Notifications</Text>
      </View>

      <ScrollView
        // iOS: lift the scroll content clear of the IME so the focused field
        // is never behind the keyboard (there is no KeyboardAvoidingView here).
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={[s.scroll, isTablet && s.scrollWide]}
      >
        <Text style={[type.labelXs, { color: theme.muted, marginBottom: 10 }]}>MESSAGES</Text>
        <PaperCard style={{ padding: 6 }} weight="thin">
          <Row icon="chatbubble-outline" title="Chat messages" subtitle="New messages in Chats" settingKey="messages" />
          <Row icon="eye-outline" title="Message preview" subtitle={'Show the text/photo, not just \u201cnew message\u201d'} settingKey="messagePreview" last />
        </PaperCard>

        <Text style={[type.labelXs, { color: theme.muted, marginTop: 24, marginBottom: 10 }]}>PUSH ALERTS</Text>
        <PaperCard style={{ padding: 6 }} weight="thin">
          <Row icon="notifications-outline" title="Requests & activity" subtitle="Message requests and colleague requests" settingKey="activity" />
          <Row icon="heart-outline" title="Likes & comments" subtitle="Reactions to your Network posts" settingKey="reactions" />
          <Row icon="call-outline" title="Incoming calls" subtitle="When someone calls you" settingKey="calls" last />
        </PaperCard>

        <QuietHoursCard theme={theme} type={type} settings={settings} updateSettings={updateSettings} />

        <Text style={[type.labelXs, { color: theme.muted, marginTop: 24, marginBottom: 10 }]}>ACTIVITY</Text>
        <PaperCard style={{ padding: 6 }} weight="thin">
          <Row icon="eye-outline" title="Status stories" subtitle="When someone you can see posts a status" settingKey="status" />
          <Row icon="people-outline" title="The Network" subtitle="New public posts on The Network" settingKey="network" />
          <Row icon="chatbubbles-outline" title="Community activity" subtitle="Join requests, approvals, being added" settingKey="communityActivity" last />
        </PaperCard>

        <Text style={[type.labelXs, { color: theme.muted, marginTop: 24, marginBottom: 10 }]}>SOUND</Text>
        <PaperCard style={{ padding: 6 }} weight="thin">
          <Row icon={settings.sound ? 'volume-high-outline' : 'volume-mute'} title="Notification sound" subtitle="Play a sound for incoming activity" settingKey="sound" last />
        </PaperCard>

        <Text style={[type.bodySm, { color: pushLive ? theme.muted : theme.subtext, marginTop: 20, lineHeight: 19 }]}>
          {Platform.OS === 'web'
            ? 'Push alerts arrive on your Android/iOS app. These preferences are saved to your account and apply everywhere you\u2019re logged in.'
            : pushLive
              ? `Push is on for ${devices.length === 1 ? '1 device' : `${devices.length} devices`}. Preferences apply everywhere you're logged in.`
              : 'Push isn\u2019t active on this device yet — allow notifications when asked, or reinstall the latest app build.'}
          {'\n'}Individual chats can still be muted from that chat's info screen; muted chats never ping.
        </Text>
      </ScrollView>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* quiet hours                                                        */
/* ------------------------------------------------------------------ */

const minutesToHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const parseHHMM = (text) => {
  const m = /^(\d{1,2}):?(\d{2})$/.exec(String(text || '').trim());
  if (!m) return null;
  const h = Number(m[1]); const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
};

/** Quiet hours are enforced by the SERVER: inside the window, pushes are
 *  delivered silently (no sound or vibration — a low-importance channel on
 *  Android). Times are in your device's timezone; the offset is saved with
 *  them so travel doesn't shift your schedule. */
function QuietHoursCard({ theme, type, settings, updateSettings }) {
  const quiet = settings.quietHours || { enabled: false, startMinute: 22 * 60, endMinute: 7 * 60, tzOffsetMinutes: 0 };
  const [enabled, setEnabled] = useState(!!quiet.enabled);
  const [startText, setStartText] = useState(minutesToHHMM(quiet.startMinute ?? 22 * 60));
  const [endText, setEndText] = useState(minutesToHHMM(quiet.endMinute ?? 7 * 60));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setEnabled(!!quiet.enabled);
    setStartText(minutesToHHMM(quiet.startMinute ?? 22 * 60));
    setEndText(minutesToHHMM(quiet.endMinute ?? 7 * 60));
  }, [quiet.enabled, quiet.startMinute, quiet.endMinute]);

  const dirty = useMemo(() => (
    enabled !== !!quiet.enabled
    || startText !== minutesToHHMM(quiet.startMinute ?? 22 * 60)
    || endText !== minutesToHHMM(quiet.endMinute ?? 7 * 60)
  ), [enabled, startText, endText, quiet]);

  const save = async () => {
    const start = parseHHMM(startText);
    const end = parseHHMM(endText);
    if (start === null || end === null) {
      setError('Use 24-hour time, like 22:30.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      // -(getTimezoneOffset()) = minutes east of UTC; server shifts every
      // push check into this offset, so the window follows the device.
      await updateSettings({
        notifications: {
          quietHours: {
            enabled,
            startMinute: start,
            endMinute: end,
            tzOffsetMinutes: -new Date().getTimezoneOffset(),
          },
        },
      });
    } finally {
      setBusy(false);
    }
  };

  const tzLabel = (() => {
    const offset = -new Date().getTimezoneOffset();
    const sign = offset >= 0 ? '+' : '−';
    const abs = Math.abs(offset);
    return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  })();

  return (
    <View>
      <Text style={[type.labelXs, { color: theme.muted, marginTop: 24, marginBottom: 10 }]}>QUIET HOURS</Text>
      <PaperCard style={{ padding: 6 }} weight="thin">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 10, paddingVertical: 10 }}>
          <Icon name="moon-outline" size={19} color={theme.ink} style={{ width: 26 }} />
          <View style={{ flex: 1 }}>
            <Text style={[type.bodyLg, { color: theme.text }]}>Do not disturb</Text>
            <Text style={[type.bodySm, { color: theme.subtext, marginTop: 2 }]}>
              Pushes arrive silently inside the window ({tzLabel})
            </Text>
          </View>
          <HandDrawnToggle value={enabled} onToggle={() => setEnabled((v) => !v)} theme={theme} busy={false} />
        </View>

        {enabled && (
          <View style={{ paddingHorizontal: 10, paddingBottom: 12 }}>
            <Rule />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 }}>
              <Text style={[type.bodySm, { color: theme.muted }]}>From</Text>
              <TimeField value={startText} onChange={setStartText} theme={theme} />
              <Text style={[type.bodySm, { color: theme.muted }]}>to</Text>
              <TimeField value={endText} onChange={setEndText} theme={theme} />
              {busy && <Text style={[type.bodySm, { color: theme.muted }]}>saving…</Text>}
            </View>
            {!!error && <Text style={[type.bodySm, { color: theme.subtext, marginTop: 8 }]}>{error}</Text>}
            {!!dirty && !busy && (
              <Pressable onPress={save} style={{ marginTop: 12, alignSelf: 'flex-start' }} hitSlop={6}>
                <View style={[inkBox(theme), { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.sm, borderWidth: 1.5, borderColor: theme.ink }]}>
                  <Text style={[type.labelSm, { color: theme.bg }]}>SAVE WINDOW</Text>
                </View>
              </Pressable>
            )}
          </View>
        )}
      </PaperCard>
    </View>
  );
}

function TimeField({ value, onChange, theme }) {
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      keyboardType="number-pad"
      maxLength={5}
      selectTextOnFocus
      accessibilityLabel="Time in 24-hour format"
      style={{
        borderWidth: 1.5, borderColor: theme.ink, borderRadius: radius.sm,
        paddingHorizontal: 10, paddingVertical: 6, minWidth: 68,
        fontFamily: 'SpaceMono_700Bold', fontSize: 15, color: theme.text,
        backgroundColor: theme.cardAlt, textAlign: 'center',
      }}
    />
  );
}

function HandDrawnToggle({ value, onToggle, theme, busy }) {
  return (
    <Pressable
      onPress={onToggle}
      disabled={busy}
      // The switch draws 28dp tall; hitSlop brings the tappable area to 44dp,
      // matching the shared HandDrawnToggle in components/common.js.
      hitSlop={8}
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
