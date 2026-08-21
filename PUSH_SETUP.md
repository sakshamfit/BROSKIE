# PUSH_SETUP.md — one-time Android push setup (FCM v1)

Everything in Phase 1 push is already in the code. This page is the **only
manual step**: connecting your Firebase project to Expo so Android pushes can
actually be delivered. It is done once, takes ~10 minutes, and needs **no code
changes and no server configuration**.

Two ways to think about what you're doing:

- **Firebase** is Google's push infrastructure. You create a project there and
  download a "service account key" (a JSON file) that grants permission to send
  pushes to your app.
- **EAS** (Expo's build service, the same one that builds your APKs) stores that
  key for you. Expo's push service then uses it to deliver every push the +one
  server sends.

> ⚠️ The JSON key is a **secret**. Never commit it to this repo, never paste it
> into chat or AI tools, never email it. If it ever leaks, delete it in Firebase
> (Service accounts) and generate a new one.

---

## Before you start (2 checks)

1. **Merge & deploy the push PR** (Phase 1). The Railway backend emits the
   pushes — if `server/src/push.js` isn't deployed, nothing will send, no matter
   how perfect Firebase is. Check it's live:
   `https://broskie-h.up.railway.app/api/health` should respond `ok: true`
   after the deploy.
2. **Confirm which Expo account builds your APKs:**
   ```bash
   cd app
   npx eas whoami
   ```
   You'll upload the Firebase key to *this* account (the one linked to project
   `saksham`, id `cfaadedd-ce58-4cec-b88f-261178485cda`). If you're not logged
   in: `npx eas login`.

---

## Step 1 — Create the Firebase project

1. Go to <https://console.firebase.google.com> and sign in with any Google
   account (a new/free one is fine — Spark free plan is enough for push).
2. Click **Create a project** (or "Add project").
3. Name it something recognizable, e.g. **plusone**.
4. Google Analytics: **disable** it (not needed for push).
5. Click **Create project** → **Continue**. You're now inside the project.

## Step 2 — Register the Android app + save `google-services.json`

FCM only delivers to an app that is registered in the Firebase project with the
exact package name.

1. On the project overview page, click the **Android robot icon** ("Add app" →
   Android). (Or ⚙️ *Project settings* → *Your apps* → Android icon.)
2. **Android package name:** `ai.arena.tomodachi`
   — must match `app/app.json` → `expo.android.package` **exactly**
   (case-sensitive, no spaces). This is the #1 cause of "no push arrives".
3. App nickname: `+one`. Debug signing certificate SHA-1: **leave empty**.
4. Click **Register app**.
5. Firebase shows a **Download `google-services.json`** screen. **Download it
   and save it as `app/google-services.json`** in this repo (the Expo project
   root is the `app/` folder — next to `app.json`), then commit and push.
   - This file contains only **public identifiers** — the Expo docs explicitly
     say it's safe to commit, and it *must* be committed: remote `eas build`
     uploads only git-tracked files, so a gitignored file never reaches the
     build (classic failure: *"Default FirebaseApp is not initialized"*).
   - `app/app.json` already points at it via
     `expo.android.googleServicesFile: "./google-services.json"`. If the file
     is missing, the build fails with *"Cannot copy google-services.json"* —
     intentional, so you can't ship a silently-pushless APK.
6. The same Firebase screen then shows **Gradle / Google-services-plugin /
   Firebase BoM instructions — ignore them.** They're for hand-written native
   Android apps. Expo's build does that wiring automatically (its config
   plugin injects the `com.google.gms.google-services` classpath, applies the
   plugin, and copies the JSON into `android/app/` during prebuild), and
   `expo-notifications` already bundles the Firebase messaging SDK. **Do not
   add `firebase-analytics` or any BoM dependency.** Click
   **Next → Continue to console**.

> Two different JSON files exist in this setup — don't mix them up:
>
> | File | From | Goes where | Secret? |
> |---|---|---|---|
> | `google-services.json` | Firebase ▸ Your apps ▸ download | committed at `app/google-services.json` | No (public ids) |
> | `plusone-firebase-adminsdk-….json` | Firebase ▸ Service accounts ▸ Generate new private key | uploaded to EAS only (step 5), never in the repo | **Yes** |

## Step 3 — Make sure the FCM v1 API is enabled

1. ⚙️ **Project settings** → **Cloud Messaging** tab.
2. Look for **Firebase Cloud Messaging API (V1)**.
   - New projects usually have it **Enabled** already → done.
   - If it shows as disabled / "Manage API in Google Cloud Console": click that
     link → make sure the right project (plusone) is selected at the top of
     Google Cloud Console → click **Enable**.

## Step 4 — Generate the private key JSON

