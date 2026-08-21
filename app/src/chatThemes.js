/**
 * +one — per-conversation chat themes.
 *
 * The "Graphite & Pulp" chat-theme system. Every conversation owns a theme;
 * the theme is stored server-side against the chat row and every participant
 * sees the same one. This module is the single, centralized registry of all
 * supported themes and the resolver that turns a ChatTheme into the full
 * color view the chat widgets consume.
 *
 * Design rules baked into every palette:
 *   - Saturation is controlled; the identity stays premium and restrained.
 *   - Every palette is self-contained: background, bubbles and text are
 *     chosen together so contrast/readability hold in both app modes.
 *   - Adding a theme later = one entry in this registry. No chat component
 *     needs to change.
 *
 * Ids in this registry mirror the server allow-list (CHAT_THEMES in
 * server/src/index.js). Unknown ids always resolve to `graphite`.
 */

/* ------------------------------------------------------------------ */
/* tiny color helpers                                                  */
/* ------------------------------------------------------------------ */

function hexToRgb(hex) {
  let h = String(hex || '').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (Number.isNaN(n) || h.length !== 6) return { r: 28, g: 27, b: 27 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** rgba() version of a hex color. */
export function alpha(hex, a) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** Shift a hex color: amt > 0 darkens toward black, amt < 0 lightens toward white. */
export function shade(hex, amt) {
  const { r, g, b } = hexToRgb(hex);
  const target = amt < 0 ? 255 : 0;
  const p = Math.min(1, Math.abs(amt));
  const mix = (c) => Math.round(c + (target - c) * p);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

/** Highest-contrast ink for a given background (white-ish or ink). */
export function readableOn(hex) {
  const { r, g, b } = hexToRgb(hex);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.55 ? '#1c1b1b' : '#f4f0ef';
}

/* ------------------------------------------------------------------ */
/* the ChatTheme model                                                 */
/* ------------------------------------------------------------------ */

/**
 * ChatTheme
 *   id                unique id (the server-side contract)
 *   name              display name
 *   category          Graphite | Atmospheric | Pulp | Special
 *   background        base chat background color
 *   backgroundGradient subtle multi-stop gradient for the background
 *   surface           sheet/surface color (composer, cards, inputs)
 *   incomingBubble    "their" bubble fill
 *   outgoingBubble    "my" bubble fill
 *   primaryText       main text on the background/incoming bubbles
 *   secondaryText     muted/secondary text
 *   accent            accent elements (ticks, active states, highlights)
 *   sendButton        send-button fill
 *   inputBackground   composer field wash
 *   replyPreview      reply-quote surface
 *   reactionAccent    reaction chip surface
 *   wallpaper         optional image wallpaper (reserved; null = gradient only)
 *   moods             mood tags used by the picker's mood selector
 */
const THEMES = [
  /* ---------------- Graphite — the default language ---------------- */
  {
    id: 'graphite', name: 'Graphite', category: 'Graphite',
    background: '#fdf8f8',
    backgroundGradient: ['#fdf8f8', '#f9f3f1', '#f5efec'],
    surface: '#fdf8f8',
    incomingBubble: '#fdf8f8',
    outgoingBubble: '#1c1b1b',
    primaryText: '#1c1b1b',
    secondaryText: '#444748',
    accent: '#1c1b1b',
    sendButton: '#1c1b1b',
    inputBackground: 'rgba(247,243,242,0.72)',
    replyPreview: '#f1edec',
    reactionAccent: '#e5e2e1',
    wallpaper: null,
    moods: ['chill', 'fun'],
  },
  {
    id: 'obsidian', name: 'Obsidian', category: 'Graphite',
    background: '#232327',
    backgroundGradient: ['#232327', '#26262c', '#202024'],
    surface: '#2c2c33',
    incomingBubble: '#33333b',
    outgoingBubble: '#0d0d10',
    primaryText: '#e9e9ee',
    secondaryText: '#a2a2ad',
    accent: '#c9c9d4',
    sendButton: '#0d0d10',
    inputBackground: 'rgba(44,44,51,0.8)',
    replyPreview: '#2c2c33',
    reactionAccent: '#3b3b44',
    wallpaper: null,
    moods: ['late-night'],
  },
  {
    id: 'carbon', name: 'Carbon', category: 'Graphite',
    background: '#e9e6e2',
    backgroundGradient: ['#e9e6e2', '#e4e0db', '#ede9e4'],
    surface: '#f1eeea',
    incomingBubble: '#f6f3ef',
    outgoingBubble: '#3a3835',
    primaryText: '#211f1d',
    secondaryText: '#6d6862',
    accent: '#4c4843',
    sendButton: '#3a3835',
    inputBackground: 'rgba(241,238,234,0.75)',
    replyPreview: '#dfdcd7',
    reactionAccent: '#d9d5d0',
    wallpaper: null,
    moods: ['hype'],
  },

  /* ---------------- Atmospheric ---------------- */
  {
    id: 'aurora', name: 'Aurora', category: 'Atmospheric',
    background: '#eef4f1',
    backgroundGradient: ['#eef4f1', '#e5f1ec', '#ebf0f5'],
    surface: '#f6faf8',
    incomingBubble: '#f8fcfb',
    outgoingBubble: '#1f4d42',
    primaryText: '#12241f',
    secondaryText: '#4f6b62',
    accent: '#2e8b76',
    sendButton: '#1f4d42',
    inputBackground: 'rgba(246,250,248,0.72)',
    replyPreview: '#e2efea',
    reactionAccent: '#cfe7dd',
    wallpaper: null,
    moods: ['chill', 'fun'],
  },
  {
    id: 'midnight', name: 'Midnight', category: 'Atmospheric',
    background: '#1c2333',
    backgroundGradient: ['#1c2333', '#1a2133', '#1e2436'],
    surface: '#252d40',
    incomingBubble: '#2b3450',
    outgoingBubble: '#10141f',
    primaryText: '#e7eaf4',
    secondaryText: '#9aa4bd',
    accent: '#8fa0d8',
    sendButton: '#10141f',
    inputBackground: 'rgba(37,45,64,0.8)',
    replyPreview: '#252d40',
    reactionAccent: '#333d5c',
    wallpaper: null,
    moods: ['late-night'],
  },
  {
    id: 'ocean', name: 'Ocean', category: 'Atmospheric',
    background: '#e8f1f5',
    backgroundGradient: ['#e8f1f5', '#ddeef4', '#e9f1f4'],
    surface: '#f3f9fb',
    incomingBubble: '#f9fcfd',
    outgoingBubble: '#15455c',
    primaryText: '#0f2733',
    secondaryText: '#46667a',
    accent: '#1f7fa3',
    sendButton: '#15455c',
    inputBackground: 'rgba(243,249,251,0.72)',
    replyPreview: '#dcebf2',
    reactionAccent: '#c6e0eb',
    wallpaper: null,
    moods: ['chill'],
  },
  {
    id: 'sunset', name: 'Sunset', category: 'Atmospheric',
    background: '#f6ece5',
    backgroundGradient: ['#f6ece5', '#f8e3d9', '#f3ece1'],
    surface: '#fbf5f0',
    incomingBubble: '#fdf8f4',
    outgoingBubble: '#7a3b2e',
    primaryText: '#331610',
    secondaryText: '#8a5a4a',
    accent: '#c05a40',
    sendButton: '#7a3b2e',
    inputBackground: 'rgba(251,245,240,0.72)',
    replyPreview: '#f2e0d6',
    reactionAccent: '#eccfc2',
    wallpaper: null,
    moods: ['love', 'hype'],
  },

  /* ---------------- Pulp — soft paper tones ---------------- */
  {
    id: 'sakura', name: 'Sakura', category: 'Pulp',
    background: '#faf0f3',
    backgroundGradient: ['#faf0f3', '#f7e8ef', '#f6eef4'],
    surface: '#fdf8fa',
    incomingBubble: '#fff8fa',
    outgoingBubble: '#8d4a5f',
    primaryText: '#331723',
    secondaryText: '#8a6472',
    accent: '#c2547c',
    sendButton: '#8d4a5f',
    inputBackground: 'rgba(253,248,250,0.72)',
    replyPreview: '#f6e2e9',
    reactionAccent: '#efd2dc',
    wallpaper: null,
    moods: ['love'],
  },
  {
    id: 'lavender', name: 'Lavender', category: 'Pulp',
    background: '#f2eff8',
    backgroundGradient: ['#f2eff8', '#ece8f6', '#f1eef7'],
    surface: '#f9f7fc',
    incomingBubble: '#fcfafe',
    outgoingBubble: '#4d4270',
    primaryText: '#241e38',
    secondaryText: '#736a90',
    accent: '#7a6bc4',
    sendButton: '#4d4270',
    inputBackground: 'rgba(249,247,252,0.72)',
    replyPreview: '#e8e2f4',
    reactionAccent: '#d9d2ec',
    wallpaper: null,
    moods: ['chill', 'love'],
  },
  {
    id: 'mint', name: 'Mint', category: 'Pulp',
    background: '#edf6f0',
    backgroundGradient: ['#edf6f0', '#e4f3e9', '#eef5ee'],
    surface: '#f6fbf7',
    incomingBubble: '#fafdfa',
    outgoingBubble: '#2f5d4a',
    primaryText: '#14241c',
    secondaryText: '#54705f',
    accent: '#3a9d76',
    sendButton: '#2f5d4a',
    inputBackground: 'rgba(246,251,247,0.72)',
    replyPreview: '#e0f0e5',
    reactionAccent: '#c9e6d3',
    wallpaper: null,
    moods: ['chill', 'fun'],
  },
  {
    id: 'cream', name: 'Cream', category: 'Pulp',
    background: '#f7f1e6',
    backgroundGradient: ['#f7f1e6', '#f3ecdb', '#f8f1e5'],
    surface: '#fcf8f0',
    incomingBubble: '#fdfaf4',
    outgoingBubble: '#5a4632',
    primaryText: '#2c2118',
    secondaryText: '#7c6a52',
    accent: '#a3743f',
    sendButton: '#5a4632',
    inputBackground: 'rgba(252,248,240,0.72)',
    replyPreview: '#f1e8d7',
    reactionAccent: '#e8dcc4',
    wallpaper: null,
    moods: ['fun', 'love'],
  },

  /* ---------------- Special — restrained, not garish ---------------- */
  {
    id: 'neon-night', name: 'Neon Night', category: 'Special',
    background: '#12101c',
    backgroundGradient: ['#12101c', '#161226', '#101420'],
    surface: '#1d1a2a',
    incomingBubble: '#262039',
    outgoingBubble: '#0b2b2e',
    primaryText: '#e9e7f5',
    secondaryText: '#9d99b8',
    accent: '#00d9c0',
    sendButton: '#00d9c0',
    inputBackground: 'rgba(29,26,42,0.8)',
    replyPreview: '#1d1a2a',
    reactionAccent: '#12302f',
    wallpaper: null,
    moods: ['gaming', 'hype', 'late-night'],
  },
  {
    id: 'galaxy', name: 'Galaxy', category: 'Special',
    background: '#141120',
    backgroundGradient: ['#141120', '#1a1429', '#121a28'],
    surface: '#1f1a2e',
    incomingBubble: '#2a2140',
    outgoingBubble: '#3a2d5c',
    primaryText: '#ebe8f7',
    secondaryText: '#a49cc4',
    accent: '#a78bda',
    sendButton: '#3a2d5c',
    inputBackground: 'rgba(31,26,46,0.8)',
    replyPreview: '#241d38',
    reactionAccent: '#362b52',
    wallpaper: null,
    moods: ['gaming', 'late-night', 'chill'],
  },
];

export const THEME_CATEGORIES = ['Recommended', 'Graphite', 'Atmospheric', 'Pulp', 'Special'];

export const THEME_MOODS = [
  { id: 'love', label: 'Love', emoji: '❤️' },
  { id: 'fun', label: 'Fun', emoji: '😂' },
  { id: 'late-night', label: 'Late Night', emoji: '🌙' },
  { id: 'chill', label: 'Chill', emoji: '💜' },
  { id: 'hype', label: 'Hype', emoji: '🔥' },
  { id: 'gaming', label: 'Gaming', emoji: '🎮' },
];

/** Curated starter set shown under "Recommended". */
const RECOMMENDED_IDS = ['graphite', 'aurora', 'sakura', 'midnight', 'mint', 'sunset'];

/* ------------------------------------------------------------------ */
/* the registry                                                       */
/* ------------------------------------------------------------------ */

const byId = new Map();

/**
 * Centralized ThemeRegistry. Chat components never hard-code theme colors;
 * they consume the resolved ChatTheme handed down from ChatThemeContext.
 * New themes (seasonal, limited-time, premium, community…) are added here
 * without touching any chat widget.
 */
export const ThemeRegistry = {
  register(theme) {
    if (!theme || !theme.id) return;
    byId.set(theme.id, theme);
    if (!this.themes.includes(theme)) this.themes.push(theme);
  },
  get(id) {
    return byId.get(id) || byId.get('graphite');
  },
  has(id) {
    return byId.has(id);
  },
  themes: [],
  byId,
  recommendedIds: RECOMMENDED_IDS,
  categories: THEME_CATEGORIES,
  moods: THEME_MOODS,

  /** Themes recommended for a mood (or null when the mood has no list). */
  forMood(moodId) {
    if (!moodId) return null;
    return THEMES.filter((t) => (t.moods || []).includes(moodId)).map((t) => t.id);
  },
};

THEMES.forEach((t) => ThemeRegistry.register(t));

/* ------------------------------------------------------------------ */
/* resolver — ChatTheme -> full color view                             */
/* ------------------------------------------------------------------ */

/**
 * Turn a ChatTheme into the same-shaped theme object the rest of the app
 * consumes, layered over the global (light/dark/kinetic) theme so every key
 * chat components read exists. In dark mode the palettes are gently darkened
 * and text flips to light ink, keeping each theme readable in both modes.
 */
export function resolveChatTheme(baseTheme, ct) {
  if (!ct) ct = ThemeRegistry.get('graphite');
  const dark = !!baseTheme.dark;
  const bg = dark ? shade(ct.background, 0.6) : ct.background;
  const surface = dark ? shade(ct.surface, 0.55) : ct.surface;
  const incoming = dark ? shade(ct.incomingBubble, 0.5) : ct.incomingBubble;
  const outgoing = dark ? shade(ct.outgoingBubble, 0.45) : ct.outgoingBubble;
  const gradient = (ct.backgroundGradient || [ct.background]).map((c) => (dark ? shade(c, 0.6) : c));
  // Dark mode: accents/send buttons that are already dark (graphite black,
  // deep green, terracotta…) would vanish on a dark background — lift them
  // toward chalk so controls stay visible; keep already-light accents as-is.
  const lift = (hex) => (readableOn(hex) === '#f4f0ef' ? shade(hex, -0.55) : hex);
  const accent = dark ? lift(ct.accent) : ct.accent;
  const sendButton = dark ? lift(ct.sendButton) : ct.sendButton;

  const primaryText = dark ? readableOn(bg) : ct.primaryText;
  const secondaryText = dark ? alpha(primaryText, 0.68) : ct.secondaryText;
  const muted = dark ? alpha(primaryText, 0.5) : shade(ct.secondaryText, -0.28);
  const graphiteLine = alpha(primaryText, dark ? 0.3 : 0.2);

  return {
    ...baseTheme,
    dark,
    name: ct.name,
    chatThemeId: ct.id,
    chatThemeCategory: ct.category,

    bg,
    chatBg: bg,
    card: surface,
    cardAlt: dark ? shade(surface, 0.24) : shade(surface, -0.035),
    inputBg: ct.inputBackground,

    ink: primaryText,
    graphite: secondaryText,
    graphiteLine,

    primary: accent,
    onPrimary: readableOn(accent),
    primaryContainer: outgoing,
    onPrimaryContainer: readableOn(outgoing),

    accent,
    onAccent: readableOn(accent),
    highlighter: accent,
    highlighterSoft: alpha(accent, 0.3),
    highlighterWash: alpha(accent, 0.16),

    badge: accent,
    onBadge: readableOn(accent),

    headerBg: bg,
    headerText: primaryText,
    headerSub: secondaryText,

    text: primaryText,
    subtext: secondaryText,
    muted,

    bubbleOut: outgoing,
    onBubbleOut: readableOn(outgoing),
    bubbleIn: incoming,
    onBubbleIn: primaryText,

    tick: muted,
    tickRead: accent,

    sendButton,
    onSendButton: readableOn(sendButton),
    inputBackground: ct.inputBackground,
    replyPreview: dark ? shade(ct.replyPreview, 0.5) : ct.replyPreview,
    reactionAccent: ct.reactionAccent,
    wallpaper: ct.wallpaper || null,
    backgroundGradient: gradient,
    backgroundWashA: alpha(accent, dark ? 0.1 : 0.05),
    backgroundWashB: alpha(ct.outgoingBubble, dark ? 0.09 : 0.04),

    danger: baseTheme.danger,
    dangerContainer: baseTheme.dangerContainer,
    ripple: alpha(primaryText, 0.08),
    overlay: baseTheme.overlay,
    border: graphiteLine,
    tabActiveBg: shade(surface, dark ? 0.3 : -0.04),
  };
}
