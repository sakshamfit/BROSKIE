#!/usr/bin/env node
/**
 * generate-emoji-data.js — builds app/src/icons/emojiData.json + emojiMeta.json
 * from the official Twemoji SVG artwork (what X/Twitter, Discord, etc. ship —
 * the flat, familiar "premium social app" emoji look) plus emojibase metadata
 * (labels, category groups, search tags, skin-tone variants).
 *
 * Why: the app renders every emoji as true vector art (react-native-svg) from
 * this packed table, so emoji look identical on every platform and never fall
 * back to inconsistent system font glyphs. This generator keeps that table
 * complete: full RGI coverage — flags, keycaps, ZWJ families, all five skin
 * tones, and the latest Unicode emoji.
 *
 * Usage:
 *   # 1. get official Twemoji SVGs (any checkout of the repo's assets/svg)
 *   curl -sL https://api.github.com/repos/jdecked/twemoji/tarball/v15.1.0 | tar xz
 *   # 2. get emojibase English data (npm package "emojibase-data", file en/data.json)
 *   # 3. run
 *   node scripts/generate-emoji-data.js \
 *     --twemoji /path/to/twemoji-checkout/assets/svg \
 *     --emojibase /path/to/emojibase-data/package/en/data.json
 *
 * Output format (v2) in app/src/icons/emojiData.json:
 *   {
 *     "P": [...],   // deduped string table: every path `d` / points value, once
 *     "A": { "<alias char>": "<canonical char>" },   // typing-variant aliases
 *     "E": { "<canonical char>": { "b": "<viewBox>", "z": [els…] } }
 *   }
 * Elements are flat objects, short keys:
 *   t:  p=path c=circle e=ellipse r=rect y=polygon l=polyline n=line g=clip-group
 *   d / pts: number → index into P   (long strings live exactly once, in P)
 *   f fill ("none" kept; omitted = SVG default black), o opacity,
 *   fo fillOpacity, fr fillRule, cr clipRule, tf transform (CSS string),
 *   s/sw/slc/slj stroke attrs, geometry keys kept verbatim,
 *   on t:'g': cl = clip-path `d` index into P, z = child els (one level)
 * Aliases cover the ways keyboards actually emit emoji: FE0F-stripped forms
 * (bare ❤ for ❤️, "1⃣" for "1️⃣") and the Twemoji filename form.
 *
 * Decoding + rendering lives in app/src/icons/Emoji.js.
 */

const fs = require('fs');
const path = require('path');

/* ---------------- args ---------------- */
function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : null;
}
const SVG_DIR = arg('twemoji');
const EMOJIBASE = arg('emojibase');
if (!SVG_DIR || !fs.existsSync(SVG_DIR)) {
  console.error('missing --twemoji <assets/svg dir>');
  process.exit(1);
}
if (!EMOJIBASE || !fs.existsSync(EMOJIBASE)) {
  console.error('missing --emojibase <en/data.json>');
  process.exit(1);
}
const OUT_DIR = path.resolve(__dirname, '..', 'app', 'src', 'icons');

/* ---------------- number minification ---------------- */
// Round to 2 decimals — 0.01 unit on a 36-unit viewBox is 0.003px at a
// 26px glyph, invisible at any real size — and strip leading zeros.
const NUM = /-?\d*\.\d+|-?\d+/g;
function minNums(s) {
  return s.replace(NUM, (raw) => {
    let v = Math.round(parseFloat(raw) * 100) / 100;
    if (Object.is(v, -0)) v = 0;
    let out = String(v);
    if (out.startsWith('0.')) out = out.slice(1);
    else if (out.startsWith('-0.')) out = '-' + out.slice(2);
    return out;
  });
}

