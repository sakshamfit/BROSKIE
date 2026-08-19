/**
 * +one — "Graphite & Pulp" design system.
 *
 * Artisanal / tactile minimalism: ink strokes on warm off-white paper.
 * NO digital shadows, NO elevation tints, NO blur. Depth comes from
 * line weight and physical overlap.
 */
import { Platform } from 'react-native';

/* ------------------------------------------------------------------ */
/* raw tokens                                                          */
/* ------------------------------------------------------------------ */

export const tokens = {
  surface: '#fdf8f8',
  surfaceDim: '#ddd9d8',
  surfaceContainerLowest: '#ffffff',
  surfaceContainerLow: '#f7f3f2',
  surfaceContainer: '#f1edec',
  surfaceContainerHigh: '#ebe7e6',
  surfaceContainerHighest: '#e5e2e1',

  onSurface: '#1c1b1b',
  onSurfaceVariant: '#444748',
  inverseSurface: '#313030',
  inverseOnSurface: '#f4f0ef',
  outline: '#747878',
  outlineVariant: '#c4c7c7',

  primary: '#000000',          // India ink
  onPrimary: '#ffffff',
  primaryContainer: '#1c1b1b',
  onPrimaryContainer: '#858383',
  inversePrimary: '#c8c6c5',

  secondary: '#5d5f5b',        // graphite
  onSecondary: '#ffffff',
  secondaryContainer: '#e2e3de',
  onSecondaryContainer: '#636561',

  tertiary: '#000000',
  tertiaryContainer: '#1a1c18',

  error: '#ba1a1a',
  onError: '#ffffff',
  errorContainer: '#ffdad6',
  onErrorContainer: '#93000a',

  primaryFixed: '#e5e2e1',
  primaryFixedDim: '#c8c6c5',
  onPrimaryFixed: '#1c1b1b',
  onPrimaryFixedVariant: '#474746',
  secondaryFixed: '#e2e3de',
  secondaryFixedDim: '#c6c7c2',
  tertiaryFixed: '#e3e3dd',

  /* Highlighter — the one vivid accent, used sparingly. Felt-tip yellow. */
  highlighter: '#FFE24D',
  highlighterSoft: 'rgba(255, 226, 77, 0.55)',
  highlighterWash: 'rgba(255, 226, 77, 0.32)',
};

/* radii — "soft", never geometric perfection */
export const radius = {
  sm: 2,
  DEFAULT: 4,
  md: 6,
  lg: 8,
  xl: 12,
  full: 9999,
};

/* 4px base unit */
export const space = (n) => n * 4;
export const spacing = {
  unit: 4,
  gutter: 24,
  margin: 32,
  safeArea: 16,
};

/* ------------------------------------------------------------------ */
/* stroke weights — depth is line weight, not shadow                   */
/* ------------------------------------------------------------------ */

export const stroke = {
  hair: StyleSheetHairline(),  // ~0.5px graphite, "far away"
  thin: 1,
  ink: 2,                      // standard ink stroke
  bold: 3,                     // "closest" to the viewer
};

function StyleSheetHairline() {
  // avoid importing StyleSheet at module top for RN web tree-shaking quirks
  const { StyleSheet } = require('react-native');
  return StyleSheet.hairlineWidth;
}

/* ------------------------------------------------------------------ */
/* typography — Bricolage headlines / Karla body / JetBrains labels    */
/* ------------------------------------------------------------------ */

const head = (w) => (w >= 800 ? 'Bricolage_800ExtraBold' : w >= 700 ? 'Bricolage_700Bold' : 'Bricolage_600SemiBold');
const body = (w) => (w >= 700 ? 'Karla_700Bold' : w >= 500 ? 'Karla_500Medium' : 'Karla_400Regular');
const mono = (w) => (w >= 700 ? 'JetBrainsMono_700Bold' : 'JetBrainsMono_500Medium');

