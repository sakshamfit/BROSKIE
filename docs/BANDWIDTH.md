# Bandwidth & throughput: zstd + brotli

How the +one backend keeps the app fast on slow connections and light on
metered data. Everything here is measured by `server/test-compression.js`
(`npm run test:compression`), which runs offline and needs no database.

## TL;DR

| Layer | Before (gzip) | After | Saving |
|---|---|---|---|
| Web bundle — 335 KB JS | 59.5 KB | **13.9 KB** pre-built brotli | **−77%** vs gzip, −96% vs raw |
| API JSON — 62 KB chat page | 3.4 KB | **1.8 KB** brotli | **−47%** vs gzip, −97% vs raw |
| Realtime frame — 18.6 KB chat batch | *(uncompressed)* 18.6 KB | **5.6 KB** permessage-deflate | **−70%** |
| Images / audio / video / uploads | untouched | untouched | 0% (already compressed) |

Every number above is printed by `npm run test:compression` on your own
machine — the suite ends with this table, so the figures never go stale.
(For reference, the old bundle comment claimed "1.4 MB → 380 KB"; gzip-6 was
the only codec in play, and even against that bar brotli is a further −77%.)

The old stack was `compression({ threshold: 1024 })` — **gzip only, brotli
never used**, and no compression at all on Socket.IO. gzip is the weakest of
the three codecs on both size and speed, so switching codecs was the single
biggest available win.

## The three layers

### 1. Live response compression — `server/src/httpCompression.js`

Replaces the `compression` package with one middleware that negotiates
**zstd → brotli → gzip** per request.

- **Only ever sends an encoding the client advertised.** Negotiation is driven
  purely by `Accept-Encoding` and honours `q` values, `*` and an explicit
  `identity` preference. A client that only speaks gzip still gets gzip, so
  this is safe for every platform and behind any proxy.
