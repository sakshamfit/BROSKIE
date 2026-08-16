/**
 * Jamendo API client for song-attachment search on statuses.
 * Jamendo is a Creative-Commons music catalogue with a simple client_id
 * based auth (no OAuth needed for public search), and — unlike Spotify's
 * Client Credentials flow — it returns full-length streamable audio URLs,
 * not just 30s previews.
 *
 * Docs: https://developer.jamendo.com/v3.0/tracks
 */
const CLIENT_ID = process.env.JAMENDO_CLIENT_ID;

const isConfigured = () => !!CLIENT_ID;

async function searchTracks(query, limit = 16) {
  if (!CLIENT_ID) return [];
  const url =
    `https://api.jamendo.com/v3.0/tracks/?client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&format=json&limit=${limit}&namesearch=${encodeURIComponent(query)}` +
    `&audioformat=mp32&imagesize=300&include=musicinfo&boost=popularity_total`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Jamendo search failed (${res.status})`);
  const data = await res.json();
  if (data?.headers?.status !== 'success') {
    throw new Error(data?.headers?.error_message || 'Jamendo search failed');
  }

  return (data.results || []).map((t) => ({
    id: String(t.id),
    name: t.name,
    artist: t.artist_name,
    album: t.album_name || '',
    albumArt: t.album_image || t.image || null,
    previewUrl: t.audio || null, // full track stream, not just a 30s clip
    url: t.shareurl || null,
    durationMs: (t.duration || 0) * 1000,
    source: 'jamendo',
  }));
}

module.exports = { isConfigured, searchTracks };
