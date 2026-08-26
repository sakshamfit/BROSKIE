/**
 * Song search — iTunes Search API primary, Deezer API automatic fallback.
 *
 * Both providers are free, key-less, and return ~30-second preview clips —
 * previews only, by design (the same model Instagram/TikTok use for music
 * stickers). Full-track playback intentionally does NOT exist here; adding
 * it requires a real licensing agreement with a provider.
 *
 * The client NEVER calls Apple/Deezer directly — everything is proxied
 * through this module so providers can be swapped without an app update:
 *
 *   searchSongs(query, limit) -> { results, degraded }   (never throws)
 *   lookupSong(id)            -> song | null             (e.g. "itunes:1440857781")
 *
 * Normalized song shape (this is the contract stored on posts/statuses):
 *   { id, provider, title, artist, album, artwork, previewUrl, durationMs }
 *
 * A shared LRU-TTL cache (15 min, 500 entries) keeps typing in the picker
 * well inside the providers' informal rate limits. Every outbound call has
 * a hard 3-second timeout; if both providers fail the caller gets a
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

async function fetchJson(url, timeoutMs = 3000) {
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

/** artworkUrl100 is always `.../100x100bb.jpg` — request 512px instead. */
function upscaleArtwork(url) {
  return url ? String(url).replace('/100x100bb.jpg', '/512x512bb.jpg') : null;
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
    previewUrl: t.previewUrl || null, // ~30s m4a clip
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

async function searchItunes(q, limit) {
  const url = `${ITUNES_BASE}/search?term=${encodeURIComponent(q)}&media=music&entity=song&country=${encodeURIComponent(COUNTRY)}&limit=${limit}`;
  const data = await fetchJson(url);
  return (data?.results || []).map(mapItunes).filter((s) => s && s.previewUrl);
}

async function searchDeezer(q, limit) {
  const url = `${DEEZER_BASE}/search?q=${encodeURIComponent(q)}&limit=${limit}`;
  const data = await fetchJson(url);
  return (data?.data || []).map(mapDeezer).filter((s) => s && s.previewUrl);
}

/**
 * Search songs. Never throws: if both providers fail or time out the caller
 * gets `{ results: [], degraded: true }` and the composer keeps working.
 */
async function searchSongs(query, limit = 15) {
  const q = sanitizeQuery(query);
  const capped = Math.min(25, Math.max(1, Number(limit) || 15));
  if (!q) return { results: [], degraded: false };

  const key = `search:${q.toLowerCase()}|${capped}`;
  const cached = cacheGet(key);
  if (cached) return { results: cached, degraded: false };

  let results = [];
  try {
    results = await searchItunes(q, capped);
  } catch (e) {
    console.error('[songs] itunes search:', e.message);
  }
  if (!results.length) {
    // Apple doesn't have it (or failed) — try Deezer before giving up.
    try {
      results = await searchDeezer(q, capped);
    } catch (e) {
      console.error('[songs] deezer search:', e.message);
    }
  }
  if (!results.length) return { results: [], degraded: true };
  cacheSet(key, results);
  return { results, degraded: false };
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
 *  - New-format ids ("itunes:…"/"deezer:…") are RE-VERIFIED against the
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

module.exports = { searchSongs, lookupSong, verifyAttachment, sanitizeQuery, mapItunes, mapDeezer };
