#!/usr/bin/env node
/*
 * Offline test suite for the bandwidth/compression stack.
 *
 *   cd server && npm run test:compression
 *
 * Covers three things, none of which need the database or the network:
 *   1. Accept-Encoding negotiation — the server must only ever answer with a
 *      codec the client advertised, honour q-values, and never compress
 *      responses that must stay untouched (204/304, no-transform, images).
 *   2. Round-trip correctness — every compressed body must decode back to
 *      exactly the original bytes, for single-shot, chunked and piped
 *      (express.static) responses alike.
 *   3. Build-time precompression — scripts/precompress.mjs must emit .br and
 *      .zst sidecars that the server serves instead of compressing on the fly.
 *
 * It also prints a size/throughput table so the actual saving is visible
 * rather than assumed.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const http = require('http');
const assert = require('assert');
const { execFileSync } = require('child_process');

const express = require('express');
const httpCompression = require('./src/httpCompression');
const servePrecompressed = require('./src/precompressed');

const PRECOMPRESS_SCRIPT = path.join(__dirname, '..', 'scripts', 'precompress.mjs');

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  ✗ ${name}\n     ${err.message}`);
  }
}

/* ------------------------------------------------------------------ */
/* fixtures                                                            */
/* ------------------------------------------------------------------ */

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'plusone-compress-'));

function writeBundleFixture() {
  // Minified-style JavaScript — the shape a real Expo web export has: short
  // identifiers, no long runs of identical text. (A highly repetitive
  // synthetic fixture flatters every codec, especially gzip, and would report
  // savings nobody sees in production.)
  let out = '';
  for (let i = 0; i < 6000; i += 1) {
    out += `export const v${i}=${i};function f${i}(x){return x+${i};}\n`;
  }
  return out;
}

const BUNDLE = writeBundleFixture();
const CHAT_PAYLOAD = JSON.stringify({
  messages: Array.from({ length: 300 }, (_, i) => ({
    id: `msg_${i}`,
    chatId: 'chat_1',
    senderId: `user_${i % 12}`,
    body: `Message number ${i}: hey, are we still on for later? Let me know when you land.`,
    createdAt: 1700000000000 + i * 1000,
    deliveryStatus: i % 5 === 0 ? 'read' : 'delivered',
    reactions: [],
  })),
});

fs.writeFileSync(path.join(TMP, 'bundle.js'), BUNDLE);
fs.writeFileSync(path.join(TMP, 'index.html'), `<!doctype html><html><body>${'<p>plus one</p>'.repeat(200)}</body></html>`);
fs.writeFileSync(path.join(TMP, 'logo.png'), Buffer.alloc(6000, 9));
fs.writeFileSync(path.join(TMP, 'tiny.js'), 'var a=1;');

/* ------------------------------------------------------------------ */
/* 1. pure functions                                                   */
/* ------------------------------------------------------------------ */

console.log('\nnegotiation');

check('picks the first codec the client listed', () => {
  assert.strictEqual(httpCompression.negotiate('br'), 'br');
  assert.strictEqual(httpCompression.negotiate('zstd'), 'zstd');
  assert.strictEqual(httpCompression.negotiate('gzip, deflate'), 'gzip');
});

check('honours q-values over list order', () => {
  assert.strictEqual(httpCompression.negotiate('gzip;q=0.5, br;q=0.9'), 'br');
  assert.strictEqual(httpCompression.negotiate('zstd;q=0.4, gzip;q=0.8'), 'gzip');
});

check('never returns a codec the client did not offer', () => {
  assert.strictEqual(httpCompression.negotiate('gzip'), 'gzip');
  assert.strictEqual(httpCompression.negotiate('deflate'), null);
  assert.strictEqual(httpCompression.negotiate(''), null);
  assert.strictEqual(httpCompression.negotiate(undefined), null);
});

check('q=0 means "never send me this"', () => {
  assert.strictEqual(httpCompression.negotiate('zstd;q=0, br;q=0, gzip'), 'gzip');
  assert.strictEqual(httpCompression.negotiate('zstd;q=0, br;q=0'), null);
});

check('an explicit identity preference wins', () => {
  assert.strictEqual(httpCompression.negotiate('identity;q=1, zstd;q=0.9'), null);
  assert.strictEqual(httpCompression.negotiate('identity'), null);
});

check('* applies to codecs the client did not name', () => {
  assert.strictEqual(httpCompression.negotiate('*'), httpCompression.preference[0]);
});

