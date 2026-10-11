# 🚂 Deploy +one Backend to Railway

The current production backend domain is `https://broskie-production-5d30.up.railway.app`.
The app configuration and Vercel proxy in this repository now target that service.

## Step 1 — Select the backend service

1. Open the BROSKIE project in Railway and select the production environment.
2. Select the Node backend service (not a database service).
3. Confirm its source is this repository, the root directory is empty, and the builder uses the repository `Dockerfile` (`railway.json` selects it).

## Step 2 — Set backend variables

Open the backend service → **Variables**. Add variables in the **production** environment:

| Variable | Value |
|---|---|
| `JWT_SECRET` | Required. Generate a strong random secret, e.g. `openssl rand -hex 32`. Keep it private and stable. |
| `CORS_ORIGIN` | `https://plusoneco.in,https://www.plusoneco.in` (include the exact HTTPS origin(s) where people open the frontend). |
| `RAILWAY_RUN_UID` | `0` when using a Railway Volume. |
| `DATA_DIR` | `/data` when the volume is mounted at `/data`; the Docker image also defaults to this path. |

**JWT_SECRET is separate from every Supabase key.** If the backend log says `JWT_SECRET is required when NODE_ENV=production`, set this exact variable on the backend service and redeploy. Do not remove the production check or use a development fallback.

### Optional: Supabase Storage for uploads

Only add these if uploads should use Supabase Storage. They are not needed for login:

| Variable | Value |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL, e.g. `https://your-project.supabase.co` |
| `SUPABASE_SECRET_KEY` | A current Supabase server-side secret key. If a previous key was shared or exposed, rotate it first. Never put it in Git or chat. |
| `SUPABASE_BUCKET` | `tomodachi-uploads` (the default) |

`SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_JWKS_URL` are not required by this backend's upload or login flow.

## Step 3 — Attach persistent storage

1. Backend service → **Volumes** → **New Volume**.
2. Mount it at **`/data`**.
3. Keep `DATA_DIR=/data` and `RAILWAY_RUN_UID=0` set, then redeploy.

A newly attached volume is empty. If existing accounts/chats need to be kept, migrate the old SQLite database and uploads before retiring the old backend; a new Railway volume does not copy them automatically.

## Step 4 — Check the backend

The service's public domain is shown in Railway → backend service → **Settings → Networking**. The current configured domain is:

```text
https://broskie-production-5d30.up.railway.app
```

Open `https://broskie-production-5d30.up.railway.app/health`. A healthy service returns JSON containing `"ok": true`.

## Step 5 — Redeploy the frontend

The checked-in `vercel.json` proxies `/api`, `/uploads`, and Android App Links to the Railway backend; `app/src/api.js` uses Railway for Socket.IO. After this repository change is merged, redeploy the Vercel frontend so the new rewrites and bundle are live. The Vercel website does not need `EXPO_PUBLIC_API_URL` for its HTTP requests because it uses the same-origin proxy.

Native app builds bake in their JavaScript and Android network-security configuration. Build and distribute a new APK after updating the backend target; already installed APKs do not receive the native domain configuration automatically.

## Step 6 — Verify login and realtime

1. Open the deployed frontend and create an account, or log in with an account in the Railway database.
2. Open Settings and confirm the connection status is **Connected**.
3. Test a second account and send a message to verify REST login and Socket.IO delivery.

If accounts from the old backend should remain available, migrate the database first. Login credentials live in the app's SQLite database, not in Supabase.

---

Never commit Railway/Supabase secrets, passwords, or tokens. Set them only in the relevant service's Variables panel.
