import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, TextInput, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../icons/Icon';
import { useTheme } from '../store/ThemeContext';
import { useAuth } from '../store/AuthContext';
import { api } from '../api';
import useResponsive from '../hooks/useResponsive';
import { confirm } from '../hooks/confirm';
import { PaperCard, InkField, InkButton, Rule } from '../components/common';
import { type, inkBox } from '../theme';

const PASSWORD_HINT = 'Use 8+ characters with uppercase, lowercase, a number, and a special character.';
const isStrongPassword = (value) => value.length >= 8 && /[A-Z]/.test(value) && /[a-z]/.test(value) && /[0-9]/.test(value) && /[^A-Za-z0-9\s]/.test(value);

/** "Security & Privacy" — change password + a read-only session summary. */
export default function SecurityScreen({ navigation, embedded = false }) {
  const { theme } = useTheme();
  const { logout } = useAuth();
  const insets = useSafeAreaInsets();
  const { isTablet, isWeb } = useResponsive();
  const s = makeStyles(theme);
  const deviceIcon = isWeb ? 'desktop-outline' : isTablet ? 'laptop-outline' : 'phone-portrait-outline';

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const submit = async () => {
    setError('');
    setSuccess(false);
    if (!current || !next) return setError('Fill in both password fields.');
    if (!isStrongPassword(next)) return setError(PASSWORD_HINT);
    if (next !== confirm) return setError('New passwords do not match.');
    setBusy(true);
    try {
      await api.changePassword({ currentPassword: current, newPassword: next });
      setCurrent(''); setNext(''); setConfirm('');
      setSuccess(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const signOutEverywhere = async () => {
    const ok = await confirm('Log out of this session?', { title: 'Log out', confirmLabel: 'Log out', destructive: true });
    if (ok) logout();
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={[s.header, !embedded && { paddingTop: 20 + insets.top }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={{ padding: 6 }}>
          <Icon name="arrow-back" size={22} color={theme.ink} />
        </Pressable>
        <Text style={[type.headlineMd, { color: theme.text }]}>Security & Privacy</Text>
      </View>

      <ScrollView contentContainerStyle={[s.scroll, isTablet && s.scrollWide]}>
        <View style={s.sectionHead}>
          <Icon name="shield-checkmark-outline" size={18} color={theme.ink} />
          <Text style={[type.labelXs, { color: theme.muted }]}>CHANGE PASSWORD</Text>
        </View>

        <PaperCard style={{ gap: 18 }} weight="thin">
          <Field
            theme={theme}
            label="Current password"
            value={current}
            onChangeText={(v) => { setCurrent(v); setError(''); }}
            placeholder="••••••••"
          />
          <Field
            theme={theme}
            label="New password"
            value={next}
            onChangeText={(v) => { setNext(v); setError(''); }}
            placeholder="8+ chars · Aa1!"
          />
          <Field
            theme={theme}
            label="Confirm new password"
            value={confirm}
            onChangeText={(v) => { setConfirm(v); setError(''); }}
            placeholder="Repeat new password"
          />

          {!!error && (
            <View style={s.msgRow}>
              <Icon name="alert-circle" size={15} color={theme.danger} />
              <Text style={[type.bodySm, { color: theme.danger, flex: 1 }]}>{error}</Text>
            </View>
          )}
          {success && (
            <View style={s.msgRow}>
              <Icon name="checkmark-circle" size={15} color="#0a8a2f" />
              <Text style={[type.bodySm, { color: '#0a8a2f', flex: 1 }]}>Password updated.</Text>
            </View>
          )}

          <InkButton
            label={busy ? 'Updating…' : 'Update password'}
            icon="key-outline"
            onPress={submit}
            disabled={busy}
            filled
          />
        </PaperCard>

        <View style={[s.sectionHead, { marginTop: 28 }]}>
          <Icon name="finger-print-outline" size={18} color={theme.ink} />
          <Text style={[type.labelXs, { color: theme.muted }]}>SESSION</Text>
        </View>
        <PaperCard weight="thin">
          <View style={s.sessionRow}>
            <Icon name={deviceIcon} size={19} color={theme.ink} />
            <View style={{ flex: 1 }}>
              <Text style={[type.bodyMd, { color: theme.text }]}>This device</Text>
              <Text style={[type.labelXs, { color: theme.graphite, marginTop: 2 }]}>ACTIVE NOW · CURRENT SESSION</Text>
            </View>
          </View>
          <Rule style={{ marginVertical: 4 }} />
          <Pressable onPress={signOutEverywhere} style={{ paddingVertical: 8 }}>
            <Text style={[type.bodySm, { color: theme.danger }]}>Log out of this session</Text>
          </Pressable>
        </PaperCard>

        <Text style={[type.bodySm, { color: theme.muted, marginTop: 20, lineHeight: 19 }]}>
          Two-factor authentication and multi-device session management aren't available yet —
          this app currently issues a single long-lived session token per login.
        </Text>
      </ScrollView>
    </View>
  );
}

function Field({ theme, label, ...props }) {
  return (
    <View>
      <Text style={[type.labelXs, { color: theme.graphite, marginBottom: 4 }]}>{label.toUpperCase()}</Text>
      <InkField>
        <TextInput
          style={{ flex: 1, ...type.bodyLg, color: theme.text, paddingVertical: 10, outlineStyle: 'none' }}
          placeholderTextColor={theme.muted}
          secureTextEntry
          {...props}
        />
      </InkField>
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 14 },
  scroll: { padding: 20, paddingBottom: 40 },
  scrollWide: { maxWidth: 560, width: '100%', alignSelf: 'center' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  msgRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sessionRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 6 },
});