check('small bodies prefer the smallest codec, large ones the cheapest', () => {
  const small = httpCompression.preferenceFor(4 * 1024);
  const large = httpCompression.preferenceFor(4 * 1024 * 1024);
  // brotli-5 beats zstd-3 on ratio; zstd-3 is ~3x cheaper to encode. Both are
  // measured in docs/BANDWIDTH.md.
  assert.ok(small.indexOf('br') < small.indexOf('zstd'), 'small bodies should prefer brotli');
  assert.ok(large.indexOf('zstd') < large.indexOf('br'), 'large bodies should prefer zstd');
  // Equally-rated codecs are broken by OUR preference, not the client's list
  // order — that is the whole point of having a preference.
  assert.strictEqual(httpCompression.negotiate('zstd, br', small), 'br');
  assert.strictEqual(httpCompression.negotiate('br, zstd', large), 'zstd');
  // …but an explicit q-value from the client always wins.
  assert.strictEqual(httpCompression.negotiate('br;q=1.0, zstd;q=0.9', large), 'br');
});

check('only offers codecs this Node build can produce', () => {
  for (const codec of httpCompression.preference) {
    assert.strictEqual(httpCompression.codecs[codec], true, `${codec} unavailable`);
  }
});

console.log('\ncontent-type filtering');

check('text, json and js are compressible', () => {
  for (const type of [
    'application/json',
    'application/json; charset=utf-8',
    'text/html; charset=utf-8',
    'text/css',
    'application/javascript; charset=utf-8',
    'application/problem+json',
    'image/svg+xml',
  ]) {
    assert.strictEqual(httpCompression.isCompressibleType(type), true, type);
  }
});

check('already-compressed media is left alone', () => {
  for (const type of [
    'image/png',
    'image/jpeg',
    'image/webp',
    'audio/mpeg',
    'video/mp4',
    'font/woff2',
    'application/zip',
    'application/octet-stream',
    'application/pdf',
  ]) {
    assert.strictEqual(httpCompression.isCompressibleType(type), false, type);
  }
});

/* ------------------------------------------------------------------ */
/* 2. build-time precompression                                        */
/* ------------------------------------------------------------------ */

console.log('\nprecompression (scripts/precompress.mjs)');

execFileSync(process.execPath, [PRECOMPRESS_SCRIPT, TMP, '--prune', '--quiet'], { stdio: 'pipe' });

check('writes a .br and a .zst sidecar for every sizable text file', () => {
  for (const file of ['bundle.js', 'index.html']) {
    for (const ext of ['.br', '.zst']) {
      if (!httpCompression.codecs[ext === '.br' ? 'br' : 'zstd']) continue;
      assert.ok(fs.existsSync(path.join(TMP, file + ext)), `${file}${ext} missing`);
    }
  }
});

check('skips tiny files and already-compressed media', () => {
  assert.ok(!fs.existsSync(path.join(TMP, 'tiny.js.br')), 'tiny.js was precompressed');
  assert.ok(!fs.existsSync(path.join(TMP, 'logo.png.br')), 'png was precompressed');
});

check('sidecars are smaller than the original', () => {
  const raw = fs.statSync(path.join(TMP, 'bundle.js')).size;
  if (httpCompression.codecs.br) {
    assert.ok(fs.statSync(path.join(TMP, 'bundle.js.br')).size < raw, 'brotli grew the bundle');
  }
  if (httpCompression.codecs.zstd) {
    assert.ok(fs.statSync(path.join(TMP, 'bundle.js.zst')).size < raw, 'zstd grew the bundle');
  }
});

check('re-running is idempotent (no rewrite when fresh)', () => {
  const before = fs.statSync(path.join(TMP, 'bundle.js.br')).mtimeMs;
  execFileSync(process.execPath, [PRECOMPRESS_SCRIPT, TMP, '--quiet'], { stdio: 'pipe' });
  const after = fs.statSync(path.join(TMP, 'bundle.js.br')).mtimeMs;
  assert.strictEqual(after, before, 'sidecar was rewritten unnecessarily');
});

check('sidecars decode back to the original bytes', () => {
  const original = fs.readFileSync(path.join(TMP, 'bundle.js'));
  if (httpCompression.codecs.br) {
    assert.ok(zlib.brotliDecompressSync(fs.readFileSync(path.join(TMP, 'bundle.js.br'))).equals(original));
  }
  if (httpCompression.codecs.zstd) {
    assert.ok(zlib.zstdDecompressSync(fs.readFileSync(path.join(TMP, 'bundle.js.zst'))).equals(original));
  }
});

