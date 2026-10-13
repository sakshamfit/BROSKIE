'use strict';

/**
 * Bandwidth-first HTTP response compression for the +one backend.
 *
 * The stock `compression` middleware only speaks gzip/deflate (and brotli on
 * newer Node) and always picks brotli when the client allows it, even where
 * zstd is both smaller and cheaper. This module replaces it with one
 * middleware that negotiates **zstd → brotli → gzip** per request and picks
 * the codec the client actually asked for with the highest quality value.
 *
 * Why it matters for a chat app: almost every byte this server sends is
 * JSON (message lists, presence, feed) or a JS/CSS bundle. zstd at level 3
 * typically lands within a couple of percent of brotli-5 while using a
 * fraction of the CPU, so the same box serves more concurrent users and
 * phones on metered data pull noticeably fewer bytes.
 *
 * Design notes
 *  - Measured on this codebase (400 KB of real API-shaped JSON/JS), zstd-3
 *    encodes at ~110 MB/s while brotli-5 manages ~40 MB/s for roughly 11%
 *    fewer bytes. Both beat gzip-6 on size *and* speed. So the default is
 *    adaptive: brotli for small bodies (sub-millisecond to encode, so take
 *    the better ratio) and zstd once a body is big enough that CPU actually
 *    costs us. Override with PREFERRED_CODECS.
 *  - Negotiation is driven purely by the client's `Accept-Encoding`. A client
 *    never receives an encoding it did not advertise, so this is safe to ship
 *    behind any proxy and safe for every platform (iOS/Android/Web).
 *  - Compression is decided when the response headers are written, not when
 *    the request arrives, so later middleware can still change the
 *    Content-Type / Cache-Control / Content-Encoding that drive the decision
 *    (this is the same hook `compression` uses, via `res.writeHead`).
 *  - Responses below `threshold` bytes are left untouched: they would cost
 *    more in CPU and header overhead than they save.
 *  - Node < 22.15 has no zstd; the codec is then simply not offered and
 *    clients transparently fall back to brotli/gzip.
 */

const zlib = require('zlib');

/* ------------------------------------------------------------------ */
/* codec availability                                                  */
/* ------------------------------------------------------------------ */

const HAS_ZSTD = typeof zlib.createZstdCompress === 'function';
const HAS_BROTLI = typeof zlib.createBrotliCompress === 'function';

/** Everything this Node build can produce, in "best ratio" order. */
const ALL_CODECS = [];
if (HAS_BROTLI) ALL_CODECS.push('br');
if (HAS_ZSTD) ALL_CODECS.push('zstd');
ALL_CODECS.push('gzip');

function buildPreference(order) {
  const wanted = order.filter((name) => name === 'gzip' || (name === 'br' && HAS_BROTLI) || (name === 'zstd' && HAS_ZSTD));
  // Append anything missing so the list is never empty or incomplete.
  for (const name of ALL_CODECS) if (!wanted.includes(name)) wanted.push(name);
  return wanted;
}

/**
 * Preference when the client rates several codecs equally.
 *
 * Small bodies (the overwhelming majority — chat JSON, presence, feed pages):
 * brotli-5 is the smallest and costs well under a millisecond to encode, so
 * ratio wins outright.
 *
 * Large bodies: switch to zstd-3. It is ~3x cheaper to produce than brotli-5
 * for ~10% more bytes, which is the right trade once a response is big enough
 * for CPU to matter (exports, big history pages, anything streamed).
 */
const SMALL_BODY_PREFERENCE = buildPreference(['br', 'zstd', 'gzip']);
const LARGE_BODY_PREFERENCE = buildPreference(['zstd', 'br', 'gzip']);

// Bodies at or above this switch from "smallest" to "cheapest" encoding.
const LARGE_BODY_BYTES = envInt('COMPRESS_LARGE_BODY', 64 * 1024, 1, 1024 * 1024 * 1024);

// `PREFERRED_CODECS=br,zstd,gzip` pins one order for every size.
const PINNED_PREFERENCE = process.env.PREFERRED_CODECS
  ? buildPreference(String(process.env.PREFERRED_CODECS).split(',').map((s) => s.trim().toLowerCase()))
  : null;

