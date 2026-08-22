import React, { useEffect, useRef } from 'react';
import { View, Text, Image, StyleSheet, Pressable, ActivityIndicator, Platform, Animated, Easing } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import Icon from '../icons/Icon';
import {
  colorFor, initials, AVATAR_INK, radius, type, tokens, stroke,
  inkBox, sketchBox, sketchAvatarFrame, pencilBox, inkUnderline, dashedRule, marker, pressedInk, raised,
} from '../theme';
import { usePressScale, Pop, FloatLoop, FadeSlide, motion, haptic, useReducedMotion } from '../motion';
import { mediaUrl } from '../api';
import { useTheme } from '../store/ThemeContext';
import { openProfile } from '../push/routing';

// expo-blur was added after some APKs had already shipped. Keep it optional so
// OTA bundles remain safe on those installations; newer builds get native
// blur, older ones receive an opaque frosted fallback instead of crashing.
let OptionalBlurView = null;
try {
  OptionalBlurView = require('expo-blur').BlurView;
} catch {
  OptionalBlurView = null;
}

/**
 * Platform-native press feedback: Android gets a Material ripple,
 * iOS keeps the existing ink/highlighter fade. Pass straight into a
 * Pressable's `android_ripple` prop.
 */
export function rippleFor(theme, { borderless = false, radius: rippleRadius } = {}) {
  return Platform.OS === 'android'
    ? { color: theme.ripple, borderless, radius: rippleRadius }
    : undefined;
}

/** Real native/web backdrop blur with a safe, solid fallback for old APKs. */
export function FrostedBackdrop({ intensity = 60, dim = 0.2, style }) {
  const { theme } = useTheme();
  const fallback = theme.dark ? 'rgba(8,8,8,0.9)' : 'rgba(236,232,229,0.92)';
  const veil = theme.dark ? `rgba(0,0,0,${dim + 0.08})` : `rgba(28,27,27,${dim})`;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      {OptionalBlurView ? (
        <OptionalBlurView
          intensity={Platform.OS === 'android' ? Math.max(48, intensity - 8) : intensity}
          tint={theme.dark ? 'dark' : 'light'}
          experimentalBlurMethod="dimezisBlurView"
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: fallback }]} />
      )}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: veil }]} />
    </View>
  );
}

/**
 * Subtle entrance motion for panels and screen content.
 *
 * Delegates to the shared FadeSlide so panels use the same arrival curve,
 * the same 8px travel and the same reduced-motion gate as the rest of the
 * app — there is exactly one entrance in this product, not two similar ones.
 */
export function MotionIn({ children, delay = 0, distance = 8, style }) {
  return (
    <FadeSlide delay={delay} distance={distance} duration={motion.normal} style={style}>
      {children}
    </FadeSlide>
  );
}

/* ------------------------------------------------------------------ */
/* paper primitives                                                    */
/* ------------------------------------------------------------------ */

/** A sheet of paper outlined with a thin graphite stroke. */
export function PaperCard({ children, style, weight = 'pencil', dogEar = false }) {
  const { theme } = useTheme();
  const outline = weight === 'ink' ? inkBox(theme, 'ink') : pencilBox(theme);
  return (
    <View style={[{ backgroundColor: theme.card, padding: 20 }, raised(theme, weight === 'ink' ? 2 : 1), outline, style]}>
      {children}
      {dogEar && <DogEar />}
    </View>
  );
}

/** Folded corner scrap — marks interactive cards. */
function DogEar({ size = 14 }) {
  const { theme } = useTheme();
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute', right: 0, bottom: 0,
        width: 0, height: 0,
        borderRightWidth: size, borderBottomWidth: size,
        borderRightColor: theme.graphiteLine,
        borderBottomColor: theme.bg,
      }}
    />
  );
}

/**
 * Pressable paper row. The whole sheet compresses very slightly (1.5%) and
 * settles back with the standard spring — full-width surfaces must move
 * *less* than buttons or the row reads as broken rather than pressed. The
 * highlighter wash still washes in on top for the ink identity.
 */
