/**
 * File storage with two backends.
 *
 *  - Supabase Storage  (when SUPABASE_URL + SUPABASE_SERVICE_KEY are set)
 *      Uploads survive redeploys and are served from Supabase's CDN.
 *  - Local disk        (fallback, zero config)
 *      Fine for local dev; files are LOST on every deploy on ephemeral hosts.
 *
 * The chosen backend is decided once at boot and logged, so it's obvious which
 * one is live.
 */
const path = require('path');
const fs = require('fs');
const { customAlphabet } = require('nanoid');

const nano = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 16);

// Accept either naming style. NEXT_PUBLIC_* is included because Supabase's
// dashboard copy-paste uses it, but note these are all read SERVER-side here.
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY;
const BUCKET = process.env.SUPABASE_BUCKET || 'tomodachi-uploads';
const ALLOWED_UPLOAD_MIME_TYPES = [
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'audio/m4a', 'audio/mp4', 'audio/aac', 'audio/mpeg', 'audio/wav',
  'audio/webm', 'audio/ogg', 'audio/3gpp',
];

/**
 * Publishable/anon keys can upload only if the bucket already exists AND an
 * RLS policy allows it; they can never create buckets. Secret/service_role
 * keys can do both. Detect so we can log something actionable.
 */
const isPublishableKey =
  !!SUPABASE_SERVICE_KEY && /^sb_publishable_/.test(SUPABASE_SERVICE_KEY);

// Same override pattern as db.js: point this at a mounted persistent volume
// (Railway Volume, Render Disk) so local-disk uploads survive redeploys too.
// Falls back to server/uploads for local dev (zero config). Irrelevant once
// Supabase Storage is configured (SUPABASE_URL + key), since that path never
// touches local disk at all.
const VOLUME_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH;
const UPLOAD_DIR = VOLUME_DIR
  ? path.join(path.resolve(VOLUME_DIR), 'uploads')
  : path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

let supabase = null;
const useSupabase = Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY);

if (useSupabase) {
  const { createClient } = require('@supabase/supabase-js');
  // supabase-js spins up a Realtime client on construction, which needs a
  // global WebSocket. Node < 22 has none, and it throws at require-time —
  // taking the whole server down. We only use Storage, so give it `ws`.
  let transport;
  try {
    transport = require('ws');
  } catch {
    /* ws not installed; only matters on Node < 22 */
  }
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: transport ? { transport } : undefined,
  });
}

/** Create the bucket if it's missing (safe to call repeatedly). */
async function ensureBucket() {
  if (!useSupabase) return;
  try {
    const { data, error } = await supabase.storage.getBucket(BUCKET);
    if (data && !error) {
      // Keep existing production buckets compatible with browser WebM and
      // native M4A/AAC voice notes as formats evolve.
      const { error: updateErr } = await supabase.storage.updateBucket(BUCKET, {
        public: true,
        fileSizeLimit: '25MB',
        allowedMimeTypes: ALLOWED_UPLOAD_MIME_TYPES,
      });
      if (updateErr) console.warn(`[storage] bucket MIME update skipped: ${updateErr.message}`);
      console.log(`[storage] bucket "${BUCKET}" found`);
      return;
    }

    const { error: createErr } = await supabase.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: '25MB',
      allowedMimeTypes: ALLOWED_UPLOAD_MIME_TYPES,
    });

    if (!createErr) {
      console.log(`[storage] created public bucket "${BUCKET}"`);
      return;
    }
    if (/already exists/i.test(createErr.message)) return;

    // Most common cause: a publishable/anon key, which cannot manage buckets.
    console.warn(`[storage] could not create bucket "${BUCKET}": ${createErr.message}`);
    if (isPublishableKey || /row-level security|Unauthorized|AccessDenied/i.test(createErr.message)) {
      console.warn(
        '[storage] ACTION REQUIRED — you are using a publishable/anon key.\n' +
        `[storage]   1) Supabase dashboard → Storage → New bucket → name it "${BUCKET}" → tick PUBLIC\n` +
        '[storage]   2) Add an INSERT policy on storage.objects for that bucket,\n' +
        '[storage]      or use the secret (service_role) key instead — see SUPABASE.md'
      );
    }
  } catch (e) {
    console.warn('[storage] bucket check failed:', e.message);
  }
}

/**
 * Persist a file buffer.
 * @returns {Promise<string>} public URL (absolute for Supabase, /uploads/... for local)
 */
async function save(buffer, originalName = 'upload.bin', mimeType = 'application/octet-stream') {
  const ext = path.extname(originalName) || '';
  const key = `${nano()}${ext}`;

  if (useSupabase) {
    const { error } = await supabase.storage.from(BUCKET).upload(key, buffer, {
      contentType: mimeType,
      upsert: false,
      cacheControl: '31536000',
    });
    if (!error) {
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(key);
      return data.publicUrl; // absolute https URL
    }

    // Don't lose the user's photo because storage is misconfigured — warn
    // loudly and fall back to local disk so the message still sends.
    console.warn(`[storage] Supabase upload failed (${error.message}); falling back to local disk`);
    if (/row-level security|Unauthorized|AccessDenied|not found|Bucket not found/i.test(error.message)) {
      console.warn(
        `[storage] Fix: create a PUBLIC bucket named "${BUCKET}" in the Supabase dashboard, ` +
        'and either add an INSERT policy for it or use the secret (service_role) key.'
      );
    }
  }

  fs.writeFileSync(path.join(UPLOAD_DIR, key), buffer);
  return `/uploads/${key}`; // relative, served by express.static
}

function describe() {
  if (!useSupabase) return 'local disk (server/uploads) — files are lost on redeploy';
  const keyKind = isPublishableKey ? 'publishable/anon key' : 'secret key';
  return `Supabase Storage (bucket "${BUCKET}", ${keyKind})`;
}

module.exports = { save, ensureBucket, describe, useSupabase, UPLOAD_DIR };
