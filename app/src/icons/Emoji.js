import React from 'react';
import { Text, Platform } from 'react-native';
import Svg, { Path, Circle, Ellipse, Rect, Polygon, Polyline, Line, G, Defs, ClipPath } from 'react-native-svg';
import { getEmojiData, useEmojiDataState } from './emojiDataState';

/**
 * True-vector colour emoji, rendered with react-native-svg from official
 * Twemoji artwork (the same flat, familiar set X/Twitter and Discord ship).
 * Replaces system font glyphs so emoji look identical — and premium — on
 * every platform, web and native.
 *
 * The packed table (emojiData.json, v2 — see scripts/generate-emoji-data.js)
 * covers the full RGI set: every Unicode emoji incl. flags, keycaps, ZWJ
 * families, all five skin tones, and the newest additions — plus typing
 * aliases for the ways keyboards actually emit emoji (bare "❤" for "❤️",
 * digit+keycap without VS16, FE0F-stripped ZWJ forms…) so any typed or
 * received text matches vector art instead of falling back to a system glyph.
 *
 * On web the table lives in its own async chunk, fetched the first time an
 * emoji is actually rendered; until it arrives we show the system glyph so
 * the app shell never waits on ~4 MB of path data before painting.
 */

const TAGS = { p: Path, c: Circle, e: Ellipse, r: Rect, y: Polygon, l: Polyline, n: Line };

/** Decode one packed element into react-native-svg props. */
function elProps(el, P) {
  const p = {};
  if (el.d != null) p.d = P[el.d];
  if (el.pts != null) p.points = P[el.pts];
  for (const k of ['cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height', 'x1', 'y1', 'x2', 'y2']) {
    if (el[k] != null) p[k] = el[k];
  }
  if (el.f != null) p.fill = el.f; // 'none' is meaningful; absent = SVG default black
  if (el.o != null) p.opacity = el.o;
  if (el.fo != null) p.fillOpacity = el.fo;
  if (el.fr != null) p.fillRule = el.fr;
  if (el.cr != null) p.clipRule = el.cr;
  if (el.tf != null) p.transform = el.tf;
  if (el.s != null) {
    p.stroke = el.s;
    if (el.sw != null) p.strokeWidth = el.sw;
    if (el.slc != null) p.strokeLinecap = el.slc;
    if (el.slj != null) p.strokeLinejoin = el.slj;
  }
  return p;
}

/* Resolved-entry cache: packed row → { vb, els }, resolved once per emoji
 * (rebuilds automatically when the web async chunk swaps the table in). */
const decodeCache = new Map();
function resolveEmoji(char) {
  const data = getEmojiData();
  if (!data) return null;
  const cached = decodeCache.get(char);
  if (cached && cached.data === data) return cached.entry;
  let entry = null;
  let raw = data.E[char];
  if (!raw) {
    const canon = data.A[char];
    if (canon) raw = data.E[canon];
  }
  if (raw) entry = { vb: raw.b, els: raw.z };
  decodeCache.set(char, { data, entry });
  if (decodeCache.size > 12000) decodeCache.clear(); // bound memory in long sessions
  return entry;
}

export function hasEmoji(ch) {
  return !!resolveEmoji(ch);
}

function Els({ els, P, clipId }) {
  return els.map((el, i) => {
    if (el.t === 'g' && el.cl != null) {
      // a group clipped by a single path (only 🫨 in the current set)
      return (
        <G key={i} clipPath={`url(#${clipId})`}>
          <Defs>
            <ClipPath id={clipId}>
              <Path d={P[el.cl]} />
            </ClipPath>
          </Defs>
          <Els els={el.z} P={P} clipId={clipId} />
        </G>
      );
    }
    if (el.t === 'g') return <Els key={i} els={el.z} P={P} clipId={clipId} />;
    const Tag = TAGS[el.t];
    if (!Tag) return null;
    return <Tag key={i} {...elProps(el, P)} />;
  });
}

const EmojiComponent = function Emoji({ char, size = 20, style }) {
  // Kick off the async table load on web as soon as an emoji is rendered.
  useEmojiDataState();
  const clipId = React.useId().replace(/[^a-zA-Z0-9]/g, 'c');
  const entry = resolveEmoji(char);
  if (!entry) {
    // graceful fallback to the system glyph for anything not loaded/known
    return <Text style={[{ fontSize: size }, style]}>{char}</Text>;
  }
  const P = getEmojiData().P;
  return (
    <Svg width={size} height={size} viewBox={entry.vb} style={style}>
      <Els els={entry.els} P={P} clipId={clipId} />
    </Svg>
  );
}

/* ------------------------------------------------------------------ */
/* text splitting                                                      */
/* ------------------------------------------------------------------ */

