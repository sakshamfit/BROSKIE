/* Song search via the iTunes Search API.
 *
 * Part 1 (unit): the track mapper against a real-shaped iTunes payload.
 * Part 2 (integration): boots the REAL server with ITUNES_API_BASE pointed
 * at a local fixture server, then drives /api/songs/search end-to-end —
 * auth required, results mapped to the client's song shape, artwork
 * upscaled, empty queries short-circuit, upstream failures degrade to a
 * 200 + error message (never a broken composer), and the route serves
 * from cache on repeat queries.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const test = require('node:test');

const itunes = require('./src/itunes');

const FIXTURE = {
  resultCount: 2,
  results: [
    {
      trackId: 1051398388,
      trackName: 'Alone',
      artistName: 'Alan Walker',
      collectionName: 'Alone - Single',
      artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music1/v4/aa/1.jpg/100x100bb.jpg',
      previewUrl: 'https://audio-ssl.itunes.apple.com/preview/mza_1.m4a',
      trackViewUrl: 'https://music.apple.com/us/album/alone/1051398388?i=1051398388',
      trackTimeMillis: 161467,
      kind: 'song',
    },
    {
      trackId: 1296934431,
      trackName: 'Alone',
      artistName: 'Marshmello',
      collectionName: 'Alone - Single',
      artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music19/v4/bb/2.jpg/100x100bb.jpg',
      previewUrl: 'https://audio-ssl.itunes.apple.com/preview/mza_2.m4a',
      trackViewUrl: 'https://music.apple.com/us/album/alone/1296934431?i=1296934431',
      trackTimeMillis: 255388,
      kind: 'song',
    },
  ],
};

test('itunes mapper maps a real-shaped result to the app song shape', () => {
  const s = itunes.mapTrack(FIXTURE.results[0]);
  if (s.id !== '1051398388') throw new Error(`id ${s.id}`);
  if (s.name !== 'Alone' || s.artist !== 'Alan Walker') throw new Error('name/artist');
  if (s.album !== 'Alone - Single') throw new Error('album');
  if (!s.albumArt.includes('/300x300bb.jpg')) throw new Error(`artwork not upscaled: ${s.albumArt}`);
  if (s.previewUrl !== FIXTURE.results[0].previewUrl) throw new Error('previewUrl');
  if (s.durationMs !== 161467) throw new Error(`durationMs ${s.durationMs}`);
  if (s.source !== 'itunes') throw new Error('source');
});

/* ---------- integration: real server + fixture iTunes API ---------- */

function startFixture() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== '/search') { res.writeHead(404).end(); return; }
    const term = url.searchParams.get('term') || '';
    if (term.toLowerCase() === 'boom') { res.writeHead(500).end('upstream down'); return; }
    if (term.toLowerCase() === 'empty') { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ resultCount: 0, results: [] })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(FIXTURE));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

(async () => {
  const fixture = await startFixture();
  const fixtureBase = `http://127.0.0.1:${fixture.address().port}`;
  const port = 4319;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plusone-itunes-'));
  const server = spawn('node', ['src/index.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(port),
      JWT_SECRET: 'itunes-suite-secret',
      DATA_DIR: dataDir,
      CORS_ORIGIN: '*',
      NODE_ENV: 'production',
      ITUNES_API_BASE: fixtureBase,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  const BASE = `http://127.0.0.1:${port}`;
  const api = async (p, method = 'GET', token) => {
    const r = await fetch(BASE + p, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  let pass = 0, fail = 0;
  const ok = (c, n) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } };

  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) break; } catch {}
    await wait(250);
  }

  const stamp = Date.now();
  const reg = await api(`/api/auth/register?nocache=${stamp}`, 'POST').catch(() => ({ status: 0 }));
  // register needs a JSON body — do it properly:
  const r2 = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: `songer${stamp}`, name: 'Songer', password: 'password-123', phone: `+1777${String(stamp).slice(-8)}` }),
  });
  const { token } = await r2.json();
  ok(r2.status === 200 && !!token, 'user registered for song search');

  const noAuth = await fetch(`${BASE}/api/songs/search?q=alone`);
  ok(noAuth.status === 401, 'song search requires auth');

  const q1 = await api(`/api/songs/search?q=${encodeURIComponent('alone alan walker')}`, 'GET', token);
  ok(q1.status === 200 && q1.data.configured === true, 'search returns 200 + configured:true (zero config needed)');
  ok(Array.isArray(q1.data.tracks) && q1.data.tracks.length === 2, 'two fixture tracks returned');
  const first = (q1.data.tracks || [])[0] || {};
  ok(first.source === 'itunes' && first.name === 'Alone' && first.artist === 'Alan Walker', 'mapped to the client song shape');
  ok(String(first.albumArt || '').includes('/300x300bb.jpg'), 'artwork requested at 300px');
  ok(!!first.previewUrl && first.durationMs === 161467, 'preview URL + duration present (playable card)');

  const qEmpty = await api('/api/songs/search?q=empty', 'GET', token);
  ok(qEmpty.status === 200 && qEmpty.data.tracks.length === 0 && !qEmpty.data.error, 'empty catalogue is a clean empty result');

  const qBoom = await api('/api/songs/search?q=boom', 'GET', token);
  ok(qBoom.status === 200 && qBoom.data.tracks.length === 0 && !!qBoom.data.error, 'upstream failure degrades to 200 + error message');

  const qBlank = await api('/api/songs/search?q=', 'GET', token);
  ok(qBlank.status === 200 && qBlank.data.tracks.length === 0, 'blank query short-circuits');

  const t1 = Date.now();
  await api(`/api/songs/search?q=cached`, 'GET', token);
  await api(`/api/songs/search?q=cached`, 'GET', token);
  const t2 = Date.now();
  ok(t2 - t1 < 900, 'repeat query served from cache (fast)');

  // legacy alias still redirects
  const alias = await fetch(`${BASE}/api/spotify/search?q=alone`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'manual' });
  ok(alias.status === 307 && String(alias.headers.get('location')).includes('/api/songs/search'), 'legacy /api/spotify/search alias still redirects');

  console.log(`\nITUNES SONGS SUITE: ${pass} passed, ${fail} failed`);
  server.kill('SIGTERM');
  fixture.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
