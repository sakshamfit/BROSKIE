# BROSKIE — a claymorphic messenger

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
npm run seed     # creates demo users, chats, statuses
npm start

# 2. app
cd app
npm install
npx expo start          # press w for web, or scan the QR with Expo Go
```

### Demo logins — password `1234` for all

| Phone | Name |
|---|---|
| `+919000000001` | You (Demo) |
| `+919000000002` | Ananya Sharma |
| `+919000000003` | Rohit Verma |
| `+919000000004` | Priya Nair |
| `+919000000005` | Karan Mehta |

**To see real-time messaging:** open the app in two browser tabs (or a browser + phone),
log in as two different people, and message between them. Typing indicators, delivery
and blue ticks all update live.

### Running on a physical device

The phone can't reach `localhost`. Point it at your machine's LAN IP:

```bash
# app/.env
EXPO_PUBLIC_API_URL=http://192.168.1.42:4000
```

---

## Features

**Accounts & profile** — register/login with phone + password, bcrypt hashing, JWT
sessions persisted via AsyncStorage, editable name/about, auto-login on relaunch.

**Messaging** — 1:1 and group chats, optimistic sending, swipe-free reply threading,
emoji reactions, delete-for-everyone, image sharing with lightbox, voice-note UI with
waveform, 32-emoji picker, day separators.

**Real-time (Socket.IO)** — instant delivery, typing indicators, online/last-seen
presence, single ✓ sent → double ✓✓ delivered → blue ✓✓ read, live unread badges,
receipts that flush when a recipient reconnects.

**Organisation** — chat list sorted by recency, unread counts, global message search,
archive, mute, group info with participant list and admin tags.

**Status / stories** — post coloured text statuses, 24-hour auto-expiry, viewed/unviewed
rings, tap-through story viewer with progress bars.

**Design** — BROSKIE claymorphism (see `design.md`): soft "inflated" surfaces built from
dual outer shadows plus inner highlights, extreme roundness (pill controls, 24px bubbles),
inset "carved" inputs, zero borders or dividers, Inter typography with generous tracking,
and a mint/emerald palette on a `#f8fafc` clay background.

**Icons & emoji — 100% SVG** — every icon is a true vector (`react-native-svg`) rendered
from official Ionicons path data via `<Icon>`. Every emoji is a full-colour Twemoji vector
rendered via `<Emoji>` / `<EmojiText>`, which auto-swaps emoji inside any string (message
bodies, group names, statuses, previews). No icon fonts and no system emoji glyphs
anywhere, so rendering is identical on iOS, Android and web.

**Polish** — full light/dark theme, deterministic colour avatars with initials,
pull-to-refresh, empty states, connection indicator.

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
│   │   └── seed.js       demo data
│   └── uploads/          uploaded images (served at /uploads)
└── app/
    ├── App.js            providers + web phone frame
    └── src/
        ├── api.js        REST client, auto-detects backend URL
        ├── theme.js      light/dark palettes, avatar colours
        ├── Navigation.js stack + custom bottom tabs
        ├── store/        Auth / Chat(socket) / Theme contexts
        ├── theme.js      design tokens: clay shadows, radii, Inter scale
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
| ← | `message:new` / `message:updated` | new message, or status/reaction change |
| ← | `chat:new` / `chat:updated` | chat list changes |
| ← | `presence` | online / last-seen |

### Message status derivation
A message is `delivered` once every other member has a delivered receipt, and `read`
once every other member has a read receipt — so it works identically for groups.

---

## Notes & limits

- Voice notes record duration and render a playable waveform bubble; capturing real
  audio bytes needs `expo-audio` recording permissions on a device build.
- Calls tab is a placeholder — real calling needs WebRTC.
- "End-to-end encrypted" is a UI label, not real E2E crypto.
- SQLite + local disk uploads are fine for demo/dev; swap for Postgres + S3 in production.
- Change `JWT_SECRET` (env var) before deploying anywhere real.