export function PaperSurface({ children, onPress, onLongPress, style, weight = 'pencil', disabled, dogEar }) {
  const { theme } = useTheme();
  const outline = weight === 'ink' ? inkBox(theme, 'ink') : pencilBox(theme);
  const { scale, onPressIn, onPressOut } = usePressScale(motion.scale.row);
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        onPressIn={disabled ? undefined : onPressIn}
        onPressOut={onPressOut}
        disabled={disabled}
        android_ripple={rippleFor(theme)}
        style={({ pressed }) => [
          { backgroundColor: theme.card },
          raised(theme, weight === 'ink' ? 2 : 1),
          outline,
          pressed && Platform.OS !== 'android' ? pressedInk(theme) : null,
          disabled && { opacity: 0.5 },
          style,
        ]}
      >
        {children}
        {dogEar && <DogEar />}
      </Pressable>
    </Animated.View>
  );
}

/** Button: 2px ink box; press floods it with highlighter. */
export function InkButton({
  label, onPress, icon, style, textStyle, disabled, busy, filled = false, danger = false,
  haptic: hapticKind = 'selection',
}) {
  const { theme } = useTheme();
  const lineColor = danger ? theme.danger : theme.ink;
  const fg = filled ? theme.onPrimary : danger ? theme.danger : theme.ink;
  const isAndroid = Platform.OS === 'android';
  const inert = disabled || busy;
  // Same spring as every other button in the app — buttons must feel related.
  const { scale, onPressIn, onPressOut } = usePressScale(motion.scale.button);
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={onPress}
        onPressIn={() => { if (inert) return; onPressIn(); if (hapticKind) haptic(hapticKind); }}
        onPressOut={onPressOut}
        disabled={inert}
        android_ripple={rippleFor(theme, { color: filled ? 'rgba(255,255,255,0.25)' : theme.ripple })}
        style={({ pressed }) => [
          styles.btn,
          raised(theme, filled ? 2 : 1),
          inkBox(theme, 'ink', lineColor),
          { backgroundColor: filled ? lineColor : theme.card },
          filled && { backgroundColor: lineColor },
          pressed && !filled && !isAndroid ? marker(theme, 2) : null,
          pressed && filled && !isAndroid ? { opacity: 0.82 } : null,
          inert && { opacity: 0.45 },
          style,
        ]}
      >
        {busy ? (
          <ActivityIndicator color={fg} />
        ) : (
          <>
            {!!icon && <Icon name={icon} size={18} color={fg} />}
            <Text style={[type.bodyStrong, { color: fg }, textStyle]}>{label}</Text>
          </>
        )}
      </Pressable>
    </Animated.View>
  );
}

/** Square-ish icon button drawn in ink, with a physical press-scale spring. */
export function InkIconButton({
  name, onPress, size = 40, iconSize = 19, iconColor, style, weight = 'ink', disabled, active,
  haptic: hapticKind = 'selection',
}) {
  const { theme } = useTheme();
  const isAndroid = Platform.OS === 'android';
  // Icons are small, so they need the deepest press of the ladder to read.
  const { scale, onPressIn, onPressOut } = usePressScale(motion.scale.icon);
  // Real devices need a minimum ~44dp tap target (Apple HIG / Material both
  // recommend this) even when the drawn box itself is smaller — hitSlop
  // widens the touchable area without changing the visual size.
  const slop = Math.max(0, Math.ceil((44 - size) / 2));
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={Math.max(slop, 6)}
      onPressIn={() => { if (disabled) return; onPressIn(); if (hapticKind) haptic(hapticKind); }}
      onPressOut={onPressOut}
      android_ripple={rippleFor(theme, { borderless: true, radius: size * 0.8 })}
      style={({ pressed }) => [
        { width: size, height: size, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.card },
        raised(theme, active ? 2 : 1),
        inkBox(theme, weight),
        { backgroundColor: theme.card },
        active ? marker(theme, 2) : null,
        pressed && !isAndroid ? marker(theme, 1) : null,
        disabled && { opacity: 0.4 },
        style,
      ]}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        <Icon name={name} size={iconSize} color={iconColor || theme.ink} />
      </Animated.View>
    </Pressable>
  );
}

