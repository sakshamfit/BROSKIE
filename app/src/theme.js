/**
 * BROSKIE design system — Claymorphism.
 * Tokens transcribed from design.md. Soft "inflated" surfaces, extreme roundness,
 * no borders or dividers, pastel clay shadows instead of grey/black.
 */
import { Platform } from 'react-native';

/* ------------------------------------------------------------------ */
/* raw tokens                                                          */
/* ------------------------------------------------------------------ */

export const tokens = {
  surface: '#f5fbf4',
  surfaceDim: '#d5dcd5',
  surfaceContainerLowest: '#ffffff',
  surfaceContainerLow: '#eff5ee',
  surfaceContainer: '#e9efe9',
  surfaceContainerHigh: '#e4eae3',
  surfaceContainerHighest: '#dee4de',
  onSurface: '#171d19',
  onSurfaceVariant: '#3d4a42',
  inverseSurface: '#2c322e',
  inverseOnSurface: '#ecf2ec',
  outline: '#6d7a71',
  outlineVariant: '#bccac0',

  primary: '#006c48',
  onPrimary: '#ffffff',
  primaryContainer: '#76ebb3',
  onPrimaryContainer: '#006a46',
  inversePrimary: '#67dca5',

  secondary: '#006d2f',
  onSecondary: '#ffffff',
  secondaryContainer: '#5dfd8a',
  onSecondaryContainer: '#007232',

  tertiary: '#7c5724',
  tertiaryContainer: '#ffcc8e',

  error: '#ba1a1a',
  onError: '#ffffff',
  errorContainer: '#ffdad6',
  onErrorContainer: '#93000a',

  primaryFixed: '#84f9c0',
  primaryFixedDim: '#67dca5',
  onPrimaryFixed: '#002113',
  onPrimaryFixedVariant: '#005235',
  secondaryFixedDim: '#3de273',

  clayWhite: '#ffffff',
  clayShadowSoft: '#e2e8f0',
  surfaceBg: '#f8fafc',
  onSurfaceText: '#1e293b',

  legacyGreen: '#25d366',   // secondary accent per spec: badges, status beads
};

/* radii — "extreme roundness" (rem → px at 16) */
export const radius = {
  sm: 8,
  DEFAULT: 16,
  md: 24,
  lg: 32,
  xl: 48,
  full: 9999,
  bubble: 24,
  bubbleTail: 8,
};

/* 8px rhythm */
export const space = (n) => n * 8;
export const spacing = {
  unit: 8,
  gutter: 24,
  marginMobile: 20,
  clayPadding: 24,
};

/* ------------------------------------------------------------------ */
/* typography — Inter, spacious tracking                               */
/* ------------------------------------------------------------------ */

const family = (weight) => {
  // Loaded via @expo-google-fonts/inter in App.js
  if (weight >= 700) return 'Inter_700Bold';
  if (weight >= 600) return 'Inter_600SemiBold';
  if (weight >= 500) return 'Inter_500Medium';
  return 'Inter_400Regular';
};

export const type = {
  displayLg:  { fontFamily: family(700), fontSize: 32, fontWeight: '700', lineHeight: 40, letterSpacing: -0.64 },
  headlineMd: { fontFamily: family(600), fontSize: 20, fontWeight: '600', lineHeight: 28, letterSpacing: -0.2 },
  headlineSm: { fontFamily: family(600), fontSize: 18, fontWeight: '600', lineHeight: 24, letterSpacing: -0.18 },
  bodyLg:     { fontFamily: family(400), fontSize: 16, fontWeight: '400', lineHeight: 24, letterSpacing: 0.16 },
  bodySm:     { fontFamily: family(400), fontSize: 14, fontWeight: '400', lineHeight: 20, letterSpacing: 0.14 },
  labelMd:    { fontFamily: family(600), fontSize: 12, fontWeight: '600', lineHeight: 16, letterSpacing: 0.6 },
  fontFamily: family,
};

/* ------------------------------------------------------------------ */
/* claymorphism elevation                                              */
/* ------------------------------------------------------------------ */

const isWeb = Platform.OS === 'web';

/**
 * Dual-shadow clay elevation.
 * Web/new-arch RN support `boxShadow` (incl. inset) so we get the true
 * inflated look; native falls back to layered elevation + soft shadow.
 */
