# BROSKIE — Application Status & Operations Guide

**Last updated:** 18 August 2026
**Repository:** `sakshamfit/BROSKIE`
**Primary production host:** Railway
**Production API:** `https://broskie-h.up.railway.app`

This document is a plain-language reference for anyone maintaining, testing, or deploying BROSKIE. It describes what is live today, where data is stored, what is safe to change, and what still needs work.

---

## 1. What BROSKIE is

BROSKIE (display name **+one**) is a real-time social and messaging app built with:

| Layer | Technology |
|---|---|
| Mobile/web app | Expo + React Native + React Native Web |
| API server | Node.js + Express |
| Real-time events | Socket.IO |
| Current application database | SQLite (`better-sqlite3`) |
| Current durable database location | Railway Volume mounted at `/data` |
| Media storage target | Supabase Storage (configuration in progress) |
| Hosting | Railway |

Key product areas include authentication, direct/group chat, reactions, polls, messages, calls/signalling, statuses, posts, communities, profiles, privacy controls, and settings.

---

## 2. Current production condition

### ✅ Persistent app data is enabled

The Railway backend has a persistent volume mounted at:

```text
/data
```

The current live database and related files are stored there:

```text
/data/tomodachi.db       SQLite database
/data/tomodachi.db-wal   SQLite write-ahead log — do not delete
/data/tomodachi.db-shm   SQLite shared-memory file — do not delete
/data/backups/           Automated database backups
/data/uploads/           Locally stored uploaded media
```

A normal Railway redeploy restarts the server code but **does not erase the `/data` volume**. New users, chats, messages, posts, settings, and local uploads should therefore survive GitHub pushes.

> **Critical:** Never delete the Railway volume or the `tomodachi.db`, `tomodachi.db-wal`, or `tomodachi.db-shm` files unless a verified database recovery procedure is in place.

### ⚠️ Supabase Storage is not confirmed active yet

The latest observed Railway startup log reported:

```text
[storage] local disk (server/uploads) — files are lost on redeploy
```

Because the app has a Railway Volume, local uploads are currently stored at `/data/uploads` and are durable. However, Supabase Storage is not yet active.

When Supabase Storage is configured correctly, Railway logs should instead show:

```text
[storage] Supabase Storage (bucket "tomodachi-uploads", secret key)
```

No Supabase secret, API key, Railway token, database password, or connection string should ever be committed to the repository or pasted into chat.

### ⚠️ Supabase Postgres migration is not complete

The app currently uses persistent SQLite on Railway. Adding `DATABASE_URL` to Railway does **not** automatically move the app to Supabase Postgres; the current database code is SQLite-specific.

A full Supabase/Postgres migration must preserve existing records and be implemented as a separate, tested migration project. Until then, Railway `/data/tomodachi.db` remains the production source of truth.

---

## 3. Mobile connection status

Native Android/iOS builds must reach the public Railway API, not `localhost`.

The source currently defaults native builds to:

```text
https://broskie-h.up.railway.app
```

For repeatable release builds, configure this build-time variable privately:

```text
EXPO_PUBLIC_API_URL=https://broskie-h.up.railway.app
```

### Important for Android/iOS releases

Existing installed APK/IPA builds do not receive JavaScript source changes automatically. After changes to mobile API configuration, build and distribute a new mobile binary:

```bash
cd app
npx eas build --platform android
```

---

## 4. Authentication and account rules

### Password policy

New registrations and password changes require all of the following:

- 8 or more characters;
- at least one uppercase letter;
- at least one lowercase letter;
- at least one number;
- at least one special character.

Example format:

```text
Broskie!2026
```

Existing users with older passwords can still sign in. They must meet the stronger rule when changing their password.

### Current authentication design

- Password hashes are stored by the backend using bcrypt.
- App sessions use server-issued JWTs.
- The app currently does **not** use Supabase Auth for user sign-in.
- A future Supabase Auth migration must include a safe password-reset/account-linking strategy, because bcrypt hashes cannot simply be copied into Supabase Auth.

