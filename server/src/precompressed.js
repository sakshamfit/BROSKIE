'use strict';

/**
 * Serves build-time precompressed sidecars (`.zst` / `.br`) that sit next to
 * the original files in the web bundle.
 *
 * Compressing the JS/CSS bundles on every request wastes CPU for bytes that
 * never change, and forces a low compression level to keep latency down.
 * `scripts/precompress.mjs` instead compresses them once at build time with
 * brotli quality 11 and zstd level 19 — the smallest result either codec can
 * produce — and this middleware hands those bytes straight to the socket with
 * zero CPU cost per request.
 *
 * Mount it *before* `express.static(root)` so it wins when a sidecar for the
 * client's preferred codec exists; otherwise it simply calls `next()` and the
 * normal static handler plus the on-the-fly compression middleware take over.
 */

const fs = require('fs');
const path = require('path');

const { negotiate, codecs } = require('./httpCompression');

/**
 * Which sidecar to serve when both exist.
 *
 * Both are written at maximum quality (brotli-11, zstd-19) and both are only
 * a few percent of the original, so this is a small decision — but it is not
 * a fixed one: brotli-11 won by ~12% on a minified-style bundle here, while
 * zstd-19 won by ~37% on a long-range-repetitive one. Brotli is served first
 * because it is the more consistently compact codec for real web bundles.
 *
 * `scripts/precompress.mjs` prints both sizes for every file it compresses,
 * so if your bundle favours zstd, flip it:
 *   STATIC_PREFERRED_CODECS=zstd,br
 */
function staticPreference() {
  const pinned = process.env.STATIC_PREFERRED_CODECS;
  const order = pinned
    ? String(pinned).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    : ['br', 'zstd'];
  const available = order.filter((name) => codecs[name] && SIDECAR_EXT[name]);
  for (const name of ['zstd', 'br']) {
    if (!available.includes(name) && codecs[name] && SIDECAR_EXT[name]) available.push(name);
  }
  return available;
}

/** Codec -> sidecar extension. gzip is intentionally absent: it is always
 *  beaten by brotli/zstd, so we never store a third copy of every bundle. */
const SIDECAR_EXT = { zstd: '.zst', br: '.br' };

/** Extension -> Content-Type. The sidecar's own extension (.br/.zst) says
 *  nothing about the payload, so the type is derived from the ORIGINAL file. */
const TYPES = {
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.cjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
};

function contentTypeFor(filePath) {
  return TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

/**
 * @param {string} root absolute directory that also holds the original files
 * @param {object} [options]
 * @param {(filePath:string)=>void} [options.setHeaders] extra headers, called
 *        with the *original* (uncompressed) file path
 */
function servePrecompressed(root, options = {}) {
  const resolvedRoot = path.resolve(root);
  const setHeaders = options.setHeaders || null;

  return function precompressedMiddleware(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    let decoded;
    try {
      decoded = decodeURIComponent((req.path || '/').split('?')[0]);
    } catch {
      return next();
    }
    if (decoded.includes('\0')) return next();

    // Resolve inside root and refuse anything that escapes it.
    const filePath = path.resolve(resolvedRoot, `.${path.posix.normalize(decoded)}`);
    if (filePath !== resolvedRoot && !filePath.startsWith(resolvedRoot + path.sep)) return next();

    // Only the codecs we actually precompress; gzip is generated on the fly.
    // negotiate() honours q-values and our own codec availability, so a client
    // that only speaks gzip simply falls through to the on-the-fly path.
    const wanted = negotiate(req.headers['accept-encoding'], staticPreference());
    const codec = wanted && codecs[wanted] && SIDECAR_EXT[wanted] ? wanted : null;
    if (!codec) return next();

    const sidecar = filePath + SIDECAR_EXT[codec];
    let sourceStat;
    let sidecarStat;
    try {
      sourceStat = fs.statSync(filePath, { throwIfNoEntry: false });
      sidecarStat = fs.statSync(sidecar, { throwIfNoEntry: false });
    } catch {
      return next();
    }
    // Missing original (we never serve a sidecar on its own) or missing/stale
    // sidecar -> let the normal handlers deal with it.
    if (!sourceStat || !sourceStat.isFile()) return next();
    if (!sidecarStat || !sidecarStat.isFile()) return next();
    if (sidecarStat.mtimeMs < sourceStat.mtimeMs) return next();

    if (setHeaders) {
      try {
        setHeaders(res, filePath);
      } catch (err) {
        console.error('[precompressed] setHeaders failed', err);
      }
    }

    if (res.getHeader('Content-Encoding')) return next(); // already claimed
    res.setHeader('Content-Encoding', codec);
    res.setHeader('Content-Type', contentTypeFor(filePath));

    const existingVary = res.getHeader('Vary');
    if (!existingVary) res.setHeader('Vary', 'Accept-Encoding');
    else if (!String(existingVary).toLowerCase().includes('accept-encoding')) {
      res.setHeader('Vary', `${existingVary}, Accept-Encoding`);
    }

    res.sendFile(sidecar, (err) => {
      if (err) next(err);
    });
  };
}

module.exports = servePrecompressed;
module.exports.contentTypeFor = contentTypeFor;
module.exports.SIDECAR_EXT = SIDECAR_EXT;
module.exports.staticPreference = staticPreference;