export const type = {
  /* display / headlines — Bricolage Grotesque */
  headlineLg:  { fontFamily: head(800), fontSize: 32, lineHeight: 35, letterSpacing: -0.64 },
  headlineMd:  { fontFamily: head(700), fontSize: 24, lineHeight: 29, letterSpacing: -0.3 },
  headlineSm:  { fontFamily: head(700), fontSize: 18, lineHeight: 22, letterSpacing: -0.2 },

  /* body — Karla */
  bodyLg:      { fontFamily: body(400), fontSize: 17, lineHeight: 26 },
  bodyMd:      { fontFamily: body(400), fontSize: 15, lineHeight: 24 },
  bodySm:      { fontFamily: body(400), fontSize: 13.5, lineHeight: 20 },
  bodyStrong:  { fontFamily: body(700), fontSize: 15, lineHeight: 24 },

  /* labels / metadata — JetBrains Mono */
  labelSm:     { fontFamily: mono(500), fontSize: 11, lineHeight: 13, letterSpacing: 0.55 },
  labelXs:     { fontFamily: mono(500), fontSize: 9.5, lineHeight: 12, letterSpacing: 0.5 },

  head, body, mono,
};

/* ------------------------------------------------------------------ */
/* "ink" helpers — replace the old clay shadow API                     */
/* ------------------------------------------------------------------ */

const isWeb = Platform.OS === 'web';

/**
 * A drawn box. `weight` maps to how "close" the element is:
 *   'hair' | 'thin' -> distant pencil line
 *   'ink'           -> standard 2px pen
 *   'bold'          -> 3px, foreground
 * Slightly asymmetric corner radii imitate a hand-drawn rectangle.
 */
export function inkBox(theme, weight = 'ink', color) {
  const w = typeof weight === 'number' ? weight : stroke[weight] ?? stroke.ink;
  return {
    borderWidth: w,
    borderColor: color || theme.ink,
    borderTopLeftRadius: radius.DEFAULT,
    borderTopRightRadius: radius.lg,
    borderBottomRightRadius: radius.DEFAULT,
    borderBottomLeftRadius: radius.md,
  };
}

/**
 * The classic "hand-drawn box" — CSS does this with
 *   border-radius: 255px 15px 225px 15px / 15px 225px 15px 255px;
 * RN has no elliptical radii, so we approximate with strongly asymmetric
 * per-corner values scaled to the element. Produces a lopsided, sketched
 * outline instead of a machined rectangle.
 */
export function sketchBox(theme, weight = 'ink', size = 56, color) {
  const w = typeof weight === 'number' ? weight : stroke[weight] ?? stroke.ink;
  const big = Math.round(size * 0.5);
  const mid = Math.round(size * 0.42);
  const small = Math.max(4, Math.round(size * 0.15));
  const tiny = Math.max(3, Math.round(size * 0.12));
  return {
    borderWidth: w,
    borderColor: color || theme.ink,
    borderTopLeftRadius: big,
    borderTopRightRadius: tiny,
    borderBottomRightRadius: mid,
    borderBottomLeftRadius: small,
  };
}

/**
 * A "drawn by hand" portrait frame — never a perfect circle. Each corner
 * gets its own uneven radius (deterministically varied by `seed` so the
 * same avatar always wobbles the same way, but different avatars don't
 * all look identical), like a quick pencil circle that doesn't quite close.
 */
export function sketchAvatarFrame(theme, size = 56, weight = 'ink', color, seed = 0) {
  const w = typeof weight === 'number' ? weight : stroke[weight] ?? stroke.ink;
  // four base "wobble" ratios, rotated by the seed so avatars vary a little
  const ratios = [0.62, 0.38, 0.55, 0.44];
  const r = [0, 1, 2, 3].map((i) => Math.round(size * ratios[(i + seed) % 4]));
  return {
    borderWidth: w,
    borderColor: color || theme.ink,
    borderTopLeftRadius: r[0],
    borderTopRightRadius: r[1],
    borderBottomRightRadius: r[2],
    borderBottomLeftRadius: r[3],
  };
}

/** Faint pencil outline for "further away" surfaces (cards, list rows). */
export function pencilBox(theme, color) {
  return {
    borderWidth: 1,
    borderColor: color || theme.graphiteLine,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.DEFAULT,
    borderBottomRightRadius: radius.lg,
    borderBottomLeftRadius: radius.DEFAULT,
  };
}