/** Input treatment: a single ink line, no box. */
export function InkField({ children, style, focused }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.field, inkUnderline(theme, focused ? 'bold' : 'ink'), style]}>
      {children}
    </View>
  );
}

/** Torn-paper / masking-tape chip. */
export function TapeChip({ label, style, textStyle, tone = 'ink' }) {
  const { theme } = useTheme();
  const isAccent = tone === 'accent';
  return (
    <View
      style={[
        styles.chip,
        {
          backgroundColor: isAccent ? theme.highlighter : theme.cardAlt,
          borderWidth: 1,
          borderColor: isAccent ? 'transparent' : theme.graphiteLine,
          // irregular, torn-looking edges
          borderTopLeftRadius: 1,
          borderTopRightRadius: 4,
          borderBottomRightRadius: 1,
          borderBottomLeftRadius: 3,
          transform: [{ rotate: '-0.6deg' }],
        },
        style,
      ]}
    >
      <Text style={[type.labelXs, { color: theme.ink }, textStyle]}>{label}</Text>
    </View>
  );
}

/** Unread count — small ink-filled bead. Pops with a tiny spring whenever
 * the count changes (0 → small → 100%), without bouncing the whole bar. */
export function CountBead({ label, style, small }) {
  const { theme } = useTheme();
  const d = small ? 17 : 21;
  return (
    <Pop trigger={label} from={0.4}>
      <View
        style={[
          {
            minWidth: d, height: d, paddingHorizontal: small ? 4 : 6,
            alignItems: 'center', justifyContent: 'center',
            backgroundColor: theme.badge, borderRadius: radius.full,
          },
          style,
        ]}
      >
        <Text style={[type.labelXs, { color: theme.onBadge, fontSize: small ? 9 : 10.5 }]}>{label}</Text>
      </View>
    </Pop>
  );
}

/** Literal X inside a hand-sketched square. */
export function InkCheckbox({ checked, size = 20, onPress }) {
  const { theme } = useTheme();
  const { scale, onPressIn, onPressOut } = usePressScale(motion.scale.chip);
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: !!checked }}
      onPress={onPress}
      onPressIn={() => { onPressIn(); haptic('selection'); }}
      onPressOut={onPressOut}
      hitSlop={8}
    >
      <Animated.View
        style={[
          { width: size, height: size, alignItems: 'center', justifyContent: 'center', transform: [{ scale }] },
          inkBox(theme, 'ink'),
        ]}
      >
        {/* the mark is struck into the box with a spring, never cut in */}
        {checked && (
          <Pop trigger={checked} from={0.5}>
            <Icon name="close" size={size * 0.82} color={theme.ink} />
          </Pop>
        )}
      </Animated.View>
    </Pressable>
  );
}

/**
 * Hand-drawn pill toggle. The thumb is finger-weighted: it springs across
 * the track (a single small overshoot at the end of the travel) while the
 * track colour crossfades underneath, so the switch reads as one physical
 * object moving rather than two properties changing at once.
 */
export function HandDrawnToggle({ value, onToggle, disabled }) {
  const { theme } = useTheme();
  const reduced = useReducedMotion();
  // Two values on purpose: the thumb travels on the native driver (never
  // drops a frame), while only the track colour — which the native driver
  // cannot interpolate — runs on the JS side.
  const slide = useRef(new Animated.Value(value ? 1 : 0)).current;
  const tint = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    if (reduced) { slide.setValue(value ? 1 : 0); tint.setValue(value ? 1 : 0); return undefined; }
    const anim = Animated.parallel([
      Animated.spring(slide, { toValue: value ? 1 : 0, ...motion.springBack, useNativeDriver: true }),
      Animated.timing(tint, {
        toValue: value ? 1 : 0, duration: motion.fast, easing: motion.easing.out, useNativeDriver: false,
      }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [value, reduced, slide, tint]);

  const translateX = slide.interpolate({ inputRange: [0, 1], outputRange: [0, 22] });
  const backgroundColor = tint.interpolate({
    inputRange: [0, 1], outputRange: [theme.cardAlt, theme.highlighter],
  });

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: !!value, disabled: !!disabled }}
      onPress={() => { if (!disabled) { haptic('selection'); onToggle?.(); } }}
      disabled={disabled}
      hitSlop={8}
    >
      <Animated.View
        style={{
          width: 52, height: 28, borderRadius: radius.full, padding: 3, justifyContent: 'center',
          borderWidth: 2, borderColor: theme.ink,
          backgroundColor,
          opacity: disabled ? 0.45 : 1,
        }}
      >
        <Animated.View
          style={{
            width: 20, height: 20, borderRadius: radius.full, backgroundColor: theme.ink,
            borderWidth: 1, borderColor: theme.ink,
            transform: [{ translateX }],
          }}
        />
      </Animated.View>
    </Pressable>
  );
}