/* ------------------------------------------------------------------ */
/* 3. end-to-end over real HTTP                                        */
/* ------------------------------------------------------------------ */

const app = express();
app.use(httpCompression());
app.use(servePrecompressed(TMP, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('bundle.js')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  },
}));
app.use(express.static(TMP, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
  },
}));

app.get('/api/chat', (req, res) => res.type('application/json').send(CHAT_PAYLOAD));
app.get('/api/tiny', (req, res) => res.json({ ok: true }));
app.get('/api/empty', (req, res) => { res.setHeader('Content-Type', 'application/json'); res.status(204).end(); });
app.get('/api/notransform', (req, res) => {
  res.setHeader('Cache-Control', 'no-transform');
  res.type('application/json').send(CHAT_PAYLOAD);
});
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.write('{"parts":[');
  let n = 0;
  const timer = setInterval(() => {
    n += 1;
    res.write(JSON.stringify({ n, text: 'streaming chunk '.repeat(12) }));
    if (n >= 30) {
      clearInterval(timer);
      res.end(']}');
    } else {
      res.write(',');
    }
  }, 1);
});

const server = app.listen(0);

function decodeBody(buf, encoding) {
  if (!encoding || encoding === 'identity') return buf;
  if (encoding === 'gzip' || encoding === 'deflate') return zlib.gunzipSync(buf);
  if (encoding === 'br') return zlib.brotliDecompressSync(buf);
  if (encoding === 'zstd') return zlib.zstdDecompressSync(buf);
  throw new Error(`unexpected Content-Encoding: ${encoding}`);
}

function request(pathname, acceptEncoding, extra) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        host: '127.0.0.1',
        port: server.address().port,
        path: pathname,
        headers: { 'Accept-Encoding': acceptEncoding, ...(extra || {}) },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            wire: Buffer.concat(chunks).length,
            body: decodeBody(Buffer.concat(chunks), res.headers['content-encoding']),
          })
        );
      }
    );
    req.on('error', reject);
  });
}

/**
 * Boot two throwaway Socket.IO servers — one with the production compression
 * options, one with them off — and compare the bytes that actually cross the
 * socket for the same chat frame. Uses the real `socketCompression()` config
 * (not a copy) so the two can never drift apart.
 */
function measureRealtime() {
  let socketIo;
  let client;
  try {
    socketIo = require('socket.io');
    client = require('socket.io-client');
  } catch (err) {
    return { skipped: true, reason: `socket.io client unavailable (${err.message})` };
  }

  const socketCompression = require('./src/socketCompression');
  const words = 'the a to and of you it in is on for with at by from up out as be this that have not but they we'.split(' ');
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const sentence = () => Array.from({ length: 12 }, () => words[Math.floor(rnd() * words.length)]).join(' ');
  const payload = {
    messages: Array.from({ length: 200 }, (_, i) => ({
      id: `m${i}-${Math.floor(rnd() * 1e9).toString(36)}`,
      body: sentence(),
      ts: 1700000000000 + i * 137,
    })),
  };

  const runOnce = (withDeflate) =>
    new Promise((resolve, reject) => {
      const httpServer = http.createServer();
      const ioServer = new socketIo.Server(httpServer, {
        cors: { origin: '*' },
        maxHttpBufferSize: 1e6,
        ...(withDeflate ? socketCompression() : { perMessageDeflate: false, httpCompression: false }),
      });
      ioServer.on('connection', (s) => s.on('echo', (p) => s.emit('echo', p)));
      httpServer.listen(0, () => {
        const port = httpServer.address().port;
        const socket = client.io(`http://127.0.0.1:${port}`, { transports: ['websocket'] });
        const done = (extra) => {
          try { socket.close(); ioServer.close(); } catch {}
          httpServer.close(() => resolve(extra));
        };
        const timer = setTimeout(() => done({ error: 'timeout' }), 8000);
        socket.on('connect', () => {
          const ws = socket.io.engine.transport.ws;
          const extensions = ws && ws.extensions ? Object.keys(ws.extensions) : [];
          // Let the handshake settle so we only measure the echo round-trip.
          setTimeout(() => {
            let bytes = 0;
            const counter = (d) => { bytes += d.length; };
            ws._socket.on('data', counter);
            socket.emit('echo', payload);
            socket.once('echo', (echoed) => {
              setTimeout(() => {
                ws._socket.off('data', counter);
                clearTimeout(timer);
                done({ extensions, wireBytes: bytes, echoed });
              }, 150);
            });
          }, 200);
        });
        socket.on('connect_error', (err) => { clearTimeout(timer); done({ error: err.message }); });
      });
    });

  return runOnce(true)
    .then((on) => runOnce(false).then((off) => {
      if (on.error || off.error) return { skipped: true, reason: on.error || off.error };
      return {
        extensions: on.extensions,
        withDeflate: on.wireBytes,
        withoutDeflate: off.wireBytes,
        payloadBytes: Buffer.byteLength(JSON.stringify(payload)),
        sent: payload,
        echoed: on.echoed,
      };
    }))
    .catch((err) => ({ skipped: true, reason: err.message }));
}

