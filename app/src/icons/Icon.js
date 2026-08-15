import React from 'react';
import Svg, { Path, Circle, Rect, Line, Polyline, Polygon, Ellipse } from 'react-native-svg';
import DATA from './iconData.json';

/**
 * Real SVG icon renderer (react-native-svg) — replaces the @expo/vector-icons
 * font glyphs so icons are true vectors everywhere (native + web DOM <svg>).
 *
 * Path data is extracted from the official `ionicons` package, so shapes are
 * pixel-identical to what the app used before.
 *
 * Ionicons draws two styles:
 *   - filled  ("send")          -> shapes are filled with currentColor
 *   - outline ("send-outline")  -> shapes are stroked, fill="none"
 * Each element carries its own fill/stroke attrs in the source SVG, which we
 * honour; anything unspecified inherits the requested `color`.
 */

const TAGS = { path: Path, circle: Circle, rect: Rect, line: Line, polyline: Polyline, polygon: Polygon, ellipse: Ellipse };

function elementProps(el, color) {
  const p = {};
  // geometry
  ['d', 'cx', 'cy', 'r', 'x', 'y', 'width', 'height', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'points'].forEach((k) => {
    if (el[k] != null) p[k] = el[k];
  });

  const hasStroke = el.stroke != null;
  const explicitFill = el.fill;

  if (explicitFill === 'none') p.fill = 'none';
  else if (explicitFill && explicitFill !== 'currentColor') p.fill = explicitFill;
  else if (hasStroke && !explicitFill) p.fill = 'none';   // stroked outline shape
  else p.fill = color;

  if (hasStroke) {
    p.stroke = el.stroke === 'currentColor' || el.stroke === 'none' ? color : el.stroke;
    if (el.sw) p.strokeWidth = el.sw;
    if (el.slc) p.strokeLinecap = el.slc;
    if (el.slj) p.strokeLinejoin = el.slj;
    if (el.sml) p.strokeMiterlimit = el.sml;
  }
  return p;
}

export default function Icon({ name, size = 24, color = '#000', style, ...rest }) {
  const icon = DATA[name] || DATA[String(name).replace(/-outline$/, '')] || null;
  if (!icon) {
    if (__DEV__) console.warn(`[Icon] unknown icon "${name}"`);
    return null;
  }

  return (
    <Svg width={size} height={size} viewBox={icon.vb} style={style} {...rest}>
      {icon.els.map((el, i) => {
        const Tag = TAGS[el.t];
        if (!Tag) return null;
        return <Tag key={i} {...elementProps(el, color)} />;
      })}
    </Svg>
  );
}

export const ICON_NAMES = Object.keys(DATA);
