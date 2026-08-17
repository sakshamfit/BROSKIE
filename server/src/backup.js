/**
 * Safety backups — copies the live SQLite database to disk so a bug,
 * accidental wipe or corrupted file never means permanent data loss.
 *
 * - Uses better-sqlite3's online backup API (safe to run while the server
 *   is writing; produces a consistent snapshot).
 * - Backups land in `<DATA_DIR>/backups` by default — i.e. NEXT TO the
 *   live database, so if DATA_DIR points at a persistent volume (Railway
 *   volume / Render disk), the backups survive redeploys too. Override
 *   with BACKUP_DIR if you want them elsewhere.
 * - Old backups are pruned, keeping the newest BACKUP_KEEP (default 20).
 *
 * Run manually:   node src/backup.js
 * Automatic:      the server also backs up every 6h and right before a
 *                 clean shutdown (SIGTERM/SIGINT — e.g. a redeploy).
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const db = require('./db');
const DATA_DIR = db.DATA_DIR;

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(DATA_DIR, 'backups');
const BACKUP_KEEP = Math.max(1, Number(process.env.BACKUP_KEEP || 20));

function backupNow() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .slice(0, 19); // YYYY-MM-DDTHH-MM-SS
  const target = path.join(BACKUP_DIR, `tomodachi-${stamp}.db`);

  return db.backup(target).then(() => {
    // Prune old backups, keep the newest BACKUP_KEEP.
    const files = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith('tomodachi-') && f.endsWith('.db'))
      .sort();
    while (files.length > BACKUP_KEEP) {
      fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
    }
    console.log(`[backup] saved ${target} (${BACKUP_KEEP} kept)`);
    return target;
  });
}

module.exports = { backupNow, BACKUP_DIR };

if (require.main === module) {
  backupNow()
    .then((p) => {
      console.log('Backup OK:', p);
      process.exit(0);
    })
    .catch((e) => {
      console.error('[backup] failed:', e.message);
      process.exit(1);
    });
}
