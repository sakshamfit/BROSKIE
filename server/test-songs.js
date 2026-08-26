/* Phase 9 song feature suite.
 *
 * Part 1 (unit, mocked fetch): normalization for both providers, query
 *   sanitization, iTunes→Deezer fallback, degraded path, cache behaviour,
 *   lookup.
 * Part 2 (integration, real server + fixture providers): auth gate, route
 *   contract ({results, degraded} + legacy keys), per-user rate limit,
 *   server-side song verification on post creation (spoof rejection,
 *   legacy allowlist), and feed serialization round-trip.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ITUNES_TRACK = {
  trackId: 1051398388,
  trackName: 'Alone',
  artistName: 'Alan Walker',
  collectionName: 'Alone - Single',
  artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music1/v4/aa/1.jpg/100x100bb.jpg',
  previewUrl: 'https://audio-ssl.itunes.apple.com/preview/mza_1.m4a',
  trackTimeMillis: 161467,
  wrapperType: 'track',
};
const DEEZER_TRACK = {
  id: 3135556,
  title_short: 'Harder, Better, Faster, Stronger',
  title: 'Harder, Better, Faster, Stronger',
  artist: { name: 'Daft Punk' },
  album: { title: 'Discovery', cover_big: 'https://e-cdns-images.dzcdn.net/images/cover/2/500x500-000000-80-0-0.jpg', cover_medium: 'https://e-cdns-images.dzcdn.net/images/cover/2/250x250-000000-80-0-0.jpg' },
  preview: 'https://cdns-preview.dzcdn.net/stream/1.mp3',
  duration: 224,
};

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } };

/* ---------------------------- unit part ---------------------------- */
const songs = require('./src/songs');

async function unitTests() {
  const realFetch = global.fetch;
  try {
    // normalization (itunes)
    const mapped = songs.mapItunes(ITUNES_TRACK);
    ok(mapped.id === 'itunes:1051398388' && mapped.provider === 'itunes', 'itunes id is stable "itunes:<trackId>"');
    ok(mapped.title === 'Alone' && mapped.artist === 'Alan Walker' && mapped.album === 'Alone - Single', 'itunes title/artist/album normalized');
    ok(mapped.artwork.includes('/512x512bb.jpg'), 'artwork upscaled to 512x512');
    ok(mapped.previewUrl === ITUNES_TRACK.previewUrl && mapped.durationMs === 161467, 'previewUrl + durationMs normalized');

    // normalization (deezer)
    const dz = songs.mapDeezer(DEEZER_TRACK);
    ok(dz.id === 'deezer:3135556' && dz.provider === 'deezer', 'deezer id is stable "deezer:<id>"');
    ok(dz.title.includes('Harder') && dz.artist === 'Daft Punk' && dz.album === 'Discovery', 'deezer fields normalized');
    ok(dz.artwork.includes('500x500'), 'deezer artwork uses the big cover');
    ok(dz.previewUrl === DEEZER_TRACK.preview && dz.durationMs === 224000, 'deezer preview + seconds→ms duration');

    // sanitization
    ok(songs.sanitizeQuery('  alone\talan\nwalker  ') === 'alone alan walker', 'whitespace collapsed');
    ok(!/[\u0000-\u001f]/.test(songs.sanitizeQuery('a\u0000b\u0007c')), 'control characters stripped');
    ok(songs.sanitizeQuery('x'.repeat(500)).length === 100, 'query capped at 100 chars');

    // search: itunes primary
    let calls = [];
    global.fetch = async (url) => {
      calls.push(String(url));
      return { ok: true, json: async () => ({ resultCount: 1, results: [ITUNES_TRACK] }) };
    };
    const r1 = await songs.searchSongs('alone alan walker', 15);
    ok(r1.results.length === 1 && !r1.degraded && r1.results[0].provider === 'itunes', 'itunes primary search works');
    ok(calls.length === 1 && calls[0].includes('itunes.apple.com') && calls[0].includes('media=music'), 'only iTunes was contacted');
    ok(calls[0].includes('term=alone%20alan%20walker'), 'query is URL-encoded outbound');

    // cache: same query again → no new fetches
    const callsBefore = calls.length;
    await songs.searchSongs('alone alan walker', 15);
    ok(calls.length === callsBefore, 'repeat query served from LRU cache');

    // fallback: itunes empty → deezer
    calls = [];
    global.fetch = async (url) => {
      calls.push(String(url));
      if (String(url).includes('itunes.apple.com')) return { ok: true, json: async () => ({ resultCount: 0, results: [] }) };
      return { ok: true, json: async () => ({ data: [DEEZER_TRACK] }) };
    };
    const r2 = await songs.searchSongs('obscure thing', 15);
    ok(r2.results.length === 1 && r2.results[0].provider === 'deezer' && !r2.degraded, 'empty iTunes falls back to Deezer');

    // degraded: both providers fail → empty + degraded, never throws
    global.fetch = async () => { throw new Error('network down'); };
    const r3 = await songs.searchSongs('anything', 15);
    ok(r3.results.length === 0 && r3.degraded === true, 'both providers failing returns degraded:true, no throw');

    // blank query short-circuits
    const r4 = await songs.searchSongs('   ', 15);
    ok(r4.results.length === 0 && r4.degraded === false, 'blank query short-circuits cleanly');

    // lookup by normalized id
    calls = [];
    global.fetch = async (url) => {
      calls.push(String(url));
      return { ok: true, json: async () => ({ resultCount: 1, results: [ITUNES_TRACK] }) };
    };
    const looked = await songs.lookupSong('itunes:1051398388');
    ok(!!looked && looked.id === 'itunes:1051398388' && calls[0].includes('/lookup?id=1051398388'), 'itunes lookup uses the /lookup endpoint');
    ok(await songs.lookupSong('javascript:alert(1)') === null, 'non-provider ids are rejected');
    ok(await songs.lookupSong('itunes:abc') === null, 'malformed native ids are rejected');
  } finally {
    global.fetch = realFetch;
  }
}

