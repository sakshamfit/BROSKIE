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
editable name/username/about, auto-login on relaunch.

**Messaging** — 1:1 and group chats, optimistic sending, swipe-free reply threading,
emoji reactions, delete-for-everyone, **edit sent messages**, **forward to one or many
chats** (with a FORWARDED tag), image sharing with lightbox, voice-note UI with
waveform, 32-emoji picker, day separators. First messages from people outside accepted
contacts stay in a WhatsApp-style **Message requests** inbox until accepted, deleted,
or blocked.

**Real-time (Socket.IO)** — instant delivery, typing indicators, online/last-seen
presence, single ✓ sent → double ✓✓ delivered → blue ✓✓ read, live unread badges,
receipts that flush when a recipient reconnects.

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
tag; posts appear live for every connected user via Socket.IO. Likes toggle with
optimistic UI, threaded comments in a bottom sheet, tag filtering, trending tags,
cursor pagination, and authors can delete their own posts.

**Colleagues** — place-based discovery inside The Network. Add a college/institution,
organization, or workplace to your profile, join an existing registered place, search
its members, and send connection requests. Accepted colleagues become contacts and can
open a direct chat immediately. Requests and newly joined members update in real time.

**Status / stories** — post coloured text statuses, 24-hour auto-expiry, viewed/unviewed
rings, tap-through story viewer with progress bars.

**Design** — "Graphite & Pulp" (see `design.md`): artisanal ink-on-paper. No
shadows, no blur, no elevation tints — depth comes from stroke weight (hairline
graphite → 2px ink → 3px bold) and physical overlap. Underline-only inputs,
dashed hand-drawn rules, masking-tape chips, X-mark checkboxes, and a
highlighter-yellow accent used sparingly for focus and active states. Signed-in screens
carry an irregular pencil-fibre grain and faint graphite smudges on warm paper, while the
original manga halftone/speed-line background remains exclusive to login and signup.
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

- Voice notes record duration and render a playable waveform bubble; capturing real
  audio bytes needs `expo-audio` recording permissions on a device build.
- Calls are real WebRTC on web (genuine peer-to-peer audio/video via the browser's
  native RTCPeerConnection). On native iOS/Android, actual camera/mic capture needs
  `react-native-webrtc`, which requires a custom dev build outside the managed/Expo Go
  workflow this app runs under — ringing, accept/decline, and call history all still
  work for real on native, the app just shows a clear message instead of connecting
  media if a native device tries to start/answer a call.
- Messages are not end-to-end encrypted — they travel over HTTPS to the server,
  which stores and relays them (the UI no longer claims otherwise).
- SQLite + local disk uploads are fine for demo/dev; swap for Postgres + S3 in production.
- Change `JWT_SECRET` (env var) before deploying anywhere real.
