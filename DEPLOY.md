# Deploying BROSKIE

BROSKIE is **two** programs, and they deploy to different places:

| Part | What it is | Vercel? |
|---|---|---|
| `app/` | Expo React Native web build — static HTML/JS | ✅ Yes, perfect fit |
| `server/` | Express + **Socket.IO** + SQLite, long-lived WebSockets | ❌ No — use Railway/Render/Fly |

**Why the server can't go on Vercel:** Vercel runs serverless functions that
spin up per-request and shut down. Socket.IO needs a process that stays alive
holding open WebSocket connections, and it keeps in-memory state (the
`sockets` Map of who is online). It also writes to a SQLite file on local
disk, which Vercel's read-only, ephemeral filesystem doesn't allow.

Put the frontend on Vercel and the backend on a host that runs a real process.

---

## Step 1 — Deploy the backend first

You need its public URL before the frontend build.

### Railway (easiest)
1. https://railway.app → **New Project → Deploy from GitHub repo** → pick `BROSKIE`
2. **Settings → Root Directory:** `server`
3. **Variables:** add `JWT_SECRET` = a long random string
   (generate one: `openssl rand -hex 32`)
4. Deploy, then **Settings → Networking → Generate Domain**
5. Copy the URL, e.g. `https://broskie-production.up.railway.app`

Railway sets `PORT` automatically and the server already reads it.

### Render (alternative)
- **New → Web Service** → repo `BROSKIE`
- Root Directory `server`, Build `npm install`, Start `npm start`
- Add `JWT_SECRET`. Note: the free tier sleeps after inactivity — the first
  request wakes it and sockets reconnect automatically.

### Seed the demo data (optional)
In the host's shell/console: `npm run seed`

> ⚠️ **SQLite on ephemeral disks.** Railway/Render wipe the container
> filesystem on redeploy, so chats reset. Fine for a demo. For anything real,
> attach a persistent volume (Railway supports this) or move to Postgres.

---

## Step 2 — Deploy the frontend to Vercel

1. https://vercel.com/new → **Import** `sakshamfit/BROSKIE`
2. Vercel reads `vercel.json` at the repo root, so leave the build settings alone
3. **Environment Variables** → add:

   | Name | Value |
   |---|---|
   | `EXPO_PUBLIC_API_URL` | `https://your-backend.up.railway.app` |

   No trailing slash. This **must** be set at build time — Expo inlines
   `EXPO_PUBLIC_*` vars into the bundle, so changing it later requires a redeploy.
4. **Deploy**

### Step 3 — Let the frontend talk to the backend
The server currently allows all origins (`cors({ origin: '*' })`), which works
out of the box. To lock it down to just your Vercel domain, edit
`server/src/index.js`:

```js
const ORIGIN = process.env.CORS_ORIGIN || '*';
app.use(cors({ origin: ORIGIN }));
const io = new Server(server, { cors: { origin: ORIGIN }, maxHttpBufferSize: 3e7 });
```

then set `CORS_ORIGIN=https://your-app.vercel.app` on the backend host.

---

## Verifying it worked

1. Open your Vercel URL → log in with `+919000000001` / `1234`
2. Go to **Settings** — the dot under your name should read **Connected**
   (green). Red "Reconnecting…" means `EXPO_PUBLIC_API_URL` is wrong or the
   backend is down.
3. Open the site in a second browser (or incognito), log in as
   `+919000000002`, and message between them — messages, typing indicators and
   blue ticks should be instant.

## Troubleshooting

| Symptom | Cause |
|---|---|
| "Reconnecting…" in Settings | `EXPO_PUBLIC_API_URL` missing/typo'd, or backend asleep |
| Login says "Failed to fetch" | Backend URL wrong, or it's `http://` while the site is `https://` (browsers block mixed content) |
| Messages send but don't arrive | WebSockets blocked — confirm the backend host supports them (Vercel functions do not) |
| Uploaded images 404 after redeploy | Local `uploads/` was wiped; use S3/Cloudinary for persistence |
| Chats disappeared after redeploy | Ephemeral SQLite; attach a volume or use Postgres |

---

## One-command alternative (both on Railway)

If juggling two hosts is annoying, Railway can serve the built frontend from
the Express app: run `npx expo export --platform web` in `app/`, copy
`app/dist` into the server, and add `app.use(express.static('dist'))`. One URL,
no CORS. Ask and I'll wire it up.
