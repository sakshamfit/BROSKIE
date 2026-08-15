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

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BUCKET = process.env.SUPABASE_BUCKET || 'broskie-uploads';

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

let supabase = null;
const useSupabase = Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY);

if (useSupabase) {
  const { createClient } = require('@supabase/supabase-js');
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Create the bucket if it's missing (safe to call repeatedly). */
async function ensureBucket() {
  if (!useSupabase) return;
  try {
    const { data, error } = await supabase.storage.getBucket(BUCKET);
    if (data && !error) return;
    const { error: createErr } = await supabase.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: '25MB',
      allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'audio/m4a', 'audio/mpeg', 'audio/wav'],
    });
    if (createErr && !/already exists/i.test(createErr.message)) {
      console.warn('[storage] could not create bucket:', createErr.message);
    } else {
      console.log(`[storage] created public bucket "${BUCKET}"`);
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
    if (error) throw new Error(`Supabase upload failed: ${error.message}`);
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(key);
    return data.publicUrl; // absolute https URL
  }

  fs.writeFileSync(path.join(UPLOAD_DIR, key), buffer);
  return `/uploads/${key}`; // relative, served by express.static
}

function describe() {
  return useSupabase
    ? `Supabase Storage (bucket "${BUCKET}")`
    : 'local disk (server/uploads) — files are lost on redeploy';
}

module.exports = { save, ensureBucket, describe, useSupabase, UPLOAD_DIR };
