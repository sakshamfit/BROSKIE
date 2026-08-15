import React from 'react';
import { Text, View, Platform } from 'react-native';
import Svg, { Path, Circle, Ellipse, Rect, Polygon, Polyline, Line, G } from 'react-native-svg';
import DATA from './emojiData.json';

/**
 * True-vector colour emoji, rendered with react-native-svg from official
 * Twemoji path data. Replaces system font glyphs so emoji look identical on
 * every platform (and are real <svg> nodes in the DOM on web).
 */

const TAGS = { path: Path, circle: Circle, ellipse: Ellipse, rect: Rect, polygon: Polygon, polyline: Polyline, line: Line };

function props(el) {
  const p = {};
  ['d', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height', 'x1', 'y1', 'x2', 'y2', 'points', 'transform'].forEach((k) => {
    if (el[k] != null) p[k] = el[k];
  });
  if (el.f) p.fill = el.f;
  if (el.o) p.opacity = el.o;
  if (el.s) {
    p.stroke = el.s;
    if (el.sw) p.strokeWidth = el.sw;
    if (el.slc) p.strokeLinecap = el.slc;
    if (el.slj) p.strokeLinejoin = el.slj;
  }
  return p;
}

export function hasEmoji(ch) {
  return !!DATA[ch];
}

export default function Emoji({ char, size = 20, style }) {
  const data = DATA[char];
  if (!data) {
    // graceful fallback to the system glyph for anything not embedded
    return <Text style={[{ fontSize: size }, style]}>{char}</Text>;
  }
  return (
    <Svg width={size} height={size} viewBox={data.vb} style={style}>
      <G>
        {data.els.map((el, i) => {
          const Tag = TAGS[el.t];
          if (!Tag) return null;
          return <Tag key={i} {...props(el)} />;
        })}
      </G>
    </Svg>
  );
}

/* ------------------------------------------------------------------ */
/* inline text + emoji                                                 */
/* ------------------------------------------------------------------ */

// Build a matcher for every embedded emoji, longest first so ZWJ/VS16
// sequences win over their single-codepoint prefixes.
const KEYS = Object.keys(DATA).sort((a, b) => b.length - a.length);
const ESCAPED = KEYS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const SPLIT_RE = ESCAPED.length ? new RegExp(`(${ESCAPED.join('|')})`, 'g') : null;

/** Any emoji-ish codepoint, used to strip stragglers we don't have art for. */
const ANY_EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}\u{2190}-\u{21FF}]/u;

/**
 * Renders a string, swapping every known emoji for its SVG.
 * Emoji are vertically centred against the surrounding text.
 */
export function EmojiText({ children, style, size, numberOfLines, ...rest }) {
  const text = typeof children === 'string' ? children : String(children ?? '');
  if (!SPLIT_RE || !ANY_EMOJI.test(text)) {
    return <Text style={style} numberOfLines={numberOfLines} {...rest}>{text}</Text>;
  }

  const flat = Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : (style || {});
  const fontSize = flat.fontSize || 16;
  const glyph = size || Math.round(fontSize * 1.1);

  // Keep the surrounding whitespace attached to the adjacent text run so the
  // emoji doesn't introduce an extra gap, and nudge it onto the text baseline.
  const parts = text.split(SPLIT_RE).filter((p) => p !== '' && p != null);

  return (
    <Text style={style} numberOfLines={numberOfLines} {...rest}>
      {parts.map((part, i) =>
        DATA[part] ? (
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
          // drop orphaned variation selectors / ZWJ that would render as blanks
          <Text key={i} style={style}>{part.replace(/[\uFE0E\uFE0F\u200D]/g, '')}</Text>
        )
      )}
    </Text>
  );
}

export const EMOJI_KEYS = KEYS;