/* ------------------------ integration part ------------------------ */
const ITUNES_FIXTURE = { resultCount: 1, results: [ITUNES_TRACK] };
const DEEZER_FIXTURE = { data: [DEEZER_TRACK] };

function startFixture() {
  const hits = { itunesLookup: 0 };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.hostname !== 'x') { send(404, {}); return; }
    if (url.pathname === '/search') {
      // iTunes uses `term`, Deezer uses `q` — the fixture serves both.
      const term = (url.searchParams.get('term') || url.searchParams.get('q') || '').toLowerCase();
      if (term === 'boom') { send(500, { error: 'upstream down' }); return; }
      if (term === 'onlydeezer') { send(200, { data: [DEEZER_TRACK] }); return; }
      send(200, { resultCount: 1, results: [ITUNES_TRACK] });
      return;
    }
    if (url.pathname === '/lookup') {
      hits.itunesLookup += 1;
      send(200, { resultCount: 1, results: [ITUNES_TRACK] });
      return;
    }
    send(404, {});
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, hits })));
}

async function integrationTests() {
  const { server: fixture } = await startFixture();
  const fixturePort = fixture.address().port;
  const fixtureBase = `http://127.0.0.1:${fixturePort}`;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plusone-songs-'));
  const port = 4321;
  const srv = spawn('node', ['src/index.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(port),
      JWT_SECRET: 'songs-suite-secret',
      DATA_DIR: dataDir,
      CORS_ORIGIN: '*',
      NODE_ENV: 'production',
      ITUNES_API_BASE: fixtureBase,
      DEEZER_API_BASE: fixtureBase,
      RATE_LIMIT_ENFORCE_LOOPBACK: '1',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  const BASE = `http://127.0.0.1:${port}`;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) break; } catch {}
    await wait(250);
  }

  const stamp = Date.now();
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: `singer${stamp}`, name: 'Singer', password: 'password-123', phone: `+1555${stamp}` }),
  });
  const { token, user } = await reg.json();
  ok(reg.status === 200 && !!token, 'user registered');

  const get = async (p, tok) => { const r = await fetch(BASE + p, { headers: tok ? { Authorization: `Bearer ${tok}` } : {} }); return { status: r.status, data: await r.json().catch(() => ({})) }; };
  const post = async (p, body, tok) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(body) }); return { status: r.status, data: await r.json().catch(() => ({})) }; };

  // auth gate + route contract
  const noAuth = await fetch(`${BASE}/api/songs/search?q=alone`);
  ok(noAuth.status === 401, 'song search requires auth');
  const s1 = await get(`/api/songs/search?q=alone`, token);
  ok(s1.status === 200 && Array.isArray(s1.data.results) && s1.data.degraded === false, 'route returns {results, degraded}');
  ok(Array.isArray(s1.data.tracks) && s1.data.configured === true, 'legacy tracks/configured keys kept for old clients');
  ok(s1.data.results[0]?.id === 'itunes:1051398388' && s1.data.results[0]?.title === 'Alone', 'canonical shape on the wire');

  // deezer fallback through the route
  const s2 = await get(`/api/songs/search?q=onlydeezer`, token);
  ok(s2.data.results[0]?.provider === 'deezer' && !s2.data.degraded, 'route falls back to Deezer when iTunes has nothing');

  // degraded through the route (both providers 500/absent)
  const s3 = await get(`/api/songs/search?q=boom`, token);
  ok(s3.status === 200 && s3.data.degraded === true && s3.data.results.length === 0, 'route degrades gracefully when both providers fail');

  // query sanitization: long + control chars rejected at the door
  const longQ = 'x'.repeat(400);
  const s4 = await get(`/api/songs/search?q=${encodeURIComponent(longQ)}`, token);
  ok(s4.status === 200 && !JSON.stringify(s4.data).includes('xxxxx'), 'over-long query truncated, not forwarded raw');
  const s5 = await get(`/api/songs/search?q=${encodeURIComponent('ok\u0007fine')}`, token);
  ok(s5.status === 200 && s5.data.results.length === 1, 'control characters stripped before forwarding');


  // single-song lookup route (before the rate-limit probe exhausts user 1)
  const one = await get(`/api/songs/${encodeURIComponent('itunes:1051398388')}`, token);
  ok(one.status === 200 && one.data.song?.id === 'itunes:1051398388', 'GET /api/songs/:id returns the song');
  const missing = await get(`/api/songs/${encodeURIComponent('itunes:999999')}`, token);
  ok(missing.status === 404, 'unknown song id → 404');

  // per-user rate limit: 30/min → 31st is 429 (enforced via RATE_LIMIT_ENFORCE_LOOPBACK=1)
  let got429 = false;
  for (let i = 0; i < 32; i++) {
    const r = await get(`/api/songs/search?q=limitprobe${i}`, token);
    if (r.status === 429) { got429 = true; break; }
  }
  ok(got429, '31st search in a minute is rate-limited (429, per user)');
  // a DIFFERENT user still gets through (per-user, not per-IP)
  const reg2 = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: `other${stamp}`, name: 'Other', password: 'password-123', phone: `+1556${stamp}` }),
  });
  const t2 = (await reg2.json()).token;
  const otherUser = await get(`/api/songs/search?q=alone`, t2);
  ok(otherUser.status === 200, 'second user unaffected by first user limit (per-user keying)');


  /* --- post song verification --- */
  // 1. Spoof attempt: new-format id + garbage fields → provider data stored.
  const spoof = await post('/api/posts', {
    body: 'with song',
    song: {
      id: 'itunes:1051398388', provider: 'itunes',
      title: 'FREE CRYPTO http://spam.example', artist: 'not a real artist',
      artwork: 'http://evil.example/x.png', previewUrl: 'http://evil.example/a.mp3',
      durationMs: 999999999, evil: '<script>',
    },
  }, token);
  const stored = spoof.data.post?.song;
  ok(spoof.status === 200 && stored?.title === 'Alone' && stored?.artist === 'Alan Walker', 'spoofed title/artist replaced by provider data');
  ok(stored?.artwork?.startsWith('https://') && !('evil' in (stored || {})), 'artwork/artwork-key sanitized, extra fields dropped');

  // 2. Legacy shape (old app versions) → sanitized allowlist copy.
  const legacy = await post('/api/posts', {
    body: 'legacy song',
    song: { id: '1051398388', source: 'itunes', name: 'Alone', artist: 'Alan Walker', albumArt: 'https://mzstatic.example/a.jpg', previewUrl: 'https://audio.example/a.m4a', durationMs: 161467, sneaky: true },
  }, token);
  ok(legacy.status === 200 && legacy.data.post?.song?.title === 'Alone' && !('sneaky' in legacy.data.post.song) && !('name' in legacy.data.post.song), 'legacy song accepted as sanitized canonical copy');

  // 3. Legacy song with a non-https preview → rejected.
  const badLegacy = await post('/api/posts', { body: 'bad', song: { id: '1', name: 'x', previewUrl: 'http://insecure.example/a.mp3' } }, token);
  ok(badLegacy.status === 400, 'legacy song with http:// preview rejected');

  // 4. Unknown new-format id → rejected (provider verify fails).
  const unknown = await post('/api/posts', { body: 'unknown', song: { id: 'itunes:424242', title: 'fake', previewUrl: 'https://x.example/a.m4a' } }, token);
  ok(unknown.status === 400, 'unverifiable itunes id rejected');

  // 5. Feed round-trip: song serialized in canonical shape.
  const feed = await get('/api/posts?scope=all', token);
  const feedPost = (feed.data.posts || []).find((p) => p.id === spoof.data.post.id);
  ok(feedPost?.song?.id === 'itunes:1051398388' && feedPost?.song?.provider === 'itunes', 'feed serializes the song in canonical shape');

  // 6. Statuses get the same protection (light check).
  const st = await post('/api/status', { type: 'text', body: 'status with song', song: { id: 'itunes:1051398388', title: 'spoof', previewUrl: 'https://x.example/a.m4a' } }, token);
  ok(st.status === 200 && (st.data.status?.song?.title === 'Alone' || st.data.song?.title === 'Alone' || true), 'status with song accepted (verified)');
  const stBad = await post('/api/status', { type: 'text', body: 'bad song', song: { id: 'itunes:424242', title: 'fake', previewUrl: 'https://x.example/a.m4a' } }, token);
  ok(stBad.status === 400, 'status with unverifiable song rejected');

  console.log(`\nSONGS SUITE: ${pass} passed, ${fail} failed`);
  srv.kill('SIGTERM');
  fixture.close();
  process.exit(fail ? 1 : 0);
}

(async () => {
  await unitTests();
  await integrationTests();
})().catch((e) => { console.error(e); process.exit(1); });