/** Rough dashed rule. */
export function Rule({ style }) {
  const { theme } = useTheme();
  return <View style={[dashedRule(theme), { marginVertical: 12 }, style]} />;
}

/**
 * Messy hand-ruled divider: uneven dash runs at a slight angle, as if drawn
 * along a ruler with a leaking pen. `tilt` varies per row so no two match.
 */
export function SketchDivider({ tilt = -0.5, style }) {
  const { theme } = useTheme();
  // deterministic-but-irregular dash pattern
  const dashes = [10, 4, 16, 6, 12, 3, 20, 8, 14, 5, 18, 7, 11, 4, 15];
  return (
    <View
      style={[
        { flexDirection: 'row', alignItems: 'center', height: 1, opacity: 0.55, transform: [{ rotate: `${tilt}deg` }] },
        style,
      ]}
    >
      {dashes.map((w, i) => (
        <View
          key={i}
          style={{
            width: w,
            height: i % 3 === 0 ? 1.4 : 1,
            marginRight: i % 2 ? 5 : 3,
            backgroundColor: i % 4 === 0 ? theme.graphiteLine : theme.graphite,
          }}
        />
      ))}
      <View style={{ flex: 1, height: 1, backgroundColor: theme.graphiteLine }} />
    </View>
  );
}

/** Highlighter scribble used for focus / active emphasis. */
export function Highlight({ children, style }) {
  const { theme } = useTheme();
  return <View style={[marker(theme, 1), { paddingHorizontal: 4 }, style]}>{children}</View>;
}

/* ------------------------------------------------------------------ */
/* avatar — sketched square-ish portrait                               */
/* ------------------------------------------------------------------ */

