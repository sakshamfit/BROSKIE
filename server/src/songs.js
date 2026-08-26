/**
 * Song search — iTunes Search API + Deezer API, queried together.
 *
 * Both providers are free, key-less, and return ~30-second preview clips —
 * previews only, by design (the same model Instagram/TikTok use for music
 * stickers). Full-track playback intentionally does NOT exist here; adding
 * it requires a real licensing agreement with a provider.
 *
 * The client NEVER calls Apple/Deezer directly — everything is proxied
 * through this module so providers can be swapped without an app update:
 *
 *   searchSongs(query, limit, profile) -> { results, degraded }   (never throws)
 *   lookupSong(id)                     -> song | null
 *   rankSongs(songs, profile, query)   -> songs (vibe-first)
 *
 * Normalized song shape (this is the contract stored on posts/statuses):
 *   { id, provider, title, artist, album, artwork, previewUrl, durationMs }
 *
 * A shared LRU-TTL cache (15 min, 500 entries) keeps typing in the picker
 * well inside the providers' informal rate limits. Every outbound call has
 * a hard 5-second timeout; if both providers fail the caller gets a
 * `degraded` flag instead of an exception — a broken song search must never
 * crash post creation.
 */
const ITUNES_BASE = process.env.ITUNES_API_BASE || 'https://itunes.apple.com';
const DEEZER_BASE = process.env.DEEZER_API_BASE || 'https://api.deezer.com';
const COUNTRY = process.env.ITUNES_COUNTRY || 'US';
const TTL_MS = 15 * 60 * 1000;
const CACHE_MAX = 500;

const cache = new Map(); // key -> { at, value }
let lastSweep = 0;

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > TTL_MS) { cache.delete(key); return undefined; }
  // Refresh recency (Map preserves insertion order → LRU-ish).
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
}

function cacheSet(key, value) {
  const t = Date.now();
  if (t - lastSweep > 300000) {
    lastSweep = t;
    for (const [k, v] of cache) if (t - v.at > TTL_MS) cache.delete(k);
  }
  cache.set(key, { at: t, value });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

/** Client/server input hygiene before anything reaches a provider URL:
 *  unicode-normalize, collapse whitespace (tabs/newlines → single space),
 *  strip remaining control characters, cap length. Exported because the
 *  route applies it too (defense in depth). */
function sanitizeQuery(raw) {
  return String(raw || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .trim()
    .slice(0, 100);
}

function sanitizeArtistName(raw) {
  return String(raw || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .trim()
    .slice(0, 80);
}

async function fetchJson(url, timeoutMs = 5000) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller?.signal });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** artworkUrl100 is usually `.../100x100bb.jpg` — request 512px instead. */
function upscaleArtwork(url) {
  if (!url) return null;
  return String(url).replace(/\/\d+x\d+([a-z]*)\.(jpg|png|webp)/i, '/512x512$1.$2');
}

function mapItunes(t) {
  if (!t || !t.trackId) return null;
  return {
    id: `itunes:${t.trackId}`,
    provider: 'itunes',
    title: t.trackName || 'Unknown track',
    artist: t.artistName || 'Unknown artist',
    album: t.collectionName || '',
    artwork: upscaleArtwork(t.artworkUrl100),
    previewUrl: t.previewUrl || null, // ~30s m4a clip (may be missing in some stores)
    durationMs: Number(t.trackTimeMillis) || 0,
  };
}

function mapDeezer(t) {
  if (!t || !t.id) return null;
  return {
    id: `deezer:${t.id}`,
    provider: 'deezer',
    title: t.title_short || t.title || 'Unknown track',
    artist: t.artist?.name || 'Unknown artist',
    album: t.album?.title || '',
    artwork: t.album?.cover_big || t.album?.cover_medium || t.album?.cover_xl || null,
    previewUrl: t.preview || null, // ~30s mp3 clip
    durationMs: (Number(t.duration) || 0) * 1000,
  };
}

function fold(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function songKey(song) {
  return `${fold(song?.title)}|${fold(song?.artist)}`;
}

function tokens(s) {
  return fold(s).split(' ').filter((w) => w.length > 1);
}

function tokenOverlap(a, b) {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const t of A) if (B.has(t)) hit += 1;
  return hit / Math.max(A.size, B.size);
}

/** Merge provider lists. Same title+artist keeps the copy that has a preview
 *  (and otherwise the first one seen). */
function mergeSongs(lists) {
  const byKey = new Map();
  const extras = [];
  for (const list of lists) {
    for (const song of list || []) {
      if (!song || !song.id) continue;
      const key = songKey(song);
      if (!key || key === '|') {
        extras.push(song);
        continue;
      }
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, song);
        continue;
      }
      if (!existing.previewUrl && song.previewUrl) byKey.set(key, song);
    }
  }
  return [...byKey.values(), ...extras];
}

