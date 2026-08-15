# Supabase Storage for BROSKIE uploads

By default BROSKIE writes uploaded photos to `server/uploads` on local disk.
On Railway/Render that disk is **ephemeral** — every redeploy wipes it and
previously shared images 404.

Pointing uploads at Supabase Storage fixes that: files persist, and they're
served from Supabase's CDN instead of your Node process.

**This is opt-in.** With no env vars set, the server keeps using local disk, so
local development needs zero configuration.

---

## Setup (about 3 minutes)

### 1. Create a project
https://supabase.com → **New project**. Any region; the free tier is fine
(1 GB storage).

### 2. Grab the credentials
**Project Settings → API**:

| Field | Env var |
|---|---|
| Project URL | `SUPABASE_URL` |
| `service_role` key (under *Project API keys*) | `SUPABASE_SERVICE_KEY` |

> ⚠️ Use the **`service_role`** key, not `anon`. It's a server-side secret that
> bypasses row-level security — it must only ever live in your backend env
> vars. Never put it in the app or commit it.

### 3. Add the variables on Railway
Your service → **Variables** → add:

```
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOi...        # service_role key
SUPABASE_BUCKET=broskie-uploads           # optional, this is the default
```

Railway redeploys automatically.

### 4. Confirm it's live
Check the deploy logs for:

```
[storage] Supabase Storage (bucket "broskie-uploads")
```

If you instead see `local disk … files are lost on redeploy`, the env vars
aren't set (check for typos or stray whitespace).

The bucket is created automatically on first boot as a **public** bucket with a
25 MB limit. You can also create it by hand under **Storage → New bucket**.

### 5. Test it
Send a photo in a chat, then **redeploy**. The image should still load —
previously it would have 404'd.

---

## How it works

`server/src/storage.js` picks a backend once at boot:

```
SUPABASE_URL + SUPABASE_SERVICE_KEY set?  →  Supabase Storage
otherwise                                 →  local disk
```

Uploads are buffered in memory by multer, then handed to `storage.save()`,
which returns the URL stored in the message row:

| Backend | Stored URL |
|---|---|
| Supabase | `https://xxxx.supabase.co/storage/v1/object/public/broskie-uploads/ab12.png` |
| Local | `/uploads/ab12.png` |

The client's `mediaUrl()` passes absolute URLs through untouched and prefixes
relative ones with the API origin, so **both forms render correctly** — old
local URLs already in the database keep working after you switch.

---

## What this does *not* fix

Storage only covers files. **Your chats, users and messages still live in
SQLite** on the ephemeral disk, so they reset on redeploy.

To fix that, pick one:

| Option | Effort | Notes |
|---|---|---|
| **Railway Volume** | 2 min, no code | Mount at `/app/server/data`. SQLite persists. Single instance only. |
| **Supabase Postgres** | Real refactor | ~52 SQL calls to convert from sync `better-sqlite3` to async `pg`. Enables multiple instances. |

The volume is the pragmatic choice for a demo; Postgres is the answer if you
outgrow one server.

---

## Cost

Supabase free tier: **1 GB storage, 2 GB egress/month**. Plenty for a demo.
Files are public-read via unguessable 16-character names — fine for a chat
demo, but note that anyone with the URL can view an image. For private media
you'd switch the bucket to private and issue signed URLs.
