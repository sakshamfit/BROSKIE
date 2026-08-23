/**
 * Resolve a writable DATA_DIR for SQLite, local uploads and backups.
 *
 * Priority:
 *   1. Explicit DATA_DIR env var
 *   2. RAILWAY_VOLUME_MOUNT_PATH (set automatically once a Railway Volume
 *      is attached)
 *   3. server/data for local dev / no-volume deploys
 *
 * Railway volumes are mounted as root. If the process later runs as a
 * non-root user (Dockerfile `USER node`, or Railway's default runtime uid)
 * the existing tomodachi.db is readable but not writable — better-sqlite3
 * then throws SQLITE_READONLY on the first real UPDATE. We chmod what we
 * can and fail with an actionable message if the directory still isn't
 * writable, instead of crashing later inside a branding migration.
 */
const path = require('path');
const fs = require('fs');

const SQLITE_FILES = [
  'tomodachi.db',
  'tomodachi.db-wal',
  'tomodachi.db-shm',
  'tomodachi.db-journal',
];

const usingPersistentVolume = !!(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH);
const onKnownEphemeralHost = !!(process.env.RAILWAY_ENVIRONMENT || process.env.RENDER);

function preferredDataDir() {
  if (process.env.DATA_DIR) return path.resolve(process.env.DATA_DIR);
  if (process.env.RAILWAY_VOLUME_MOUNT_PATH) return path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH);
  return path.join(__dirname, '..', 'data');
}

function tryChmod(target, mode) {
  try {
    fs.chmodSync(target, mode);
    return true;
  } catch {
    return false;
  }
}

function repairSqlitePermissions(dir) {
  tryChmod(dir, 0o777);
  for (const name of SQLITE_FILES) {
    const filePath = path.join(dir, name);
    if (fs.existsSync(filePath)) tryChmod(filePath, 0o666);
  }
}

function dirIsWritable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-probe-${process.pid}-${process.hrtime.bigint()}`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

function readonlyHelp(dir) {
  return (
    `SQLite data directory is not writable: ${dir}. ` +
    `Railway volumes are mounted as root; a non-root process can open tomodachi.db ` +
    `but every write fails with SQLITE_READONLY. ` +
    `Fix: set RAILWAY_RUN_UID=0 on the Railway service (Variables → RAILWAY_RUN_UID=0) ` +
    `and redeploy, or run the container as root long enough to chown the volume. ` +
    `See DEPLOY.md → "Never lose data on deploy".`
  );
}

function resolveDataDir() {
  const dir = preferredDataDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // mkdir may fail on a read-only parent; the writability probe below
    // produces the user-facing error.
  }
  repairSqlitePermissions(dir);
  if (dirIsWritable(dir)) return dir;
  const error = new Error(readonlyHelp(dir));
  error.code = 'SQLITE_READONLY';
  throw error;
}

module.exports = {
  SQLITE_FILES,
  usingPersistentVolume,
  onKnownEphemeralHost,
  preferredDataDir,
  repairSqlitePermissions,
  dirIsWritable,
  readonlyHelp,
  resolveDataDir,
};
