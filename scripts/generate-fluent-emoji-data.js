#!/usr/bin/env node
/**
 * Replace the packed Twemoji rows in emojiData.json with Microsoft Fluent
 * Emoji 3D image assets while preserving every canonical key and alias.
 *
 * Fluent's official 3D style is distributed as 256px PNG files (the SVGs in
 * the repository are different Color/Flat styles). This script creates small,
 * transparent 64px assets and changes matching rows from { b, z } vector
 * records to { i } image records. Rows without an exact Fluent sequence remain
 * as compacted Twemoji vectors, so no supported emoji becomes blank.
 *
 * Generated platform modules use static require() calls: quality-90 WebP on
 * web/Android and 256-colour PNG on iOS (React Native supports WebP on Android
 * only). Metro packages the compatible format for each target, while browsers
 * request only images that are actually rendered.
 *
 * Usage:
 *   git clone --depth 1 https://github.com/microsoft/fluentui-emoji.git /tmp/fluentui-emoji
 *   node scripts/generate-fluent-emoji-data.js \
 *     --fluent /tmp/fluentui-emoji \
 *     --revision "$(git -C /tmp/fluentui-emoji rev-parse HEAD)"
 *
 * Requirements: ImageMagick's `convert` executable.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
}

const ROOT = path.resolve(__dirname, '..');
const FLUENT_ROOT = path.resolve(arg('fluent') || '');
const FLUENT_ASSETS = path.join(FLUENT_ROOT, 'assets');
const FLUENT_LICENSE = path.join(FLUENT_ROOT, 'LICENSE');
const DATA_FILE = path.join(ROOT, 'app', 'src', 'icons', 'emojiData.json');
const ASSET_DIR = path.join(ROOT, 'app', 'assets', 'emoji', 'fluent-3d');
const ASSET_MODULE_BASE = path.join(ROOT, 'app', 'src', 'icons', 'fluentEmojiAssets');
const REVISION = arg('revision') || 'unknown';
const IMAGE_SIZE = Number(arg('size') || 64);
const WEBP_QUALITY = Number(arg('quality') || 90);

if (!fs.existsSync(FLUENT_ASSETS) || !fs.existsSync(FLUENT_LICENSE)) {
  console.error('missing --fluent <microsoft/fluentui-emoji checkout>');
  process.exit(1);
}
if (!Number.isInteger(IMAGE_SIZE) || IMAGE_SIZE < 32 || IMAGE_SIZE > 256) {
  console.error('--size must be an integer from 32 to 256');
  process.exit(1);
}
if (!Number.isInteger(WEBP_QUALITY) || WEBP_QUALITY < 1 || WEBP_QUALITY > 100) {
  console.error('--quality must be an integer from 1 to 100');
  process.exit(1);
}
const convertCheck = spawnSync('convert', ['-version'], { encoding: 'utf8' });
if (convertCheck.status !== 0) {
  console.error('ImageMagick `convert` is required');
  process.exit(1);
}

const stripFe0f = (value) => value.replace(/\uFE0F/g, '');
const charFromUnicode = (unicode) => unicode
  .trim()
  .split(/\s+/)
  .map((hex) => String.fromCodePoint(parseInt(hex, 16)))
  .join('');
const codepointName = (char) => Array.from(char)
  .map((value) => value.codePointAt(0).toString(16))
  .join('-');

function walk(dir, visit) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file, visit);
    else visit(file);
  }
}

const TONE_FOLDER = {
  '1f3fb': 'light',
  '1f3fc': 'medium-light',
  '1f3fd': 'medium',
  '1f3fe': 'medium-dark',
  '1f3ff': 'dark',
};

function imageForSequence(files, unicode) {
  const parts = unicode.toLowerCase().split(/\s+/);
  const tone = parts.map((part) => TONE_FOLDER[part]).find(Boolean) || 'default';
  if (files.length === 1) return files[0];
  const suffix = `_3d_${tone}.png`;
  return files.find((file) => file.toLowerCase().endsWith(suffix)) || null;
}

function loadFluentIndex() {
  const exact = new Map();
  const normalized = new Map();
  const metadataFiles = [];
  for (const entry of fs.readdirSync(FLUENT_ASSETS, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const metadata = path.join(FLUENT_ASSETS, entry.name, 'metadata.json');
      if (fs.existsSync(metadata)) metadataFiles.push(metadata);
    }
  }

  for (const metadataFile of metadataFiles) {
    const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
    const emojiDir = path.dirname(metadataFile);
    const images = [];
    walk(emojiDir, (file) => {
      if (file.toLowerCase().endsWith('.png') && file.split(path.sep).includes('3D')) {
        images.push(file);
      }
    });
    if (!images.length) continue;

    const sequences = metadata.unicodeSkintones?.length
      ? metadata.unicodeSkintones
      : [metadata.unicode];
    for (const unicode of sequences) {
      const image = imageForSequence(images, unicode);
      if (!image) {
        throw new Error(`No exact 3D image for ${unicode} in ${emojiDir}`);
      }
      const char = charFromUnicode(unicode);
      const record = { char, image, unicode, metadataFile };
      exact.set(char, record);
      const key = stripFe0f(char);
      const previous = normalized.get(key);
      if (previous && previous.image !== image) {
        throw new Error(`Conflicting FE0F-normalized Fluent rows for ${unicode}`);
      }
      normalized.set(key, record);
    }
  }
  return { exact, normalized, metadataCount: metadataFiles.length };
}

function compactFallbackEntry(entry, oldPaths, paths, pathIndexes) {
  const table = (oldIndex) => {
    const value = oldPaths[oldIndex];
    if (typeof value !== 'string') throw new Error(`Invalid old path index ${oldIndex}`);
    let next = pathIndexes.get(value);
    if (next == null) {
      next = paths.length;
      paths.push(value);
      pathIndexes.set(value, next);
    }
    return next;
  };
  const compactElements = (elements) => elements.map((element) => {
    const next = { ...element };
    if (next.d != null) next.d = table(next.d);
    if (next.pts != null) next.pts = table(next.pts);
    if (next.cl != null) next.cl = table(next.cl);
    if (next.z) next.z = compactElements(next.z);
    return next;
  });
  return { b: entry.b, z: compactElements(entry.z) };
}

function convertImage(source, webpDestination, pngDestination) {
  const result = spawnSync('convert', [
    source,
    '-filter', 'Lanczos',
    '-resize', `${IMAGE_SIZE}x${IMAGE_SIZE}`,
    '-strip',
    // Keep a palette PNG clone for iOS before encoding the web/Android image.
    '(', '+clone', '-colors', '256', '-write', `PNG8:${pngDestination}`, '+delete', ')',
    '-quality', String(WEBP_QUALITY),
    '-define', 'webp:method=6',
    '-define', 'webp:alpha-quality=100',
    webpDestination,
  ], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`Image conversion failed for ${source}: ${result.stderr || result.stdout}`);
  }
}

function writeAssetModule(filename, assetNames, extension, platform) {
  const moduleLines = [
    '/**',
    ` * Generated Microsoft Fluent Emoji 3D assets for ${platform}.`,
    ` * Upstream revision: ${REVISION}`,
    ` * ${IMAGE_SIZE}px ${extension.toUpperCase()}. MIT license: ../../assets/emoji/fluent-3d/LICENSE`,
    ' * Regenerate with scripts/generate-fluent-emoji-data.js; do not edit.',
    ' */',
    'const FLUENT_3D_ASSETS = [',
    ...assetNames.map((assetName) => `  require('../../assets/emoji/fluent-3d/${assetName}.${extension}'),`),
    '];',
    '',
    'export default FLUENT_3D_ASSETS;',
    '',
  ];
  fs.writeFileSync(filename, moduleLines.join('\n'));
}