export function Avatar({ uri, name, id, size = 48, group = false, online = false, unread = false, weight = 'ink', shape = 'circle', profileId = null, onPress = null }) {
  const { theme } = useTheme();
  const src = mediaUrl(uri);
  const fill = theme.dark ? theme.cardAlt : colorFor(id || name || '');
  const ink = theme.dark ? theme.ink : AVATAR_INK;
  const lineColor = weight === 'thin' ? theme.graphite : theme.ink;

  // 'sketch' = drawn-by-hand portrait frame (uneven corners, never a
  // perfect circle) for the Settings profile hero; every other avatar in
  // the app (chat rows, headers, member lists) stays the circular ink ring.
  const lineWidth = stroke[weight] ?? stroke.ink;
  const seed = String(id || name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const frameStyle = shape === 'sketch'
    ? sketchAvatarFrame(theme, size, lineWidth, lineColor, seed)
    : { borderRadius: radius.full, borderWidth: lineWidth, borderColor: lineColor };

  const body = (
    <View style={{ width: size, height: size }}>
      {/* circular by default (per the mockup's rounded-full avatars); pass
          shape="sketch" for a hand-drawn, uneven pencil-outline portrait */}
      <View
        style={[
          {
            width: size, height: size, overflow: 'hidden', backgroundColor: fill,
            alignItems: 'center', justifyContent: 'center',
          },
          frameStyle,
        ]}
      >
        {src ? (
          <Image source={{ uri: src }} style={{ width: size, height: size }} />
        ) : group ? (
          <Icon name="people" size={size * 0.44} color={ink} />
        ) : (
          <Text style={{ color: ink, fontFamily: type.head(700), fontSize: size * 0.34, letterSpacing: -0.3 }}>
            {initials(name)}
          </Text>
        )}
      </View>

      {/* unread: solid ink blob pinned to the corner (per the sketch mockup) */}
      {unread && (
        <View
          style={{
            position: 'absolute', right: -4, top: -4,
            width: 15, height: 15, borderRadius: radius.full,
            backgroundColor: theme.ink,
            borderWidth: 2, borderColor: theme.bg,
          }}
        />
      )}

      {online && !unread && (
        <View
          style={{
            position: 'absolute', right: -4, top: -4,
            width: 11, height: 11, borderRadius: radius.full,
            backgroundColor: theme.highlighter,
            borderWidth: 1.5, borderColor: theme.ink,
          }}
        />
      )}
    </View>
  );

  // Tapping the circle opens that person's profile — anywhere in the app.
  // Pass `profileId` (a user id) to enable it, or a custom `onPress`.
  const press = onPress || (profileId ? () => openProfile(profileId) : null);
  if (!press) return body;
  return <PressableAvatar onPress={press} name={name}>{body}</PressableAvatar>;
}

/** Avatar press wrapper — springs so tapping a face feels like a real target. */
function PressableAvatar({ onPress, name, children }) {
  const { scale, onPressIn, onPressOut } = usePressScale(0.92);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name ? `View ${name}'s profile` : 'View profile'}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      hitSlop={4}
    >
      <Animated.View style={{ transform: [{ scale }] }}>{children}</Animated.View>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/* misc                                                                */
/* ------------------------------------------------------------------ */

export function Ticks({ status, color, size = 14 }) {
  const { theme } = useTheme();
  if (status === 'sending' || status === 'queued') {
    return <Icon name="time-outline" size={size} color={color || theme.muted} />;
  }
  if (status === 'failed') return <Icon name="alert-circle-outline" size={size} color={theme.danger} />;
  const tickColor = status === 'read' ? (color ? color : theme.tickRead) : color || theme.muted;
  return (
    <View style={{ flexDirection: 'row', width: size + 4 }}>
      <Icon name="checkmark" size={size} color={tickColor} />
      {(status === 'delivered' || status === 'read') && (
        <Icon name="checkmark" size={size} color={tickColor} style={{ marginLeft: -size * 0.62 }} />
      )}
    </View>
  );
}

export function Screen({ children, style }) {
  const { theme } = useTheme();
  return <View style={[{ flex: 1, backgroundColor: theme.bg }, style]}>{children}</View>;
}

/**
 * Full-screen boot / busy state.
 *
 * A bare spinner on an empty screen reads as "stuck". The mark breathes
 * instead: a slow, low-amplitude pulse that says the app is alive without
 * competing for attention, plus the label. Reduced motion gets the static
 * mark and the platform spinner only.
 */
export function Loading({ label }) {
  const { theme } = useTheme();
  const reduced = useReducedMotion();
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) return undefined;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 900, easing: motion.easing.inOut, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 900, easing: motion.easing.inOut, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse, reduced]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] });

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg, gap: 18 }}>
      <Animated.View style={reduced ? null : { transform: [{ scale }], opacity }}>
        <ActivityIndicator size="large" color={theme.ink} />
      </Animated.View>
      {!!label && <Text style={[type.labelSm, { color: theme.muted }]}>{label}</Text>}
    </View>
  );
}

export function EmptyState({ icon = 'chatbubbles-outline', title, subtitle }) {
  const { theme } = useTheme();
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', padding: 40, flex: 1 }}>
      {/* slow, near-still float so empty screens feel alive; unmounts with
          the list when content arrives, so it never animates off-screen */}
      <FloatLoop amplitude={5} duration={3800}>
        <View style={[{ width: 84, height: 84, alignItems: 'center', justifyContent: 'center', marginBottom: 22 }, inkBox(theme, 'ink')]}>
          <Icon name={icon} size={36} color={theme.ink} />
        </View>
      </FloatLoop>
      <Text style={[type.headlineSm, { color: theme.text, textAlign: 'center' }]}>{title}</Text>
      {!!subtitle && (
        <Text style={[type.bodySm, { marginTop: 8, color: theme.subtext, textAlign: 'center', maxWidth: 290 }]}>{subtitle}</Text>
      )}
    </View>
  );
}

