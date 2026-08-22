# FULL APP QA + WIRING + PERFORMANCE — LOOP #1 REPORT

**Scope:** entire BROSKIE / +one repo (Expo client `app/`, Node/Socket.IO/SQLite server `server/`)
**Audit date:** 2026-08-22 (UTC)
**Branch:** `arena/01a0284f-broskie`

**Result of LOOP #1: 10 bugs found → 10 fixed → full regression green.**
One loop is complete; the loop is *not* finished — see `REMAINING RISKS` / `NEXT LOOP` for what a
device/network environment must still verify. Everything below is evidence-based; anything I could
not actually execute is marked `NOT VERIFIED` / `BLOCKED` / `NEEDS DEVICE TEST` — no assumptions.

---

## Verification facts (what actually ran)

| Check | Result | Evidence |
|---|---|---|
| Server syntax (`node --check` all files) | **PASS** | 9/9 files parse |
| Server suites (9 suites) | **PASS — 263/263** | chat-history 14 · offline-messaging 14 · message-state 15 · push 33 · phase2 39 · phase3 27 · moderation 61 · OT 33 · features 27 |
| `bash scripts/ci.sh` end-to-end (deps → syntax → all suites → web export) | **PASS** | exit 0, `✅ CI/CD pipeline complete` |
| Web production export (`expo export --platform web`) | **PASS** | all 30+ screen/component chunks emitted, 0 errors |
| Android Hermes export (`expo export --platform android`) | **PASS** | `index-….hbc` (8.2 MB) emitted, 0 errors |
| Live server boot (production mode, single-host, `server/public`) | **PASS** | `+one server listening on http://0.0.0.0:4000`, `/api/health` → `ok:true` |
| Live REST user journey (register → login → /api/me → patch → users search → direct chat → send message → fetch → post → feed → like → comment → detail) | **PASS** | all 200s, data persisted and fetched back |
| Storage flow (multipart `/api/upload` → `/uploads/…` fetch) | **PASS** | upload → URL → GET 200 (correct bytes); malformed upload rejected |
| PWA/manifest/service-worker served by the deployed web build | **PASS** | `/service-worker.js` 200, `/manifest.json` 200, SPA fallback `/c/<code>` 200 |
| Auth (expected failures + happy path) | **PASS** | bad token → 401; strong-password registration + login; session restore logic reviewed |
| API wiring (client call sites ↔ server routes) | **PASS** | every client `/api/…` path matched a server route (8 template-literal false positives manually confirmed) |
| Socket wiring (client emits ↔ server handlers; server emits ↔ client listeners) | **PASS** | all 18 server handlers matched; all client listeners subscribed (incl. array-registered events) |
| Navigation wiring | **PASS** | all 19 stack routes + 4 tab pages exist; every `navigate(...)` target resolves; deep-link routes (chat/activity/colleagues/network/post/community) wired |
| Security — route authz | **PASS** | only 4 intentionally public routes (/api/health, username-available, register, login); every admin route double-gated `requireAdmin` |
| Security — secrets | **PASS** | no hardcoded keys/secrets in `server/src` or `app/src`; `google-services.json` contains public identifiers only |
| Memory-leak static audit | **PASS** | every component-level listener/timer/subscription has cleanup; provider singletons intentionally persistent |
| Error-message hygiene | **PASS (after fix)** | 8 socket catch-alls were leaking raw technical errors → now `socketFailure()` (friendly to client, detail logged) |

---

## BUGS FOUND → FIXED (10)