function artistMatches(songArtist, fav) {
  const a = fold(songArtist);
  const f = fold(fav);
  if (!a || !f) return 0;
  if (a === f) return 1;
  if (a.includes(f) || f.includes(a)) return 0.7;
  const overlap = tokenOverlap(a, f);
  return overlap >= 0.5 ? overlap : 0;
}

/**
 * Rank songs so the user's vibe lands first: favourite artists, songs they
 * already attached, then preview availability and query closeness.
 */
function rankSongs(songs, profile, query) {
  const list = Array.isArray(songs) ? songs.slice() : [];
  const favs = (profile?.favoriteArtists || []).map(sanitizeArtistName).filter(Boolean);
  const recents = profile?.recents || [];
  const q = fold(query);
  const scored = list.map((song, index) => {
    let score = 0;
    if (song.previewUrl) score += 8;
    for (const fav of favs) {
      const m = artistMatches(song.artist, fav);
      if (m >= 1) score += 100;
      else if (m >= 0.7) score += 55;
      else if (m > 0) score += Math.round(35 * m);
    }
    for (const recent of recents) {
      if (recent?.id && recent.id === song.id) score += 90;
      else if (fold(recent?.title) === fold(song.title) && fold(recent?.artist) === fold(song.artist)) score += 80;
      else if (fold(recent?.artist) && fold(recent.artist) === fold(song.artist)) score += 40;
    }
    if (q) {
      const title = fold(song.title);
      const artist = fold(song.artist);
      if (title === q || artist === q) score += 25;
      else if (title.startsWith(q) || artist.startsWith(q)) score += 12;
      else if (title.includes(q) || artist.includes(q)) score += 6;
    }
    return { song, score, index };
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((row) => row.song);
}

function itunesCountries() {
  const extras = String(process.env.ITUNES_COUNTRIES || 'IN,GB')
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter((c) => /^[A-Z]{2}$/.test(c));
  return [...new Set([String(COUNTRY || 'US').toUpperCase(), ...extras])].slice(0, 3);
}

function queryVariants(q) {
  const variants = [q];
  const stripped = q
    .replace(/\s*[([{].+$/, '')
    .replace(/\s+(feat\.?|ft\.?|featuring)\s+.+$/i, '')
    .trim();
  if (stripped && stripped !== q && stripped.length >= 2) variants.push(stripped);
  return variants.slice(0, 2);
}

async function searchItunes(q, limit, country = COUNTRY) {
  const url = `${ITUNES_BASE}/search?term=${encodeURIComponent(q)}&media=music&entity=song&country=${encodeURIComponent(country)}&limit=${limit}`;
  const data = await fetchJson(url);
  return (data?.results || []).map(mapItunes).filter(Boolean);
}

async function searchDeezer(q, limit) {
  const url = `${DEEZER_BASE}/search?q=${encodeURIComponent(q)}&limit=${limit}`;
  const data = await fetchJson(url);
  return (data?.data || []).map(mapDeezer).filter(Boolean);
}

async function settledList(promise) {
  try {
    return await promise;
  } catch (e) {
    console.error('[songs] provider:', e.message);
    return null; // null = failed (distinct from empty [])
  }
}

/**
 * Search songs. Never throws: if both providers fail or time out the caller
 * gets `{ results: [], degraded: true }` and the composer keeps working.
 *
 * Both providers are queried in parallel (and extra iTunes storefronts when
 * the first pass is thin) so a track that only lives on Deezer, or only in
 * the IN/GB iTunes store, still shows up.
 */
async function searchSongs(query, limit = 20, profile = null) {
  const q = sanitizeQuery(query);
  const capped = Math.min(40, Math.max(1, Number(limit) || 20));
  if (!q) return { results: [], degraded: false };

  const key = `search:${q.toLowerCase()}|${capped}`;
  const cached = cacheGet(key);
  if (cached) {
    return { results: rankSongs(cached, profile, q).slice(0, capped), degraded: false };
  }

  const countries = itunesCountries();
  const primaryCountry = countries[0];
  const [itunesPrimary, deezerPrimary] = await Promise.all([
    settledList(searchItunes(q, capped, primaryCountry)),
    settledList(searchDeezer(q, capped)),
  ]);

  let lists = [itunesPrimary || [], deezerPrimary || []];
  let failed = itunesPrimary === null && deezerPrimary === null;
  let merged = mergeSongs(lists);

  // Thin first pass: try other storefronts + a stripped query variant so
  // regional / "feat." titles aren't dropped just because the US catalog
  // ranked something else.
  if (merged.length < Math.min(8, capped)) {
    const extras = [];
    for (const country of countries.slice(1)) {
      extras.push(settledList(searchItunes(q, capped, country)));
    }
    for (const variant of queryVariants(q).slice(1)) {
      extras.push(settledList(searchItunes(variant, capped, primaryCountry)));
      extras.push(settledList(searchDeezer(variant, capped)));
    }
    if (extras.length) {
      const more = await Promise.all(extras);
      if (more.some((r) => r !== null)) failed = false;
      merged = mergeSongs([...lists, ...more.map((r) => r || [])]);
    }
  }

  if (!merged.length) return { results: [], degraded: failed || true };
  cacheSet(key, merged);
  return { results: rankSongs(merged, profile, q).slice(0, capped), degraded: false };
}

/** Look one song back up by its normalized id ("itunes:1440857781") — used
 *  both by GET /api/songs/:id and to verify client-supplied attachments
 *  server-side instead of trusting their title/artist/artwork. */
async function lookupSong(id) {
  const m = /^(itunes|deezer):([0-9]+)$/.exec(String(id || ''));
  if (!m) return null;
  const [, provider, nativeId] = m;
  const key = `lookup:${provider}:${nativeId}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  let song = null;
  try {
    if (provider === 'itunes') {
      const url = `${ITUNES_BASE}/lookup?id=${encodeURIComponent(nativeId)}&country=${encodeURIComponent(COUNTRY)}`;
      const data = await fetchJson(url);
      song = mapItunes((data?.results || []).find((t) => t.wrapperType === 'track' && String(t.trackId) === nativeId) || null);
    } else {
      const url = `${DEEZER_BASE}/track/${encodeURIComponent(nativeId)}`;
      const data = await fetchJson(url);
      song = data && data.id ? mapDeezer(data) : null;
    }
  } catch (e) {
    console.error('[songs] lookup', id, e.message);
    song = null;
  }
  // Negative results are cached too (short-TTL value via same structure) so a
  // bad id cannot be hammered against the providers.
  cacheSet(key, song);
  return song;
}

/**
 * Validate a client-supplied song attachment for a post/status.
 *  - New-format ids ("itunes:…"/ "deezer:…") are RE-VERIFIED against the
 *    provider and the provider's own data is stored — a user cannot spoof
 *    arbitrary title/artist text (or a malicious artwork URL) into a feed.
 *  - Legacy ids (plain numeric / jamendo:*, sent by app versions released
 *    before Phase 9) are accepted as a strictly sanitized allowlist copy so
 *    old clients keep working.
 * Never throws. Returns { song } or { error }.
 */
async function verifyAttachment(song) {
  if (!song || typeof song !== 'object' || Array.isArray(song)) return { error: 'Invalid song attachment.' };
  const rawId = String(song.id || '');
  if (/^(itunes|deezer):[0-9]+$/.test(rawId)) {
    const verified = await lookupSong(rawId);
    if (!verified) return { error: 'That song could not be verified — search for it again.' };
    return { song: verified };
  }

  const httpsUrl = (v) => {
    const s = String(v || '');
    return /^https:\/\/[^\s"'<>\\]+$/.test(s) ? s : null;
  };
  const out = {
    id: rawId.slice(0, 64) || null,
    provider: String(song.provider || song.source || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24) || null,
    title: String(song.title || song.name || '').slice(0, 120),
    artist: String(song.artist || '').slice(0, 120),
    album: String(song.album || '').slice(0, 160),
    artwork: httpsUrl(song.artwork || song.albumArt),
    previewUrl: httpsUrl(song.previewUrl),
    durationMs: Math.max(0, Math.min(600000, Math.round(Number(song.durationMs) || 0))),
  };
  if (!out.previewUrl) return { error: 'Invalid song attachment.' };
  return { song: out };
}

function uniqueArtists(songs, limit = 12) {
  const seen = new Set();
  const out = [];
  for (const song of songs || []) {
    const name = sanitizeArtistName(song?.artist);
    const key = fold(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= limit) break;
  }
  return out;
}

module.exports = {
  searchSongs,
  lookupSong,
  verifyAttachment,
  sanitizeQuery,
  sanitizeArtistName,
  mapItunes,
  mapDeezer,
  mergeSongs,
  rankSongs,
  songKey,
  uniqueArtists,
  upscaleArtwork,
};
