/**
 * iTunes Search API client for song-attachment search.
 *
 * Docs: https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTunesSearchAPI/LookupExamples.html
 *
 * Zero configuration — no API key. Returns 30-second streamable previews
 * (previewUrl, .m4a — playable by expo-audio and browser <audio>), album
 * artwork and durations. This is the DEFAULT song source; Jamendo remains
 * an optional secondary source (full-length Creative-Commons tracks) that
 * is appended when JAMENDO_CLIENT_ID is configured.
 *
 * The Search API is rate-limited (~20 req/min); hot queries are served from
 * a small in-memory TTL cache so typing in the picker doesn't hammer it.
 */
const API_BASE = process.env.ITUNES_API_BASE || 'https://itunes.apple.com';
const COUNTRY = process.env.ITUNES_COUNTRY || 'US';
const TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 200;

const cache = new Map(); // "q|limit" -> { at, tracks }
let lastSweep = 0;

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) { cache.delete(key); return null; }
  // refresh recency (Map iteration order = LRU-ish)
  cache.delete(key);
  cache.set(key, hit);
  return hit.tracks;
}

function cacheSet(key, tracks) {
  const t = Date.now();
  if (t - lastSweep > 300000) {
    lastSweep = t;
    for (const [k, v] of cache) if (t - v.at > TTL_MS) cache.delete(k);
  }
  cache.set(key, { at: t, tracks });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

/** Map one iTunes result to the app's song shape (same shape Jamendo maps to,
 * so stored status/post songs and the client stay compatible). */
function mapTrack(t) {
  return {
    id: String(t.trackId ?? t.collectionId ?? ''),
    name: t.trackName || t.collectionName || 'Unknown track',
    artist: t.artistName || 'Unknown artist',
    album: t.collectionName || '',
    // artworkUrl100 is always `.../100x100bb.jpg` — request 300px instead.
    albumArt: t.artworkUrl100 ? String(t.artworkUrl100).replace('/100x100bb.jpg', '/300x300bb.jpg') : null,
    previewUrl: t.previewUrl || null, // ~30s m4a clip
    url: t.trackViewUrl || null,      // Apple Music / iTunes web link
    durationMs: Number(t.trackTimeMillis) || 0,
    source: 'itunes',
  };
}

async function searchTracks(query, limit = 16) {
  const q = String(query || '').trim();
  if (!q) return [];
  const capped = Math.min(25, Math.max(1, Number(limit) || 16));
  const key = `${q.toLowerCase()}|${capped}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const url =
    `${API_BASE}/search?term=${encodeURIComponent(q)}` +
    `&media=music&entity=song&country=${encodeURIComponent(COUNTRY)}&limit=${capped}`;

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), 6000);
  try {
    const res = await fetch(url, { signal: controller?.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`iTunes search failed (${res.status})`);
    const data = await res.json();
    // Empty catalog is a normal answer for obscure queries, not an error.
    const tracks = (data?.results || []).filter((t) => t && t.previewUrl !== undefined).map(mapTrack);
    cacheSet(key, tracks);
    return tracks;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

module.exports = { searchTracks, mapTrack };