| # | Severity | Bug | Fix |
|---|---|---|---|
| 1 | **HIGH** | **Moderation enforcement gap.** A *restricted* (or suspended/banned) user could still write messages over the socket — `deliverUserMessage` had no moderation gate. The existing `test-moderation` failure (54/55) exposed it. | Added `moderationGate()` to the single shared message path + every other content side door: socket `message:send`, REST `POST /api/chats/:id/messages`, `message:edit`, `message:edit:ot`, `poll:create`, `POST /api/messages/forward`, `POST /api/status/:id/reply`. All return 403 with the human message. |
| 2 | MEDIUM | **Client ⇄ server OT divergence.** `app/src/ot/TextOperation.js` and `server/src/ot/textOperation.js` were NOT identical — the server had an `insertionIsBeforeCursor` tie-break in `transformCursor` that the client lacked. Selections cross the wire, so the two devices could render different cursors for the same event (and the files are documented as "identical logic"). | Ported the tie-break to the client; verified with a tool diff that only cosmetic parentheses remain. |
| 3 | MEDIUM | **Test drift — protection of a copy, not the code.** `server/test-message-state.js` mirrored `app/src/messaging/messageState.js` and had silently drifted (no OT merge, no backoff jitter, narrower permanent-error regex). | Test now **loads the real app ESM source** (module-syntax strip in plain Node) and asserts the real contract; coverage expanded 11 → 15 checks (OT merge, jitter range, full permanent-error set, `keepPending`, media-URI replacement). |
| 4 | MEDIUM | **OT parity untested.** No test compared client vs server OT behavior. | `test-ot.js` now has a `Client ⇄ server OT parity` section (transformCursor over tie cursors + `transform()` parity) — 31 → 33 checks. |
| 5 | LOW | **Stale legacy suite.** `server/test-features.js` required a pre-running server on :4000 and used passwords violating the current policy → it crashed (`FATAL fetch failed`) instead of testing. | Self-contained on :4300 with throwaway DATA_DIR, policy-compliant passwords, wired as `test:features` npm script. 27/27 green. |
| 6 | MEDIUM | **CI wiring gaps.** `scripts/ci.sh` skipped the OT + features suites; `docs/ci.workflow.yml` (the GitHub workflow template) skipped 4 suites and had a stale server-boot step for `test-features.js`. | Both now run all 9 suites (263 checks) + web export; the workflow doc = template for `.github/workflows/ci.yml`. |
| 7 | LOW | **Version metadata mismatch.** `app.json` says 1.4.0, `app/package.json`/lock said 1.2.0. | Aligned to 1.4.0. |
| 8 | MEDIUM | **PWA offline mode was permission-gated.** The service worker (offline shell cache + installability) was only registered *after* the user granted notification permission — denying the prompt silently disabled offline caching. | Service worker now registers unconditionally on sign-in; only the Push subscription stays permission-gated. `PushController` comment (claimed web was a no-op) corrected. |
| 9 | LOW | **Technical errors could reach users** through 8 socket catch-alls (`e.message`). | `socketFailure()` helper: known short validation phrases pass through; system/DB/network text is logged and replaced with "Something went wrong. Please try again." |
| 10 | LOW | **Docs drifted** (push 31→33, OT 31→33, moderation 55→61, message-state 11→15, CI totals, app version). | README / APP_STATUS / CI doc updated. |

---

## Status per requested category

- **SCREENS CHECKED:** 26/26 registered & bundle-verified; 4 tab pages + 19 stack routes. Every screen's REST/socket consumers mapped.
- **ROUTES CHECKED:** 19/19 stack routes + 4/4 tabs + deep links (`plusone://…`, `https://…/c/<code>`). 0 broken targets.
- **BUTTONS CHECKED:** all handlers resolve to real logic (settings, chat actions, community/colleague actions, moderation UI, composer actions, call controls). 0 dead buttons found.
- **API CONNECTIONS:** ~110 client call sites ↔ ~120 server routes — every client call matched; 0 orphan client calls that hit missing endpoints. (10 exported-but-unused client helpers and `/api/spotify/search` kept as backward-compat.)
- **DATABASE FLOWS:** users, chats, members, messages, receipts, reactions, polls, statuses, posts, comments, communities, colleagues, affiliations, blocks, push tokens, calls, docs/ops, moderation tables — all covered by suites + live journey; CRUD verified on the live server.
- **STORAGE FLOWS:** multipart upload → durable local-disk path → URL → served back (verified live). Supabase path: `BLOCKED` (no credentials here).
- **REALTIME FLOWS:** 18 socket events exercised by suites (send/ack, read receipts, typing, presence, reactions, polls, OT docs, message edit OT, calls signaling, chat/request/community/colleague updates, moderation alerts, push fan-out) — all green.
- **LOADING / EMPTY / ERROR / OFFLINE:** implemented and covered by local-first suites (outbox, backoff, idempotent retry, sync cursors, offline cache); UI state branches present in screen code (loading, true-empty, error boundary + retry on Conversation).