/* ---------------- tiny tolerant SVG parser ---------------- */
// Twemoji files are machine-generated and regular: flat shape elements,
// one level of <g>, and a <defs><clipPath> preamble on a handful of files.
const TAG_RE = /<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*?)(\/?)>/g;
const ATTR_RE = /([\w:-]+)="([^"]*)"/g;
const SHORT_TAG = { path: 'p', circle: 'c', ellipse: 'e', rect: 'r', polygon: 'y', polyline: 'l', line: 'n' };
// clip paths that clip nothing (the whole 36×36 canvas) — safe to drop.
const NOOP_CLIPS = new Set(['M0 0h36v36H0z', 'M0 0h36v36H0Z']);

function attrs(src) {
  const o = {};
  let m;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(src))) o[m[1]] = m[2];
  return o;
}

/**
 * Parse one Twemoji SVG into { vb, els, clipsUsed, groupCount }.
 * els entries use the packed short-key format; `d`/`pts`/`cl` are still raw
 * strings here (table-ized later). Returns null when the file uses more than
 * one real clip path (one file, maracas — not worth renderer complexity).
 */
function parseSvg(src) {
  const clipDefs = {}; // id -> raw d
  const root = { inherit: {}, list: [] };
  const stack = [root];
  let inDefs = false;
  let clipId = null;
  let m;

  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(src))) {
    const closing = !!m[1];
    const tag = m[2].toLowerCase();
    const a = attrs(m[3] || '');
    if (tag === 'svg') continue;
    if (tag === 'defs') { inDefs = !closing; continue; }
    if (tag === 'clippath') {
      if (!closing) clipId = a.id || 'clip';
      else clipId = null;
      continue;
    }
    if (tag === 'g') {
      if (closing) { stack.pop(); continue; }
      const parent = stack[stack.length - 1];
      const inherit = { ...parent.inherit };
      if (a.fill != null) inherit.fill = a.fill;
      if (a['fill-rule'] != null) inherit.fillRule = a['fill-rule'];
      if (a['clip-rule'] != null) inherit.clipRule = a['clip-rule'];
      if (a['fill-opacity'] != null) inherit.fillOpacity = a['fill-opacity'];
      if (a.opacity != null) inherit.opacity = a.opacity;
      let target = parent.list;
      let clipD = null;
      if (a['clip-path']) {
        const id = (a['clip-path'].match(/url\(#([\w-]+)\)/) || [])[1];
        if (id) {
          // resolved after parse; mark with the id for now
          const node = { t: 'g', clipId: id, z: [] };
          parent.list.push(node);
          target = node.z;
          clipD = node;
        }
      }
      stack.push({ inherit, list: target, clipNode: clipD });
      continue;
    }
    const t = SHORT_TAG[tag];
    if (!t) continue;
    if (inDefs) {
      if (tag === 'path' && a.d && clipId) clipDefs[clipId] = a.d;
      continue;
    }
    const inherit = stack[stack.length - 1].inherit;
    const el = { t };
    if (a.d != null) el.d = a.d;
    if (a.points != null) el.pts = a.points;
    const fill = a.fill ?? inherit.fill;
    if (fill === 'none') el.f = 'none';
    else if (fill && fill !== '#000' && fill !== 'black') el.f = fill;
    put(el, 'fo', a['fill-opacity'] ?? inherit.fillOpacity);
    put(el, 'o', a.opacity ?? inherit.opacity);
    put(el, 'fr', a['fill-rule'] ?? inherit.fillRule);
    put(el, 'cr', a['clip-rule'] ?? inherit.clipRule);
    put(el, 'tf', a.transform);
    if (a.stroke) {
      el.s = a.stroke;
      put(el, 'sw', a['stroke-width']);
      put(el, 'slc', a['stroke-linecap']);
      put(el, 'slj', a['stroke-linejoin']);
    }
    for (const k of ['cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height', 'x1', 'y1', 'x2', 'y2']) {
      if (a[k] != null) el[k] = a[k];
    }
    stack[stack.length - 1].list.push(el);
  }

  // resolve clip ids → d; bail on multi-real-clip files
  const realClips = new Set();
  const resolve = (list) => {
    for (const el of list) {
      if (el.t === 'g') {
        const d = clipDefs[el.clipId];
        const min = d ? minNums(d) : null;
        if (!min || NOOP_CLIPS.has(min)) {
          // no-op clip → flatten children up into this list, in place
          el.t = null; el.flatten = true;
        } else {
          realClips.add(min);
          el.cl = d;
        }
        resolve(el.z);
      }
    }
  };
  resolve(root.list);
  if (realClips.size > 1) return null;

  // physically flatten no-op groups (preserve order)
  const flat = (list) => {
    const out = [];
    for (const el of list) {
      if (el.flatten) { for (const c of el.z) out.push(c); }
      else out.push(el);
    }
    return out;
  };
  const vb = (src.match(/viewBox="([^"]*)"/) || [])[1] || '0 0 36 36';
  return { vb, els: flat(root.list) };
}
function put(el, key, v) { if (v != null) el[key] = v; }

/* ---------------- string table ---------------- */
const P = [];
const PIndex = new Map();
function table(str) {
  const min = minNums(str);
  let i = PIndex.get(min);
  if (i == null) { i = P.length; P.push(min); PIndex.set(min, i); }
  return i;
}
function packEls(els) {
  return els.map((el) => {
    const out = { ...el };
    if (typeof out.d === 'string') out.d = table(out.d);
    if (typeof out.pts === 'string') out.pts = table(out.pts);
    if (typeof out.cl === 'string') out.cl = table(out.cl);
    if (out.z) out.z = packEls(out.z);
    return out;
  });
}

/* ---------------- emojibase ↔ twemoji file matching ---------------- */
function fileFor(hexcode, svgFiles) {
  const parts = hexcode.toLowerCase().split('-');
  // Twemoji filenames drop leading zeros (0023 → 23) and usually drop FE0F.
  const noZeros = parts.map((p) => p.replace(/^0+(?=[0-9a-f])/, ''));
  const candidates = [
    parts.join('-'),
    noZeros.join('-'),
    parts.filter((p) => p !== 'fe0f').join('-'),
    noZeros.filter((p) => p !== 'fe0f').join('-'),
  ];
  for (const c of candidates) {
    const f = `${c}.svg`;
    if (svgFiles.has(f)) return f;
  }
  return null;
}
function charFromFilename(file) {
  const base = file.replace(/\.svg$/, '');
  return base.split('-').map((hs) => String.fromCodePoint(parseInt(hs, 16))).join('');
}
const stripFe0f = (ch) => ch.replace(/️/g, '');

/* emojibase group → picker category */
const GROUP_CATEGORY = {
  0: 'smileys', 1: 'people', 2: 'people', 3: 'nature', 4: 'food',
  5: 'travel', 6: 'activities', 7: 'objects', 8: 'symbols', 9: 'flags',
};

/* ---------------- main ---------------- */
function main() {
  const svgFiles = new Set(fs.readdirSync(SVG_DIR).filter((f) => f.endsWith('.svg')));
  const base = JSON.parse(fs.readFileSync(EMOJIBASE, 'utf8'));

  const E = {};            // canonical char -> {b, z}
  const A = {};            // alias char -> canonical char
  const meta = { v: 2, categories: {}, names: {}, tags: {}, tones: {} };
  const usedFiles = new Set();
  const skipped = [];

  const addEmoji = (char, parsed) => {
    if (E[char]) return false;
    E[char] = { b: parsed.vb, z: packEls(parsed.els) };
    return true;
  };
  const addAlias = (alias, canon) => {
    if (!alias || alias === canon || A[alias] || E[alias]) return;
    A[alias] = canon;
  };

  // type 1 = emoji-presentation, type 0 = legacy text-presentation that now
  // renders as emoji (❤️ ☺️ ✌️ ©️ …) — emojibase keeps both; we need both.
  const entries = base.filter((e) => (e.type === 0 || e.type === 1) && Number.isInteger(e.group));
  for (const entry of entries) {
    const file = fileFor(entry.hexcode, svgFiles);
    if (!file) { skipped.push(`no-file  ${entry.emoji} ${entry.hexcode}`); continue; }
    const src = fs.readFileSync(path.join(SVG_DIR, file), 'utf8');
    const parsed = parseSvg(src);
    if (!parsed) { skipped.push(`multi-clip ${entry.emoji} ${entry.hexcode} (${file})`); continue; }
    usedFiles.add(file);
    if (addEmoji(entry.emoji, parsed)) {
      const cat = GROUP_CATEGORY[entry.group] || 'symbols';
      (meta.categories[cat] = meta.categories[cat] || []).push(entry.emoji);
      meta.names[entry.emoji] = entry.label;
      if (entry.tags?.length) meta.tags[entry.emoji] = entry.tags;
      addAlias(charFromFilename(file), entry.emoji);
      addAlias(stripFe0f(entry.emoji), entry.emoji);
    }
    // skin tones ride along with their base emoji
    if (Array.isArray(entry.skins)) {
      const toneChars = [];
      for (const skin of entry.skins) {
        const sFile = fileFor(skin.hexcode, svgFiles);
        if (!sFile) { skipped.push(`no-file  ${skin.emoji} ${skin.hexcode}`); continue; }
        if (!E[skin.emoji]) {
          const sParsed = parseSvg(fs.readFileSync(path.join(SVG_DIR, sFile), 'utf8'));
          if (!sParsed) { skipped.push(`multi-clip ${skin.emoji} ${skin.hexcode} (${sFile})`); continue; }
          usedFiles.add(sFile);
          addEmoji(skin.emoji, sParsed);
        }
        meta.names[skin.emoji] = skin.label;
        addAlias(charFromFilename(sFile), skin.emoji);
        addAlias(stripFe0f(skin.emoji), skin.emoji);
        toneChars.push(skin.emoji);
      }
      if (toneChars.length === 5) meta.tones[entry.emoji] = toneChars;
    }
  }

  // any leftover svg files are non-RGI extras — include with filename char so
  // old messages containing them still render (aliases only, not pickable).
  let leftovers = 0;
  for (const f of svgFiles) {
    if (usedFiles.has(f)) continue;
    const ch = charFromFilename(f);
    if (E[ch] || A[ch]) continue;
    const parsed = parseSvg(fs.readFileSync(path.join(SVG_DIR, f), 'utf8'));
    if (!parsed) { skipped.push(`multi-clip ${ch} leftover (${f})`); continue; }
    E[ch] = { b: parsed.vb, z: packEls(parsed.els) };
    leftovers++;
    addAlias(stripFe0f(ch), ch);
  }

  // order categories by emojibase `order`
  const orderOf = new Map(base.map((e) => [e.emoji, e.order ?? 99999]));
  for (const cat of Object.keys(meta.categories)) {
    meta.categories[cat].sort((x, y) => (orderOf.get(x) ?? 99999) - (orderOf.get(y) ?? 99999));
  }

  const dataOut = { v: 2, P, A, E };
  const dataJson = JSON.stringify(dataOut);
  const metaJson = JSON.stringify(meta);
  fs.writeFileSync(path.join(OUT_DIR, 'emojiData.json'), dataJson);
  fs.writeFileSync(path.join(OUT_DIR, 'emojiMeta.json'), metaJson);

  console.log(`emoji entries : ${Object.keys(E).length}`);
  console.log(`aliases       : ${Object.keys(A).length}`);
  console.log(`tone bases    : ${Object.keys(meta.tones).length}`);
  console.log(`leftover files: ${leftovers}`);
  console.log(`string table  : ${P.length} unique path/point strings`);
  console.log(`categories    : ${Object.entries(meta.categories).map(([k, v]) => `${k}:${v.length}`).join('  ')}`);
  console.log(`emojiData.json: ${(dataJson.length / 1024 / 1024).toFixed(2)} MB`);
  console.log(`emojiMeta.json: ${(metaJson.length / 1024).toFixed(0)} KB`);
  console.log(`skipped (${skipped.length}):`);
  skipped.forEach((s) => console.log('  ' + s));
}
main();