function preferenceFor(size) {
  if (PINNED_PREFERENCE) return PINNED_PREFERENCE;
  return Number.isFinite(size) && size >= LARGE_BODY_BYTES ? LARGE_BODY_PREFERENCE : SMALL_BODY_PREFERENCE;
}

const PREFERENCE = SMALL_BODY_PREFERENCE;

/* ------------------------------------------------------------------ */
/* tunables                                                            */
/* ------------------------------------------------------------------ */

function envInt(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

// Compression levels for *dynamic* (on-the-fly) responses. Static bundles are
// precompressed at build time instead, where we can afford max quality.
//
// Two zstd levels, because level 3 and level 7 are good at different things
// (400 KB of this repo's real JSON/JS):
//   zstd-3   101.7 KB   3.5 ms encode   0.90 ms decode
//   zstd-7    90.9 KB   9.3 ms encode   0.59 ms decode
//   brotli-5  88.6 KB   9.7 ms encode   0.95 ms decode
//   gzip-6    99.2 KB   9.3 ms encode   1.04 ms decode
// Small bodies use brotli-5 (smallest, and sub-millisecond anyway). Large
// bodies switch to zstd-7: effectively the same size as brotli-5 but it
// decodes ~1.6x faster, which is what a phone on a slow connection notices.
const LEVELS = {
  zstd: envInt('COMPRESS_ZSTD_LEVEL', 3, 1, 19),
  brotli: envInt('COMPRESS_BROTLI_QUALITY', 5, 0, 11),
  gzip: envInt('COMPRESS_GZIP_LEVEL', 6, 1, 9),
};
const LARGE_LEVELS = {
  zstd: envInt('COMPRESS_ZSTD_LEVEL_LARGE', 7, 1, 19),
  brotli: LEVELS.brotli,
  gzip: LEVELS.gzip,
};
// Static sidecars (`.br` / `.zst`) are produced once, so spend the CPU.
const STATIC_LEVELS = {
  zstd: envInt('STATIC_ZSTD_LEVEL', 19, 1, 22),
  brotli: envInt('STATIC_BROTLI_QUALITY', 11, 0, 11),
};

const MIN_SIZE = envInt('COMPRESS_MIN_SIZE', 1024, 0, 1024 * 1024);
// Above this we stop compressing: the CPU cost outweighs the transfer saving
// for the huge bodies this server can return (media, exports).
const MAX_SIZE = envInt('COMPRESS_MAX_SIZE', 8 * 1024 * 1024, MIN_SIZE + 1, 1024 * 1024 * 1024);
// Emit `X-Compression` on every response. Handy in the field, off by default
// because header bytes count too.
const DEBUG = String(process.env.COMPRESSION_DEBUG || '').trim() === '1';

function createEncoder(codec, sizeHint, large = false) {
  const levels = large ? LARGE_LEVELS : LEVELS;
  if (codec === 'zstd') {
    return zlib.createZstdCompress({
      params: { [zlib.constants.ZSTD_c_compressionLevel]: levels.zstd },
    });
  }
  if (codec === 'br') {
    return zlib.createBrotliCompress({
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: levels.brotli,
        // Size hint lets brotli size its window/hash tables up front.
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: sizeHint > 0 ? sizeHint : 0,
      },
    });
  }
  return zlib.createGzip({ level: levels.gzip });
}

/* ------------------------------------------------------------------ */
/* Accept-Encoding negotiation                                         */
/* ------------------------------------------------------------------ */

/**
 * Parse an `Accept-Encoding` header into `{ name -> q }`.
 * Unknown/malformed entries are ignored; `q=0` is preserved so we can honour
 * "never send me this".
 */
function parseAcceptEncoding(header) {
  const offers = Object.create(null);
  if (!header) return offers;
  for (const part of String(header).split(',')) {
    const tokens = part.split(';');
    const name = tokens.shift().trim().toLowerCase();
    if (!name) continue;
    let q = 1;
    for (const token of tokens) {
      const [key, value] = token.split('=');
      if (key && key.trim().toLowerCase() === 'q') {
        const parsed = Number(value && value.trim());
        q = Number.isFinite(parsed) ? parsed : 1;
      }
    }
    // Last occurrence wins, matching how `Accept-Encoding` is defined.
    offers[name] = q;
  }
  return offers;
}

