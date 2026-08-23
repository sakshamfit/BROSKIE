import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView,
  Platform, ScrollView, ActivityIndicator, Animated, Easing, Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, Pattern, Circle, Rect } from 'react-native-svg';
import Icon from '../icons/Icon';
import { useAuth } from '../store/AuthContext';
import { api, authErrorMessage } from '../api';
import { useDebouncedCallback } from '../rateLimit';
import { SpringPressable, Shake, motion, haptic } from '../motion';

/**
 * Auth must not subscribe to the live window height. Android and mobile web
 * change that height for every frame of the keyboard animation; feeding those
 * frames into the auth component re-renders controlled TextInputs and can
 * make their caret visibly flash or jump. Width/orientation changes are the
 * only layout changes this screen needs.
 */
function useAuthLayout() {
  const screenRef = useRef(Dimensions.get('screen'));
  const [width, setWidth] = useState(() => Dimensions.get('window').width);

  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', ({ window }) => {
      setWidth((previousWidth) => previousWidth === window.width ? previousWidth : window.width);
    });
    return () => subscription?.remove();
  }, []);

  const screen = screenRef.current;
  const shortSide = Math.min(screen.width || width, screen.height || width);
  return {
    width,
    isWeb: Platform.OS === 'web',
    isSmallPhone: shortSide < 360,
    isSplitCapable: width >= 840 && shortSide >= 600,
  };
}

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

const CARD = {
  bg: '#242322',
  bgDeep: '#151515',
  bgRaised: '#302e2c',
  text: '#f4f0ef',
  subtext: '#c5c0bd',
  muted: '#99928e',
  line: '#5e5956',
  accent: '#FFE24D',
  accentSoft: 'rgba(255,226,77,0.18)',
  error: '#ffb4ab',
};

const MAX_USERNAME_LENGTH = 64;
const PASSWORD_HINT = 'Password must be at least 8 characters.';

