# FULL APP QA + CALLING + CHAT-OPEN FIX — LOOP #2 REPORT

**Scope:** entire BROSKIE / +one repo (Expo client `app/`, Node/Socket.IO/SQLite server `server/`)
**Audit date:** 2026-08-25 (UTC)
**Branch:** `arena/01a03a90-broskie`
**Trigger:** user reports — (1) opening a chat starts at the TOP and visibly scrolls down to the latest message; (2) voice/video calling does not work on Android web and iOS web (plusoneco.in); (3) full end-to-end check of every flow + security & performance sweep.

**Result: 2 user-facing bugs fixed, 9 security/robustness holes closed, 4 performance improvements, full pipeline green (exit 0) — 15 server suites, 3 app test groups, live single-host E2E journey 25/25, hardening smoke 14/14, jsdom app smoke clean.**

---

## 1. CHAT OPENS AT THE TOP, THEN SCROLLS DOWN — FIXED

**Root cause.** Both conversation screens (`ConversationScreen.js`, `GCChatScreen.js`) rendered an ordinary top-anchored `FlatList` (oldest message first) and relied on `onContentSizeChange → scrollToEnd()` to land on the latest message. That correction runs *after* the first paint, so every chat visibly opened at the top of the thread and then scrolled/animated to the bottom — exactly what users reported. The same hack also fought the user's scroll position whenever content size changed.

**Fix (both screens).**
- The lists are now **inverted (bottom-anchored)**: data is reversed (newest = index 0), so opening a chat renders **directly on the latest message by layout — no initial scroll exists anymore, so no jump can occur**.
- Removed the `onContentSizeChange → scrollToEnd` correction entirely (it cannot be needed when the list is bottom-anchored; its presence was the bug).
- Scroll helpers updated to inverted geometry: "scroll to latest" is now `scrollToOffset(0)`; "load older" now triggers near the *end* of the scroll range (visual top).
- `maintainVisibleContentPosition` kept for native; a small web-only `scrollTop` compensation preserves reading position when rows are added while the user is scrolled up (react-native-web has no MVCP).
- `windowSize` added (render window reduced 21 → 9 viewport-lengths) — cheaper long chats.
- Regression locks added: `app/scripts/chat-anchor.test.mjs` (10 source-level checks — makes the top-anchored/scrollToEnd pattern impossible to reintroduce) and two behavioural checks inside `scripts/smoke-web.js` (newest message rendered, no corrective scroll ran).

**Verified:** production-bundle jsdom smoke opens the conversation and confirms the newest message renders with **zero corrective scrolling**; 10/10 anchor regression tests pass.

## 2. CALLING NOT WORKING ON ANDROID/IOS WEB — FIXED (4 root causes)

The signalling server was never the problem — the phase3 suite already proved invite/accept/offer/answer/ICE. Four client-side causes broke mobile browsers:

| # | Root cause | Fix |
|---|---|---|
| 1 | **`getUserMedia` was requested from a socket callback**, not a user gesture. iOS Safari can silently stall the first microphone/camera prompt when it is requested outside a tap; Android Chrome shows the prompt at a confusing moment mid-call. | Media is now **pre-warmed inside the Accept/Call tap** (`prewarmCallMedia`) and reused by `ensurePeerConnection` (`prewarmedMediaRef`). The invite is only emitted after media is confirmed, so the other side never rings for a call that cannot start. |
| 2 | **Voice calls played remote audio through a 0×0 invisible `<video>`** — iOS Safari frequently refuses/delays audio from zero-sized hidden video elements → "connected" calls with no sound on iPhones. | Voice calls now render a hidden **`<audio>`** element (`RemoteAudio`); media elements explicitly call `play()` after `srcObject` is attached (relying on `autoPlay` alone is unreliable on mobile Safari). |
| 3 | **`RTC.supported` was true even when `navigator.mediaDevices` was missing** (insecure origin / restricted webviews) → calls crashed with raw `TypeError` instead of a clear message. | `supported` now requires a secure context + `getUserMedia`; every `getUserMedia` failure is mapped to a human phrase (`NotAllowedError` → "allow it in your browser settings", `NotReadableError` → "busy in another app", etc.) shown in the call overlay. |
| 4 | **No TURN relay + no failure handling**: mobile carriers use CGNAT; STUN-only calls stall on "Connecting…" forever with no feedback. | Documented TURN setup via `EXPO_PUBLIC_ICE_SERVERS` (see `.env.example`), added **ICE `failed` detection with `restartIce()` + graceful failure message** ("network blocked the call — try Wi-Fi"), and a **25-second connecting watchdog** so callers are never stuck on "Connecting…". |