/** Single ink underline — the input-field treatment from the spec. */
export function inkUnderline(theme, weight = 'ink', color) {
  const w = typeof weight === 'number' ? weight : stroke[weight] ?? stroke.ink;
  return {
    borderBottomWidth: w,
    borderBottomColor: color || theme.ink,
    borderRadius: 0,
    backgroundColor: 'transparent',
  };
}

/** Dashed "leaking pen" divider. */
export function dashedRule(theme, color) {
  return {
    borderBottomWidth: 1,
    borderStyle: 'dashed',
    borderBottomColor: color || theme.graphiteLine,
  };
}

/** Highlighter wash — marker stroke behind text / active states. */
export function marker(theme, strength = 1) {
  return {
    backgroundColor: strength >= 2 ? theme.highlighter : theme.highlighterSoft,
  };
}

/** Pressed state: ink thickens, highlighter bleeds in. */
export function pressedInk(theme) {
  return { backgroundColor: theme.highlighterWash };
}

/**
 * Cross-platform raised surface. A firm down-right shadow creates the tactile
 * 3D card/button language without another native dependency.
 */
export function raised(theme, level = 1) {
  const depth = level >= 2 ? 8 : 5;
  const opacity = theme.dark ? 0.58 : level >= 2 ? 0.3 : 0.2;
  if (isWeb) {
    return { boxShadow: `${Math.max(3, depth - 2)}px ${depth}px 0 rgba(0,0,0,${opacity})` };
  }
  return {
    shadowColor: '#000000',
    shadowOffset: { width: Math.max(2, depth - 4), height: depth },
    shadowOpacity: opacity,
    shadowRadius: level >= 2 ? 7 : 4,
    elevation: level >= 2 ? 10 : 6,
  };
}

/* Back-compat shims so any stragglers don't crash.
   The clay system is gone — these are intentional no-ops. */
export const clay = () => ({});
export const clayFor = () => ({});
export const clayPressed = () => ({});
export const clayInset = () => ({});
export const clayInsetFor = () => ({});
export const clayAvatar = () => ({});

/* ------------------------------------------------------------------ */
/* themes                                                              */
/* ------------------------------------------------------------------ */

export const lightTheme = {
  dark: false,
  name: '+one',

  bg: tokens.surface,             // warm pulp paper
  chatBg: tokens.surface,
  card: tokens.surface,           // cards are paper, not tinted
  cardAlt: tokens.surfaceContainerLow,
  inputBg: 'transparent',

  ink: tokens.primary,            // India ink
  graphite: tokens.secondary,     // pencil
  graphiteLine: tokens.outlineVariant,

  primary: tokens.primary,
  onPrimary: tokens.onPrimary,
  primaryContainer: tokens.primaryContainer,
  onPrimaryContainer: tokens.onPrimaryContainer,

  accent: tokens.highlighter,
  onAccent: tokens.onSurface,
  highlighter: tokens.highlighter,
  highlighterSoft: tokens.highlighterSoft,
  highlighterWash: tokens.highlighterWash,

  badge: tokens.primary,          // ink-filled bead
  onBadge: tokens.onPrimary,

  headerBg: tokens.surface,
  headerText: tokens.onSurface,
  headerSub: tokens.onSurfaceVariant,

  text: tokens.onSurface,
  subtext: tokens.onSurfaceVariant,
  muted: tokens.outline,

  /* bubbles: mine = ink-filled, theirs = paper with ink outline */
  bubbleOut: tokens.primary,
  onBubbleOut: tokens.onPrimary,
  bubbleIn: tokens.surface,
  onBubbleIn: tokens.onSurface,

  tick: tokens.outline,
  tickRead: tokens.primary,

  danger: tokens.error,
  dangerContainer: tokens.errorContainer,

  ripple: 'rgba(0,0,0,0.06)',
  overlay: 'rgba(28,27,27,0.55)',
  border: tokens.outlineVariant,
  tabActiveBg: tokens.tertiaryFixed,   // pale paper fill behind the active tab
};