export default function AuthScreen() {
  const { login, register } = useAuth();
  const insets = useSafeAreaInsets();
  const { isSplitCapable, isSmallPhone, isWeb, width } = useAuthLayout();

  /**
   * Keep phone auth top-anchored for the entire session. In particular, do
   * not decide this from the current viewport height: mobile browsers report
   * a smaller height as soon as the IME opens, which used to switch the form
   * from centered to top-anchored in the middle of the keyboard animation.
   * That switch made the card, fields, and caret visibly bounce.
   *
   * The native Android activity also uses adjustPan (app.json), so the OS can
   * move the window just enough to reveal a focused field without continuously
   * resizing this form. The phone layout remains a natural-height scroll
   * surface rather than a flex box that re-centers on every IME frame.
   */
  const anchorTop = isWeb ? width < 600 : !isSplitCapable;
  const [mode, setMode] = useState('login'); // 'login' | 'register' | 'forgot' | 'otp' | 'reset'
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const submittingRef = useRef(false);
  const [focus, setFocus] = useState(null);

  // OTP Verification specific states
  const [otp, setOtp] = useState('');
  const [resetToken, setResetToken] = useState('');
  const otpInputRef = useRef(null);

  const [checking, setChecking] = useState(false);
  const [availability, setAvailability] = useState(null); // { available, error }
  const checkSequence = useRef(0);

  // Debounced username availability probe
  const checkAvailability = useDebouncedCallback(async (candidate, sequence) => {
    try {
      const result = await api.usernameAvailable(candidate);
      if (checkSequence.current === sequence) setAvailability(result);
    } catch {
      if (checkSequence.current === sequence) setAvailability(null);
    } finally {
      if (checkSequence.current === sequence) setChecking(false);
    }
  }, 450);

  useEffect(() => {
    const sequence = ++checkSequence.current;
    const candidate = username.trim();
    if (mode !== 'register' || !candidate || candidate.length > MAX_USERNAME_LENGTH) {
      checkAvailability.cancel();
      setChecking(false);
      setAvailability(null);
      return undefined;
    }
    setChecking(true);
    checkAvailability(candidate, sequence);
    return () => checkAvailability.cancel();
  }, [username, mode, checkAvailability]);

  const [errorTick, setErrorTick] = useState(0);
  const fail = (message) => {
    setError(message);
    setSuccessMessage('');
    setErrorTick((n) => n + 1);
    haptic('error');
  };

  const handleForgotPassword = async () => {
    const phoneCandidate = phone.trim();
    if (!phoneCandidate) return fail('Phone number is required to receive OTP.');
    setBusy(true);
    try {
      await api.forgotPassword(phoneCandidate);
      setSuccessMessage('OTP sent successfully!');
      setMode('otp');
      setOtp('');
      haptic('success');
    } catch (e) {
      fail(e.message || 'Failed to request OTP');
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (otp.length < 6) return fail('Please enter the complete 6-digit OTP.');
    setBusy(true);
    try {
      const res = await api.verifyOtp(phone.trim(), otp);
      setResetToken(res.resetToken);
      setSuccessMessage('OTP Verified. Please set a new password.');
      setMode('reset');
      setPassword('');
      setConfirmPassword('');
      haptic('success');
    } catch (e) {
      fail(e.message || 'OTP verification failed');
    } finally {
      setBusy(false);
    }
  };

  const handleResetPassword = async () => {
    if (!password) return fail('Please enter a new password.');
    if (password.length < 8) return fail(PASSWORD_HINT);
    if (password !== confirmPassword) return fail('Passwords do not match.');
    setBusy(true);
    try {
      await api.resetPassword(resetToken, password);
      setSuccessMessage('Password reset successful! You can now sign in.');
      setMode('login');
      setUsername('');
      setPassword('');
      setPhone('');
      haptic('success');
    } catch (e) {
      fail(e.message || 'Failed to reset password.');
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (submittingRef.current) return;
    setError('');
    setSuccessMessage('');

    if (mode === 'forgot') {
      await handleForgotPassword();
      return;
    }
    if (mode === 'otp') {
      await handleVerifyOtp();
      return;
    }
    if (mode === 'reset') {
      await handleResetPassword();
      return;
    }

    const candidate = username.trim();
    if (!candidate) return fail('Username is required.');
    if (candidate.length > MAX_USERNAME_LENGTH) return fail(`Username must be ${MAX_USERNAME_LENGTH} characters or fewer.`);
    if (!password) return fail(mode === 'register' ? PASSWORD_HINT : 'Password is required.');
    if (mode === 'register' && !name.trim()) return fail('Please enter your name.');
    if (mode === 'register' && password.length < 8) return fail(PASSWORD_HINT);
    
    submittingRef.current = true;
    setBusy(true);
    try {
      if (mode === 'login') await login(candidate, password);
      else await register(candidate, name.trim(), password, phone.trim() || undefined);
      haptic('success');
    } catch (e) {
      fail(authErrorMessage(e, mode));
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  };

  return (
    <View style={[s.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <HalftoneBackground />
      <SpeedLines />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        enabled={Platform.OS === 'ios'}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          contentContainerStyle={anchorTop ? s.scrollAnchored : s.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="none"
          automaticallyAdjustKeyboardInsets={false}
          contentInsetAdjustmentBehavior="never"
          removeClippedSubviews={false}
          overScrollMode={anchorTop ? 'never' : 'auto'}
        >
          <View style={[anchorTop ? s.layoutAnchored : s.layout, { flexDirection: isSplitCapable ? 'row' : 'column' }]}>
            {isSplitCapable && (
              <View style={[s.brandSection, anchorTop && s.brandSectionAnchored]}>
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

            <View style={anchorTop ? s.cardWrapAnchored : s.cardWrap}>
              <View style={[s.card, isSmallPhone && s.cardCompact]}>
                <View pointerEvents="none" style={s.cardTexture}>
                  <View style={[s.cardFiber, { top: '18%', left: '8%', width: '40%', transform: [{ rotate: '-2deg' }] }]} />
                  <View style={[s.cardFiber, { top: '54%', right: '5%', width: '32%', transform: [{ rotate: '3deg' }] }]} />
                  <View style={[s.cardFiber, { bottom: '13%', left: '22%', width: '52%', opacity: 0.08 }]} />
                </View>
                <View style={s.cardContent}>
                  <View style={s.cardHeader}>
                    <View style={s.cardIconBadge}>
                      <Icon name="person-circle" size={28} color={CARD.accent} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.cardEyebrow}>+ONE · SECURE ACCESS</Text>
                      <Text style={s.cardTitle}>
                        {mode === 'login' ? 'Sign in' :
                         mode === 'register' ? 'Create account' :
                         mode === 'forgot' ? 'Forgot Password' :
                         mode === 'otp' ? 'Verify OTP' :
                         'Reset Password'}
                      </Text>
                    </View>
                  </View>

                  {(mode === 'login' || mode === 'register') && (
                    <View style={s.modeRow}>
                      {['login', 'register'].map((m) => {
                        const active = mode === m;
                        return (
                          <SpringPressable
                            key={m}
                            onPress={() => { setMode(m); setError(''); setSuccessMessage(''); setShowPassword(false); }}
                            disabled={busy}
                            scaleTo={motion.scale.chip}
                            haptic="selection"
                            android_ripple={{ color: 'rgba(255,226,77,0.22)' }}
                            style={({ pressed }) => [
                              s.modeTab,
                              active && s.modeTabActive,
                              pressed && Platform.OS !== 'android' && { opacity: 0.78 },
                            ]}
                          >
                            <Text style={[s.modeTabText, active && s.modeTabTextActive]}>
                              {m === 'login' ? 'SIGN IN' : 'SIGN UP'}
                            </Text>
                          </SpringPressable>
                        );
                      })}
                    </View>
                  )}

                  {/* FORGOT PASSWORD: Enter Registered Phone */}
                  {mode === 'forgot' && (
                    <Field
                      icon="call-outline"
                      label="Registered Phone"
                      value={phone}
                      onChangeText={(val) => { setPhone(val); if (error) setError(''); }}
                      placeholder="+91 00000 00000"
                      focused={focus === 'phone'}
                      onFocus={() => setFocus('phone')}
                      onBlur={() => setFocus(null)}
                      keyboardType="phone-pad"
                      autoComplete="tel"
                      textContentType="telephoneNumber"
                      editable={!busy}
                    />
                  )}

                  {/* OTP INPUT SCREEN */}
                  {mode === 'otp' && (
                    <View style={{ alignItems: 'center' }}>
                      <Text style={s.otpInstructions}>
                        Enter the 6-digit verification code sent to your registered phone number.
                      </Text>
                      
                      <Pressable onPress={() => otpInputRef.current?.focus()} style={s.otpBoxesRow}>
                        {Array.from({ length: 6 }).map((_, i) => {
                          const char = otp[i] || '';
                          const isFocused = otp.length === i;
                          return (
                            <View key={i} style={[s.otpBox, isFocused && s.otpBoxFocused]}>
                              <Text style={s.otpText}>{char || '_'}</Text>
                            </View>
                          );
                        })}
                      </Pressable>
                      <TextInput
                        ref={otpInputRef}
                        value={otp}
                        onChangeText={(val) => {
                          const cleaned = val.replace(/[^0-9]/g, '');
                          if (cleaned.length <= 6) {
                            setOtp(cleaned);
                            if (error) setError('');
                          }
                        }}
                        keyboardType="number-pad"
                        style={{ position: 'absolute', width: 0, height: 0, opacity: 0 }}
                        maxLength={6}
                        editable={!busy}
                      />

                      <View style={s.otpResendRow}>
                        <Text style={s.resendText}>Didn't receive it?</Text>
                        <Pressable onPress={handleForgotPassword} disabled={busy} hitSlop={10}>
                          <Text style={s.resendLink}>Resend OTP</Text>
                        </Pressable>
                      </View>
                    </View>
                  )}

                  {/* RESET NEW PASSWORD SCREEN */}
                  {mode === 'reset' && (
                    <>
                      <Field
                        icon="key-outline"
                        label="New Password"
                        value={password}
                        onChangeText={(value) => { setPassword(value); if (error) setError(''); }}
                        placeholder="At least 8 characters"
                        focused={focus === 'key'}
                        onFocus={() => setFocus('key')}
                        onBlur={() => setFocus(null)}
                        secureTextEntry={!showPassword}
                        autoCapitalize="none"
                        autoCorrect={false}
                        autoComplete="new-password"
                        textContentType="newPassword"
                        editable={!busy}
                      />
                      <Field
                        icon="key-outline"
                        label="Confirm New Password"
                        value={confirmPassword}
                        onChangeText={(value) => { setConfirmPassword(value); if (error) setError(''); }}
                        placeholder="Repeat password"
                        focused={focus === 'key-confirm'}
                        onFocus={() => setFocus('key-confirm')}
                        onBlur={() => setFocus(null)}
                        secureTextEntry={!showPassword}
                        autoCapitalize="none"
                        autoCorrect={false}
                        autoComplete="new-password"
                        textContentType="newPassword"
                        returnKeyType="done"
                        onSubmitEditing={submit}
                        editable={!busy}
                        suffix={
                          <Pressable
                            onPress={() => setShowPassword((visible) => !visible)}
                            accessibilityRole="button"
                            accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                            hitSlop={10}
                            style={s.passwordToggle}
                          >
                            <Icon name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={21} color={CARD.subtext} />
                          </Pressable>
                        }
                      />
                    </>
                  )}

                  {/* Standard Sign Up Fields */}
                  {mode === 'register' && (
                    <Field
                      icon="person-outline"
                      label="Display name"
                      value={name}
                      onChangeText={(value) => { setName(value); if (error) setError(''); }}
                      placeholder="Your name"
                      focused={focus === 'name'}
                      onFocus={() => setFocus('name')}
                      onBlur={() => setFocus(null)}
                      autoCapitalize="words"
                      autoComplete="name"
                      textContentType="name"
                      maxLength={80}
                      editable={!busy}
                    />
                  )}

                  {(mode === 'login' || mode === 'register') && (
                    <Field
                      icon="id-card-outline"
                      label="Username"
                      value={username}
                      onChangeText={(value) => { setUsername(value); if (error) setError(''); }}
                      placeholder="Your username"
                      focused={focus === 'uid'}
                      onFocus={() => setFocus('uid')}
                      onBlur={() => setFocus(null)}
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="username"
                      textContentType="username"
                      maxLength={MAX_USERNAME_LENGTH}
                      editable={!busy}
                      suffix={
                        mode === 'register' ? (
                          checking ? (
                            <ActivityIndicator size="small" color={CARD.accent} />
                          ) : availability ? (
                            <Icon
                              name={availability.available ? 'checkmark-circle' : 'alert-circle'}
                              size={19}
                              color={availability.available ? '#8ddd9b' : CARD.error}
                            />
                          ) : null
                        ) : null
                      }
                    />
                  )}
                  {mode === 'register' && availability && !availability.available && (
                    <Text style={s.fieldHint}>{availability.error}</Text>
                  )}
                  {mode === 'register' && !availability && (
                    <Text style={s.fieldHintMuted}>Use any normal characters · maximum {MAX_USERNAME_LENGTH} · must be unique</Text>
                  )}

                  {mode === 'register' && (
                    <Field
                      icon="call-outline"
                      label="Phone (optional)"
                      value={phone}
                      onChangeText={setPhone}
                      placeholder="+91 00000 00000"
                      focused={focus === 'phone'}
                      onFocus={() => setFocus('phone')}
                      onBlur={() => setFocus(null)}
                      keyboardType="phone-pad"
                      autoComplete="tel"
                      textContentType="telephoneNumber"
                      editable={!busy}
                    />
                  )}

                  {mode === 'login' && (
                    <Field
                      icon="key-outline"
                      label="Password"
                      value={password}
                      onChangeText={(value) => { setPassword(value); if (error) setError(''); }}
                      placeholder="Enter password"
                      focused={focus === 'key'}
                      onFocus={() => setFocus('key')}
                      onBlur={() => setFocus(null)}
                      secureTextEntry={!showPassword}
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="current-password"
                      textContentType="password"
                      returnKeyType="done"
                      onSubmitEditing={submit}
                      editable={!busy}
                      suffix={
                        <Pressable
                          onPress={() => setShowPassword((visible) => !visible)}
                          accessibilityRole="button"
                          accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                          hitSlop={10}
                          style={s.passwordToggle}
                        >
                          <Icon name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={21} color={CARD.subtext} />
                        </Pressable>
                      }
                    />
                  )}

                  {mode === 'register' && <Text style={s.passwordHint}>{PASSWORD_HINT}</Text>}

                  {/* Forgot Password trigger on Login tab */}
                  {mode === 'login' && (
                    <View style={s.forgotLinkRow}>
                      <Pressable onPress={() => { setMode('forgot'); setError(''); setSuccessMessage(''); }} hitSlop={10}>
                        <Text style={s.forgotLink}>Forgot password?</Text>
                      </Pressable>
                    </View>
                  )}

                  {/* Success Notifications */}
                  {!!successMessage && (
                    <View style={s.successRow}>
                      <Icon name="checkmark-circle" size={17} color="#8ddd9b" />
                      <Text style={s.successText}>{successMessage}</Text>
                    </View>
                  )}

                  {/* Errors */}
                  {!!error && (
                    <Shake trigger={errorTick}>
                      <View style={s.errorRow}>
                        <Icon name="alert-circle" size={17} color={CARD.error} />
                        <Text style={s.errorText}>{error}</Text>
                      </View>
                    </Shake>
                  )}

                  {/* Action trigger button */}
                  <SpringPressable
                    onPress={submit}
                    disabled={busy}
                    scaleTo={motion.scale.button}
                    haptic="impact"
                    android_ripple={{ color: 'rgba(0,0,0,0.2)' }}
                    style={({ pressed }) => [
                      s.submitBtn,
                      Platform.OS !== 'android' && pressed && s.submitBtnPressed,
                      busy && s.submitBtnDisabled,
                    ]}
                  >
                    {busy ? (
                      <>
                        <ActivityIndicator color={CARD.bgDeep} />
                        <Text style={s.submitText}>PROCESSING…</Text>
                      </>
                    ) : (
                      <>
                        <Text style={s.submitText}>
                          {mode === 'login' ? 'SIGN IN' :
                           mode === 'register' ? 'CREATE ACCOUNT' :
                           mode === 'forgot' ? 'REQUEST OTP' :
                           mode === 'otp' ? 'VERIFY OTP' :
                           'RESET PASSWORD'}
                        </Text>
                        <Icon name="arrow-forward" size={20} color={CARD.bgDeep} />
                      </>
                    )}
                  </SpringPressable>

                  {/* Back Navigation options for non-login states */}
                  {mode !== 'login' && mode !== 'register' && (
                    <Pressable
                      onPress={() => { setMode('login'); setError(''); setSuccessMessage(''); }}
                      disabled={busy}
                      style={{ alignSelf: 'center', marginTop: 18 }}
                      hitSlop={10}
                    >
                      <Text style={s.backLink}>Back to Sign In</Text>
                    </Pressable>
                  )}
                </View>
              </View>
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
      <Text style={s.fieldLabel}>{label}</Text>
      <View style={[s.fieldInputRow, focused && s.fieldInputRowFocused]}>
        <Icon name={icon} size={18} color={focused ? CARD.accent : CARD.muted} />
        <TextInput
          style={s.fieldInput}
          placeholderTextColor={CARD.muted}
          selectionColor={CARD.accent}
          cursorColor={CARD.accent}
          underlineColorAndroid="transparent"
          textAlignVertical="center"
          multiline={false}
          numberOfLines={1}
          textBreakStrategy={Platform.OS === 'android' ? 'simple' : undefined}
          disableFullscreenUI
          {...inputProps}
        />
        {suffix}
      </View>
    </View>
  );
}

const HalftoneBackground = memo(function HalftoneBackground() {
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
});

const SpeedLines = memo(function SpeedLines() {
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
});

const GlitchWordmark = memo(function GlitchWordmark({ small = false, compact = false }) {
  const size = compact ? (small ? 44 : 56) : (small ? 64 : 88);
  const textStyle = [s.glitchText, { fontSize: size, lineHeight: size + 4 }];
  const offset = compact ? 2 : 4;
  return (
    <View style={s.glitchWrap}>
      <Text style={[textStyle, s.glitchLayerRed, { transform: [{ translateX: offset }, { translateY: -offset * 0.75 }] }]}>+one</Text>
      <Text style={[textStyle, s.glitchLayerCyan, { transform: [{ translateX: -offset }, { translateY: offset * 0.75 }] }]}>+one</Text>
      <Text style={textStyle}>+one</Text>
      <Text style={[s.wordmarkSub, compact && { fontSize: 18, letterSpacing: 2, marginTop: 4 }]}>ONE NETWORK</Text>
    </View>
  );
});

/* ------------------------------------------------------------------ */
/* styles                                                              */
/* ------------------------------------------------------------------ */

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: VOID.background },
  scroll: { flexGrow: 1, minHeight: '100%' },
  scrollAnchored: { flexGrow: 0, paddingBottom: 40 },

  layout: {
    flex: 1,
    minHeight: 640,
  },
  layoutAnchored: { flexGrow: 0 },

  brandSection: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    paddingHorizontal: 24,
  },
  brandSectionAnchored: {
    justifyContent: 'flex-start',
    paddingTop: 64,
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
    paddingHorizontal: 22,
    paddingVertical: 28,
    position: 'relative',
  },
  cardWrapAnchored: {
    flex: 0,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: 22,
    paddingTop: 14,
    paddingBottom: 44,
    position: 'relative',
  },
  card: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: CARD.bg,
    borderWidth: 1.5,
    borderColor: CARD.line,
    borderRadius: 14,
    padding: 26,
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 14 },
        shadowOpacity: 0.5,
        shadowRadius: 20,
      },
      web: { boxShadow: '0 14px 28px rgba(0,0,0,0.5)' },
      default: {},
    }),
  },
  cardCompact: { padding: 18, borderRadius: 12 },
  cardTexture: { ...StyleSheet.absoluteFillObject, opacity: 0.7, overflow: 'hidden', borderRadius: 14 },
  cardFiber: { position: 'absolute', height: 1, backgroundColor: '#ffffff', opacity: 0.06 },
  cardContent: { position: 'relative', zIndex: 1 },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingBottom: 17,
    marginBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: CARD.line,
  },
  cardIconBadge: {
    width: 44, height: 44, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: CARD.bgDeep, borderWidth: 1, borderColor: CARD.line,
  },
  cardEyebrow: {
    fontFamily: 'SpaceMono_700Bold', fontSize: 9.5, letterSpacing: 1.2,
    color: CARD.muted, marginBottom: 2,
  },
  cardTitle: {
    fontFamily: 'Anybody_800ExtraBold',
    fontSize: 28,
    color: CARD.text,
    letterSpacing: -0.4,
  },

  modeRow: { flexDirection: 'row', gap: 9, marginBottom: 22 },
  modeTab: {
    flex: 1, minHeight: 44, borderWidth: 1, borderColor: CARD.line,
    borderRadius: 7, alignItems: 'center', justifyContent: 'center',
    backgroundColor: CARD.bgRaised,
  },
  modeTabActive: { backgroundColor: CARD.accent, borderColor: CARD.accent },
  modeTabText: { fontFamily: 'SpaceMono_700Bold', fontSize: 11.5, letterSpacing: 1.2, color: CARD.subtext },
  modeTabTextActive: { color: CARD.bgDeep },

  fieldWrap: { marginBottom: 17, position: 'relative' },
  fieldLabel: {
    fontFamily: 'SpaceMono_700Bold', fontSize: 10.5, letterSpacing: 1,
    color: CARD.subtext, textTransform: 'uppercase', marginBottom: 7,
  },
  fieldInputRow: {
    height: 54, flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1.5, borderColor: CARD.line, borderRadius: 8,
    paddingHorizontal: 13, backgroundColor: CARD.bgDeep,
  },
  fieldInputRowFocused: {
    borderColor: CARD.accent,
    backgroundColor: '#191817',
  },
  fieldInput: {
    flex: 1, height: 50,
    fontFamily: Platform.OS === 'android' ? undefined : 'Hanken_400Regular',
    fontSize: 16, lineHeight: 20, color: CARD.text,
    paddingTop: 0, paddingBottom: 0, paddingVertical: 0,
    includeFontPadding: false,
    outlineStyle: 'none',
  },
  passwordToggle: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  fieldHint: { fontFamily: 'Hanken_400Regular', fontSize: 12, lineHeight: 17, color: CARD.error, marginTop: -10, marginBottom: 15 },
  fieldHintMuted: { fontFamily: 'Hanken_400Regular', fontSize: 12, lineHeight: 17, color: CARD.muted, marginTop: -10, marginBottom: 15 },
  passwordHint: { color: CARD.muted, fontFamily: 'Hanken_400Regular', fontSize: 12, lineHeight: 17, marginTop: -7, marginBottom: 2 },

  errorRow: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    marginTop: 11, paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: 'rgba(255,180,171,0.5)', borderRadius: 7,
    backgroundColor: 'rgba(147,0,10,0.2)',
  },
  errorText: { flex: 1, fontFamily: 'Hanken_400Regular', fontSize: 13, lineHeight: 18, color: CARD.error },

  successRow: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    marginTop: 11, paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: 'rgba(141,221,155,0.5)', borderRadius: 7,
    backgroundColor: 'rgba(10,138,47,0.2)',
  },
  successText: { flex: 1, fontFamily: 'Hanken_400Regular', fontSize: 13, lineHeight: 18, color: '#8ddd9b' },

  submitBtn: {
    minHeight: 56, marginTop: 23,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 11,
    backgroundColor: CARD.accent,
    borderWidth: 2, borderColor: '#111111', borderRadius: 8,
    paddingHorizontal: 18, paddingVertical: 14,
    shadowColor: '#000000', shadowOffset: { width: 4, height: 6 }, shadowOpacity: 0.42, shadowRadius: 4,
    elevation: 9,
  },
  submitBtnPressed: { transform: [{ translateX: 2 }, { translateY: 3 }], opacity: 0.88 },
  submitBtnDisabled: { opacity: 0.62 },
  submitText: {
    fontFamily: 'Anybody_800ExtraBold', fontSize: 17, color: CARD.bgDeep,
    textTransform: 'uppercase', letterSpacing: 1.2,
  },

  speedLinesTrack: { flexDirection: 'row', width: '220%', height: '100%' },
  speedLine: { width: 2, height: '100%', marginRight: 98, backgroundColor: 'rgba(0,240,255,0.08)' },

  // OTP Styles
  otpInstructions: {
    fontFamily: 'Hanken_400Regular',
    fontSize: 14,
    lineHeight: 20,
    color: CARD.subtext,
    textAlign: 'center',
    marginBottom: 16,
    paddingHorizontal: 10,
  },
  otpBoxesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginVertical: 20,
    paddingHorizontal: 5,
  },
  otpBox: {
    width: 44,
    height: 54,
    borderWidth: 1.5,
    borderColor: CARD.line,
    borderRadius: 8,
    backgroundColor: CARD.bgDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  otpBoxFocused: {
    borderColor: CARD.accent,
    backgroundColor: '#191817',
  },
  otpText: {
    fontFamily: 'SpaceMono_700Bold',
    fontSize: 22,
    color: CARD.text,
  },
  otpResendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    marginBottom: 16,
  },
  resendText: {
    fontFamily: 'Hanken_400Regular',
    fontSize: 13.5,
    color: CARD.muted,
  },
  resendLink: {
    fontFamily: 'SpaceMono_700Bold',
    fontSize: 13.5,
    color: CARD.accent,
  },
  forgotLinkRow: {
    alignItems: 'flex-end',
    marginTop: -8,
    marginBottom: 12,
  },
  forgotLink: {
    fontFamily: 'Hanken_400Regular',
    fontSize: 13.5,
    color: CARD.accent,
    textDecorationLine: 'underline',
  },
  backLink: {
    fontFamily: 'SpaceMono_700Bold',
    fontSize: 13.5,
    color: CARD.muted,
    textDecorationLine: 'underline',
  },
});