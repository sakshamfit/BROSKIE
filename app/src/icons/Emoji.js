import React from 'react';
import { Text, View, Platform } from 'react-native';
import Svg, { Path, Circle, Ellipse, Rect, Polygon, Polyline, Line, G } from 'react-native-svg';
import { getEmojiData, useEmojiDataState } from './emojiDataState';

/**
 * True-vector colour emoji, rendered with react-native-svg from official
 * Twemoji path data. Replaces system font glyphs so emoji look identical on
 * every platform (and are real <svg> nodes in the DOM on web).
 *
 * On web the ~2.4 MB path-data table is fetched in its own async chunk and
 * only when an emoji is actually needed. Until it arrives, components fall
 * back to the native/system glyph, so the app shell and auth screen never
 * wait for emoji data before painting.
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

const ANY_EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}\u{2190}-\u{21FF}]/u;

/** Lazily-built splitter for whatever emoji table is current. */
let splitCache = null;
function splitFor(data) {
  if (!data) return null;
  if (splitCache && splitCache.data === data) return splitCache.re;
  const keys = Object.keys(data).sort((a, b) => b.length - a.length);
  const escaped = keys.map((k) => k.replace(/[.*+?^${}()|[\]]/g, '\\$&'));
  const re = escaped.length ? new RegExp(`(${escaped.join('|')})`, 'g') : null;
  splitCache = { data, re };
  return re;
}

export function hasEmoji(ch) {
  return !!getEmojiData()?.[ch];
}

export default function Emoji({ char, size = 20, style }) {
  // Kick off the async table load on web as soon as an emoji is rendered.
  const { data } = useEmojiDataState();
  if (!data || !data[char]) {
    // graceful fallback to the system glyph for anything not loaded/embedded
    return <Text style={[{ fontSize: size }, style]}>{char}</Text>;
  }
  return (
    <Svg width={size} height={size} viewBox={data[char].vb} style={style}>
      <G>
        {data[char].els.map((el, i) => {
          const Tag = TAGS[el.t];
          if (!Tag) return null;
          return <Tag key={i} {...props(el)} />;
        })}
      </G>
    </Svg>
  );
}

/**
 * Renders a string, swapping every known emoji for its SVG.
 * Emoji are vertically centred against the surrounding text.
 */
export function EmojiText({ children, style, size, numberOfLines, ...rest }) {
  const { data } = useEmojiDataState();
  const text = typeof children === 'string' ? children : String(children ?? '');
  const splitRe = splitFor(data);
  if (!splitRe || !ANY_EMOJI.test(text)) {
    return <Text style={style} numberOfLines={numberOfLines} {...rest}>{text}</Text>;
  }

  const flat = Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : (style || {});
  const fontSize = flat.fontSize || 16;
  const glyph = size || Math.round(fontSize * 1.1);

  // Keep the surrounding whitespace attached to the adjacent text run so the
  // emoji doesn't introduce an extra gap, and nudge it onto the text baseline.
  const parts = text.split(splitRe).filter((p) => p !== '' && p != null);

  return (
    <Text style={style} numberOfLines={numberOfLines} {...rest}>
      {parts.map((part, i) =>
        data[part] ? (
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

export const EMOJI_KEYS = Object.keys(getEmojiData() || {});
