/**
 * Touch-target audit: find tappable elements whose drawn box is smaller than
 * the 44dp minimum Apple's HIG (and Material) recommend, and that do not
 * already widen their hit area with hitSlop.
 *
 * Read-only. Run from app/:  node scripts/audit-touch-targets.js
 */
const fs = require('node:fs');
const path = require('node:path');

const APP = path.resolve(__dirname, '..');
const PRESSABLE = /<(Pressable|TouchableOpacity|SpringPressable)\b([\s\S]*?)>/g;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const report = [];

for (const file of [...walk(path.join(APP, 'src')), path.join(APP, 'App.js')]) {
  const src = fs.readFileSync(file, 'utf8');

  // Map every stylesheet key to its smallest fixed dimension.
  const sizes = {};
  const styleRe = /(\w+):\s*\{([^{}]*)\}/g;
  let sm;
  while ((sm = styleRe.exec(src))) {
    const body = sm[2];
    const dims = [...body.matchAll(/\b(width|height|minWidth|minHeight):\s*(\d+(?:\.\d+)?)/g)]
      .map((m) => Number(m[2]))
      .filter((v) => v > 0);
    if (dims.length) sizes[sm[1]] = Math.min(...dims);
  }

  let m;
  PRESSABLE.lastIndex = 0;
  while ((m = PRESSABLE.exec(src))) {
    const tag = m[0];
    if (/hitSlop/.test(tag)) continue;
    // Which stylesheet keys does this element's style reference?
    const keys = [...tag.matchAll(/\b(?:s|styles)\.(\w+)/g)].map((k) => k[1]);
    const dims = keys.map((k) => sizes[k]).filter((v) => typeof v === 'number');
    // Inline width/height on the tag itself.
    const inline = [...tag.matchAll(/\b(width|height|minWidth|minHeight):\s*(\d+(?:\.\d+)?)/g)]
      .map((k) => Number(k[2])).filter((v) => v > 0);
    const smallest = Math.min(...[...dims, ...inline].filter((v) => Number.isFinite(v)), Infinity);
    if (smallest < 44) {
      report.push({
        file: path.relative(APP, file),
        line: src.slice(0, m.index).split('\n').length,
        component: m[1],
        smallest,
      });
    }
  }
}

for (const r of report) {
  console.log(`${r.file}:${r.line}  <${r.component}>  smallest fixed dimension ${r.smallest}dp (no hitSlop)`);
}
console.log(`\n${report.length} tappable element(s) under 44dp without hitSlop`);