1. ⚙️ **Project settings** → **Service accounts** tab.
2. Make sure "Firebase Admin SDK" is selected.
3. Click **Generate new private key** → **Generate key** in the popup.
4. A JSON file downloads (name looks like
   `plusone-firebase-adminsdk-abc123-1a2b3c4d5e.json`).
5. Move it **somewhere outside this repo** (e.g. `~/Documents/secrets/`).
   Delete it from your Downloads folder once uploaded (step 5) if you like —
   you can always generate a fresh one.

## Step 5 — Upload the key to EAS

Pick **one** of the two — the dashboard is easier the first time.

### Option A — expo.dev dashboard (easiest)

1. Go to <https://expo.dev> and log in with the **same account** as
   `npx eas whoami`.
2. Open your project (**+one** / `saksham`).
3. Open the **Credentials** tab → **Android** section.
4. Find the **Push Notifications (FCM v1)** card → **Upload** → choose the JSON
   file from step 4.

### Option B — EAS CLI (official menu path)

```bash
cd app
npx eas credentials
```

- Select **Android** → **production** → **Google Service Account**.
- Select **Manage your Google Service Account Key for Push Notifications
  (FCM v1)**.
- Select **Set up a Google Service Account Key for Push Notifications (FCM
  v1)** → **Upload a new service account key**.
- Point it at the `*-firebase-adminsdk-*.json` from step 4 (the CLI
  auto-detects it if it's in the folder — but don't leave it there; it's a
  secret, and `.gitignore` in this repo blocks `*-firebase-adminsdk-*.json`
  just in case).

**Verify:** run `npx eas credentials -p android` again — the FCM v1 credential
should now be listed (owner + created date), with no warning.

## Step 6 — Build the fresh 1.4.0 APK

⚠️ **Order matters:** upload the key (step 5) *before* building — EAS bakes the
Firebase config into the APK at build time.

```bash
cd app
npx eas build -p android --profile preview
```

- Wait for the build (~10–20 min), download the APK from the link it prints,
  and install it on the phone(s) (uninstall or install-over the old 1.3.0).
- Old installed APKs **cannot** get push via OTA — that's why this build is
  required (it adds the `expo-notifications` native module).

## Step 7 — The acceptance test

1. Open the new app on a **real Android phone** (not just an emulator), sign
   in, and **Allow** notifications when asked (Android 13+ asks once).
2. Check registration: **Settings ▸ Notifications ▸** bottom of the page should
   say **"Push is on for 1 device."**
3. From another account (e.g., the web app at plusoneeeee.vercel.app on your
   laptop), send a DM to the phone **while the phone is locked / app closed**.
4. Within a few seconds: a heads-up notification with the sender's name and
   message preview.
5. **Tap it → it opens that exact conversation.** That's the whole feature. 🎉

Also worth checking once:
- **Muted chat** → no notification at all (server skips it).
- **Quiet hours** (Settings ▸ Notifications ▸ Quiet hours, e.g. now → now+1h)
  → notification arrives **silently** (tray only, no sound).

---

## If nothing arrives

| Symptom | Likely cause / fix |
|---|---|
| Settings ▸ Notifications says "Push isn't active on this device" | Old APK (check About: version **1.4.0**), or notification permission denied — Android Settings ▸ Apps ▸ +one ▸ Notifications ▸ allow. |
| App log: *"Default FirebaseApp is not initialized"* | `app/google-services.json` missing or not committed (remote EAS builds only see git-tracked files) — do step 2.5, then rebuild. |
| Device registered, but no notification ever arrives | Step 2 package name mismatch (must be `ai.arena.tomodachi`); `google-services.json` from a different Firebase project than the service-account key you uploaded; or step 3 FCM v1 API disabled; or key uploaded to a different Expo account/project than the one that built the APK. |
| `403 PERMISSION_DENIED` from Firebase Installations at token time | The API key in google-services.json is restricted — in Google Cloud Console ▸ Credentials, allow the **FCM Registration API** + **Firebase Installations API** (or leave unrestricted). |
| Nothing sends at all for anyone | The Phase 1 server code isn't deployed yet — check `api/health` deploy and Railway logs. |
| Railway logs show `[push] expo error: InvalidCredentials` / auth errors | The FCM v1 API is disabled (step 3) or the uploaded key is wrong/revoked — regenerate and re-upload. |
| Worked, then stopped after you deleted the key in Firebase | Expected — delete is how you revoke. Generate a new key and upload it; no rebuild needed for a key swap. |

You can also send a raw test push without the app server:

```bash
npx expo push:android
# paste an Expo push token, e.g. one from the push_tokens table
# (Railway: sqlite3 /data/tomodachi.db 'select * from push_tokens')
```

## iOS, later

The entire code path is already iOS-ready. When the time comes:
`eas credentials -p ios` → upload an APNs **Key (.p8)** from
<https://appstoreconnect.apple.com> (Keys page) — then build. Nothing else
changes.
