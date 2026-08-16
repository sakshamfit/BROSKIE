# 🚂 Deploy 友達 Backend to Railway

## Step 1 — Deploy to Railway

1. Go to [https://railway.app](https://railway.app) and log in (GitHub login works)
2. Click **New Project** → **Deploy from GitHub repo**
3. Select `sakshamfit/BROSKIE`
4. Railway auto-detects Node from root `package.json` and reads `railway.json`

## Step 2 — Add Environment Variables

In your Railway project dashboard → **Variables**, add these:

| Variable | Value |
|---|---|
| `JWT_SECRET` | Generate one: click "Generate" or run `openssl rand -hex 32` |
| `SUPABASE_URL` | `https://ldrdawvivzggzoxyiugf.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Your secret key (from Supabase dashboard → Settings → API → `service_role` key) |
| `SUPABASE_BUCKET` | `tomodachi-uploads` |

> ⚠️ **Never put these in your repo** — Railway's Variables panel keeps them secret.

## Step 3 — Get Your Backend URL

In Railway → **Settings** → **Networking** → **Generate Domain**.  
Copy the URL — it'll look like `https://your-app.up.railway.app`

## Step 4 — Create your account

There's no demo data seeded anymore — the app runs entirely on real
accounts. Open the deployed app and use **Sign Up** to create your own
account with a username and password; anyone else who wants an account
signs up the same way. (If you specifically want throwaway test data for
local development only, `cd server && node src/seed.js --yes-wipe-real-data`
still exists — the flag is required on purpose since it wipes every
existing user/chat first. Never run it against a production database.)

## Step 5 — Point Vercel Frontend to Railway

1. Go to [https://vercel.com](https://vercel.com) → your `broskie-mu` project
2. **Settings** → **Environment Variables**
3. Add: `EXPO_PUBLIC_API_URL` = `https://your-app.up.railway.app` (your Railway URL, no trailing slash)
4. Go to **Deployments** → trigger a **Redeploy** (three dots menu → Redeploy)
5. Vercel rebuilds the frontend with the backend URL baked in

## Step 6 — Verify

1. Open `https://broskie-mu.vercel.app` — sign up for an account (or log in with one you already created)
2. Open **Settings** — the connection dot should show **Connected** (yellow/green)
3. Open a second browser tab, sign up as a second account, and message between them — it should arrive instantly with blue ticks

---

## Done! 🎉

The frontend lives on Vercel's CDN, the real-time backend runs on Railway, and uploaded images persist via your Supabase bucket — all working together.