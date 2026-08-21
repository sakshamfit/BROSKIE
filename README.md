# +one — an ink-and-paper messenger

A full-stack, real-time messaging app: **Expo / React Native** client + **Node, Socket.IO, SQLite** backend.
Runs on iOS, Android and the web from one codebase.

> Not affiliated with WhatsApp. Built as an original clone-style app for learning/demo purposes.

---

## Quick start

Two processes. Open two terminals.

```bash
# 1. backend  (http://localhost:4000)
cd server
npm install
npm start

# 2. app
cd app
npm install
npx expo start          # press w for web, or scan the QR with Expo Go
```

The database starts completely empty — there's no seeded demo data. Use
**Sign Up** on the login screen to create a real account (username +
password); do that again in a second browser tab/device to create a second
account to message with.

**To see real-time messaging:** open the app in two browser tabs (or a browser + phone),
log in as two different accounts, and message between them. Typing indicators, delivery
and blue ticks all update live.

### Data safety — no data loss on updates

- The database is backed up **automatically every 6 hours** and **right before
  every clean shutdown** (which includes redeploys on Railway/Render). Backups
  are kept in `<DATA_DIR>/backups` (20 by default, override with `BACKUP_KEEP`).
- Point `DATA_DIR` at a **persistent volume** (Railway Volume / Render Disk) and
  the DB **and** its backups survive every redeploy — see `DEPLOY.md`.
- Manual backup anytime: `npm run backup`.
- There is deliberately **no seed/fake-data script** in this repo — the database
  contains only real accounts that sign up.

### Running on a physical device

The phone can't reach `localhost`. Point it at your machine's LAN IP:

```bash
# app/.env
EXPO_PUBLIC_API_URL=http://192.168.1.42:4000
```

### Download the app on iOS / Android

**Option A — Expo Go (free, ~1 minute).** The same codebase runs in the Expo Go
app on iPhone and Android. Start the dev server, then scan the QR code:

```bash
cd app
npx expo start        # scan the QR with Expo Go (App Store / Play Store)
```

**Option B — Standalone installable app via EAS Build.** Produces a real `.ipa`
(iOS) / `.apk` (Android) you can download on your phone.