/**
 * Characters that can start an emoji sequence — a fast pre-check so plain
 * text never touches the (large) splitter regex. Built from code points so
 * no invisible glyph ever lives in the source:
 *   A9/AE ©® · 203C ‼ · 2049 ⁉ · 2122 ™ · 2139 ℹ · 2190–21FF arrows ·
 *   2300–23FF · 24C2 Ⓜ · 25AA–25FE · 2600–27BF · 2B00–2BFF ·
 *   3030 〰 · 303D 〽 · 3297 ㊗ · 3299 ㊙ · FE0F VS16 · 200D ZWJ ·
 *   20E3 keycap · 1F000–1FAFF pictographs · E0020–E007F flag tag chars
 */
const ANY_RANGES = [
  [0xa9, 0xae], [0x203c, 0x203c], [0x2049, 0x2049], [0x2122, 0x2122],
  [0x2139, 0x2139], [0x2190, 0x21ff], [0x2300, 0x23ff], [0x24c2, 0x24c2],
  [0x25aa, 0x25fe], [0x2600, 0x27bf], [0x2b00, 0x2bff], [0x3030, 0x3030],
  [0x303d, 0x303d], [0x3297, 0x3297], [0x3299, 0x3299], [0xfe0f, 0xfe0f],
  [0x200d, 0x200d], [0x20e3, 0x20e3], [0x1f000, 0x1faff], [0xe0020, 0xe007f],
];
const cp = (n) => (n > 0xffff ? `\\u{${n.toString(16)}}` : `\\u${n.toString(16).padStart(4, '0')}`);
const ANY_EMOJI = new RegExp(
  `[${ANY_RANGES.map(([a, b]) => (a === b ? cp(a) : `${cp(a)}-${cp(b)}`)).join('')}]`,
  'u',
);

/** Invisible formatting marks to strip from unmatched leftover text parts. */
const FORMAT_CHARS = new RegExp('[\\uFE0E\\uFE0F\\u200D\\u20E3\\u{E0020}-\\u{E007F}]', 'gu');

/** Lazily-built splitter for the current emoji table (canon keys + aliases). */
let splitCache = null;
function splitFor(data) {
  if (!data) return null;
  if (splitCache && splitCache.data === data) return splitCache.re;
  const keys = [...Object.keys(data.E), ...Object.keys(data.A)].sort((a, b) => b.length - a.length);
  const escaped = keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = escaped.length ? new RegExp(`(${escaped.join('|')})`, 'g') : null;
  splitCache = { data, re };
  return re;
}

/** Split text into ordered parts; emoji parts resolve with hasEmoji(). */
export function splitEmojiParts(text) {
  const data = getEmojiData();
  const re = splitFor(data);
  if (!re || !text || !ANY_EMOJI.test(text)) return null;
  return text.split(re).filter((p) => p !== '' && p != null);
}

/**
 * Detect "emoji-only" messages so bubbles can show them jumbo-sized, like
 * WhatsApp / iMessage / Telegram do. Returns the emoji chars when the body
 * is only emoji (≤ 3, whitespace allowed), else null.
 */
export function jumboEmojiChars(text) {
  if (!text) return null;
  const noSpace = String(text).trim().replace(/\s+/g, '');
  if (!noSpace || !ANY_EMOJI.test(noSpace)) return null;
  const parts = splitEmojiParts(noSpace);
  if (!parts) return null;
  const chars = parts.filter((p) => hasEmoji(p));
  if (chars.length !== parts.length || chars.length < 1 || chars.length > 3) return null;
  return chars;
}

/**
 * Renders a string, swapping every known emoji for its SVG.
 * Emoji are vertically centred against the surrounding text.
 */
export function EmojiText({ children, style, size, numberOfLines, ...rest }) {
  useEmojiDataState();
  const text = typeof children === 'string' ? children : String(children ?? '');
  const parts = splitEmojiParts(text);
  if (!parts) {
    return <Text style={style} numberOfLines={numberOfLines} {...rest}>{text}</Text>;
  }

  const flat = Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : (style || {});
  const fontSize = flat.fontSize || 16;
  const glyph = size || Math.round(fontSize * 1.1);

  return (
    <Text style={style} numberOfLines={numberOfLines} {...rest}>
      {parts.map((part, i) =>
        hasEmoji(part) ? (
          <Emoji
            key={i}
            char={part}
            size={glyph}
            style={
              Platform.OS === 'web'
                ? { verticalAlign: 'text-bottom', marginHorizontal: -0.5 }
                : { transform: [{ translateY: Math.round(fontSize * 0.135) }] }
            }
          />
        ) : (
          // drop orphaned variation selectors / ZWJ / tag chars (invisible)
          <Text key={i} style={style}>{part.replace(FORMAT_CHARS, '')}</Text>
        )
      )}
    </Text>
  );
}

/** All canonical (fully-qualified) emoji chars the current table renders. */
export function emojiKeys() {
  return Object.keys(getEmojiData()?.E || {});
}

export const Emoji = React.memo(EmojiComponent);
export default EmojiComponent;