export function clay(level = 1, tint = tokens.clayShadowSoft) {
  if (isWeb) {
    const presets = {
      // level: [ambient, anchor, inner-highlight, inner-shade]
      1: `0 10px 24px -6px ${tint}, 0 4px 10px -4px rgba(148,163,184,0.35), inset 2px 2px 5px rgba(255,255,255,0.95), inset -3px -4px 8px rgba(148,163,184,0.16)`,
      2: `0 18px 38px -10px ${tint}, 0 8px 16px -6px rgba(148,163,184,0.42), inset 3px 3px 7px rgba(255,255,255,0.95), inset -4px -5px 11px rgba(148,163,184,0.22)`,
      3: `0 26px 54px -12px ${tint}, 0 12px 22px -8px rgba(148,163,184,0.45), inset 3px 4px 9px rgba(255,255,255,0.9), inset -5px -7px 14px rgba(148,163,184,0.26)`,
    };
    return { boxShadow: presets[level] || presets[1] };
  }
  const native = {
    1: { elevation: 4,  shadowRadius: 12, shadowOpacity: 0.16, shadowOffset: { width: 0, height: 6 } },
    2: { elevation: 8,  shadowRadius: 18, shadowOpacity: 0.2,  shadowOffset: { width: 0, height: 10 } },
    3: { elevation: 12, shadowRadius: 26, shadowOpacity: 0.24, shadowOffset: { width: 0, height: 14 } },
  };
  return { shadowColor: '#94a3b8', ...(native[level] || native[1]) };
}

/** Pressed state — outer shadow shrinks, inner deepens (squished clay). */
export function clayPressed(tint = tokens.clayShadowSoft) {
  if (isWeb) {
    return {
      boxShadow: `0 3px 8px -4px ${tint}, inset 3px 4px 9px rgba(148,163,184,0.34), inset -2px -2px 6px rgba(255,255,255,0.85)`,
      transform: [{ scale: 0.985 }],
    };
  }
  return { elevation: 1, shadowColor: '#94a3b8', shadowRadius: 4, shadowOpacity: 0.14, shadowOffset: { width: 0, height: 2 }, transform: [{ scale: 0.985 }] };
}

/** Inset "carved" surface — inputs, search bars. No outer shadow. */
export function clayInset(strength = 1) {
  if (isWeb) {
    const s = strength === 2
      ? `inset 4px 5px 11px rgba(148,163,184,0.35), inset -3px -3px 8px rgba(255,255,255,0.95)`
      : `inset 3px 4px 8px rgba(148,163,184,0.26), inset -2px -2px 6px rgba(255,255,255,0.92)`;
    return { boxShadow: s };
  }
  // native cannot do inset shadows -> subtle tonal recess instead
  return { backgroundColor: tokens.surfaceContainerLow };
}

/** Avatars sit "set into" the clay. */
export function clayAvatar() {
  if (isWeb) {
    return { boxShadow: `inset 2px 3px 6px rgba(0,0,0,0.18), inset -2px -2px 5px rgba(255,255,255,0.35), 0 4px 10px -3px ${tokens.clayShadowSoft}` };
  }
  return { elevation: 2, shadowColor: '#94a3b8', shadowRadius: 6, shadowOpacity: 0.15, shadowOffset: { width: 0, height: 3 } };
}

/* ------------------------------------------------------------------ */
/* themes                                                              */
/* ------------------------------------------------------------------ */