- **Adaptive codec choice**, because the two modern codecs win at different
  things (measured on 400 KB of this repo's real JSON/JS):

  | codec | size | encode | decode |
  |---|---|---|---|
  | gzip-6 | 99.2 KB | 9.3 ms (41 MB/s) | 1.04 ms |
  | zstd-3 | 101.7 KB | **3.5 ms (110 MB/s)** | 0.90 ms |
  | zstd-7 | 90.9 KB | 9.3 ms (41 MB/s) | **0.59 ms** |
  | brotli-5 | **88.6 KB** | 9.7 ms (40 MB/s) | 0.95 ms |

  So bodies **under 64 KB** use brotli-5 — the smallest, and its built-in
  dictionary is at its best on exactly the small JSON this API mostly sends.
  Bodies **64 KB and over** switch to zstd-7, which is within 0.5% of
  brotli-5's size but decodes ~1.6× faster — the thing a phone on a slow
  connection actually feels. Either way gzip-6 loses on both size and speed.
- Correct by default: `Vary: Accept-Encoding` is always set, `Content-Length`
  is dropped when the body is rewritten, `Cache-Control: no-transform` and
  `204`/`304` responses are left alone, and already-compressed media
  (image/audio/video/zip/woff2) is never re-compressed.
- The drain/backpressure chain is wired to the *compression* stream, not the
  socket. `express.static` pipes files into the response, and a pipe waiting
  for the socket to drain while zlib is still chewing input would hang the
  response forever — this is covered by an explicit regression test.

### 2. Build-time precompression — `scripts/precompress.mjs`

The JS/CSS bundles are immutable, so compressing them per request wastes CPU
for bytes that never change *and* forces a low compression level to keep
time-to-first-byte down.

The build instead compresses them **once**: brotli quality 11 and zstd level
19, the smallest output either codec can produce.

```
$ node scripts/precompress.mjs server/public --prune
  index.html                            21.9 KB  br       92 B  zstd      110 B
  _expo/static/js/bundle-deadbeef.js    0.33 MB  br    13.8 KB  zstd    15.6 KB
precompress: server/public — 2 compressed, 0 up to date, 0 skipped
  (brotli −96.2%, zstd −95.7%, 0.34 MB saved on first load)
```

`server/src/precompressed.js` then serves `<file>.br` / `<file>.zst` straight
off disk with the original file's `Content-Type`, `Vary: Accept-Encoding`,
ETag/304 handling and your `setHeaders` cache rules — **zero CPU per
request**. A client that only speaks the other modern codec gets the other
sidecar; a gzip-only client falls through to live compression.

Brotli is served first because it is the *stable* choice at maximum quality,
which zstd-19 is not. Same 343 KB bundle, one whitespace difference
(`return x+1;` vs `return x+1;`):

| bundle | brotli-11 | zstd-19 |
|---|---|---|
| `…return x+1;}` | 13.9 KB | **10.0 KB** |
| `…return x+1; }` | 13.8 KB | 15.6 KB |

zstd swung 55% on a change brotli shrugged off — its long-range matcher is
sensitive to how the minifier's tokens line up, so "zstd is smaller" is not a
claim you can make once and forget. Both sidecars are always built and the
script prints both sizes, so if your bundle reliably favours zstd, set
`STATIC_PREFERRED_CODECS=zstd,br`.

Wired into the Docker image (`Dockerfile`, web-build stage), the Railway build
(`server/package.json` → `npm run build`) and `npm run precompress`.

### 3. Realtime compression — `server/src/socketCompression.js`

Socket.IO ships with **permessage-deflate disabled**, so until now every chat
message, presence sweep and OT operation went out at full JSON size. Browser
WebSockets (and the `ws` client) support the extension, so enabling it is a
direct win on the traffic users feel most.

Measured end-to-end: an 18.6 KB chat frame costs **18.6 KB → 5.6 KB** on the
wire (−70%).

Settings are conservative because a deflate context is per-connection memory:
frames under 1 KB skip compression, windows are capped at 4 KB,
`concurrencyLimit` bounds simultaneous inflations, and `maxHttpBufferSize`
(1 MB) is enforced against the **decompressed** size, so the usual
permessage-deflate zip-bomb concern does not apply.

## Configuration

All optional — the defaults are what production runs.

| Variable | Default | Meaning |
|---|---|---|
| `COMPRESS_MIN_SIZE` | `1024` | don't compress responses smaller than this (bytes) |
| `COMPRESS_MAX_SIZE` | `8388608` | don't compress responses larger than this |
| `COMPRESS_LARGE_BODY` | `65536` | size at which the codec switches from brotli to zstd |
| `COMPRESS_BROTLI_QUALITY` | `5` | live brotli quality (0–11) |
| `COMPRESS_ZSTD_LEVEL` | `3` | live zstd level for bodies under `COMPRESS_LARGE_BODY` (1–19) |
| `COMPRESS_ZSTD_LEVEL_LARGE` | `7` | live zstd level for bodies at or above it (1–19) |
| `COMPRESS_GZIP_LEVEL` | `6` | live gzip level (1–9) |
| `STATIC_BROTLI_QUALITY` | `11` | precompressed `.br` quality |
| `STATIC_ZSTD_LEVEL` | `19` | precompressed `.zst` level |
| `PREFERRED_CODECS` | *(adaptive)* | pin one codec order for all sizes, e.g. `br,zstd,gzip` |
| `STATIC_PREFERRED_CODECS` | `br,zstd` | which sidecar to serve when several exist |
| `SOCKET_COMPRESSION` | `1` | set `0` to disable all realtime compression |
| `COMPRESSION_DEBUG` | `0` | set `1` to add an `X-Compression: <codec> <sent>/<raw>` header |

## Verifying it works

```bash
# what codec does the server pick?
curl -sS -H 'Accept-Encoding: zstd'      -o /dev/null -w '%{header_json}' https://<host>/api/chats
curl -sS -H 'Accept-Encoding: br'        -o /dev/null -w '%{size_download}\n' https://<host>/api/chats
curl -sS -H 'Accept-Encoding: gzip'      -o /dev/null -w '%{size_download}\n' https://<host>/api/chats
curl -sS                                 -o /dev/null -w '%{size_download}\n' https://<host>/api/chats

# is the pre-built sidecar being served?
curl -sS -H 'Accept-Encoding: zstd' -I https://<host>/_expo/static/js/web/<bundle>.js
#   → content-encoding: zstd
#   → cache-control: public, max-age=31536000, immutable
#   → vary: Accept-Encoding
```

Live counters (admin only), plus an hourly `[bandwidth]` line in the server
log:

```
GET /api/admin/compression
{
  "codecs":      { "zstd": true, "br": true, "gzip": true },
  "preference":  ["br", "zstd", "gzip"],
  "responses":   18234,
  "compressed":  12071,
  "rawBytes":    412345678,
  "sentBytes":   39745210,
  "savedRatio":  0.9036,
  "byCodec": { "br": { "count": 8120, "savedRatio": 0.91 }, … }
}
```

```bash
cd server && npm run test:compression    # 37 assertions + a size/throughput table
```

## Platform notes

- **Web (browsers).** Chrome/Edge/Firefox/Safari advertise `br` and — since
  Chrome 123, Firefox 126 and Safari 18.4 — `zstd`. They get the best codec
  automatically and decompress transparently. No client change needed.
- **Native (iOS/Android).** `fetch` advertises whatever the platform stack can
  decode (OkHttp on Android, NSURLSession on iOS). The server honours exactly
  that, so a stack that only offers gzip keeps getting gzip rather than bytes
  it cannot read. We deliberately do **not** force `Accept-Encoding` in
  `app/src/api.js`: overriding it makes OkHttp stop transparently
  decompressing, which would break every request.
- **Node < 22.15** has no zstd. The codec is detected at import time and
  simply not offered; clients fall back to brotli/gzip with no error.
- **Vercel / Cloudflare** compress at their own edge. That covers the static
  marketing site and the `/api` proxy; this work is what makes the **Railway
  origin** (realtime sockets, direct-to-origin clients, single-host and Docker
  deploys) efficient, and it costs nothing where an edge CDN is in front.

## Rollback

Nothing is irreversible:

- `SOCKET_COMPRESSION=0` disables realtime compression on next restart.
- `PREFERRED_CODECS=gzip,br,zstd` restores gzip-first behaviour (still better
  than before, since brotli/zstd remain available to clients that ask).
- Deleting `server/public/**/*.{br,zst}` returns static files to live
  compression; the server detects missing sidecars automatically.
