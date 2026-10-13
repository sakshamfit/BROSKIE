#!/usr/bin/env node
/*
 * Precompress a built web bundle into `.br` and `.zst` sidecars.
 *
 *   node scripts/precompress.mjs <dir> [--prune] [--quiet]
 *
 * Compressing the JS/CSS bundles per request wastes CPU for bytes that never
 * change, and forces a low compression level to keep time-to-first-byte down.
 * This does it once, at build time, at the highest level each codec offers
 * (brotli quality 11, zstd level 19) — the smallest payload either codec can
 * produce, served with zero per-request CPU by server/src/precompressed.js.
 *
 * The original files are left untouched, so hosts that do their own edge
 * compression (Vercel, Cloudflare) are unaffected — they just never see the
 * sidecars unless a server that understands them is serving the directory.
 *
 * Options
 *   --prune                delete sidecars whose source file is gone
 *   --quiet                only print the final summary line
 *   --zstd-level <n>       zstd level (default 19)
 *   --brotli-quality <n>   brotli quality (default 11)
 *   --min-size <bytes>     skip tiny files (default 512)
 *   --jobs <n>             parallel files (default 4)
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

const HAS_ZSTD = typeof zlib.zstdCompress === 'function';
const HAS_BROTLI = typeof zlib.brotliCompress === 'function';

/* ------------------------------------------------------------------ */
/* arguments                                                           */
/* ------------------------------------------------------------------ */

const argv = process.argv.slice(2);
const flags = {
  dir: null,
  prune: false,
  quiet: false,
  zstdLevel: 19,
  brotliQuality: 11,
  minSize: 512,
  jobs: 4,
};

for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === '--prune') flags.prune = true;
  else if (arg === '--quiet') flags.quiet = true;
  else if (arg === '--zstd-level') flags.zstdLevel = Number(argv[++i]);
  else if (arg === '--brotli-quality') flags.brotliQuality = Number(argv[++i]);
  else if (arg === '--min-size') flags.minSize = Number(argv[++i]);
  else if (arg === '--jobs') flags.jobs = Number(argv[++i]);
  else if (arg === '--help' || arg === '-h') {
    console.log('Usage: node scripts/precompress.mjs <dir> [--prune] [--quiet] [--zstd-level n] [--brotli-quality n] [--min-size n] [--jobs n]');
    process.exit(0);
  } else if (!arg.startsWith('-')) flags.dir = arg;
}

if (!flags.dir) {
  console.error('precompress: no directory given');
  process.exit(1);
}