(async () => {
  await new Promise((resolve) => server.on('listening', resolve));

  console.log('\nHTTP round-trips');

  const AE_ALL = 'gzip, deflate, br, zstd';

  for (const codec of ['zstd', 'br', 'gzip']) {
    if (!httpCompression.codecs[codec]) continue;
    // eslint-disable-next-line no-await-in-loop
    const r = await request('/api/chat', codec);
    check(`${codec}: API JSON decodes back to the exact payload`, () => {
      assert.strictEqual(r.headers['content-encoding'], codec);
      assert.strictEqual(r.body.toString(), CHAT_PAYLOAD);
      assert.ok(r.wire < CHAT_PAYLOAD.length, `no saving: ${r.wire} vs ${CHAT_PAYLOAD.length}`);
    });
    // eslint-disable-next-line no-await-in-loop
    check(`${codec}: sets Vary: Accept-Encoding and drops Content-Length`, () => {
      assert.strictEqual(r.headers.vary, 'Accept-Encoding');
      assert.strictEqual(r.headers['content-length'], undefined);
    });
  }

  const small = await request('/api/tiny', AE_ALL);
  check('responses under the threshold are left uncompressed', () => {
    assert.strictEqual(small.headers['content-encoding'], undefined);
  });

  const empty = await request('/api/empty', AE_ALL);
  check('204 No Content is never compressed', () => {
    assert.strictEqual(empty.status, 204);
    assert.strictEqual(empty.headers['content-encoding'], undefined);
  });

  const notransform = await request('/api/notransform', AE_ALL);
  check('Cache-Control: no-transform is respected', () => {
    assert.strictEqual(notransform.headers['content-encoding'], undefined);
    assert.strictEqual(notransform.body.toString(), CHAT_PAYLOAD);
  });

  const png = await request('/logo.png', AE_ALL);
  check('image/png is served as-is', () => {
    assert.strictEqual(png.headers['content-encoding'], undefined);
    assert.strictEqual(png.wire, 6000);
  });

  const noHeader = await request('/api/chat', '');
  check('a client that sends no Accept-Encoding gets plain bytes', () => {
    assert.strictEqual(noHeader.headers['content-encoding'], undefined);
    assert.strictEqual(noHeader.body.toString(), CHAT_PAYLOAD);
  });

  const streamed = await request('/api/stream', 'zstd');
  check('chunked (streamed) responses compress and decode', () => {
    assert.strictEqual(streamed.headers['content-encoding'], 'zstd');
    assert.strictEqual(streamed.headers['transfer-encoding'], 'chunked');
    JSON.parse(streamed.body.toString());
  });

  // The big one: express.static pipes the file into res, which is where a
  // broken backpressure chain hangs forever instead of erroring.
  for (const codec of ['zstd', 'br', 'gzip']) {
    // eslint-disable-next-line no-await-in-loop
    const r = await request('/bundle.js', codec);
    check(`${codec}: piped static file completes and decodes (backpressure)`, () => {
      assert.strictEqual(r.body.toString(), BUNDLE);
      assert.ok(r.wire < BUNDLE.length);
    });
  }

  console.log('\nprecompressed static serving');

  // Static assets use their own preference list (max-quality sidecars), which
  // is independent of the live, size-adaptive one.
  const best = servePrecompressed.staticPreference()[0];
  const sidecarSize = fs.statSync(path.join(TMP, `bundle.js${best === 'zstd' ? '.zst' : '.br'}`)).size;
  const served = await request('/bundle.js', AE_ALL);
  check(`serves the pre-built ${best} sidecar instead of compressing live`, () => {
    assert.strictEqual(served.headers['content-encoding'], best);
    assert.strictEqual(served.wire, sidecarSize);
    assert.strictEqual(served.body.toString(), BUNDLE);
    assert.strictEqual(served.headers['content-type'], 'application/javascript; charset=utf-8');
    assert.ok(String(served.headers.vary).includes('Accept-Encoding'));
    assert.ok(String(served.headers['cache-control']).includes('immutable'), 'setHeaders hook lost');
  });

  const gzipOnly = await request('/bundle.js', 'gzip');
  check('a gzip-only client falls back to live compression', () => {
    assert.strictEqual(gzipOnly.headers['content-encoding'], 'gzip');
    assert.strictEqual(gzipOnly.body.toString(), BUNDLE);
    assert.ok(gzipOnly.wire > sidecarSize, 'live gzip should not beat the pre-built sidecar');
  });

  const revalidated = await request('/bundle.js', AE_ALL, { 'If-None-Match': served.headers.etag });
  check('conditional requests still return 304', () => {
    assert.strictEqual(revalidated.status, 304);
  });

  const traversal = await request('/../package.json', AE_ALL);
  check('path traversal is refused', () => {
    assert.ok([301, 302, 403, 404].includes(traversal.status), `unexpected ${traversal.status}`);
  });

  /* ---------------------------------------------------------------- */
  /* realtime (Socket.IO permessage-deflate)                           */
  /* ---------------------------------------------------------------- */

  console.log('\nrealtime (permessage-deflate)');

  const realtime = await measureRealtime();
  if (realtime.skipped) {
    console.log(`  · skipped: ${realtime.reason}`);
  } else {
    check('client and server negotiate permessage-deflate', () => {
      assert.ok(realtime.extensions.length > 0, 'no permessage-deflate extension negotiated');
    });
    check('a large chat frame is compressed on the wire', () => {
      assert.ok(
        realtime.withDeflate < realtime.withoutDeflate * 0.6,
        `expected a big saving, got ${realtime.withoutDeflate} B → ${realtime.withDeflate} B`
      );
    });
    check('the frame round-trips intact', () => {
      assert.deepStrictEqual(realtime.echoed, realtime.sent);
    });
    console.log(
      `  · ${realtime.payloadBytes} B chat frame → ${realtime.withDeflate} B compressed ` +
        `vs ${realtime.withoutDeflate} B raw (−${(100 - (realtime.withDeflate / realtime.withoutDeflate) * 100).toFixed(0)}%)`
    );
  }

  /* ---------------------------------------------------------------- */
  /* size + throughput table                                           */
  /* ---------------------------------------------------------------- */

  console.log('\nmeasured transfer sizes');
  const rows = [
    ['chat payload (API JSON)', Buffer.byteLength(CHAT_PAYLOAD)],
    ['bundle.js (web app)', Buffer.byteLength(BUNDLE)],
  ];
  const header = '  ' + 'payload'.padEnd(26) + 'raw'.padStart(10) + 'gzip'.padStart(10) + 'brotli'.padStart(10) + 'zstd'.padStart(10);
  console.log(header);
  for (const [label, rawSize] of rows) {
    const isBundle = label.startsWith('bundle');
    const sizes = {};
    for (const codec of ['gzip', 'br', 'zstd']) {
      if (!httpCompression.codecs[codec]) { sizes[codec] = NaN; continue; }
      if (isBundle) {
        // Bundles are served from the max-quality build-time sidecar when the
        // client accepts br/zstd, so report that number where it applies.
        const ext = codec === 'br' ? '.br' : codec === 'zstd' ? '.zst' : null;
        if (ext) { sizes[codec] = fs.statSync(path.join(TMP, 'bundle.js' + ext)).size; continue; }
      }
      const r = await request(isBundle ? '/bundle.js' : '/api/chat', codec);
      sizes[codec] = r.wire;
    }
    const fmt = (n) => (Number.isNaN(n) ? '—' : `${(n / 1024).toFixed(1)} KB`).padStart(10);
    console.log('  ' + label.padEnd(26) + fmt(rawSize) + fmt(sizes.gzip) + fmt(sizes.br) + fmt(sizes.zstd));
  }

  const stats = httpCompression.snapshotStats();
  console.log(
    `\n  live middleware: ${stats.compressed}/${stats.responses} responses compressed, ` +
      `${(stats.rawBytes / 1024).toFixed(0)} KB → ${(stats.sentBytes / 1024).toFixed(0)} KB ` +
      `(−${(stats.savedRatio * 100).toFixed(1)}%)`
  );

  server.close();
  fs.rmSync(TMP, { recursive: true, force: true });

  console.log(`\n${failed === 0 ? '✓' : '✗'} ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('\ntest-compression crashed:', err);
  server.close();
  process.exit(1);
});