export function IconButton({ name, onPress, size = 22, color, style, haptic: hapticKind = 'selection', disabled }) {
  const { theme } = useTheme();
  const { scale, onPressIn, onPressOut } = usePressScale(motion.scale.icon);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      onPressIn={() => { if (disabled) return; onPressIn(); if (hapticKind) haptic(hapticKind); }}
      onPressOut={onPressOut}
      android_ripple={rippleFor(theme, { borderless: true, radius: 24 })}
      style={[{ padding: 8 }, disabled && { opacity: 0.4 }, style]}
      hitSlop={6}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        <Icon name={name} size={size} color={color || theme.ink} />
      </Animated.View>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/* time helpers                                                        */
/* ------------------------------------------------------------------ */

export function formatTime(ts) {
  const d = new Date(ts);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

export function formatChatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return formatTime(ts);
  if (d.toDateString() === yesterday.toDateString()) return 'YESTERDAY';
  return d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function formatDayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return 'TODAY';
  if (d.toDateString() === yesterday.toDateString()) return 'YESTERDAY';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase();
}

export function lastSeenText(isOnline, lastSeen) {
  if (isOnline) return 'online';
  if (!lastSeen) return '';
  const diff = Date.now() - lastSeen;
  if (diff < 60000) return 'last seen just now';
  if (diff < 3600000) return `last seen ${Math.floor(diff / 60000)}m ago`;
  const d = new Date(lastSeen);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return `last seen today at ${formatTime(lastSeen)}`;
  return `last seen ${formatChatTime(lastSeen)}`;
}

/** Prefer the user's real, unique username; fall back to a slug of their name. */
export function handleFor(nameOrUser = '', phone = '') {
  if (nameOrUser && typeof nameOrUser === 'object') {
    if (nameOrUser.username) return '@' + nameOrUser.username;
    return handleFor(nameOrUser.name, nameOrUser.phone);
  }
  const base = String(nameOrUser).toLowerCase().replace(/[^a-z0-9]+/g, '');
  return '@' + (base || String(phone).replace(/\D/g, '').slice(-6) || 'user');
}

/** Usernames always recognized as verified even before their server-side
 *  `goldTick` flag exists (backward-compat with older databases). The badge is
 *  otherwise driven entirely by the per-user `goldTick` flag from the server. */
const GOLD_TICK_USERNAMES = new Set(['saksham']);

export function hasGoldTick(userOrUsername) {
  if (userOrUsername == null) return false;
  if (typeof userOrUsername === 'object') {
    // Server-driven flag wins; the hardcoded list keeps the original owner(s)
    // verified when the flag is still 0 on a not-yet-migrated database.
    if (userOrUsername.goldTick === true) return true;
  }
  const raw = typeof userOrUsername === 'string'
    ? userOrUsername
    : (userOrUsername.username || '');
  return GOLD_TICK_USERNAMES.has(String(raw).normalize('NFKC').trim().toLowerCase());
}

/** Gold filled circle with an ink check — shown next to the verified username only. */
export function GoldTick({ size = 15, style }) {
  return (
    <View
      accessibilityLabel="Verified"
      style={[{ width: size, height: size, flexShrink: 0 }, style]}
    >
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Circle cx="12" cy="12" r="11" fill="#E8B923" stroke="#8A6500" strokeWidth="1.15" />
        <Path
          d="M6.9 12.35 l3.15 3.2 7.15-7.45"
          fill="none"
          stroke="#1c1b1b"
          strokeWidth="2.35"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingVertical: 13, paddingHorizontal: 20 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 2, minHeight: 46 },
  chip: { paddingHorizontal: 8, paddingVertical: 3 },
});
