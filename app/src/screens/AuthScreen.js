import React, { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView,
  Platform, ScrollView,
} from 'react-native';
import Icon from '../icons/Icon';
import { useAuth } from '../store/AuthContext';
import { useTheme } from '../store/ThemeContext';
import { ClayCard, ClayButton, ClayInset } from '../components/common';
import { radius, type, clayFor, clayPressed, tokens } from '../theme';

export default function AuthScreen() {
  const { login, register } = useAuth();
  const { theme } = useTheme();
  const [mode, setMode] = useState('login');
  const [phone, setPhone] = useState('+919000000001');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('1234');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError('');
    if (!phone.trim() || !password) return setError('Phone number and password are required.');
    if (mode === 'register' && !name.trim()) return setError('Please enter your name.');
    setBusy(true);
    try {
      if (mode === 'login') await login(phone.trim(), password);
      else await register(phone.trim(), name.trim(), password);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const s = makeStyles(theme);

  const Field = ({ icon, ...props }) => (
    <ClayInset style={s.field} strength={1}>
      <Icon name={icon} size={19} color={theme.muted} />
      <TextInput
        style={s.input}
        placeholderTextColor={theme.muted}
        {...props}
      />
    </ClayInset>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <View style={s.logoWrap}>
          <View style={[s.logoCircle, clayFor(theme, 3)]}>
            <Icon name="chatbubbles" size={46} color={tokens.onPrimaryFixed} />
          </View>
          <Text style={s.title}>BROSKIE</Text>
          <Text style={s.tagline}>Soft, tactile messaging for your people.</Text>
        </View>

        <ClayCard style={s.card} level={2}>
          <View style={s.tabs}>
            {['login', 'register'].map((m) => {
              const active = mode === m;
              return (
                <Pressable
                  key={m}
                  onPress={() => { setMode(m); setError(''); }}
                  style={({ pressed }) => [
                    s.tab,
                    active && { backgroundColor: theme.accent },
                    active ? clayFor(theme, 1) : null,
                    pressed && !active ? { opacity: 0.7 } : null,
                  ]}
                >
                  <Text style={[type.bodySm, { fontFamily: type.fontFamily(700), color: active ? theme.onAccent : theme.subtext }]}>
                    {m === 'login' ? 'Log in' : 'Sign up'}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {mode === 'register' && (
            <Field icon="person-outline" placeholder="Your name" value={name} onChangeText={setName} autoCapitalize="words" />
          )}
          <Field icon="call-outline" placeholder="Phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoCapitalize="none" />
          <Field icon="lock-closed-outline" placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry />

          {!!error && (
            <View style={s.errorBox}>
              <Icon name="alert-circle" size={16} color={theme.danger} />
              <Text style={[type.bodySm, { color: theme.danger, flex: 1 }]}>{error}</Text>
            </View>
          )}

          <ClayButton
            label={mode === 'login' ? 'Log in' : 'Create account'}
            onPress={submit}
            busy={busy}
            style={{ marginTop: 8 }}
          />

          <View style={s.demoBox}>
            <Text style={[type.labelMd, { color: theme.muted, marginBottom: 12 }]}>DEMO ACCOUNTS · PASSWORD 1234</Text>
            {[
              ['+919000000001', 'You (Demo)'],
              ['+919000000002', 'Ananya Sharma'],
              ['+919000000003', 'Rohit Verma'],
            ].map(([p, n]) => (
              <Pressable
                key={p}
                onPress={() => { setPhone(p); setPassword('1234'); setMode('login'); }}
                style={({ pressed }) => [s.demoRow, { backgroundColor: theme.cardAlt }, pressed ? clayPressed(theme.shadowTint) : null]}
              >
                <Text style={[type.bodySm, { fontFamily: type.fontFamily(600), color: theme.primary }]}>{p}</Text>
                <Text style={[type.bodySm, { color: theme.subtext }]}>{n}</Text>
              </Pressable>
            ))}
            <Text style={[type.bodySm, { color: theme.muted, marginTop: 12, fontSize: 12, lineHeight: 18 }]}>
              Tip: open a second browser tab and log in as someone else to chat in real time.
            </Text>
          </View>
        </ClayCard>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (t) => StyleSheet.create({
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 20, paddingVertical: 40, maxWidth: 480, width: '100%', alignSelf: 'center' },
  logoWrap: { alignItems: 'center', marginBottom: 32 },
  logoCircle: {
    width: 96, height: 96, borderRadius: radius.full, backgroundColor: tokens.primaryContainer,
    alignItems: 'center', justifyContent: 'center', marginBottom: 20,
  },
  title: { ...type.displayLg, color: t.text, letterSpacing: 1.5 },
  tagline: { ...type.bodySm, color: t.subtext, marginTop: 8 },
  card: { padding: 24 },
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: radius.full },
  field: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, marginBottom: 14, minHeight: 54 },
  input: { flex: 1, paddingVertical: 15, ...type.bodyLg, color: t.text, outlineStyle: 'none' },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, paddingHorizontal: 4 },
  demoBox: { marginTop: 26, paddingTop: 4 },
  demoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 18, borderRadius: radius.full, marginBottom: 8 },
});
