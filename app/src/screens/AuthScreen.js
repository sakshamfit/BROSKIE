import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView,
  Platform, ScrollView, ActivityIndicator, Animated, Easing,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, Pattern, Circle, Rect } from 'react-native-svg';
import Icon from '../icons/Icon';
import { useAuth } from '../store/AuthContext';
import { api } from '../api';
import useResponsive from '../hooks/useResponsive';

/**
 * "Enter the Void" — dark manga/glitch login screen. Scoped ONLY to Auth;
 * the rest of the app keeps the Graphite & Pulp paper theme. Colours and
 * type scale below are lifted straight from the supplied mockup's Tailwind
 * config, hand-mapped to React Native style objects (no CDN Tailwind here).
 */
const VOID = {
  background: '#131313',
  surfaceContainerLowest: '#0e0e0e',
  onBackground: '#e5e2e1',
  onSurfaceVariant: '#b9cacb',
  outline: '#849495',
  outlineVariant: '#3b494b',
  primaryContainer: '#00f0ff',   // cyan accent
  onPrimaryContainer: '#006970',
  onTertiaryFixed: '#1a1c1c',    // near-black ink used for the brutalist card
  tertiary: '#f5f5f5',           // brutalist card background (near white)
  secondaryContainer: '#ff525c', // hot red/pink accent
  onSecondaryContainer: '#5b000f',
  error: '#ffb4ab',
};

const USERNAME_RE = /^[a-z0-9](?:[a-z0-9._]{1,22})[a-z0-9]$/;