---

## PERFORMANCE

- **Startup:** main web chunk 1.4 MB; Auth screen + shell lazy-loaded; heavy chunks (emoji 2.4 MB, AI greeter 1 MB) are lazy and never load until used. `NOT VERIFIED` on device (no browser/device profiler here).
- **Navigation/tab:** all motion uses `useNativeDriver` (transform/opacity), reduced-motion respected — by code review; frame times `NEEDS DEVICE TEST`.
- **Network:** client `api.js` has 25 s timeouts, GET retries, dual-base fallback (Vercel ↔ Railway), network-class headers, `no-store` on GET; SW network-first with cache fallback; socket reconnect/backoff + outbox. Slow-network behavior verified at the protocol level; real 2G/3G `NEEDS DEVICE TEST`.
- **Memory:** static listener/timer cleanup audit PASS; repeated open/close profiling `NEEDS DEVICE TEST`.
- **Data efficiency:** pagination (`limit`/`before`), sync cursors, bounded 400-msg local history, debounced search, lazy chunks, image thumbs, no polling (socket push instead).

---

## SLOW NETWORK: **PASS (protocol-level)** — real-world PASS requires device test
## SECURITY: **PASS** (within repo scope; see residuals)
## BUILD: **PASS** (web + android Hermes + single-host static serve)
## REGRESSION: **PASS** (all 263 checks after every fix; final `ci.sh` exit 0)

---

## VERIFICATION HONESTY BOX

- `VERIFIED` — everything in the tables above ran in this environment.
- `NOT VERIFIED` — in-app browser behavior (the sandbox has no browser): no clicks, gestures, swipes, sheets, PWA install flow, or notification taps were executed in a real browser/device.
- `BLOCKED` — Supabase Storage/Postgres activation (no credentials), Android FCM push delivery (needs the service-account key upload + fresh APK — see APP_STATUS.md), GitHub workflow creation (repo token policy).
- `NEEDS DEVICE TEST` — Android/iOS: push tap → exact screen, WebRTC audio/video end-to-end, recorder permissions, low-RAM/2G behavior, 20× open/close memory profile, orientation/safe-area visuals, accessibility (TalkBack/VoiceOver).

## REMAINING RISKS
1. `/uploads` is served unauthenticated (unguessable nano-id capability URLs — standard messenger pattern; revisit if media should be private).
2. `cors({origin:'*'})` — acceptable because auth is bearer-token only (no cookies); tighten if cookies are ever added.
3. iOS `buildNumber: 5` vs Android `versionCode: 6` — confirm intended per-platform counters before the next release.
4. `status:reply` socket event has no client consumer (status replies are also delivered as normal chat messages) — harmless, but consider removing or consuming.
5. `profile:updated` (admin gold-tick change) isn't live-applied until the user's next profile refetch.
6. 10 unused client API helpers + community categories served server-side but consumed from a local list — intentional, keep for old app builds; note drift risk.

## NEXT LOOP (when device/browser access exists)
1. Device test: register → message locked phone → tap push → exact chat opens; muted chat / quiet hours (silent) paths.
2. Two-device WebRTC call + voice-note record/send/replay.
3. Real slow-network pass (throttle 2G/3G): outbox drain, sync cursor, offline reload via SW.
4. Memory profile: open/close Conversation 20×; check listener growth.
5. Activate `.github/workflows/ci.yml` from `docs/ci.workflow.yml` so every push runs the 263 checks.
6. Confirm Supabase Storage logs on Railway; move SQLite migration planning forward.

**LOOP #1 STATUS: COMPLETE — critical bugs 0 · broken routes 0 · dead buttons 0 · unwired features 0 · unhandled critical states 0 · build errors 0 · runtime crashes 0 (in executed scope) · obvious perf bottlenecks 0 (code-level).**
