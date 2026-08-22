# BROSKIE — Application Status & Operations Guide

**Last updated:** 21 August 2026**Repository:** `sakshamfit/BROSKIE`
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

### Android device compatibility (every supported phone)

The Android build floor is **Android 7.0 (API 24)** — `minSdkVersion: 24` is
set explicitly in `app.json`. That is the lowest API level React Native 0.86
(Expo SDK 57) can run on; it covers essentially every Android phone in use
since 2016, new and old alike. Below API 24, no React Native 0.86 app can
run — that is a hard upstream limit of the framework, not of this app.

What makes old-device support work:

- `app/plugins/withAuthNetworkSecurity.js` bundles the **ISRG Root X1
  certificate** into the APK and pins it (system + pinned roots, cleartext
  off) for the production Railway API domain — Android 7.0's trust store
  predates that root, and without this older phones would reject the API's
  HTTPS chain before any JavaScript runs.
- All new motion is transform/opacity with `useNativeDriver: true` (60fps on
  mid/low-end hardware), `prefers-reduced-motion` is respected, and continuous
  animations are tiny (typing dots, skeletons, empty-state float) and
  auto-paused when unmounted.
- Heavy UI work is gated/fallback-safe: `expo-blur` is optional (opaque
  fallback on old APKs), fonts have a grace timer, and a root error boundary
  keeps one bad screen from blanking the app.
- No native modules beyond the SDK-57-aligned set were added; every Expo
  dependency in `package.json` matches `bundledNativeModules.json` for SDK 57
  (`npx expo install --check` clean), so native autolinking succeeds on
  current and future build pipelines.
- `expo-haptics` is optional at runtime (guarded try/catch, no-op on web and
  on devices without a haptic engine).

Current release metadata: version **1.4.0**, Android `versionCode` **6**.

### API endpoint for native builds

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

### Push notifications (new in 1.4.0 — Phase 1)

Push is the "something waiting" loop: without it, nobody reopens the app. What is
implemented and live in this repo:

| Piece | Status |
|---|---|
| Server fan-out on real events | New message / group @mention, message & connect requests (Activity), colleague requests, likes/comments on your posts, community join approvals, incoming call |
| Deep links | Notification tap opens the exact screen (Conversation / Activity / Colleagues tab / Network) via the `plusone://` scheme + payload route |
| Per-chat mute | Respected server-side — a muted chat never pings |
| Quiet hours | Settings ▸ Notifications ▸ Quiet hours; enforced server-side in the user's own timezone. Pushes still arrive but silently (`*-silent` Android channels, no sound) |
| Per-type toggles | Messages, requests & activity, likes & comments, calls, preview text — all server-enforced |
| Badge counts | Each push carries unread chats + pending Activity; the app keeps the badge in sync while in use |
| Token registry | `POST/DELETE /api/push/token` (auth-scoped); dead tokens auto-pruned when Expo reports `DeviceNotRegistered` |
| Tests | `cd server && node test-push.js` — 33 end-to-end checks against a stubbed Expo endpoint |

What it needs to actually reach devices:

1. **A fresh Android APK (1.4.0 / versionCode 6)** — push adds the
   `expo-notifications` native module, so OTA updates cannot install it on
   existing builds. Build with EAS as above.
2. **A one-time FCM v1 credential** — Android delivery through Expo requires a
   Firebase service-account key uploaded once:
   - Firebase console → Project settings → Service accounts → *Generate new private key* (JSON).
   - `cd app && npx eas credentials -p android` → Push Notifications → upload that JSON
     (or expo.dev → project → Credentials → Android → FCM v1).
   - Never commit the JSON or paste its contents anywhere.
   Until this is done, devices register tokens but no push can be delivered.
3. **No server configuration** — the Expo Push API needs no server key or env
   var; deploy the backend as usual.

iOS can follow later with APNs keys (`eas credentials -p ios`); the entire client
and server code path is already platform-neutral.

Foreground behaviour: a push banners whenever the app is open EXCEPT for the one
conversation the user is currently reading (the socket renders that message live;
the on-screen chat is reported via `setViewedChat()` from `ConversationScreen`).
When the app is backgrounded/killed, the OS displays the notification. A push
that merely arrives never navigates — deep links happen only on a notification
tap, and `getLastNotificationResponseAsync()` is honored only during a true cold
start so a recent notification can't hijack a normal launch into its chat.

### Phase 2 — the daily campus loop ("Today at your place")

The goal: a user with a college on their profile has something new to tap every
afternoon **without opening Chats**. All JavaScript — no new native modules, so
unlike Phase 1 it also reaches existing installs via OTA once they carry a
push-capable runtime.

