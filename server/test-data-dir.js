/**
 * DATA_DIR resolution + permission repair (the Railway SQLITE_READONLY path).
 *
 * Does not open the live database. Destructive only to its own temp folders.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plusone-data-dir-'));
process.env.DATA_DIR = tmpRoot;

const {
  preferredDataDir,
  repairSqlitePermissions,
  dirIsWritable,
  readonlyHelp,
  resolveDataDir,
  SQLITE_FILES,
} = require('./src/dataDir');

function pass(name) {
  console.log(`  ok  ${name}`);
}

function rmrf(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

let failed = 0;
function check(name, fn) {
  try {
    fn();
    pass(name);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err.message}`);
  }
}

console.log('data-dir');

check('preferredDataDir honors DATA_DIR', () => {
  assert.strictEqual(preferredDataDir(), path.resolve(tmpRoot));
});

check('resolveDataDir creates and returns a writable folder', () => {
  const dir = resolveDataDir();
  assert.strictEqual(dir, path.resolve(tmpRoot));
  assert.ok(fs.existsSync(dir));
  assert.ok(dirIsWritable(dir));
});

check('repairSqlitePermissions makes an owner-readonly db writable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plusone-ro-db-'));
  const dbFile = path.join(dir, 'tomodachi.db');
  fs.writeFileSync(dbFile, 'sqlite');
  fs.chmodSync(dbFile, 0o444);
  fs.chmodSync(dir, 0o555);
  repairSqlitePermissions(dir);
  assert.ok(dirIsWritable(dir), 'directory should be writable after repair');
  fs.writeFileSync(dbFile, 'sqlite-rewritten');
  rmrf(dir);
});

check('dirIsWritable is false for a path we cannot create', () => {
  // /dev/null is a file, so mkdir of a child must fail immediately.
  assert.strictEqual(dirIsWritable(path.join('/dev/null', 'plusone-cannot-write')), false);
});

check('readonlyHelp names the directory and RAILWAY_RUN_UID', () => {
  const text = readonlyHelp('/data');
  assert.match(text, /\/data/);
  assert.match(text, /RAILWAY_RUN_UID=0/);
  assert.match(text, /SQLITE_READONLY/);
});

check('SQLITE_FILES lists the WAL/SHM sidecars Railway must not delete', () => {
  assert.ok(SQLITE_FILES.includes('tomodachi.db'));
  assert.ok(SQLITE_FILES.includes('tomodachi.db-wal'));
  assert.ok(SQLITE_FILES.includes('tomodachi.db-shm'));
});

rmrf(tmpRoot);

if (failed) {
  console.error(`\n${failed} data-dir check(s) failed`);
  process.exit(1);
}
console.log('\nAll data-dir checks passed.');
