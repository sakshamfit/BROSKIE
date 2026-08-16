/**
 * Minimal Spotify Web API client for song-attachment search on statuses.
 * Uses the Client Credentials flow (no user login needed) — good enough
 * for track search + 30s preview URLs.
 */
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

let cachedToken = null;
let cachedAt = 0;

async function getToken() {
  if (!CLIENT_ID || !CLIENT_SECRET) return null;
  if (cachedToken && Date.now() < cachedAt) return cachedToken;

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Spotify auth failed (${res.status})`);
  const data = await res.json();
  cachedToken = data.access_token;
  cachedAt = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

const isConfigured = () => !!(CLIENT_ID && CLIENT_SECRET);

async function searchTracks(query, limit = 12) {
  const token = await getToken();
  if (!token) return [];
  const url = `https://api.spotify.com/v1/search?type=track&limit=${limit}&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Spotify search failed (${res.status})`);
  const data = await res.json();
  return (data.tracks?.items || []).map((t) => ({
    id: t.id,
    name: t.name,
    artist: (t.artists || []).map((a) => a.name).join(', '),
    album: t.album?.name || '',
    albumArt: t.album?.images?.[1]?.url || t.album?.images?.[0]?.url || null,
    previewUrl: t.preview_url,
    url: t.external_urls?.spotify || null,
    durationMs: t.duration_ms,
  }));
}

module.exports = { isConfigured, searchTracks };