export const lightTheme = {
  dark: false,
  name: 'BROSKIE',

  // surfaces
  bg: tokens.surfaceBg,
  chatBg: tokens.surfaceBg,
  card: tokens.clayWhite,
  cardAlt: tokens.surfaceContainerLow,
  inputBg: tokens.clayWhite,

  // brand
  primary: tokens.primary,
  onPrimary: tokens.onPrimary,
  primaryContainer: tokens.primaryContainer,
  onPrimaryContainer: tokens.onPrimaryContainer,
  accent: tokens.primaryContainer,      // mint clay for FAB / primary actions
  onAccent: tokens.onPrimaryFixed,
  badge: tokens.legacyGreen,            // secondary green beads
  onBadge: '#ffffff',

  // header is a clay surface, not a slab of colour
  headerBg: tokens.clayWhite,
  headerText: tokens.onSurface,
  headerSub: tokens.onSurfaceVariant,

  // text
  text: tokens.onSurfaceText,
  subtext: '#64748b',
  muted: tokens.outline,

  // bubbles
  bubbleOut: tokens.primaryContainer,
  onBubbleOut: tokens.onPrimaryFixed,
  bubbleIn: tokens.clayWhite,
  onBubbleIn: tokens.onSurfaceText,

  tick: tokens.primary,
  tickRead: '#0ea5e9',
  danger: tokens.error,
  dangerContainer: tokens.errorContainer,

  shadowTint: tokens.clayShadowSoft,
  ripple: 'rgba(0,108,72,0.06)',
  overlay: 'rgba(23,29,25,0.42)',

  border: 'transparent',   // spec: no dividers
};

export const darkTheme = {
  dark: true,
  name: 'BROSKIE',

  bg: '#111b17',
  chatBg: '#111b17',
  card: '#1b2621',
  cardAlt: '#22302a',
  inputBg: '#1b2621',

  primary: tokens.primaryFixedDim,
  onPrimary: tokens.onPrimaryFixed,
  primaryContainer: '#005235',
  onPrimaryContainer: tokens.primaryFixed,
  accent: tokens.primaryFixedDim,
  onAccent: tokens.onPrimaryFixed,
  badge: tokens.secondaryFixedDim,
  onBadge: '#002109',

  headerBg: '#1b2621',
  headerText: tokens.inverseOnSurface,
  headerSub: '#9bb0a5',

  text: '#e6ede8',
  subtext: '#9bb0a5',
  muted: '#7f938a',

  bubbleOut: '#005235',
  onBubbleOut: tokens.primaryFixed,
  bubbleIn: '#1b2621',
  onBubbleIn: '#e6ede8',

  tick: tokens.primaryFixedDim,
  tickRead: '#38bdf8',
  danger: '#ffb4ab',
  // muted recessed red so destructive surfaces don't shout in dark mode
  dangerContainer: '#3b1d1a',

  shadowTint: '#0b120f',
  ripple: 'rgba(132,249,192,0.08)',
  overlay: 'rgba(0,0,0,0.6)',

  border: 'transparent',
};

/* dark-mode clay uses a darker tint */
export function clayFor(theme, level = 1) {
  if (!theme.dark) return clay(level, theme.shadowTint);
  if (isWeb) {
    const presets = {
      1: `0 10px 22px -8px rgba(0,0,0,0.55), inset 2px 2px 5px rgba(255,255,255,0.05), inset -3px -4px 8px rgba(0,0,0,0.35)`,
      2: `0 16px 34px -10px rgba(0,0,0,0.6), inset 3px 3px 7px rgba(255,255,255,0.06), inset -4px -5px 11px rgba(0,0,0,0.4)`,
      3: `0 24px 48px -12px rgba(0,0,0,0.65), inset 3px 4px 9px rgba(255,255,255,0.07), inset -5px -7px 14px rgba(0,0,0,0.45)`,
    };
    return { boxShadow: presets[level] || presets[1] };
  }
  return clay(level, theme.shadowTint);
}

export function clayInsetFor(theme, strength = 1) {
  if (!theme.dark) return clayInset(strength);
  if (isWeb) {
    return { boxShadow: `inset 3px 4px 9px rgba(0,0,0,0.45), inset -2px -2px 6px rgba(255,255,255,0.05)` };
  }
  return { backgroundColor: theme.cardAlt };
}

/* ------------------------------------------------------------------ */
/* avatars                                                             */
/* ------------------------------------------------------------------ */

export const AVATAR_COLORS = [
  '#76ebb3', '#5dfd8a', '#ffcc8e', '#84f9c0', '#67dca5',
  '#a7f3d0', '#bbf7d0', '#fde68a', '#99f6e4', '#c7f9cc',
];

export function colorFor(id = '') {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i);
  return AVATAR_COLORS[sum % AVATAR_COLORS.length];
}

/** avatars use pastel fills -> dark ink for contrast */
export const AVATAR_INK = '#0f3d2b';

export function initials(name = '') {
  const parts = String(name)
    .split(/\s+/)
    .map((p) => p.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
