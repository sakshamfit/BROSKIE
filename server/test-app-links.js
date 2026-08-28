/**
 * Android App Links (Digital Asset Links) — offline unit tests.
 * Pure-node: no database, no sockets, no network.
 */
const assert = require('assert');
const { DEFAULT_PACKAGE, normalizeFingerprint, assetLinksPayload } = require('./src/appLinks');

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err.message}`);
  }
}

const SHA256_LOWER = 'a1b2c3d4e5f60718'.repeat(4); // 64 hex chars
const SHA256_COLON = SHA256_LOWER.toUpperCase().match(/.{2}/g).join(':');
const SHA256_BARE = SHA256_LOWER;

console.log('app-links');

check('normalizeFingerprint: colon-form stays uppercase colon-separated', () => {
  assert.strictEqual(normalizeFingerprint(SHA256_COLON), SHA256_COLON);
});

check('normalizeFingerprint: accepts bare hex', () => {
  assert.strictEqual(normalizeFingerprint(SHA256_BARE), SHA256_COLON);
});

check('normalizeFingerprint: accepts space/dash separators', () => {
  assert.strictEqual(normalizeFingerprint(SHA256_COLON.replace(/:/g, ' ')), SHA256_COLON);
  assert.strictEqual(normalizeFingerprint(SHA256_COLON.replace(/:/g, '-')), SHA256_COLON);
});

check('normalizeFingerprint: rejects empty / whitespace', () => {
  assert.strictEqual(normalizeFingerprint(''), null);
  assert.strictEqual(normalizeFingerprint('   '), null);
  assert.strictEqual(normalizeFingerprint(undefined), null);
});

check('normalizeFingerprint: rejects non-SHA256 lengths', () => {
  assert.strictEqual(normalizeFingerprint('AA:BB:CC'), null);
  assert.strictEqual(normalizeFingerprint('zz'.repeat(32)), null); // 64 chars, not hex
  assert.strictEqual(normalizeFingerprint('a'.repeat(63)), null);
});

check('assetLinksPayload: defaults package name', () => {
  const { packageName, payload } = assetLinksPayload({ fingerprint: 'aa'.repeat(32) });
  assert.strictEqual(packageName, DEFAULT_PACKAGE);
  assert.strictEqual(payload[0].target.package_name, DEFAULT_PACKAGE);
});

check('assetLinksPayload: honors ANDROID_PACKAGE_NAME', () => {
  const { payload } = assetLinksPayload({ packageName: 'com.example.app', fingerprint: 'aa'.repeat(32) });
  assert.strictEqual(payload[0].target.package_name, 'com.example.app');
});

check('assetLinksPayload: emits canonical Digital Asset Links shape', () => {
  const { payload } = assetLinksPayload({ fingerprint: 'aa'.repeat(32) });
  assert.deepStrictEqual(payload[0].relation, ['delegate_permission/common.handle_all_urls']);
  assert.deepStrictEqual(payload[0].target, {
    namespace: 'android_app',
    package_name: DEFAULT_PACKAGE,
    sha256_cert_fingerprints: ['AA:'.repeat(31) + 'AA'],
  });
});

check('assetLinksPayload: payload is an ARRAY (Google rejects objects)', () => {
  const { payload } = assetLinksPayload({ fingerprint: 'aa'.repeat(32) });
  assert.ok(Array.isArray(payload));
});

check('assetLinksPayload: null payload when fingerprint unset/invalid', () => {
  const none = assetLinksPayload({});
  assert.strictEqual(none.payload, null);
  assert.strictEqual(none.fingerprint, null);
  const bad = assetLinksPayload({ fingerprint: 'not-a-fingerprint' });
  assert.strictEqual(bad.payload, null);
  assert.strictEqual(bad.fingerprint, null);
});

console.log(`\n${failed === 0 ? 'ALL PASS' : 'FAILURES'} — app-links tests`);
process.exit(failed === 0 ? 0 : 1);