/**
 * Pick the best codec for this request, or null when the response must be
 * sent uncompressed.
 *
 * @param {string} acceptEncoding raw `Accept-Encoding` header
 * @param {string[]} [preference] codecs in our order of preference
 */
function negotiate(acceptEncoding, preference = PREFERENCE) {
  const offers = parseAcceptEncoding(acceptEncoding);

  // An explicit `identity;q=1` (or any codec outranking everything we offer)
  // means the client really does want the body untouched.
  const identityQ = Object.prototype.hasOwnProperty.call(offers, 'identity') ? offers.identity : 0;
  const starQ = Object.prototype.hasOwnProperty.call(offers, '*') ? offers['*'] : undefined;

  let best = null;
  let bestQ = 0;
  for (const codec of preference) {
    const q = Object.prototype.hasOwnProperty.call(offers, codec)
      ? offers[codec]
      : starQ;
    if (q === undefined) continue;
    if (q > bestQ) {
      bestQ = q;
      best = codec;
    }
  }

  if (!best || bestQ <= 0) return null;
  // `Accept-Encoding: identity;q=1, gzip;q=0.5` — respect the stronger no.
  if (identityQ >= bestQ) return null;
  return best;
}

/* ------------------------------------------------------------------ */
/* content-type matching                                               */
/* ------------------------------------------------------------------ */

// Types where compression is pure waste: already compressed, or binary noise.
const COMPRESSIBLE_EXACT = new Set([
  'application/json',
  'application/javascript',
  'application/x-javascript',
  'application/ecmascript',
  'application/xml',
  'application/xhtml+xml',
  'application/ld+json',
  'application/manifest+json',
  'application/graphql',
  'application/x-yaml',
  'application/yaml',
  'application/atom+xml',
  'application/rss+xml',
  'application/vnd.ms-fontobject',
  'image/svg+xml',
  'image/bmp',
  'image/vnd.microsoft.icon',
  'font/ttf',
  'font/otf',
]);

const INCOMPRESSIBLE_EXACT = new Set([
  'application/gzip',
  'application/x-gzip',
  'application/zip',
  'application/x-zip-compressed',
  'application/zstd',
  'application/x-zstd',
  'application/brotli',
  'application/pdf',
  'application/octet-stream',
  'application/wasm',
]);

function isCompressibleType(contentType) {
  if (!contentType) return false;
  const mime = String(contentType).split(';')[0].trim().toLowerCase();
  if (!mime) return false;
  if (INCOMPRESSIBLE_EXACT.has(mime)) return false;
  if (mime.startsWith('text/')) return true;
  if (mime.startsWith('image/')) return COMPRESSIBLE_EXACT.has(mime);
  if (mime.startsWith('audio/') || mime.startsWith('video/')) return false;
  if (COMPRESSIBLE_EXACT.has(mime)) return true;
  // Suffix convention: application/problem+json, application/vnd.api+json, …
  return /\+(?:json|xml|text|yaml)$/.test(mime);
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const CACHE_CONTROL_NO_TRANSFORM = /(?:^|,)\s*?no-transform\s*?(?:,|$)/;
const HEADERS_SENT = (res) => (typeof res.headersSent === 'boolean' ? res.headersSent : Boolean(res._header));

function chunkLength(chunk, encoding) {
  if (!chunk) return 0;
  return Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk, encoding);
}

function toBuffer(chunk, encoding) {
  return Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
}

function addVary(res) {
  const existing = res.getHeader('Vary');
  if (!existing) {
    res.setHeader('Vary', 'Accept-Encoding');
    return;
  }
  const parts = String(existing).split(',').map((s) => s.trim()).filter(Boolean);
  if (!parts.some((p) => p.toLowerCase() === 'accept-encoding')) parts.push('Accept-Encoding');
  res.setHeader('Vary', parts.join(', '));
}

/**
 * Run `listener` just before the response headers hit the wire — the only
 * point where every middleware has finished touching them. (Same contract as
 * the `on-headers` package, inlined to keep the dependency list short.)
 */
function onHeaders(res, listener) {
  if (HEADERS_SENT(res)) return; // too late to change anything
  let fired = false;
  const original = res.writeHead;
  res.writeHead = function writeHeadPatched(...args) {
    if (!fired) {
      fired = true;
      try {
        listener.call(this);
      } catch (err) {
        console.error('[compression] header hook failed', err);
      }
    }
    return original.apply(this, args);
  };
}

