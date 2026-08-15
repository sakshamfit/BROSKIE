import React, { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView,
  Platform, ScrollView,
} from 'react-native';
import Icon from '../icons/Icon';
import { useAuth } from '../store/AuthContext';
import { useTheme } from '../store/ThemeContext';
import { InkButton, InkField, Rule } from '../components/common';
import { type, inkBox, marker, stroke } from '../theme';

export default function AuthScreen() {
  const { login, register } = useAuth();
  const { theme } = useTheme();
  const [mode, setMode] = useState('login');
  const [phone, setPhone] = useState('+919000000001');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('1234');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState(null);

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

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        {/* masthead */}
        <View style={s.masthead}>
          <View style={[s.logoBox, inkBox(theme, 'bold')]}>
            <Icon name="chatbubbles" size={30} color={theme.ink} />
          </View>
          <Text style={s.title}>BROSKIE</Text>
          <View style={s.taglineWrap}>
            <Text style={s.tagline}>messages, sketched by hand</Text>
          </View>
        </View>

        <Rule style={{ marginBottom: 26 }} />

        {/* mode switch — highlighter marks the active one */}
        <View style={s.tabs}>
          {['login', 'register'].map((m) => {
            const active = mode === m;
            return (
              <Pressable key={m} onPress={() => { setMode(m); setError(''); }} style={s.tab}>
                <View style={active ? marker(theme, 2) : null}>
                  <Text style={[type.labelSm, { color: active ? theme.ink : theme.muted, paddingHorizontal: 6, paddingVertical: 3 }]}>
                    {m === 'login' ? 'LOG IN' : 'SIGN UP'}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        {mode === 'register' && (
          <View style={s.fieldWrap}>
            <Text style={s.fieldLabel}>NAME</Text>
            <InkField focused={focus === 'name'}>
              <TextInput
                style={s.input} placeholder="your name" placeholderTextColor={theme.muted}
                value={name} onChangeText={setName} autoCapitalize="words"
                onFocus={() => setFocus('name')} onBlur={() => setFocus(null)}
              />
            </InkField>
          </View>
        )}

        <View style={s.fieldWrap}>
          <Text style={s.fieldLabel}>PHONE</Text>
          <InkField focused={focus === 'phone'}>
            <TextInput
              style={s.input} placeholder="+91 00000 00000" placeholderTextColor={theme.muted}
              value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoCapitalize="none"
              onFocus={() => setFocus('phone')} onBlur={() => setFocus(null)}
            />
          </InkField>
        </View>

        <View style={s.fieldWrap}>
          <Text style={s.fieldLabel}>PASSWORD</Text>
          <InkField focused={focus === 'pass'}>
            <TextInput
              style={s.input} placeholder="••••" placeholderTextColor={theme.muted}
              value={password} onChangeText={setPassword} secureTextEntry
              onFocus={() => setFocus('pass')} onBlur={() => setFocus(null)}
            />
          </InkField>
        </View>

        {!!error && (
          <View style={s.errorBox}>
            <Icon name="alert-circle" size={15} color={theme.danger} />
            <Text style={[type.bodySm, { color: theme.danger, flex: 1 }]}>{error}</Text>
          </View>
        )}

        <InkButton
          label={mode === 'login' ? 'Log in' : 'Create account'}
          onPress={submit}
          busy={busy}
          filled
          style={{ marginTop: 22 }}
        />

        <Rule style={{ marginTop: 34, marginBottom: 16 }} />

        <Text style={[type.labelSm, { color: theme.muted, marginBottom: 12 }]}>DEMO ACCOUNTS · PW 1234</Text>
        {[
          ['+919000000001', 'You (Demo)'],
          ['+919000000002', 'Ananya Sharma'],
          ['+919000000003', 'Rohit Verma'],
        ].map(([p, n]) => (
          <Pressable
            key={p}
            onPress={() => { setPhone(p); setPassword('1234'); setMode('login'); }}
            style={({ pressed }) => [s.demoRow, pressed ? marker(theme, 1) : null]}
          >
            <Text style={[type.labelSm, { color: theme.ink }]}>{p}</Text>
            <Text style={[type.bodySm, { color: theme.subtext }]}>{n}</Text>
          </Pressable>
        ))}

        <Text style={[type.bodySm, { color: theme.muted, marginTop: 18, fontSize: 12.5, lineHeight: 19 }]}>
          Open a second browser tab and log in as someone else to chat in real time.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (t) => StyleSheet.create({
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 32, paddingVertical: 48, maxWidth: 460, width: '100%', alignSelf: 'center' },
  masthead: { alignItems: 'flex-start' },
  logoBox: { width: 60, height: 60, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  title: { ...type.headlineLg, color: t.text },
  taglineWrap: { marginTop: 6 },
  tagline: { ...type.bodyMd, color: t.subtext, fontStyle: 'italic' },
  tabs: { flexDirection: 'row', gap: 20, marginBottom: 28 },
  tab: { paddingVertical: 2 },
  fieldWrap: { marginBottom: 22 },
  fieldLabel: { ...type.labelXs, color: t.muted, marginBottom: 2 },
  input: { flex: 1, paddingVertical: 10, ...type.bodyLg, color: t.text, outlineStyle: 'none' },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 6 },
  demoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 9 },
});