### Login/logout

- Login fields use plain language: **Enter name**, **Username**, and **Password**.
- Logging out asks for confirmation.
- Confirming logout clears the active in-memory session immediately, even if browser/device storage fails.
- Settings includes a permanent **Delete One ID** danger-zone action. The server verifies the current password, deletes personal content/direct chats, cleans relationship records, and safely transfers shared groups, communities and institutions before removing the user.

---

## 5. Profile photos

Users can manage their profile image from **Settings**:

- Tap the profile photo to add or replace it.
- Select **REMOVE PHOTO** to clear it.
- Removal requires confirmation.

Uploaded images currently use the active storage backend:

1. Supabase Storage, when `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are configured correctly; otherwise
2. the durable Railway volume at `/data/uploads`.

---

## 6. Colleagues and affiliations

The app now exposes **Colleagues** as a first-class bottom tab on phones and a dedicated sidebar destination on tablets/web (it is also reachable from Network). Users can:

- add a college/institution, organization, or workplace from Personal Information;
- search and directly join an existing registered place;
- discover people who share one of their places;
- send, accept, decline, or cancel colleague requests; and
- open a direct chat after a request is accepted.

Affiliations, requests, and accepted connections are stored in SQLite and update connected clients through Socket.IO. A colleague request is only allowed when both users share a registered place. Blocking a user also removes the colleague connection and cancels pending requests.

### Message requests

Tapping a username or opening a composer does **not** send a request. Tap the
**+one** sign in front of a person in find +ones to send a connect request, or
send a first real message (text, photo, or voice). Incoming requests, likes,
comments and calls appear in **Activity**, opened from the +one wordmark or the
Instagram-style heart. The receiver can preview
the first message, then accept and chat, delete the request, or block the sender.
Existing direct chats remain accepted for backward compatibility.

---

## 7. Theme and UI status

The public app name is **+one**, version **1.2.0**. The supplied black-and-white
brush logo is used for the Android/iOS launcher icon, adaptive and monochrome
Android icons, native splash, browser favicon, PWA icons, and Median assets.
The Android package, iOS bundle identifier, Expo project ID, session keys,
database filename, and storage bucket retain their legacy technical identifiers
so installed accounts and production data are not broken by the rebrand.

The app supports the following appearance choices:

- Light
- Dark
- System
- Kinetic Ink

**Kinetic Ink** is a high-contrast dark manga-tech theme with cyan action accents and red notification/critical accents.

The chat list and conversation interface use a manga/paper visual style, including hand-inked card outlines, tape-style date labels, unread markers, and a paper-panel composer. Every signed-in screen uses a lightly uneven sketch-graph background with pencil fibres and graphite smudges. Login/signup are explicitly excluded and retain their original dark manga halftone and speed lines.

### Daily AI greeting

Version 1.2 adds a once-per-day animated and spoken greeting after authentication. It uses foreground device location only to request current conditions from Open-Meteo and combines that with server-provided unread/message-request/colleague/community counts. A preferred feminine voice speaks the briefing once while the original animation embedded in `app/assets/ai-greeter.glb` loops independently through Three.js; the app does not retarget or modify the model skeleton. The overlay closes automatically after the finale. Animation and export requirements are documented in `AI_GREETER.md`. This version requires a fresh native build because it adds Expo Location, Speech, and GL modules.

### App updates

Settings has an **App Updates** section (`app/src/components/UpdateSection.js`,
engine in `app/src/updates.js`). It reports the installed version/bundle, when it
last checked, and updates the app on demand:

- **Update now / Install & restart** — checks, downloads and immediately restarts
  into the new release. Native uses `expo-updates` (EAS channel `stable`); web
  unregisters service workers, clears CacheStorage and hard-reloads with a
  cache-busting parameter.
- **CHECK** — checks without installing.
- **Auto-install updates** (default on) — silent checks on launch and on every
  return to the foreground; a downloaded bundle is installed the next time the
  app is reopened, never mid-session. Web only self-reloads after the tab has
  been in the background for over five minutes.
- Expo Go / dev builds report "Updates unavailable in this build".

Publishing is documented in `DEPLOY.md` → "Shipping app updates". Note that OTA
updates only reach installs whose fingerprint runtime version matches; native
dependency changes still require a new build.

---

## 8. Current deployment checks

### Check backend health

Open:

```text
https://broskie-h.up.railway.app/api/health
```

A healthy response includes:

```json
{
  "ok": true,
  "time": 0,
  "storage": "..."
}
```

Expected storage values:

| Value | Meaning |
|---|---|
| `Supabase Storage (bucket "tomodachi-uploads", secret key)` | Supabase media storage is active. |
| `local disk (server/uploads) — files are lost on redeploy` | Supabase is not active. With the Railway volume mounted, uploads are still kept under `/data/uploads`, but Supabase is not being used. |

### Check Railway volume from Railway CLI

```bash
railway ssh --project=PROJECT_ID --environment=ENVIRONMENT_ID --service=SERVICE_ID
```

Inside the shell:

```bash
echo $RAILWAY_VOLUME_MOUNT_PATH
ls -la /data
```

The mount path should be `/data`, and the directory should contain `tomodachi.db`.

---

## 9. Safe deployment checklist

Before pushing/deploying changes:

1. Confirm the Railway Volume is still attached at `/data`.
2. Do not change or delete `DATA_DIR`, `RAILWAY_VOLUME_MOUNT_PATH`, or database files.
3. Keep `JWT_SECRET` configured in Railway.
4. Keep secrets only in Railway/Supabase variable dashboards.
5. Run the web export locally:

   ```bash
   cd app
   npx expo export --platform web
   ```

6. Check server syntax when backend files change:

   ```bash
   node --check server/src/index.js
   ```

7. After deploy, check Railway logs and `/api/health`.
8. Test with a real account: sign in, send a message, then confirm it remains after a redeploy.

---

## 10. Security rules

Never share or commit:

```text
GitHub personal access tokens
Railway tokens
Supabase secret/service-role keys
Database URLs containing passwords
JWT_SECRET values
Private SSH keys
```

If any credential is accidentally exposed, revoke/rotate it immediately in the relevant provider dashboard and update the Railway variable privately.

---

## 11. Planned work

### High priority

- [ ] Confirm Supabase Storage is active in Railway logs.
- [ ] Build/distribute the new +one 1.2.0 Android APK (AI location, speech and GL modules require a fresh binary).
- [ ] Test registration, login, logout, profile photo add/remove, and real-time messages on a second physical device.
- [ ] Verify data remains after a Railway redeploy.

### Future production migration

- [ ] Audit all SQLite schema and queries.
- [ ] Create a versioned Supabase Postgres schema.
- [ ] Build a safe SQLite-to-Postgres migration tool.
- [ ] Verify row counts and relationships before cutover.
- [ ] Move database reads/writes to Postgres incrementally.
- [ ] Preserve Railway `/data` as rollback protection until the new backend is verified.
- [ ] Plan a separate Supabase Auth migration with an account/password reset flow.

---

## 12. Recent notable changes

| Commit | Change |
|---|---|
| `797ad79` | Native clients default to the Railway production API instead of `localhost`. |
| `5bbd1e2` | Logout requires confirmation. |
| `f574936` | Active sessions clear immediately on logout. |
| `3017386` | Profile photos can be removed; server supports explicit avatar clearing. |
| `2f8d999` | Strong password policy added. |
| `9a59577` | Kinetic Ink appearance theme added. |
| `20b1432` | Chat list/conversation manga-paper UI redesign. |

---

## Support / handoff note

For any issue report, include:

1. Device type and browser/app version;
2. exact error text or screenshot with private information hidden;
3. whether the issue occurs on web, Android, or iOS;
4. Railway deploy/log time; and
5. whether `/api/health` returns `ok: true`.