| Piece | What it does |
|---|---|
| Today strip (Colleagues + Network) | Who's around / online from your places, one-tap **"I'M AROUND"** (a 12-hour flag, re-upping extends it), and today's posts from your places. Hidden for profiles with no places. |
| Greeter handoff | The morning greeting now says *"2 people from your college posted today, and 1 person is around now"* — then, instead of auto-dismissing, it holds on the last line with a **SEE TODAY AT YOUR COLLEGE** button that lands on the Colleagues tab (where the strip lives). |
| Network filters | **Worldwide / My places / Following** chips on the feed. The Today strip and greeter can jump straight into the My-places lens from anywhere. |
| Follow | One-way follow from any Network post (FOLLOW / FOLLOWING pill). Follows power the Following lens and its pushes. |
| Post audience "My places" | Posts can target just people who share your college/workplace (server-enforced, like every other audience). |
| Campus pushes | *"Riya from your college posted"* (to place-sharers when a post targets My places), *"Amit is around"*, and plain *"posted:"* to followers. All gated by Settings ▸ Notifications ▸ The Network, quiet hours, and mute rules like every other push. |
| Photo See statuses | Already existed (crop + upload) — no change needed. |

Endpoints: `POST/DELETE /api/users/:id/follow`, `POST /api/me/around`,
`GET /api/today?since=<local midnight>`, `?filter=worldwide|places|following`
on `GET /api/posts`, audience `places` on `POST /api/posts`, and
`placesPostersToday`/`aroundNow` in `GET /api/greeting-summary`.

Tests: `cd server && node test-phase2.js` — 39 end-to-end checks (follow rules,
all three feed lenses, places-audience visibility/likes, around lifecycle +
expiry sweep, Today payload scoping, greeter counts, all three campus pushes).

**Done when:** a user with a college on their profile has something new to tap
every afternoon without opening Chats.

---

## 3b. Phase 3 — finish what exists + web push + CI