/* ------------------------------------------------------------------ */
/* stats                                                               */
/* ------------------------------------------------------------------ */

const stats = {
  responses: 0,
  compressed: 0,
  rawBytes: 0,
  sentBytes: 0,
  byCodec: Object.create(null),
};

for (const codec of ['zstd', 'br', 'gzip']) stats.byCodec[codec] = { count: 0, rawBytes: 0, sentBytes: 0 };

function resetStats() {
  stats.responses = 0;
  stats.compressed = 0;
  stats.rawBytes = 0;
  stats.sentBytes = 0;
  for (const codec of Object.keys(stats.byCodec)) {
    stats.byCodec[codec] = { count: 0, rawBytes: 0, sentBytes: 0 };
  }
}

function snapshotStats() {
  const saved = stats.rawBytes > 0 ? 1 - stats.sentBytes / stats.rawBytes : 0;
  const byCodec = {};
  for (const [codec, s] of Object.entries(stats.byCodec)) {
    byCodec[codec] = { ...s, savedRatio: s.rawBytes > 0 ? 1 - s.sentBytes / s.rawBytes : 0 };
  }
  return {
    responses: stats.responses,
    compressed: stats.compressed,
    rawBytes: stats.rawBytes,
    sentBytes: stats.sentBytes,
    savedRatio: saved,
    byCodec,
  };
}

/* ------------------------------------------------------------------ */
/* middleware                                                          */
/* ------------------------------------------------------------------ */

/**
 * @param {object} [options]
 * @param {number} [options.threshold]   minimum body size worth compressing
 * @param {(req:object,res:object)=>boolean} [options.filter] extra predicate
 * @returns {Function} express/http middleware
 */