Also: ringtone `AudioContext` now attempts `resume()` (iOS mints suspended contexts); cancelling a call while the permission prompt is open can no longer leak a live mic stream; a declined permission now tells the caller (decline emit) instead of ringing forever.

**Verified:** full call handshake (invite → accept → offer → answer → ICE both ways → hangup → busy rejection → call log) passes 25/25 against the live single-host server. Actual mic/camera audio needs two real devices — see "Still needs a device" below.

## 3. SECURITY FIXES (server)

1. **Stored XSS via uploads (critical).** `/api/upload` accepted *any* file type; files were served same-origin from `/uploads`, so an uploaded `.html`/`.svg` executed script on the web origin. Now: MIME allowlist (image/audio/video, never SVG/HTML), **canonical extension derived from the validated mimetype** (client filename ignored), and **magic-byte sniffing** for images so mislabelled payloads are rejected (415). Verified: HTML-as-PNG rejected, `.html` uploads rejected, existing PNG round-trips.
2. **`/uploads` serving hardened**: `nosniff` + `Content-Security-Policy: sandbox` on every upload response; HTML/SVG/JS extensions are never served even if an old file exists on disk.
3. **Brute-force protection**: login now has per-IP + per-username failure throttling (10 failures / 15 min → 429 with `Retry-After`); register/forgot-password/verify-otp/reset-password get limiter budgets; uploads get a per-user budget. Tiny in-memory fixed-window limiter (no new deps); **loopback requests exempt** so CI suites stay deterministic. Verified live: 429 returned from a non-loopback IP after the budget.
4. **Presence privacy leak (fixed).** `io.emit('presence', …)` broadcast every user's online status and exact last-seen timestamp to every connected socket, ignoring the "last seen: nobody/contacts" setting. Replaced with `broadcastPresence()` which applies the same `presenceFor()` policy per viewer. Verified live: a `lastSeen=nobody` user's presence is not delivered to other users.
5. **`message:react` authorization hole.** Any authenticated user who knew a message id could write reactions into (and emit updates to) a chat they were not a member of. Now member-scoped, emoji validated (length cap), burst-limited (25/10 s per socket).
6. **JWT algorithm pinning** (`HS256` only) on sign *and* verify.
7. **`trust proxy = 1`** so rate limiting sees real client IPs behind Railway/Vercel (previously every client shared the proxy IP — one throttle bucket for everyone).
8. **Socket frame cap** reduced `maxHttpBufferSize` 30 MB → 1 MB (messages cap at 5 000 chars; media goes over HTTP upload) — closes an easy remote memory/CPU DoS.
9. **Baseline security headers** on every response: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: SAMEORIGIN`, `Permissions-Policy` (camera/mic same-origin), and HSTS on HTTPS.

## 4. PERFORMANCE

- **Chat list render window** reduced (FlatList `windowSize` 21 → 9 on both screens) and the per-content-size scroll correction removed (less layout thrash on every incoming message).
- **Removed a re-render trigger**: the old scroll hack fired `scrollToEnd` on every content-size change (each message, each prepend) — gone.
- **SQLite pragmas**: added `busy_timeout` + `synchronous = NORMAL` (WAL-safe durability/perf pairing; prevents SQLITE_BUSY errors under concurrent writes).
- Bundle note: the web build ships as one ~7.5 MB minified chunk (gzips to ~2 MB at the edge). The repo deliberately removed code-splitting (`src/lazy.js` "without lazy loading"), so this is a known, pre-existing trade-off — re-enabling async chunks is the next big win if desired.

## 5. VERIFICATION FACTS (what actually ran)

| Check | Result |
|---|---|
| `bash scripts/ci.sh` (deps → syntax → ALL suites → app tests → web export) | **PASS, exit 0** |
| Server suites (15): data-dir, message-state, chat-history, offline-messaging, push, otp, phase2, moderation, phase3, ot, gc, chat-inbox, features, **hardening (new)**, **e2e-journey (new)** | **ALL GREEN** |
| App tests: image-editor geometry 13, chat-inbox 8, **chat-anchor (new) 10** | **ALL GREEN** |
| Production web export (`expo export --platform web`) | **PASS** (0 errors) |
| jsdom app smoke (logged-out + logged-in, opens conversation, long-press menu, GC flow) | **no errors, no warnings** |
| Live single-host server journey (register → login → request/accept → realtime message → typing → receipts → upload → serve-back → image message → call handshake → busy → hangup → call log) | **25/25** |
| Hardening smoke (headers, upload enforcement, sniffing, sandboxed uploads, presence privacy, rate-limit 429) | **14/14** |
| `node --check` on every server file | PASS |

## 6. STILL NEEDS A REAL DEVICE / PRODUCTION ENV (cannot be executed in this sandbox)

- Two-device audio/video round-trip (mic actually transmitting) — signalling, state machine, overlay and media plumbing are verified; final audio quality needs phones.
- TURN: **for calls over mobile carrier networks, set `EXPO_PUBLIC_ICE_SERVERS` with TURN credentials** in the web build environment and redeploy (see `.env.example`). Without a TURN relay, CGNAT carriers can still block direct P2P — the app now fails fast with a clear message instead of hanging.
- Push delivery (FCM/APNs credentials), Supabase Storage (needs bucket credentials) — unchanged from loop #1 status.
- plusoneco.in deploy: merge this branch, redeploy the web build (Vercel/Cloudflare), and redeploy the Railway server — the chat-open fix ships in the web bundle; the server fixes ship with the API.

## 7. FILES CHANGED (loop #2)

- `app/src/screens/ConversationScreen.js`, `app/src/screens/GCChatScreen.js` — inverted bottom-anchored chat lists, scroll-helper updates, web reading-position compensation.
- `app/src/webrtc/rtc.js` — secure-context aware `supported`, friendly media-error mapping, `preflightPermissions`.
- `app/src/store/ChatContext.js` — gesture-time media pre-warm + reuse, ICE failed/restart + connecting watchdog, friendly call failures, prewarm leak guard, ringtone resume.
- `app/src/components/CallVideo.js`, `app/src/components/CallOverlay.js` — `RemoteAudio` for voice calls, explicit `play()` on media elements.
- `app/scripts/chat-anchor.test.mjs` (new), `app/scripts/smoke-web.js` (2 new checks).
- `server/src/index.js` — upload enforcement + sniffing, uploads serving headers, rate limiters + login throttle, security headers, trust proxy, presence privacy, message:react scoping, socket frame cap.
- `server/src/db.js` — `busy_timeout` + `synchronous=NORMAL` pragmas.
- `server/src/auth.js` — HS256 pinning.
- `server/test-hardening.js` (new), `server/test-e2e-journey.js` (new).
- `scripts/ci.sh`, `server/package.json`, `app/package.json` — new suites wired into the pipeline.
- `.env.example` — TURN/ICE documentation.

**LOOP #2 STATUS: chat-open bug fixed · mobile-web calling fixed · 9 security holes closed · perf tuned · full pipeline green · production build verified live.**

---

## 8. ADDENDUM — SONG SEARCH NOW POWERED BY THE ITUNES SEARCH API

**Change:** `/api/songs/search` (the "Add a song" picker on statuses and Network posts) now uses the **iTunes Search API** (`https://itunes.apple.com/search?term=…&media=music&entity=song`) as its primary source:

- **Zero configuration** — no API key, so song attachment works on every deployment out of the box (previously it silently showed "not configured" until a `JAMENDO_CLIENT_ID` was set).
- Results carry **30-second preview clips** (`previewUrl`, .m4a — played inline by the existing SongCard player), **album artwork** (requested at 300px) and durations.
- Same response shape as before (`id/name/artist/albumArt/previewUrl/durationMs/source`), so stored songs on existing statuses/posts keep rendering and playing unchanged.
- **Jamendo stays as an optional bonus source**: when `JAMENDO_CLIENT_ID` is configured, its full-length Creative-Commons tracks are dedup-appended after the iTunes results.
- Server-side TTL cache (10 min, LRU-capped) keeps typing in the picker well inside iTunes' ~20 req/min guidance; upstream failures degrade to a 200 + friendly message (the composer never breaks); `ITUNES_COUNTRY` env selects the storefront (default US).

**Files:** `server/src/itunes.js` (new), `server/src/index.js` (route), `app/src/components/SongPicker.js` / `SongCard.js` (copy), `.env.example`, `server/test-itunes-songs.js` (new — 12 checks: mapper unit + integration against a fixture iTunes API, incl. auth gate, empty catalogue, upstream-failure degradation, cache, legacy alias). Wired into `scripts/ci.sh`.

**Verification:** `test:itunes-songs` 12/12 against the real server booted with a fixture upstream; full `ci.sh` pipeline green. Live calls to itunes.apple.com from the production host (Railway) are ordinary outbound HTTPS — not exercisable from this sandbox (egress-blocked), but covered by the fixture integration end-to-end.
