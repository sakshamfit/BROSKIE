#!/usr/bin/env node
/**
 * One-off codemod: route every <Text> in the app through src/components/Text.js
 * so the app-wide maxFontSizeMultiplier cap applies structurally.
 *
 * Surgical string edits driven by a real AST — no whole-file regeneration, so
 * the diff is limited to (a) dropping `Text` from the react-native import and
 * (b) adding one import line. Run from the app/ directory.
 */
const fs = require('node:fs');
const path = require('node:path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const APP_ROOT = path.resolve(__dirname, '..');
const TEXT_MODULE = path.join(APP_ROOT, 'src', 'components', 'Text.js');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = [...walk(path.join(APP_ROOT, 'src')), path.join(APP_ROOT, 'App.js')];

let changed = 0;
const skipped = [];

for (const file of files) {
  if (path.resolve(file) === path.resolve(TEXT_MODULE)) continue;
  const src = fs.readFileSync(file, 'utf8');

  const ast = parser.parse(src, { sourceType: 'module', plugins: ['jsx'] });

  let usesTextJSX = false;
  let rnImport = null;
  let textSpec = null;
  let anchorEnd = 0; // end of the last import that is NOT the one we rewrite
  let alreadyImportsSharedText = false;

  traverse(ast, {
    JSXOpeningElement(p) {
      const name = p.node.name;
      if (name && name.type === 'JSXIdentifier' && name.name === 'Text') usesTextJSX = true;
    },
    ImportDeclaration(p) {
      const source = p.node.source.value;
      if (source === 'react-native') {
        for (const spec of p.node.specifiers) {
          if (
            spec.type === 'ImportSpecifier' &&
            spec.imported.type === 'Identifier' &&
            spec.imported.name === 'Text' &&
            spec.local.name === 'Text'
          ) {
            rnImport = p.node;
            textSpec = spec;
          }
        }
        return;
      }
      anchorEnd = Math.max(anchorEnd, p.node.end);
      if (/\/Text$/.test(source) || source === './Text') alreadyImportsSharedText = true;
    },
  });

  if (!usesTextJSX) continue;
  const rel = path.relative(APP_ROOT, file);
  if (alreadyImportsSharedText) { skipped.push(`${rel} — already imports the shared Text`); continue; }
  if (!textSpec) { skipped.push(`${rel} — renders <Text> without importing it from react-native`); continue; }

  const edits = [];

  /* 1. drop `Text` from the react-native import specifier list */
  if (rnImport.specifiers.length === 1) {
    let end = rnImport.end;
    while (src[end] === '\r' || src[end] === '\n') end += 1;
    edits.push([rnImport.start, end, '']);
  } else {
    let start = textSpec.start;
    let end = textSpec.end;
    let fwd = end;
    while (/\s/.test(src[fwd])) fwd += 1;
    if (src[fwd] === ',') {
      // "Text," — take the comma and the run of whitespace after it
      end = fwd + 1;
      while (/[ \t]/.test(src[end])) end += 1;
      if (src[end] === '\n') {
        end += 1;
        while (/[ \t]/.test(src[end])) end += 1;
      }
    } else {
      // last specifier — take the comma that precedes it
      let back = start;
      while (/\s/.test(src[back - 1])) back -= 1;
      if (src[back - 1] === ',') start = back - 1;
    }
    edits.push([start, end, '']);
  }

  /* 2. add the shared Text import after the last untouched import */
  let importPath = path.relative(path.dirname(file), TEXT_MODULE).replace(/\\/g, '/').replace(/\.js$/, '');
  if (!importPath.startsWith('.')) importPath = './' + importPath;
  edits.push([anchorEnd, anchorEnd, `\nimport { Text } from '${importPath}';`]);

  edits.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  let out = src;
  for (const [start, end, replacement] of edits) out = out.slice(0, start) + replacement + out.slice(end);

  fs.writeFileSync(file, out);
  changed += 1;
  console.log('  ✓ ' + rel + '  →  ' + importPath);
}

console.log(`\nrewrote ${changed} file(s)`);
if (skipped.length) {
  console.log('skipped:');
  for (const s of skipped) console.log('  - ' + s);
}