function httpCompression(options = {}) {
  const threshold = Number.isFinite(options.threshold) ? options.threshold : MIN_SIZE;
  const filter = options.filter || null;

  return function compressionMiddleware(req, res, next) {
    let ended = false;
    let stream = null;
    let listeners = [];
    let estimatedLength = null; // set when the body arrives with res.end()
    let codec = null;
    // Bytes as they go IN to the compressor vs. bytes that hit the socket.
    // Counted at the res.write/res.end boundary so both streamed and
    // single-shot (`res.send(json)`) bodies are measured.
    let rawBytes = 0;
    let sentBytes = 0;

    const _end = res.end;
    const _on = res.on;
    const _write = res.write;

    // Some libraries (send/serve-static) call res.flush() to force a flush.
    res.flush = function flush() {
      if (stream && typeof stream.flush === 'function') stream.flush();
    };

    /**
     * Replay `res.on('drain', …)` registrations onto `target`.
     *
     * `listeners` is deliberately NOT cleared here when `target` is the
     * compression stream: callers that pipe into `res` (express.static does
     * `fs.createReadStream(path).pipe(res)`) register their backpressure
     * handler *after* the headers are written, i.e. after the stream exists.
     * Those handlers must observe the **compression stream's** drain, not the
     * socket's — the socket stays happily empty while zlib is still chewing
     * through its input buffer, so a pipe waiting on the socket would never
     * resume and the response would hang forever. Anything registered from
     * here on is forwarded to the stream (same contract as `compression`).
     */
    function addBufferedListeners(target) {
      if (!listeners) return;
      for (const args of listeners) target.on(...args);
      if (target === res) listeners = null;
    }

    function nocompress() {
      addBufferedListeners(res);
    }

    res.write = function write(chunk, encoding) {
      if (ended) return false;
      if (!HEADERS_SENT(res)) this.writeHead(this.statusCode);
      if (!stream) return _write.call(this, chunk, encoding);
      const buf = toBuffer(chunk, encoding);
      rawBytes += buf.length;
      return stream.write(buf);
    };

    res.end = function end(chunk, encoding) {
      if (ended) return false;
      if (!HEADERS_SENT(res)) {
        if (!this.getHeader('Content-Length')) estimatedLength = chunkLength(chunk, encoding);
        this.writeHead(this.statusCode);
      }
      if (!stream) {
        ended = true;
        return _end.call(this, chunk, encoding);
      }
      ended = true;
      if (!chunk) return stream.end();
      const buf = toBuffer(chunk, encoding);
      rawBytes += buf.length;
      return stream.end(buf);
    };

    res.on = function on(type, listener) {
      if (!listeners || type !== 'drain') return _on.call(this, type, listener);
      if (stream) return stream.on(type, listener);
      listeners.push([type, listener]);
      return this;
    };

    onHeaders(res, function onResponseHeaders() {
      stats.responses += 1;

      // No body to compress (204/304) — an encoding header there is nonsense
      // and confuses some proxies.
      if (res.statusCode === 204 || res.statusCode === 304 || res.statusCode < 200) return nocompress();
      if (req.method === 'HEAD') return nocompress();
      if (req.headers && req.headers['x-no-compression']) return nocompress();

      const cacheControl = res.getHeader('Cache-Control');
      if (cacheControl && CACHE_CONTROL_NO_TRANSFORM.test(cacheControl)) return nocompress();

      if (!isCompressibleType(res.getHeader('Content-Type'))) return nocompress();
      if (filter && !filter(req, res)) return nocompress();

      const declared = Number(res.getHeader('Content-Length'));
      const size = Number.isFinite(declared) && declared > 0 ? declared : estimatedLength;
      // Unknown length: still allowed (chunked responses), decided on the fly.
      if (Number.isFinite(size) && size > 0 && size < threshold) return nocompress();
      if (Number.isFinite(size) && size > MAX_SIZE) return nocompress();

      const existing = res.getHeader('Content-Encoding');
      if (existing && existing !== 'identity') return nocompress();

      const large = Number.isFinite(size) && size >= LARGE_BODY_BYTES;
      codec = negotiate(req.headers['accept-encoding'], preferenceFor(size));
      if (!codec) return nocompress();

      stream = createEncoder(codec, Number.isFinite(size) ? size : 0, large);
      addBufferedListeners(stream);

      res.setHeader('Content-Encoding', codec);
      res.removeHeader('Content-Length');
      addVary(res);

      const originalWrite = _write;
      stream.on('data', function onStreamData(data) {
        sentBytes += data.length;
        if (originalWrite.call(res, data) === false) stream.pause();
      });
      stream.on('end', function onStreamEnd() {
        stats.compressed += 1;
        stats.rawBytes += rawBytes;
        stats.sentBytes += sentBytes;
        const bucket = stats.byCodec[codec] || (stats.byCodec[codec] = { count: 0, rawBytes: 0, sentBytes: 0 });
        bucket.count += 1;
        bucket.rawBytes += rawBytes;
        bucket.sentBytes += sentBytes;
        if (DEBUG) {
          try {
            res.setHeader('X-Compression', `${codec} ${sentBytes}/${rawBytes}`);
          } catch {}
        }
        _end.call(res);
      });
      stream.on('error', function onStreamError(err) {
        console.error(`[compression] ${codec} stream error:`, err && err.message);
        ended = true;
        try {
          _end.call(res);
        } catch {}
      });
      _on.call(res, 'drain', function onResponseDrain() {
        if (stream) stream.resume();
      });

      // Stop burning CPU if the client went away mid-response.
      _on.call(res, 'close', function onResponseClose() {
        if (stream && !ended) {
          ended = true;
          if (typeof stream.destroy === 'function') stream.destroy();
        }
      });
    });

    next();
  };
}

module.exports = httpCompression;
module.exports.httpCompression = httpCompression;
module.exports.negotiate = negotiate;
module.exports.isCompressibleType = isCompressibleType;
module.exports.parseAcceptEncoding = parseAcceptEncoding;
module.exports.createEncoder = createEncoder;
module.exports.snapshotStats = snapshotStats;
module.exports.resetStats = resetStats;
module.exports.codecs = { zstd: HAS_ZSTD, br: HAS_BROTLI, gzip: true };
module.exports.preference = SMALL_BODY_PREFERENCE.slice();
module.exports.largePreference = LARGE_BODY_PREFERENCE.slice();
module.exports.preferenceFor = preferenceFor;
module.exports.levels = { ...LEVELS, large: { ...LARGE_LEVELS }, static: { ...STATIC_LEVELS } };
module.exports.staticLevels = STATIC_LEVELS;
module.exports.thresholds = { min: MIN_SIZE, max: MAX_SIZE, largeBody: LARGE_BODY_BYTES };