| Piece | Status |
|---|---|
| **Live calls on Android** | `react-native-webrtc` (124.x) + `@config-plugins/react-native-webrtc`; a platform adapter (`app/src/webrtc/`) gives web and native one API; `CallOverlay` renders native video via `RTCView`. Camera/mic permissions added (Android `CAMERA`/`MODIFY_AUDIO_SETTINGS`, iOS usage strings). **Needs the fresh 1.4.0+ APK** — same build as push. |
| **Web push (full parity)** | Browsers get every push Android/iOS get. Plain Web Push (VAPID), signed and sent by the +one server itself — keys auto-generate on first boot and persist on `/data` (override with `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`). Service worker (`app/public/service-worker.js`) shows a notification for every push except the conversation the user is focused on and actively reading (the page reports it via `plusone-viewing` messages), forwards taps to the page for exact-screen routing (a received push never navigates), and tags chat notifications per conversation. A tap that cold-opens the app carries its route in the launch URL (`/?push=…`). Register on the web app: sign in → allow notifications. |
| **Community invite links** | 8-char code per community (admins only see it), `Share` sheet with `https://…/c/<code>`, join-by-code bypasses every join policy (the link IS the approval), long-press rotates/revokes. Web `/c/<code>` and native `plusone://c/<code>` both deep-link: join → open the community detail. |
| **Hold-to-record voice notes** | Hold the mic button to record, release to send; quick taps cancel (never send accidents). Race-safe: a release during recorder start-up parks the stop. |
| **Activity grouping** | Likes/comments on your posts collapse into one row per post ("7 people liked your post") with stacked avatars; latest comment as preview. 7-day window. |
| Songs on See/Network | Already existed (crop + upload + Jamendo picker) — verified, no change needed. |
| **CI** | Workflow file shipped at `docs/ci.workflow.yml` — activate once via GitHub → Add file → Create new file → name it `.github/workflows/ci.yml` → paste it in (the sandbox's git token cannot create workflow files). CI runs every server suite (chat history 14, offline messaging 14, message state 15, push 33, phase 2 39, phase 3 27, moderation 61, OT 33, features 27 — 263 checks) + web and Android bundle exports. |

New endpoints: `GET /api/push/web-config`, `POST/DELETE /api/push/web-subscription`,
`POST /api/communities/join-by-code`, `POST /api/communities/:id/invite/rotate`.
Tests: `npm run test:phase3` — 27 checks (invite lifecycle incl. rotation +
admin-only visibility, activity grouping, web-push parity + 410 pruning).

---

## 3c. Safety & Moderation Center (admin-only)

Private to accounts with the backend `admin` **role** (initial admin: `saksham`, granted at boot/registration — extra admins via the `ADMIN_USERNAMES` env var). The Settings screen shows *Admin ▸ Safety & Moderation* only for admins, and **every** admin API request re-verifies the role server-side (`requireAdmin`) — no client check is ever trusted.

| Piece | How it works |
|---|---|
| Detection pipeline | Runs **after** a message is stored and delivered — messaging is never blocked by analysis. Context-aware rules (threat / self-harm / violence / weapons / extremism / child-safety / sexual coercion / hate / harassment / scam / doxxing / spam / profanity) score message *shapes* (directed, future-intent), then context signals (quotation, educational/news framing, negation, questions) demote confidence: "Violence is bad." and quotes never alert; "I'm going to hurt you" does. |
| Severities | INFO/LOW (aggregate silently — never alert), MEDIUM (reviewable case), HIGH/CRITICAL (case + realtime dashboard alert + admin push on every platform incl. web push). |
| Dedupe/aggregation | Same message+category → signals counter, never duplicate cases. LOW events collapse per user/category in a 60-min window. User reports on an auto-flagged message mark it *mixed* with multiple signals. |
| User reports | ⋯ menu ▸ **Report** with 10 reasons + optional note. Rate-limited (5/min, 25/h), duplicate-proof, chat-membership-verified (no probing foreign ids). Reports and automated detections land in the same cases. |
| Admin UI | Overview (counts + recent alerts), Cases (severity/category/status/source/sort filters + search by case id/@username/message/chat id), case detail (evidence snapshot, reporters, history, actions: confirm/dismiss/escalate/false-positive/under-review; warn/restrict/suspend/ban/remove-content/no-action — irreversible ones require explicit confirmation), user review panel, append-only Audit tab, Settings tab (alert level, case level, retention). Realtime updates over the socket — no refresh. |
| Enforcement | `users.moderation` state: warned/restricted/suspended/banned. Login + messaging + posts + statuses + calls are gated server-side; suspension auto-expires; enforcement disconnects live sessions. **Automated detection never auto-punishes** — every consequential action is a human decision, recorded in the audit log. |
| Privacy | Minimal evidence: message/chat ids + a 280-char snapshot — never copies of private conversations. Reports, confidence scores and case data are never exposed to the reported user or normal users (separate tables, separate APIs, 403 for everyone without the role). Retention: closed cases/reports purged after the configured days (default 180), audit kept 2×. |
| Tables | `moderation_cases`, `moderation_reports`, `moderation_actions`, `moderation_audit_log` (append-only), `moderation_settings` + `users.role/moderation/suspended_until`. |

Tests: `npm run test:moderation` — **61 checks** covering the spec's acceptance flow: harmless messages create nothing; context negatives (quotes/questions/education) never alert; a real threat → case → realtime alert → admin push (Android + web) → review → restrict (server-blocked messaging) → unrestrict → audit; unauthorized users get 403 on every admin endpoint; report dedupe, probing protection and rate limits; false positives close without punishment; LOW aggregation; scam detection; settings + audit of changes; and **all five message-content side doors** (REST send, socket send, edit + OT edit, poll create, forward, status reply) are server-gated while a user is restricted.

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

The public app name is **+one**, version **1.4.0**. The supplied black-and-white
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

### Gesture interaction system (finger-driven)

The phone/tab UI (bottom-tab flow in `Navigation.js`) has Instagram-style,
finger-driven gestures built on a centralized priority system:

- **Page-to-page swipe navigation** (`app/src/components/PageSwipePager.js`):
  the whole page tracks the finger 1:1 while dragging (transform +
  native driver, no re-renders), the neighbouring page is always mounted so
  it slides in pre-rendered, release commits past 30% of viewport width OR a
  fast flick (velocity ≥ 0.55 px/ms with ≥ 40px travel), and the strip
  settles with a momentum spring (or springs back on cancel). Page order
  follows the existing tab architecture: Network → See → Chats → Colleagues
  (Settings stays a pushed stack screen). The bottom tab bar stays
  synchronized: active tab commits only when the gesture completes, and the
  bar subtly responds to the finger mid-drag via a shared Animated progress.
- **Message swipe-to-reply** (`MessageBubble.js`): rightward horizontal drag
  on a bubble moves the message with the finger (resisted near a 72dp cap),
  reveals the ↩ badge, arms once at 48dp with a haptic + badge pop, springs
  back on release, then opens the existing reply composer (auto-focus,
  scroll-stable). Vertical drags always scroll the chat instead.
- **Gesture priority** (`app/src/gestures.js`): a single pure module holds
  every tuning constant and decision (lock zones, dominance, thresholds,
  resistance curves) plus the documented state machine. Message swipes and
  horizontal carousels claim the responder in the capture phase (deeper),
  so they always beat page navigation, which only claims in the bubble
  phase after a 12px lock zone — feeds never flip pages accidentally.
- **Platform rules:** gestures are touch-only on web (mouse drag, hover
  reply button, R shortcut and context-menu Reply are unchanged); tablets
  and touch-screens get gestures; `prefers-reduced-motion` cuts springs and
  keeps the gestures functional; haptics are native-only and fire once per
  gesture.



Each conversation can have its own independent chat theme (Chat ▸ ⋯ ▸ Chat theme).
The theme belongs to the **conversation**, not the user: it is persisted
server-side on the chat row (`theme_id`, `theme_updated_by`, `theme_updated_at`
columns on `chats`) and every participant sees the same theme. Changing the
theme in one chat never touches another.

- **Registry:** all themes live in `app/src/chatThemes.js` (13 launch themes:
  Graphite, Obsidian, Carbon, Aurora, Midnight, Ocean, Sunset, Sakura,
  Lavender, Mint, Cream, Neon Night, Galaxy), mirrored server-side by the
  `CHAT_THEMES` allow-list in `server/src/index.js`. The server rejects any
  theme id outside that list (no arbitrary CSS/colors/objects can be injected
  through the database); clients fall back to `graphite` on unknown ids.
- **Persistence & realtime:** `POST /api/chats/:id/theme` persists the theme,
  records a subtle `✨ <name> changed the chat theme to <Theme>` system
  message, and broadcasts `chat:theme` + `chat:updated` + `message:new` so
  everyone viewing the chat re-themes instantly without a reload; late joiners
  read the persisted theme from the chat summary.
- **Picker UX:** bottom sheet with horizontally scrollable miniature
  conversation previews, category chips (Recommended / Graphite / Atmospheric /
  Pulp / Special) and an optional mood selector that recommends themes. Tapping
  a card live-previews the chat behind the sheet; nothing is persisted until
  **Apply theme** is pressed. A failed save rolls back to the previous
  persisted theme and shows a small non-blocking error — messaging is never
  blocked.
- **Rendering:** chat widgets consume a centralized `ChatTheme` resolved from
  the registry (`ChatThemeScope`), so adding a future theme is a registry entry
  only — no chat component changes. Background gradients use `react-native-svg`
  (no new native dependencies) and crossfade in ~280 ms.

### Motion & interaction system

`app/src/motion.js` is the single, centralized motion system. All animation
tokens (micro 130ms / fast 190ms / normal 260ms / slow 360ms, spring presets,
easing curves), the `prefers-reduced-motion` gate (web `matchMedia` + native
`AccessibilityInfo`), safe haptics (`expo-haptics`, throttled, no-op on web),
and the reusable primitives live there.

**The rules the system enforces**

- *Press depth scales inversely with surface size* — `motion.scale` is a
  ladder: rows 0.985, cards 0.975, buttons 0.97, chips 0.95, icons 0.9. A
  full-width row dropping 4% looks broken; a 20px icon dropping 1.5% looks
  dead.
- *Overshoot is one ~1.5% kick, never a bounce* — `springBack`
  (1.00 → 0.97 → 1.015 → 1.00) is the release for every pressable in the app.
- *Haptics fire on the completed press, not touch-down* — a finger landing on
  a row to scroll must never buzz. Repeats inside 45ms are swallowed.
- *Transform + opacity only, native driver everywhere* — the single exception
  is the settings toggle's track colour, which the native driver cannot
  interpolate; its thumb still travels natively.
- *Nothing animates off-screen* — `MotionActive` (fed by `PageSwipePager`)
  stops shimmer, typing dots and floating empties on the mounted-but-hidden
  neighbouring pages.
- *Reduced motion cuts movement, keeps feedback* — presses swap scale for a
  brightness dip, gestures keep working, entrances land instantly.

**Primitives**

- `SpringPressable` / `usePressScale` — the press primitive used by every
  affordance in the app (~95 call sites). Layout props follow the children
  into the animated wrapper, so wrapping a row of [icon, label] never
  restacks it.
- `FadeSlide` / `Stagger` — opacity + 8px translate entrances on the
  "arriving" curve; `staggerDelay` caps list cascades at 6 items so long
  lists never feel slow.
- `Pop` — one spring (not a chained sequence) for badges, reaction pills,
  check marks, and the composer icon as it changes meaning (mic → send).
- `IconSwap` — state changes *morph*: the two glyphs crossfade and
  counter-scale (tab bar outline → filled, heart, follow ✓, emoji/keyboard).
- `Bloom` — a single ring pushed outward when a toggle turns on (likes).
- `Shake` — the one "rejected" motion: 5px, ~250ms, paired with an error
  haptic (sign-in failures).
- `BottomSheet` / `SheetHandle` — one sheet behaviour app-wide: backdrop
  dims in step with a 1:1 downward drag, flings away past ~28% of its
  height, and always animates *out* before unmounting. Centred dialogs get a
  24px lift + scale instead of flying up from off-screen.
- `TypingDots`, `Skeleton`, `FloatLoop` — looping primitives, all gated on
  `useMotionActive()`.
- `LikeBurst` — double-tap a message → a gradient heart springs out with a
  rotation wobble, a shockwave ring ripples out, mini hearts/dots scatter,
  the bubble pulses with a medium haptic, and the heart floats away.
- `MotionActive` / `useMotionActive` — the off-screen gate.

**Gesture surfaces** (all finger-tracking, all with velocity-aware release):
page-to-page swiping (`PageSwipePager`), swipe-to-reply on a message,
drag-to-dismiss on every sheet, drag-to-dismiss on the story viewer (which
also shrinks as it travels and eases back while held to pause), and
`ImageLightbox` — one shared photo viewer for the feed, post detail, profile
and conversation, where a vertical drag moves the photo and fades the
backdrop proportionally.

Chat behavior details: new messages animate in once (opacity + translate +
scale spring; an id set prevents re-animation on scroll recycling); the
optimistic copy and its server confirmation never double-animate; chat-list
rows press *into* their own depth plate (sprung 2/4px offset) and give a
brief avatar pulse + wash when a message arrives; the list cascade only runs
on first paint, never when rows scroll back into view; story progress bars
animate 0→100% with hold-to-pause and resume.

**Verifying motion changes:** `app/scripts/smoke-web.js` boots the real web
bundle in jsdom against `app/scripts/mock-api.js`, drives likes, follows, tab
switches, opening a chat and long-pressing a bubble, and fails on any
uncaught error or React warning. Run `npm run check` (or
`SMOKE_LOGGED_IN=1 ./scripts/check.sh`, plus `SMOKE_REDUCED=1` for the
reduced-motion pass) from `app/`.

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

- [ ] Upload the FCM v1 service-account key (`eas credentials -p android`) so Expo can deliver Android pushes.
- [ ] Build and distribute the **1.4.0** Android APK (push notifications add a native module — no OTA path from 1.3.0). Phase 2 is pure JavaScript and ships in the same build.
- [ ] Device test the full loop: message a locked phone → tap the notification → it opens that exact chat. Repeat for a muted chat (no push) and quiet hours (silent push).
- [ ] Device test the campus loop: two accounts sharing a college → "I'm around" → the other sees the Today strip + gets the push → greeter mentions the college activity and the handoff opens it.
- [ ] Confirm Supabase Storage is active in Railway logs.
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
| current | **Push notifications (Phase 1)**: Expo push on messages/@mentions, requests, colleague requests, likes/comments, calls; deep links to the exact screen; server-enforced per-chat mute, quiet hours and per-type toggles; badge counts; `plusone://` scheme; `test-push.js` (33 checks). |
| current | **Phase 2 — the daily campus loop**: Today-at-your-place strip (around/online, 12h "I'm around"), greeter campus lines + one-tap handoff, Network Worldwide/My places/Following lenses, follow from posts, "My places" post audience, campus pushes; `test-phase2.js` (39 checks). |
| current | **Phase 3**: live WebRTC calls on Android, **web push parity** (VAPID, zero-config), community invite links + deep links, hold-to-record voice notes, grouped Activity rows, GitHub Actions CI; `test-phase3.js` (27 checks). |
| current | Per-conversation chat themes (13 themes, realtime sync, picker with live preview). |
| current | Centralized motion system (`src/motion.js`): a press-depth ladder applied to every affordance, single-kick overshoot springs, icon morphs, toggle blooms, error shakes, one drag-to-dismiss sheet behaviour, a shared gesture-driven photo viewer, feed skeletons, a scroll-aware compose button, off-screen loop gating, reduced-motion + haptics support, and a headless smoke test for all of it. |

---

## Support / handoff note

For any issue report, include:

1. Device type and browser/app version;
2. exact error text or screenshot with private information hidden;
3. whether the issue occurs on web, Android, or iOS;
4. Railway deploy/log time; and
5. whether `/api/health` returns `ok: true`.