/** Dark = ink-on-slate (chalkboard rather than paper). */
export const darkTheme = {
  dark: true,
  name: '+one',

  bg: '#1c1b1b',
  chatBg: '#1c1b1b',
  card: '#1c1b1b',
  cardAlt: '#262525',
  inputBg: 'transparent',

  ink: '#f4f0ef',                 // chalk
  graphite: '#a8a5a4',
  graphiteLine: '#4a4848',

  primary: '#f4f0ef',
  onPrimary: '#1c1b1b',
  primaryContainer: '#e5e2e1',
  onPrimaryContainer: '#1c1b1b',

  accent: tokens.highlighter,
  onAccent: '#1c1b1b',
  highlighter: tokens.highlighter,
  highlighterSoft: 'rgba(255, 226, 77, 0.42)',
  highlighterWash: 'rgba(255, 226, 77, 0.22)',

  badge: tokens.highlighter,
  onBadge: '#1c1b1b',

  headerBg: '#1c1b1b',
  headerText: '#f4f0ef',
  headerSub: '#b6b3b2',

  text: '#f4f0ef',
  subtext: '#b6b3b2',
  muted: '#8b8887',

  bubbleOut: '#f4f0ef',
  onBubbleOut: '#1c1b1b',
  bubbleIn: '#1c1b1b',
  onBubbleIn: '#f4f0ef',

  tick: '#8b8887',
  tickRead: tokens.highlighter,

  danger: '#ffb4ab',
  dangerContainer: '#3b1d1a',

  ripple: 'rgba(255,255,255,0.07)',
  overlay: 'rgba(0,0,0,0.65)',
  border: '#4a4848',
  tabActiveBg: '#2e2d2d',
};



/** KINETIC_INK — a high-contrast cyan/red manga-tech palette. */
export const kineticInkTheme = {
  dark: true,
  name: 'KINETIC INK',
  typography: 'kinetic',

  bg: '#131313',
  chatBg: '#131313',
  card: '#20201f',
  cardAlt: '#2a2a2a',
  inputBg: '#0e0e0e',

  ink: '#dbfcff',
  graphite: '#b9cacb',
  graphiteLine: '#3b494b',

  primary: '#00f0ff',
  onPrimary: '#00363a',
  primaryContainer: '#00f0ff',
  onPrimaryContainer: '#006970',

  accent: '#00f0ff',
  onAccent: '#002022',
  highlighter: '#00f0ff',
  highlighterSoft: 'rgba(0, 240, 255, 0.36)',
  highlighterWash: 'rgba(0, 240, 255, 0.18)',

  badge: '#ff525c',
  onBadge: '#5b000f',

  headerBg: '#131313',
  headerText: '#e5e2e1',
  headerSub: '#b9cacb',

  text: '#e5e2e1',
  subtext: '#b9cacb',
  muted: '#849495',

  bubbleOut: '#00f0ff',
  onBubbleOut: '#00363a',
  bubbleIn: '#20201f',
  onBubbleIn: '#e5e2e1',

  tick: '#849495',
  tickRead: '#00f0ff',

  danger: '#ffb4ab',
  dangerContainer: '#93000a',

  ripple: 'rgba(0, 240, 255, 0.18)',
  overlay: 'rgba(0,0,0,0.78)',
  border: '#3b494b',
  tabActiveBg: '#00f0ff',
};

/* ------------------------------------------------------------------ */
/* avatars — pencil-sketched initials, no colour fills                 */
/* ------------------------------------------------------------------ */

/** Muted drafting tints; avatars are outlined, fills stay subtle. */
export const AVATAR_COLORS = [
  '#e5e2e1', '#e2e3de', '#e3e3dd', '#ebe7e6', '#ddd9d8',
  '#f1edec', '#e7e4e0', '#e0e3e3', '#eae6e2', '#e4e6e1',
];

export function colorFor(id = '') {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i);
  return AVATAR_COLORS[sum % AVATAR_COLORS.length];
}

export const AVATAR_INK = tokens.onSurface;

export function initials(name = '') {
  const parts = String(name)
    .split(/\s+/)
    .map((p) => p.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