const ROOT = path.resolve(flags.dir);
if (!fs.existsSync(ROOT) || !fs.statSync(ROOT).isDirectory()) {
  console.error(`precompress: "${ROOT}" is not a directory`);
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* what to compress                                                    */
/* ------------------------------------------------------------------ */

// Text-ish payloads only. Images/audio/video/woff2 are already compressed —
// recompressing them wastes build time and can even make them bigger.
const COMPRESSIBLE_EXT = new Set([
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx',
  '.css',
  '.html', '.htm',
  '.json', '.map', '.webmanifest',
  '.xml', '.txt', '.md',
  '.svg',
  '.ttf', '.otf', '.eot',
]);

const pct = (n) => `${n.toFixed(1)}%`;
function kb(n) {
  if (n < 1024) return `${n} B`;
  if (n < 100 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(2)} MB`;
}

function compressBrotli(buf) {
  return zlib.brotliCompressSync(buf, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: flags.brotliQuality,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
    },
  });
}

function compressZstd(buf) {
  return zlib.zstdCompressSync(buf, {
    params: {
      [zlib.constants.ZSTD_c_compressionLevel]: flags.zstdLevel,
    },
  });
}

/** True when every codec we can produce already has a fresh sidecar. */
function isFresh(sourcePath, sourceMtimeMs) {
  const checks = [];
  if (HAS_BROTLI) checks.push(`${sourcePath}.br`);
  if (HAS_ZSTD) checks.push(`${sourcePath}.zst`);
  if (checks.length === 0) return true;
  for (const sidecar of checks) {
    const stat = fs.statSync(sidecar, { throwIfNoEntry: false });
    if (!stat || stat.mtimeMs <= sourceMtimeMs) return false;
  }
  return true;
}

async function walk(dir) {
  const files = [];
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      files.push(...(await walk(full)));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

async function pool(items, limit, worker) {
  const queue = items.slice();
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (;;) {
      const item = queue.shift();
      if (item === undefined) return;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

const summary = {
  files: 0,
  skipped: 0,
  rewritten: 0,
  upToDate: 0,
  rawTotal: 0,
  brTotal: 0,
  zstTotal: 0,
  bytesSaved: 0,
  rows: [],
};

const allFiles = await walk(ROOT);

// `--prune`: drop sidecars whose source disappeared (e.g. after a rebuild that
// renamed hashed bundles), so the directory never accumulates dead weight.
if (flags.prune) {
  let removed = 0;
  for (const file of allFiles) {
    if (!file.endsWith('.br') && !file.endsWith('.zst')) continue;
    const source = file.replace(/\.(br|zst)$/, '');
    if (!fs.existsSync(source)) {
      await fsp.rm(file, { force: true });
      removed += 1;
    }
  }
  if (removed && !flags.quiet) console.log(`precompress: pruned ${removed} orphaned sidecar(s)`);
}

const targets = allFiles.filter((file) => {
  const ext = path.extname(file).toLowerCase();
  return COMPRESSIBLE_EXT.has(ext);
});

await pool(targets, Math.max(1, flags.jobs), async (file) => {
  let stat;
  let buf;
  try {
    stat = await fsp.stat(file);
    if (stat.size < flags.minSize) {
      summary.skipped += 1;
      return;
    }
    if (isFresh(file, stat.mtimeMs)) {
      summary.upToDate += 1;
      return;
    }
    buf = await fsp.readFile(file);
  } catch (err) {
    console.warn(`precompress: skipping ${path.relative(ROOT, file)} — ${err.message}`);
    summary.skipped += 1;
    return;
  }

  let br = null;
  let zst = null;
  if (HAS_BROTLI) {
    try {
      br = compressBrotli(buf);
      await fsp.writeFile(`${file}.br`, br);
    } catch (err) {
      console.warn(`precompress: brotli failed for ${path.relative(ROOT, file)} — ${err.message}`);
    }
  }
  if (HAS_ZSTD) {
    try {
      zst = compressZstd(buf);
      await fsp.writeFile(`${file}.zst`, zst);
    } catch (err) {
      console.warn(`precompress: zstd failed for ${path.relative(ROOT, file)} — ${err.message}`);
    }
  }

  if (!br && !zst) {
    summary.skipped += 1;
    return;
  }

  // Bigger than the original? Keep the smaller one only, so a pathological
  // file never costs the client bytes.
  const bestSize = Math.min(br ? br.length : Infinity, zst ? zst.length : Infinity, buf.length);
  if (br && br.length > buf.length) await fsp.rm(`${file}.br`, { force: true });
  if (zst && zst.length > buf.length) await fsp.rm(`${file}.zst`, { force: true });

  summary.files += 1;
  summary.rewritten += 1;
  summary.rawTotal += buf.length;
  summary.brTotal += br ? br.length : buf.length;
  summary.zstTotal += zst ? zst.length : buf.length;
  summary.bytesSaved += buf.length - bestSize;

  const rel = path.relative(ROOT, file);
  if (!flags.quiet && buf.length >= 8 * 1024) {
    const brTxt = br ? kb(br.length) : '—';
    const zstTxt = zst ? kb(zst.length) : '—';
    console.log(
      `  ${rel.padEnd(46)} ${kb(buf.length).padStart(10)}  br ${brTxt.padStart(10)}  zstd ${zstTxt.padStart(10)}`
    );
  }
  summary.rows.push({ file: rel, raw: buf.length, br: br ? br.length : null, zst: zst ? zst.length : null });
});

if (!HAS_ZSTD) {
  console.warn('precompress: this Node build has no zstd support (needs >= 22.15) — writing brotli sidecars only');
}
if (!HAS_BROTLI) {
  console.warn('precompress: this Node build has no brotli support — writing zstd sidecars only');
}

const avgBr = summary.rawTotal ? 1 - summary.brTotal / summary.rawTotal : 0;
const avgZst = summary.rawTotal ? 1 - summary.zstTotal / summary.rawTotal : 0;
const rel = path.relative(process.cwd(), ROOT);
const label = rel && !rel.startsWith('..') ? rel : ROOT;
console.log(
  `precompress: ${label} — ${summary.rewritten} compressed, ${summary.upToDate} up to date, ${summary.skipped} skipped` +
    ` (brotli −${pct(avgBr * 100)}, zstd −${pct(avgZst * 100)}, ${kb(summary.bytesSaved)} saved on first load)`
);