export default function AuthScreen() {
  const { login, register } = useAuth();
  const insets = useSafeAreaInsets();
  const { isSplitCapable, isSmallPhone } = useResponsive();
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState(null);

  const [checking, setChecking] = useState(false);
  const [availability, setAvailability] = useState(null); // { available, error }
  const checkTimer = useRef(null);

  useEffect(() => {
    if (mode !== 'register') { setAvailability(null); return; }
    clearTimeout(checkTimer.current);
    const u = username.trim().toLowerCase();
    if (u.length < 3) { setAvailability(null); return; }
    setChecking(true);
    checkTimer.current = setTimeout(async () => {
      try {
        const r = await api.usernameAvailable(u);
        setAvailability(r);
      } catch {
        setAvailability(null);
      } finally {
        setChecking(false);
      }
    }, 400);
    return () => clearTimeout(checkTimer.current);
  }, [username, mode]);

  const submit = async () => {
    setError('');
    const u = username.trim().toLowerCase();
    if (!u || !password) return setError('Operator ID and Access Key are required.');
    if (!USERNAME_RE.test(u) || u.length < 3) {
      return setError('Operator ID must be 3–24 chars: letters, numbers, "." or "_".');
    }
    if (mode === 'register' && !name.trim()) return setError('Please enter your name.');
    setBusy(true);
    try {
      if (mode === 'login') await login(u, password);
      else await register(u, name.trim(), password, phone.trim() || undefined);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[s.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <HalftoneBackground />
      <SpeedLines />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
      >
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <View style={[s.layout, { flexDirection: isSplitCapable ? 'row' : 'column' }]}>
            {/* -------- Branding splash — hidden on phones to leave room for the
                form (matches how the mockup's own layout collapses on small
                screens); tablets/desktop keep the full split. -------- */}
            {isSplitCapable && (
              <View style={s.brandSection}>
                <GlitchWordmark small={isSmallPhone} />
                <View style={s.tagBadge}>
                  <Text style={s.tagBadgeText}>SYSTEM: V.01-SHONEN</Text>
                </View>
                <Text style={s.scribble}>AWAKEN!</Text>
              </View>
            )}
            {!isSplitCapable && (
              <View style={s.brandSectionCompact}>
                <GlitchWordmark small={isSmallPhone} compact />
              </View>
            )}

            {/* -------- Sync Link card -------- */}
            <View style={s.cardWrap}>
              <View style={s.cardShadow} />
              <View style={[s.card, isSmallPhone && s.cardCompact]}>
                <View style={s.cardHeader}>
                  <Icon name="person-circle" size={34} color={VOID.onTertiaryFixed} />
                  <Text style={s.cardTitle}>Sync Link</Text>
                </View>

                <View style={s.modeRow}>
                  {['login', 'register'].map((m) => {
                    const active = mode === m;
                    return (
                      <Pressable
                        key={m}
                        onPress={() => { setMode(m); setError(''); }}
                        android_ripple={{ color: 'rgba(0,240,255,0.25)' }}
                        style={[s.modeTab, active && s.modeTabActive]}
                      >
                        <Text style={[s.modeTabText, active && s.modeTabTextActive]}>
                          {m === 'login' ? 'LOG IN' : 'SIGN UP'}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                {mode === 'register' && (
                  <Field
                    icon="id-card-outline"
                    label="Callsign"
                    value={name}
                    onChangeText={setName}
                    placeholder="Your display name"
                    focused={focus === 'name'}
                    onFocus={() => setFocus('name')}
                    onBlur={() => setFocus(null)}
                    autoCapitalize="words"
                  />
                )}

                <Field
                  icon="id-card-outline"
                  label="Operator ID"
                  value={username}
                  onChangeText={setUsername}
                  placeholder="Enter alphanumeric code"
                  focused={focus === 'uid'}
                  onFocus={() => setFocus('uid')}
                  onBlur={() => setFocus(null)}
                  autoCapitalize="none"
                  autoCorrect={false}
                  suffix={
                    mode === 'register' ? (
                      checking ? (
                        <ActivityIndicator size="small" color={VOID.onTertiaryFixed} />
                      ) : availability ? (
                        <Icon
                          name={availability.available ? 'checkmark-circle' : 'alert-circle'}
                          size={18}
                          color={availability.available ? '#0a8a2f' : VOID.secondaryContainer}
                        />
                      ) : null
                    ) : null
                  }
                />
                {mode === 'register' && availability && !availability.available && (
                  <Text style={s.fieldHint}>{availability.error}</Text>
                )}
                {mode === 'register' && !availability && (
                  <Text style={s.fieldHintMuted}>3–24 chars · letters, numbers, "." or "_" · must be unique</Text>
                )}

                {mode === 'register' && (
                  <Field
                    icon="call"
                    label="Comm Channel (optional)"
                    value={phone}
                    onChangeText={setPhone}
                    placeholder="+91 00000 00000"
                    focused={focus === 'phone'}
                    onFocus={() => setFocus('phone')}
                    onBlur={() => setFocus(null)}
                    keyboardType="phone-pad"
                  />
                )}

                <Field
                  icon="key-outline"
                  label="Access Key"
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  focused={focus === 'key'}
                  onFocus={() => setFocus('key')}
                  onBlur={() => setFocus(null)}
                  secureTextEntry
                />

                <View style={s.optionsRow}>
                  <Pressable onPress={() => setRemember((v) => !v)} style={s.rememberRow}>
                    <View style={[s.checkbox, remember && s.checkboxChecked]}>
                      {remember && <Icon name="checkmark" size={13} color={VOID.tertiary} />}
                    </View>
                    <Text style={s.rememberText}>REMEMBER ME</Text>
                  </Pressable>
                  <Text style={s.lostKey}>LOST KEY?</Text>
                </View>

                {!!error && (
                  <View style={s.errorRow}>
                    <Icon name="alert-circle" size={15} color={VOID.secondaryContainer} />
                    <Text style={s.errorText}>{error}</Text>
                  </View>
                )}

                <Pressable
                  onPress={submit}
                  disabled={busy}
                  android_ripple={{ color: VOID.primaryContainer }}
                  style={({ pressed }) => [s.submitBtn, Platform.OS !== 'android' && pressed && s.submitBtnPressed, busy && { opacity: 0.6 }]}
                >
                  {busy ? (
                    <ActivityIndicator color={VOID.primaryContainer} />
                  ) : (
                    <>
                      <Text style={s.submitText}>{mode === 'login' ? 'ENTER THE VOID' : 'CREATE OPERATOR'}</Text>
                      <Icon name="arrow-forward" size={20} color={VOID.background} />
                    </>
                  )}
                </Pressable>

                <View style={s.sticker}>
                  <Text style={s.stickerText}>LOCKED OUT?</Text>
                </View>
              </View>
              <View style={s.cornerBR} />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* pieces                                                              */
/* ------------------------------------------------------------------ */

function Field({ icon, label, suffix, focused, ...inputProps }) {
  return (
    <View style={s.fieldWrap}>
      <View style={s.fieldLabelRow}>
        <Icon name={icon} size={13} color={VOID.onTertiaryFixed} />
        <Text style={s.fieldLabel}>{label}</Text>
      </View>
      <View style={s.fieldInputRow}>
        <TextInput
          style={s.fieldInput}
          placeholderTextColor={VOID.outline}
          {...inputProps}
        />
        {suffix}
      </View>
      <View style={[s.fieldUnderline, focused && s.fieldUnderlineActive]} />
    </View>
  );
}

/** Halftone dot-grid background, tiled via an SVG pattern (works everywhere, no images). */
function HalftoneBackground() {
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
      <Defs>
        <Pattern id="halftone" width="8" height="8" patternUnits="userSpaceOnUse">
          <Circle cx="2" cy="2" r="1" fill="#353535" opacity={0.4} />
        </Pattern>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#halftone)" />
    </Svg>
  );
}

/** Diagonal cyan speed-line overlay, looping via a native Animated translate. */
function SpeedLines() {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(anim, { toValue: 1, duration: 2200, easing: Easing.linear, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);

  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 100] });
  const lines = useMemo(() => Array.from({ length: 24 }, (_, i) => i), []);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View style={[s.speedLinesTrack, { transform: [{ translateX }] }]}>
        {lines.map((i) => (
          <View key={i} style={s.speedLine} />
        ))}
      </Animated.View>
    </View>
  );
}

/** Red/cyan double-exposed "glitch" wordmark, built from stacked offset text layers. */
function GlitchWordmark({ small = false, compact = false }) {
  const size = compact ? (small ? 44 : 56) : (small ? 64 : 88);
  const textStyle = [s.glitchText, { fontSize: size, lineHeight: size + 4 }];
  const offset = compact ? 2 : 4;
  return (
    <View style={s.glitchWrap}>
      <Text style={[textStyle, s.glitchLayerRed, { transform: [{ translateX: offset }, { translateY: -offset * 0.75 }] }]}>友達</Text>
      <Text style={[textStyle, s.glitchLayerCyan, { transform: [{ translateX: -offset }, { translateY: offset * 0.75 }] }]}>友達</Text>
      <Text style={textStyle}>友達</Text>
      <Text style={[s.wordmarkSub, compact && { fontSize: 18, letterSpacing: 2, marginTop: 4 }]}>TOMODACHI</Text>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* styles                                                              */
/* ------------------------------------------------------------------ */

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: VOID.background },
  scroll: { flexGrow: 1, minHeight: '100%' },

  layout: {
    flex: 1,
    minHeight: 640,
  },

  brandSection: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    paddingHorizontal: 24,
  },
  brandSectionCompact: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 28,
    paddingBottom: 12,
    paddingHorizontal: 24,
  },

  glitchWrap: { alignItems: 'center' },
  glitchText: {
    fontFamily: 'Anybody_900Black',
    fontStyle: 'italic',
    color: VOID.onBackground,
    textAlign: 'center',
  },
  glitchLayerRed: {
    position: 'absolute',
    color: VOID.secondaryContainer,
    opacity: 0.7,
    transform: [{ translateX: 4 }, { translateY: -3 }],
  },
  glitchLayerCyan: {
    position: 'absolute',
    color: VOID.primaryContainer,
    opacity: 0.7,
    transform: [{ translateX: -4 }, { translateY: 3 }],
  },
  wordmarkSub: {
    fontFamily: 'Anybody_800ExtraBold',
    fontSize: 30,
    color: VOID.primaryContainer,
    marginTop: 8,
    textTransform: 'uppercase',
    letterSpacing: 4,
    textAlign: 'center',
  },

  tagBadge: {
    marginTop: 28,
    backgroundColor: VOID.onTertiaryFixed,
    borderWidth: 2,
    borderColor: VOID.primaryContainer,
    paddingHorizontal: 16,
    paddingVertical: 8,
    transform: [{ skewX: '-12deg' }],
  },
  tagBadgeText: {
    fontFamily: 'SpaceMono_700Bold',
    fontSize: 12,
    letterSpacing: 2,
    color: VOID.primaryContainer,
  },

  scribble: {
    position: 'absolute',
    bottom: '22%',
    left: '18%',
    fontFamily: 'Bricolage_600SemiBold',
    fontSize: 24,
    color: VOID.secondaryContainer,
    opacity: 0.85,
    transform: [{ rotate: '-12deg' }],
  },

  cardWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
    position: 'relative',
  },
  cardShadow: {
    position: 'absolute',
    top: 32 + 12,
    left: 24 + 12,
    right: 24 - 12,
    bottom: 32 - 12,
    maxWidth: 420,
    alignSelf: 'center',
    width: '100%',
    backgroundColor: '#000',
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: VOID.tertiary,
    borderWidth: 4,
    borderColor: VOID.onTertiaryFixed,
    padding: 28,
    transform: [{ rotate: '1deg' }],
  },
  cardCompact: { padding: 18, borderWidth: 3, transform: [{ rotate: '0.5deg' }] },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingBottom: 16,
    marginBottom: 24,
    borderBottomWidth: 4,
    borderBottomColor: VOID.onTertiaryFixed,
  },
  cardTitle: {
    fontFamily: 'Anybody_800ExtraBold',
    fontSize: 26,
    color: VOID.onTertiaryFixed,
    textTransform: 'uppercase',
  },

  modeRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  modeTab: { flex: 1, borderWidth: 2, borderColor: VOID.onTertiaryFixed, paddingVertical: 9, alignItems: 'center' },
  modeTabActive: { backgroundColor: VOID.onTertiaryFixed },
  modeTabText: { fontFamily: 'SpaceMono_700Bold', fontSize: 12, letterSpacing: 1.5, color: VOID.onTertiaryFixed },
  modeTabTextActive: { color: VOID.primaryContainer },

  fieldWrap: { marginBottom: 22, position: 'relative' },
  fieldLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  fieldLabel: {
    fontFamily: 'SpaceMono_700Bold', fontSize: 11, letterSpacing: 1.5,
    color: '#5d5f5f', textTransform: 'uppercase',
  },
  fieldInputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderBottomWidth: 4, borderBottomColor: VOID.onTertiaryFixed, paddingVertical: 8,
  },
  fieldInput: {
    flex: 1, fontFamily: 'SpaceMono_400Regular', fontSize: 15, color: VOID.onTertiaryFixed,
    paddingVertical: 2, outlineStyle: 'none',
  },
  fieldUnderline: { height: 3, backgroundColor: 'transparent', marginTop: -3 },
  fieldUnderlineActive: { backgroundColor: VOID.primaryContainer },
  fieldHint: { fontFamily: 'SpaceMono_400Regular', fontSize: 11, color: VOID.secondaryContainer, marginTop: -14, marginBottom: 18 },
  fieldHintMuted: { fontFamily: 'SpaceMono_400Regular', fontSize: 11, color: '#7d7d7d', marginTop: -14, marginBottom: 18 },

  optionsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, marginBottom: 8 },
  rememberRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkbox: { width: 20, height: 20, borderWidth: 2, borderColor: VOID.onTertiaryFixed, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: VOID.onTertiaryFixed },
  rememberText: { fontFamily: 'SpaceMono_700Bold', fontSize: 11, letterSpacing: 1, color: '#5d5f5f' },
  lostKey: {
    fontFamily: 'SpaceMono_700Bold', fontSize: 11, letterSpacing: 1, color: VOID.secondaryContainer,
    textDecorationLine: 'underline',
  },

  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
  errorText: { flex: 1, fontFamily: 'SpaceMono_400Regular', fontSize: 12, color: VOID.secondaryContainer },

  submitBtn: {
    marginTop: 26,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12,
    backgroundColor: VOID.background,
    borderWidth: 4, borderColor: VOID.onTertiaryFixed,
    paddingVertical: 16,
  },
  submitBtnPressed: { backgroundColor: VOID.primaryContainer, transform: [{ translateX: 4 }, { translateY: 4 }] },
  submitText: {
    fontFamily: 'Anybody_800ExtraBold', fontSize: 18, color: VOID.primaryContainer,
    textTransform: 'uppercase', letterSpacing: 1.5,
  },

  sticker: {
    position: 'absolute', top: -18, right: -14,
    backgroundColor: VOID.secondaryContainer, borderWidth: 2, borderColor: VOID.onTertiaryFixed,
    paddingHorizontal: 12, paddingVertical: 5, transform: [{ rotate: '12deg' }],
  },
  stickerText: { fontFamily: 'Bricolage_600SemiBold', fontSize: 13, color: VOID.onSecondaryContainer },

  cornerBR: {
    position: 'absolute', bottom: 32, right: 24, width: 56, height: 56,
    borderBottomWidth: 8, borderRightWidth: 8, borderColor: VOID.onTertiaryFixed,
  },

  speedLinesTrack: { flexDirection: 'row', width: '220%', height: '100%' },
  speedLine: { width: 2, height: '100%', marginRight: 98, backgroundColor: 'rgba(0,240,255,0.08)' },
});