function main() {
  const oldData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (!oldData.P || !oldData.E || !oldData.A) {
    throw new Error('emojiData.json is not a packed vector table');
  }
  const oldKeys = Object.keys(oldData.E);
  const oldAliases = Object.keys(oldData.A);
  const fluent = loadFluentIndex();

  fs.rmSync(ASSET_DIR, { recursive: true, force: true });
  fs.mkdirSync(ASSET_DIR, { recursive: true });
  fs.copyFileSync(FLUENT_LICENSE, path.join(ASSET_DIR, 'LICENSE'));

  const paths = [];
  const pathIndexes = new Map();
  const entries = {};
  const assetNames = [];
  const fallback = [];
  let webpBytes = 0;
  let pngBytes = 0;

  for (const char of oldKeys) {
    const match = fluent.exact.get(char) || fluent.normalized.get(stripFe0f(char));
    if (!match) {
      entries[char] = compactFallbackEntry(oldData.E[char], oldData.P, paths, pathIndexes);
      fallback.push(char);
      continue;
    }

    const index = assetNames.length;
    const assetName = `${String(index).padStart(4, '0')}-${codepointName(char)}`;
    const webpDestination = path.join(ASSET_DIR, `${assetName}.webp`);
    const pngDestination = path.join(ASSET_DIR, `${assetName}.png`);
    convertImage(match.image, webpDestination, pngDestination);
    webpBytes += fs.statSync(webpDestination).size;
    pngBytes += fs.statSync(pngDestination).size;
    entries[char] = { i: index };
    assetNames.push(assetName);
    if ((index + 1) % 250 === 0) process.stdout.write(`converted ${index + 1}\r`);
  }
  if (assetNames.length >= 250) process.stdout.write('\n');

  const data = { v: 3, P: paths, A: oldData.A, E: entries };
  const dataJson = JSON.stringify(data);
  fs.writeFileSync(DATA_FILE, dataJson);

  // The generic module is the iOS-safe fallback. Metro selects the smaller
  // WebP module for web and Android through its normal platform resolution.
  writeAssetModule(`${ASSET_MODULE_BASE}.js`, assetNames, 'png', 'iOS/native fallback');
  writeAssetModule(`${ASSET_MODULE_BASE}.web.js`, assetNames, 'webp', 'web');
  writeAssetModule(`${ASSET_MODULE_BASE}.android.js`, assetNames, 'webp', 'Android');

  // Guard the hard constraint in the generator itself.
  if (Object.keys(data.E).join('\0') !== oldKeys.join('\0')) {
    throw new Error('Canonical emoji keys changed during generation');
  }
  if (Object.keys(data.A).join('\0') !== oldAliases.join('\0')) {
    throw new Error('Emoji alias keys changed during generation');
  }

  console.log(`Fluent metadata : ${fluent.metadataCount}`);
  console.log(`canonical keys  : ${oldKeys.length} (preserved)`);
  console.log(`aliases         : ${oldAliases.length} (preserved)`);
  console.log(`Fluent 3D rows  : ${assetNames.length}`);
  console.log(`Twemoji fallback: ${fallback.length}`);
  console.log(`fallback paths  : ${paths.length}`);
  console.log(`WebP assets     : ${(webpBytes / 1024 / 1024).toFixed(2)} MB (web/Android)`);
  console.log(`PNG assets      : ${(pngBytes / 1024 / 1024).toFixed(2)} MB (iOS)`);
  console.log(`emojiData.json  : ${(Buffer.byteLength(dataJson) / 1024 / 1024).toFixed(2)} MB`);
  console.log(`fallback chars  : ${fallback.join(' ')}`);
}

main();
