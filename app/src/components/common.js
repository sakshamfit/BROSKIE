import React, { useEffect, useRef } from 'react';
import { View, Text, Image, StyleSheet, Pressable, ActivityIndicator, Platform, Animated, Easing } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import Icon from '../icons/Icon';
import {
  colorFor, initials, AVATAR_INK, radius, type, tokens, stroke,
  inkBox, sketchBox, sketchAvatarFrame, pencilBox, inkUnderline, dashedRule, marker, pressedInk, raised,
} from '../theme';
import { usePressScale, Pop, FloatLoop } from '../motion';
import { mediaUrl } from '../api';
import { useTheme } from '../store/ThemeContext';

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

/** Subtle entrance motion for panels and screen content. */
export function MotionIn({ children, delay = 0, distance = 10, style }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(distance)).current;
  useEffect(() => {
    const animation = Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 220, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 280, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [delay, opacity, translateY]);
  return <Animated.View style={[{ opacity, transform: [{ translateY }] }, style]}>{children}</Animated.View>;
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

/** Pressable paper row; highlighter washes in on press. */
export function PaperSurface({ children, onPress, onLongPress, style, weight = 'pencil', disabled, dogEar }) {
  const { theme } = useTheme();
  const outline = weight === 'ink' ? inkBox(theme, 'ink') : pencilBox(theme);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      android_ripple={rippleFor(theme)}
      style={({ pressed }) => [
        { backgroundColor: theme.card },
        raised(theme, weight === 'ink' ? 2 : 1),
        outline,
        pressed && Platform.OS !== 'android' ? [pressedInk(theme), { transform: [{ translateY: 2 }] }] : null,
        disabled && { opacity: 0.5 },
        style,
      ]}
    >
      {children}
      {dogEar && <DogEar />}
    </Pressable>
  );
}

/** Button: 2px ink box; press floods it with highlighter. */
export function InkButton({ label, onPress, icon, style, textStyle, disabled, busy, filled = false, danger = false }) {
  const { theme } = useTheme();
  const lineColor = danger ? theme.danger : theme.ink;
  const fg = filled ? theme.onPrimary : danger ? theme.danger : theme.ink;
  const isAndroid = Platform.OS === 'android';
  const scale = useRef(new Animated.Value(1)).current;
  const setPressed = (pressed) => Animated.spring(scale, {
    toValue: pressed ? 0.965 : 1, useNativeDriver: true, speed: 38, bounciness: 5,
  }).start();
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={onPress}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        disabled={disabled || busy}
        android_ripple={rippleFor(theme, { color: filled ? 'rgba(255,255,255,0.25)' : theme.ripple })}
        style={({ pressed }) => [
          styles.btn,
          raised(theme, filled ? 2 : 1),
          inkBox(theme, 'ink', lineColor),
          { backgroundColor: filled ? lineColor : theme.card },
          filled && { backgroundColor: lineColor },
          pressed && !filled && !isAndroid ? marker(theme, 2) : null,
          pressed && filled && !isAndroid ? { opacity: 0.82 } : null,
          (disabled || busy) && { opacity: 0.45 },
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
export function InkIconButton({ name, onPress, size = 40, iconSize = 19, iconColor, style, weight = 'ink', disabled, active }) {
  const { theme } = useTheme();
  const isAndroid = Platform.OS === 'android';
  const { scale, onPressIn, onPressOut } = usePressScale(0.94);
  // Real devices need a minimum ~44dp tap target (Apple HIG / Material both
  // recommend this) even when the drawn box itself is smaller — hitSlop
  // widens the touchable area without changing the visual size.
  const slop = Math.max(0, Math.ceil((44 - size) / 2));
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={Math.max(slop, 6)}
      onPressIn={onPressIn}
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
  return (
    <Pressable onPress={onPress} hitSlop={8} style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, inkBox(theme, 'ink')]}>
      {checked && <Icon name="close" size={size * 0.82} color={theme.ink} />}
    </Pressable>
  );
}

/** Hand-drawn pill toggle — ink outline, sketch-square thumb. */
export function HandDrawnToggle({ value, onToggle, disabled }) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: !!value, disabled: !!disabled }}
      onPress={onToggle}
      disabled={disabled}
      hitSlop={8}
      style={{
        width: 52, height: 28, borderRadius: radius.full, padding: 3, justifyContent: 'center',
        borderWidth: 2, borderColor: theme.ink,
        backgroundColor: value ? theme.highlighter : theme.cardAlt,
        opacity: disabled ? 0.45 : 1,
      }}
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

export function Avatar({ uri, name, id, size = 48, group = false, online = false, unread = false, weight = 'ink', shape = 'circle' }) {
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

  return (
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
}

/* ------------------------------------------------------------------ */
/* misc                                                                */
/* ------------------------------------------------------------------ */

export function Ticks({ status, color, size = 14 }) {
  const { theme } = useTheme();
  if (status === 'sending') return <Icon name="time-outline" size={size} color={color || theme.muted} />;
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

export function Loading({ label }) {
  const { theme } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg, gap: 14 }}>
      <ActivityIndicator size="large" color={theme.ink} />
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

export function IconButton({ name, onPress, size = 22, color, style }) {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      android_ripple={rippleFor(theme, { borderless: true, radius: 24 })}
      style={({ pressed }) => [{ padding: 8, opacity: pressed && Platform.OS !== 'android' ? 0.55 : 1 }, style]}
      hitSlop={6}
    >
      <Icon name={name} size={size} color={color || theme.ink} />
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

/** Hard-reserved gold verification mark. Only username `saksham` receives it. */
const GOLD_TICK_USERNAME = 'saksham';

export function hasGoldTick(userOrUsername) {
  if (userOrUsername == null) return false;
  const raw = typeof userOrUsername === 'string'
    ? userOrUsername
    : (userOrUsername.username || '');
  return String(raw).normalize('NFKC').trim().toLowerCase() === GOLD_TICK_USERNAME;
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