Requirements: an [Expo account](https://expo.dev/signup) and, for iOS only, an
[Apple Developer Program](https://developer.apple.com/programs/) membership
(US$99/yr — Apple requires it to sign/install any standalone iOS app).
Android needs no paid account for a side-loaded APK.

```bash
cd app
npx eas-cli login                      # your Expo account
npx eas-cli build:configure            # one-time project setup
npx eas-cli build -p ios  --profile preview    # installable .ipa
npx eas-cli build -p android --profile preview # installable .apk
```

- The build runs in the cloud (~5–10 min) and prints a **QR code / install link** —
  open it on your iPhone to download the app. Internal-distribution builds need
  your device registered first: `npx eas-cli device:create` (or say yes when
  prompted).
- **No Apple Developer account?** Use the `simulator` profile
  (`eas build -p ios --profile simulator`) — no paid account needed, but it only
  runs in the iOS Simulator on a Mac.
- **TestFlight / App Store:** `npx eas-cli build -p ios --profile production`,
  then `npx eas-cli submit -p ios`.

Notes: the iOS/Android native folders are generated automatically during the
cloud build (this repo uses the managed Expo workflow, so nothing native is
committed). Calls ring and show history on native, but live WebRTC media is
web-only for now — see "Notes & limits" below.

---

## Features

**Accounts & profile** — register/login with a unique username + password (phone is
optional, for display only), bcrypt hashing, JWT sessions persisted via AsyncStorage,
editable name/username/about, auto-login on relaunch, and password-confirmed permanent
One ID deletion with safe cleanup/transfer of shared resources.

**Messaging** — 1:1 and group chats, optimistic sending, swipe-free reply threading,
emoji reactions, delete-for-everyone, **edit sent messages**, **forward to one or many
chats** (with a FORWARDED tag), image sharing with lightbox, voice-note UI with
waveform, 32-emoji picker, day separators, and per-user **Delete chat** that clears
history only for the person deleting it and restores the thread when a new message arrives.
First messages from people outside accepted contacts stay in Instagram-style **Activity**
(the +one wordmark or heart) until accepted, deleted, or blocked. Opening a chat or
tapping a username never sends a request — only sending a message does.

**Real-time (Socket.IO)** — instant delivery, typing indicators, online/last-seen
presence, single ✓ sent → double ✓✓ delivered → blue ✓✓ read, live unread badges,
receipts that flush when a recipient reconnects.

**Push notifications (Android first)** — when the app is closed or backgrounded, the
server sends an Expo push for: new direct/group messages (with a "mentioned you"
variant for @mentions), message/connect requests in Activity, colleague requests,
likes and comments on your Network posts, community join approvals, and incoming
calls. Tapping the notification opens the exact screen (that Conversation, Activity,
or the Colleagues tab) via the `plusone://` deep-link route carried in the payload.
Pushes respect everything you'd expect, server-side: per-chat mute (a muted chat
never pings), notification preferences per type, and **quiet hours** — inside the
window pushes are delivered silently (a low-importance Android channel) so a 3am
message is waiting in the morning without waking anyone. The launcher badge is
stamped on each push (unread chats + pending Activity) and kept in sync in-app.
One-time Android setup: create a Firebase project, generate an FCM v1 service
account key, and upload it with `eas credentials -p android` (see APP_STATUS.md).
iOS push follows the same code path once APNs credentials are added.


**Organisation** — chat list sorted by recency with **pinned chats pinned to the top**,
unread counts, global message search plus **in-chat search that jumps to the match**,
**starred messages** (save any message, browse them from Chat info or Settings),
archive, mute, group info with participant list and admin tags.

**Disappearing messages** — set a chat-wide self-destruct timer (30s / 5m / 1h / 24h)
from Chat info, or long-press any message for a per-message timer. Expired messages are
hard-deleted server-side on a 15-second sweep and vanish from every device in real time.

**Group admin powers** — admins can rename the group, promote/demote members to admin,
and remove members (the creator can't be demoted or removed; the last admin can't leave
or be removed). Membership changes post system messages and update everyone live.

**Polls** — group chats get a poll composer (question + 2–6 options). Polls render inline
as their own message with live vote counts and bars; members can vote or change their
vote, and results update in real time for everyone.

**The Network** — a public worldwide feed. Anyone can post text, an image and a
tag; posts appear live for every connected user via Socket.IO. Photo posts provide
Original, 1:1, 4:5, 16:9 and 9:16 framing with native crop editing, and preserve that
chosen box in the feed. Likes toggle with optimistic UI, threaded comments in a bottom
sheet, tag filtering, trending tags, cursor pagination, and author deletion.
Feed lenses: **Worldwide / My places / Following** — plus **Follow** any author
from their post and a **My places** audience so a post can target just people
who share your college or workplace.

**Calls** — real 1:1 voice/video WebRTC on every platform (browser + Android
app), with the ink-and-paper full-screen overlay, ringing, accept/decline and
call history. **Hold the mic button to record a voice note and release to send**
(quick taps are ignored so nothing accidental is ever sent).

**Communities with invite links** — every community has an 8-character invite
code: admins share `https://…/c/<code>` via WhatsApp/SMS and anyone with the
link joins instantly (the link is the approval, whatever the join policy).
Long-press rotates the code to revoke a leaked link; the code is only ever
visible to admins.

**Safety & Moderation (admin-only)** — a private Safety Center for accounts
with the backend `admin` role: context-aware detection (threats, violence,
extremism, child safety, scams, harassment — quotations and educational
discussion never alert) plus in-app user reports flow into the same reviewable
cases; HIGH/CRITICAL events alert the admin in realtime and by push on every
platform. Every admin action (warn/restrict/suspend/ban/remove) requires
explicit confirmation for irreversible steps and lands in an append-only audit
log. Automated detection prioritizes human review — it never auto-punishes —
and moderation evidence stays minimal (message references, no conversation
copies).

**Activity that stays readable** — likes and comments on your posts group into
one row each ("7 people liked your post") with a stack of the most recent
faces, instead of a wall of noise.

**Today at your place (the daily campus loop)** — the morning AI greeter now
reports campus life (*"2 people from your college posted today, and 1 person is
around now"*) and hands off with one tap into the **Today strip** on Colleagues
and Network: who's around or online from your places right now, one-tap
**"I'm around"** (a 12-hour presence flag, with matching pushes — *"Amit is
around"*, *"Riya from your college posted"*), and today's posts from your
places. Hidden for profiles without places; quiet hours, mutes and per-type
notification settings are enforced server-side like every other push.

**Colleagues** — place-based discovery inside The Network. Add a college/institution,
organization, or workplace to your profile, join an existing registered place, search
its members, and send connection requests. Accepted colleagues become contacts and can
open a direct chat immediately. Requests and newly joined members update in real time.

**Daily AI greeting** — once per day after sign-in, a GLB character automatically speaks
with a preferred feminine voice while its original embedded animation plays continuously
through Three.js without bone manipulation or retargeting. It uses the user's first name,
real location-based Open-Meteo weather, temperature and request counts, then closes itself
after “Let’s find the +ones.” See `AI_GREETER.md` for model/animation details.

**Status / stories** — post coloured text statuses, 24-hour auto-expiry, viewed/unviewed
rings, tap-through story viewer with progress bars.

**Design** — "Graphite & Pulp" (see `design.md`): artisanal ink-on-paper. No
shadows, no blur, no elevation tints — depth comes from stroke weight (hairline
graphite → 2px ink → 3px bold) and physical overlap. Underline-only inputs,
dashed hand-drawn rules, masking-tape chips, X-mark checkboxes, and a
highlighter-yellow accent used sparingly for focus and active states. Signed-in screens
use a lightly uneven hand-sketched graph with pencil fibres and graphite smudges on warm
paper. Login and signup keep their original manga halftone/speed-line background without
the graph overlay.
Bricolage Grotesque headlines / Karla body / JetBrains Mono labels.

**Icons & emoji — 100% SVG** — every icon is a true vector (`react-native-svg`) rendered
from official Ionicons path data via `<Icon>`. Every emoji is a full-colour Twemoji vector
(1445 of them — smileys, people, nature, food, travel, activities, objects, symbols)
rendered via `<Emoji>` / `<EmojiText>`, which auto-swaps emoji inside any string (message
bodies, group names, statuses, previews) — the picker itself is tabbed by category with
a name search ("fire" finds 🔥). No icon fonts and no system emoji glyphs anywhere, so
rendering is identical on iOS, Android and web instead of falling back to inconsistent
platform glyphs for anything outside a small hand-picked set.

**Calls** — real 1:1 voice and video calling over WebRTC, signalled through the existing
Socket.IO connection (ringing, accept/decline/busy/missed, mute, hang up), with call
history persisted server-side and a dedicated Calls tab to call someone back. On web this
is a genuine peer-to-peer audio/video connection; native iOS/Android media capture needs
`react-native-webrtc` + a custom dev build (see Notes & limits below) so the ringing/
history/signaling works everywhere but live audio/video is web-only for now.

**Self-updating** — **Settings ▸ App Updates** shows the installed version and updates
the app on the spot: one tap downloads the newest release and restarts straight into it.
It also runs quietly in the background (check on launch and on every return to the
foreground, install on the next reopen), with an *Auto-install updates* toggle to turn
that off. Native builds pull EAS/OTA bundles; on web the same button retires stale
service-worker/PWA caches and hard-reloads the freshly deployed bundle. See
`DEPLOY.md` → "Shipping app updates" for how to publish one.

**Polish** — full light/dark theme, deterministic colour avatars with initials,
pull-to-refresh, empty states, connection indicator. The web app is a proper
installable PWA (add-to-home-screen, standalone, no browser chrome) and syncs with
the system chrome: paper-coloured `theme-color`, safe-area padding for notches/home
indicators, and on the Median Android browser it drives the native status bar
(edge-to-edge overlay + theme-matched icons) via the Median JS bridge.

---

## Architecture

```
whatsapp-clone/
├── server/
│   ├── src/
│   │   ├── index.js      REST routes + Socket.IO event handlers
│   │   ├── db.js         SQLite schema (users, chats, members,
│   │   │                 messages, receipts, reactions, statuses)
│   │   ├── auth.js       JWT sign/verify + middleware
│   │   └── backup.js     automatic safety backups
│   └── uploads/          uploaded images (served at /uploads)
└── app/
    ├── App.js            providers + web phone frame
    └── src/
        ├── api.js        REST client, auto-detects backend URL
        ├── theme.js      light/dark palettes, avatar colours
        ├── Navigation.js stack + custom bottom tabs
        ├── store/        Auth / Chat(socket) / Theme contexts
        ├── theme.js      design tokens: ink strokes, radii, type scale
        ├── icons/       Icon.js + iconData.json  (Ionicons vectors)
        │                Emoji.js + emojiData.json (Twemoji vectors)
        ├── components/   Avatar, Ticks, MessageBubble, VoiceNote…
        └── screens/      Auth, ChatList, Conversation, NewChat,
                          Status, ChatInfo, Settings
```

### Socket events

| Direction | Event | Purpose |
|---|---|---|
| → | `message:send` | send text/image/voice (acked with the saved message) |
| → | `message:read` | mark a chat read → emits blue ticks |
| → | `typing` | broadcast typing state |
| → | `message:react` / `message:delete` | toggle reaction / delete for everyone |
| → | `message:edit` | edit one of my own text messages (acked with the update) |
| → | `poll:create` / `poll:vote` | post a poll message / vote or change my vote |
| ← | `message:new` / `message:updated` | new message, or status/reaction/edit/poll-count change |
| ← | `message:expired` | a disappearing message was deleted by its timer (`{chatId, messageIds}`) |
| ← | `chat:new` / `chat:updated` / `chat:removed` | chat list changes (removed = left/removed from a chat) |
| ← | `presence` | online / last-seen |
| → | `call:invite` / `call:accept` / `call:decline` / `call:hangup` | start, accept, decline, or end a 1:1 call |
| → / ← | `call:offer` / `call:answer` / `call:ice-candidate` | WebRTC SDP + ICE signaling relay (server never inspects payloads) |
| ← | `call:incoming` / `call:accepted` / `call:ended` | ring the callee, notify the caller, notify both sides a call ended |

### Message status derivation
A message is `delivered` once every other member has a delivered receipt, and `read`
once every other member has a read receipt — so it works identically for groups.

---

## Notes & limits

- **Push notifications** reach **web browsers too** — Chrome/Edge/Firefox (and
  Safari 16.4+ with the PWA installed). Web pushes are signed with VAPID keys
  the server generates itself on first boot (persisted on the /data volume);
  set `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` env vars only if
  you want to supply your own. No third-party service, no configuration.
- Android/iOS push needs a fresh app binary (1.4.0+, `versionCode` 6): it adds
  the `expo-notifications` native module, so already-installed APKs cannot pick
  it up over an OTA update. Android delivery additionally needs a one-time FCM
  v1 service-account key uploaded via `eas credentials -p android` (or the
  expo.dev dashboard → Credentials) — see PUSH_SETUP.md.
- Voice notes request microphone permission, record real WebM (web) or M4A/AAC
  (Android/iOS) audio with `expo-audio`, upload it to the active storage backend,
  and render a playable waveform bubble with the recorded duration.
- Calls are real peer-to-peer WebRTC on every platform: the browser's native
  implementation on web, `react-native-webrtc` on Android/iOS (Phase 3; needs
  the 1.4.0+ app build — older installs still ring and keep call history but
  cannot connect live media).
- Messages are not end-to-end encrypted — they travel over HTTPS to the server,
  which stores and relays them (the UI no longer claims otherwise).
- SQLite + local disk uploads are fine for demo/dev; swap for Postgres + S3 in production.
- Change `JWT_SECRET` (env var) before deploying anywhere real.
