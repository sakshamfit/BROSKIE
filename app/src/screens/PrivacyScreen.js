import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../icons/Icon';
import { useAuth } from '../store/AuthContext';
import { useTheme } from '../store/ThemeContext';
import useResponsive from '../hooks/useResponsive';
import { PaperCard, InkButton, marker } from '../components/common';
import { radius, type, inkBox } from '../theme';

const LAST_SEEN_OPTIONS = [
  { key: 'everyone', label: 'Everyone', icon: 'earth-outline', sub: 'Anyone can see when you were last online' },
  { key: 'contacts', label: 'My contacts', icon: 'people-outline', sub: 'Only people you already chat with' },
  { key: 'nobody', label: 'Nobody', icon: 'eye-off-outline', sub: "Hide it completely \u2014 you also won't see anyone else's" },
];

/**
 * "Privacy" — real, server-enforced controls:
 *   - Last seen / online dot visibility (everyone / contacts / nobody),
 *     mirrored server-side in presenceFor() for chat lists, chat headers
 *     and ChatInfo, not just hidden client-side.
 *   - Read receipts on/off — turning it off stops the server from ever
 *     recording your 'read' receipt (so no one sees a blue tick from you),
 *     the classic WhatsApp trade-off: you also stop seeing others' ticks.
 *   - Blocked contacts management, linking to a dedicated list screen.
 */
export default function PrivacyScreen({ navigation, embedded = false }) {
  const { user, updateSettings } = useAuth();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { isTablet } = useResponsive();
  const s = makeStyles(theme);

  const privacy = user?.settings?.privacy || { lastSeen: 'everyone', readReceipts: true };
  const [busy, setBusy] = useState(false);

  const setLastSeen = async (key) => {
    setBusy(true);
    try { await updateSettings({ privacy: { lastSeen: key } }); } finally { setBusy(false); }
  };
  const toggleReadReceipts = async () => {
    setBusy(true);
    try { await updateSettings({ privacy: { readReceipts: !privacy.readReceipts } }); } finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={[s.header, !embedded && { paddingTop: 20 + insets.top }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={{ padding: 6 }}>
          <Icon name="arrow-back" size={22} color={theme.ink} />
        </Pressable>
        <Text style={[type.headlineMd, { color: theme.text }]}>Privacy</Text>
      </View>

      <ScrollView contentContainerStyle={[s.scroll, isTablet && s.scrollWide]}>
        <Text style={[type.labelXs, { color: theme.muted, marginBottom: 10 }]}>LAST SEEN & ONLINE</Text>
        <View style={{ gap: 10 }}>
          {LAST_SEEN_OPTIONS.map((opt) => {
            const active = privacy.lastSeen === opt.key;
            return (
              <Pressable
                key={opt.key}
                onPress={() => setLastSeen(opt.key)}
                disabled={busy}
                style={({ pressed }) => [
                  s.optionRow, inkBox(theme, active ? 'ink' : 'thin'),
                  active && { backgroundColor: theme.highlighterWash },
                  pressed && !active ? marker(theme, 1) : null,
                ]}
              >
                <Icon name={opt.icon} size={19} color={theme.ink} style={{ width: 26 }} />
                <View style={{ flex: 1 }}>
                  <Text style={[type.bodyLg, { color: theme.text }]}>{opt.label}</Text>
                  <Text style={[type.bodySm, { color: theme.subtext, marginTop: 2 }]}>{opt.sub}</Text>
                </View>
                {active && <Icon name="checkmark-circle" size={19} color={theme.ink} />}
              </Pressable>
            );
          })}
        </View>

        <Text style={[type.labelXs, { color: theme.muted, marginTop: 24, marginBottom: 10 }]}>MESSAGES</Text>
        <PaperCard style={{ padding: 6 }} weight="thin">
          <View style={s.row}>
            <Icon name="checkmark-done-outline" size={19} color={theme.ink} style={{ width: 26 }} />
            <View style={{ flex: 1 }}>
              <Text style={[type.bodyLg, { color: theme.text }]}>Read receipts</Text>
              <Text style={[type.bodySm, { color: theme.subtext, marginTop: 2 }]}>
                Blue double-ticks when you've read a message
              </Text>
            </View>
            <HandDrawnToggle value={!!privacy.readReceipts} onToggle={toggleReadReceipts} theme={theme} busy={busy} />
          </View>
        </PaperCard>
        {!privacy.readReceipts && (
          <Text style={[type.bodySm, { color: theme.muted, marginTop: 8, lineHeight: 18 }]}>
            Turned off — you won't send read receipts to anyone, and you also won't see
            when others have read your messages. This does not apply to group chats.
          </Text>
        )}

        <Text style={[type.labelXs, { color: theme.muted, marginTop: 24, marginBottom: 10 }]}>BLOCKED CONTACTS</Text>
        <Pressable
          onPress={() => navigation.navigate('BlockedUsers')}
          style={({ pressed }) => [s.optionRow, inkBox(theme, 'thin'), pressed && marker(theme, 1)]}
        >
          <Icon name="ban-outline" size={19} color={theme.ink} style={{ width: 26 }} />
          <View style={{ flex: 1 }}>
            <Text style={[type.bodyLg, { color: theme.text }]}>Blocked contacts</Text>
            <Text style={[type.bodySm, { color: theme.subtext, marginTop: 2 }]}>
              Manage who can't message you or see your posts
            </Text>
          </View>
          <Icon name="chevron-forward-outline" size={17} color={theme.muted} />
        </Pressable>
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
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 14, paddingVertical: 13 },
});
