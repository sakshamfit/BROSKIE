#!/usr/bin/env node
/** Integrity/search/coverage checks for the generated emoji table. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'app', 'src', 'icons', 'emojiData.json');
const META_FILE = path.join(ROOT, 'app', 'src', 'icons', 'emojiMeta.json');
const MODULE_BASE = path.join(ROOT, 'app', 'src', 'icons', 'fluentEmojiAssets');
const ASSET_DIR = path.join(ROOT, 'app', 'assets', 'emoji', 'fluent-3d');
const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const meta = JSON.parse(fs.readFileSync(META_FILE, 'utf8'));

assert.strictEqual(data.v, 3, 'expected packed table v3');
assert.strictEqual(Object.keys(data.E).length, 4009, 'canonical key count changed');
assert.strictEqual(Object.keys(data.A).length, 1344, 'alias key count changed');
assert.ok(Array.isArray(data.P), 'missing fallback path table');

function moduleAssets(filename, extension) {
  const source = fs.readFileSync(filename, 'utf8');
  const pattern = new RegExp(`require\\('\\.\\.\\/\\.\\.\\/assets\\/emoji\\/fluent-3d\\/([^']+)\\.${extension}'\\)`, 'g');
  return { source, names: [...source.matchAll(pattern)].map((match) => match[1]) };
}
const iosModule = moduleAssets(`${MODULE_BASE}.js`, 'png');
const webModule = moduleAssets(`${MODULE_BASE}.web.js`, 'webp');
const androidModule = moduleAssets(`${MODULE_BASE}.android.js`, 'webp');
const assetNames = webModule.names;
assert.strictEqual(assetNames.length, 3145, 'unexpected Fluent asset count');
assert.strictEqual(new Set(assetNames).size, assetNames.length, 'duplicate Fluent asset filename');
assert.deepStrictEqual(iosModule.names, assetNames, 'iOS and web asset order differs');
assert.deepStrictEqual(androidModule.names, assetNames, 'Android and web asset order differs');

function webpSize(buffer) {
  assert.strictEqual(buffer.toString('ascii', 0, 4), 'RIFF', 'asset is not RIFF');
  assert.strictEqual(buffer.toString('ascii', 8, 12), 'WEBP', 'asset is not WebP');
  const kind = buffer.toString('ascii', 12, 16);
  if (kind === 'VP8X') {
    return [buffer.readUIntLE(24, 3) + 1, buffer.readUIntLE(27, 3) + 1];
  }
  if (kind === 'VP8L') {
    const bits = buffer.readUInt32LE(21);
    return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
  }
  if (kind === 'VP8 ') {
    const marker = buffer.indexOf(Buffer.from([0x9d, 0x01, 0x2a]), 20);
    assert.ok(marker >= 0, 'invalid VP8 frame header');
    return [buffer.readUInt16LE(marker + 3) & 0x3fff, buffer.readUInt16LE(marker + 5) & 0x3fff];
  }
  throw new Error(`unsupported WebP chunk ${kind}`);
}

let webpBytes = 0;
let pngBytes = 0;
for (const assetName of assetNames) {
  const webpFile = path.join(ASSET_DIR, `${assetName}.webp`);
  const pngFile = path.join(ASSET_DIR, `${assetName}.png`);
  assert.ok(fs.existsSync(webpFile), `missing Fluent WebP ${assetName}`);
  assert.ok(fs.existsSync(pngFile), `missing Fluent PNG ${assetName}`);
  const webp = fs.readFileSync(webpFile);
  const png = fs.readFileSync(pngFile);
  webpBytes += webp.length;
  pngBytes += png.length;
  const [webpWidth, webpHeight] = webpSize(webp);
  assert.ok(webpWidth > 0 && webpHeight > 0 && webpWidth <= 64 && webpHeight <= 64
    && Math.max(webpWidth, webpHeight) === 64,
  `${assetName}.webp does not fit the 64px asset box (${webpWidth}x${webpHeight})`);
  assert.deepStrictEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10],
    `${assetName}.png is not PNG`);
  const pngWidth = png.readUInt32BE(16);
  const pngHeight = png.readUInt32BE(20);
  assert.ok(pngWidth > 0 && pngHeight > 0 && pngWidth <= 64 && pngHeight <= 64
    && Math.max(pngWidth, pngHeight) === 64,
  `${assetName}.png does not fit the 64px asset box (${pngWidth}x${pngHeight})`);
}

const allowedTypes = new Set(['p', 'c', 'e', 'r', 'y', 'l', 'n', 'g']);
function checkElements(elements, char) {
  assert.ok(Array.isArray(elements) && elements.length, `blank vector fallback ${char}`);
  for (const element of elements) {
    assert.ok(allowedTypes.has(element.t), `unsupported ${element.t} in ${char}`);
    for (const key of ['d', 'pts', 'cl']) {
      if (element[key] != null) {
        assert.ok(Number.isInteger(element[key]), `${char} has non-integer ${key}`);
        assert.ok(typeof data.P[element[key]] === 'string', `${char} has invalid ${key} index`);
      }
    }
    if (element.z) checkElements(element.z, char);
  }
}

let fluentRows = 0;
let fallbackRows = 0;
const imageIndexes = new Set();
for (const [char, entry] of Object.entries(data.E)) {
  if (entry.i != null) {
    assert.deepStrictEqual(Object.keys(entry), ['i'], `${char} has a malformed image row`);
    assert.ok(Number.isInteger(entry.i) && entry.i >= 0 && entry.i < assetNames.length,
      `${char} has an invalid image index`);
    imageIndexes.add(entry.i);
    fluentRows += 1;
  } else {
    assert.strictEqual(typeof entry.b, 'string', `${char} fallback has no viewBox`);
    checkElements(entry.z, char);
    fallbackRows += 1;
  }
}
assert.strictEqual(fluentRows, 3145, 'unexpected Fluent row count');
assert.strictEqual(fallbackRows, 864, 'unexpected fallback row count');
assert.strictEqual(imageIndexes.size, assetNames.length, 'unreferenced or duplicate image indexes');

for (const [alias, canonical] of Object.entries(data.A)) {
  assert.ok(alias && canonical, 'blank alias');
  assert.ok(data.E[canonical], `alias ${alias} targets missing ${canonical}`);
}
const resolve = (char) => data.E[char] || data.E[data.A[char]];
const categoryNames = ['smileys', 'people', 'nature', 'food', 'travel', 'activities', 'objects', 'symbols', 'flags'];
for (const category of categoryNames) {
  const chars = meta.categories[category];
  assert.ok(Array.isArray(chars) && chars.length, `empty picker category ${category}`);
  for (const char of chars) assert.ok(resolve(char), `${category} contains unresolved ${char}`);
}

const query = 'fire';
const allChars = categoryNames.flatMap((category) => meta.categories[category]);
const searchResults = allChars.filter((char) => {
  if ((meta.names[char] || '').toLowerCase().includes(query)) return true;
  return meta.tags?.[char]?.some((tag) => tag.includes(query));
});
assert.ok(searchResults.includes('🔥'), 'picker search no longer finds fire');
assert.ok(data.E['🔥']?.i != null, 'fire is not Fluent 3D');
for (const char of ['😀', '👋', '🍕', '✈️', '⚽️', '💡', '❤️']) {
  assert.ok(data.E[char]?.i != null, `representative ${char} is not Fluent 3D`);
}
for (const char of ['🇮🇳', '🫩']) {
  assert.ok(data.E[char]?.z?.length, `expected exact-missing ${char} to use fallback vector`);
}

const license = fs.readFileSync(path.join(ASSET_DIR, 'LICENSE'), 'utf8');
assert.match(license, /MIT License/);
assert.match(license, /Copyright \(c\) Microsoft Corporation/);
assert.ok(!`${iosModule.source}${webModule.source}${androidModule.source}`.toLowerCase().includes('apple'),
  'unexpected Apple artwork reference');

console.log(JSON.stringify({
  canonical: Object.keys(data.E).length,
  aliases: Object.keys(data.A).length,
  fluentRows,
  fallbackRows,
  fallbackPaths: data.P.length,
  assetsPerPlatform: assetNames.length,
  webpBytes,
  pngBytes,
  searchFire: searchResults.includes('🔥'),
  categories: Object.fromEntries(categoryNames.map((name) => [name, meta.categories[name].length])),
}, null, 2));
