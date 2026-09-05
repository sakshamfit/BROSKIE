# Prompt for Claude (local) — build the +one Android APK and make it run smoothly on every phone

Copy everything below the line into Claude Code / Claude Desktop running on your own
machine, from inside a checkout of `sakshamfit/BROSKIE`. It is written to be pasted
as-is. It assumes you have (or will create) an Expo account and that your machine
can reach `expo.dev`, `dl.google.com` and Maven — the Arena sandbox could not, which
is why this work has to happen locally.

---

You are working in a checkout of the `sakshamfit/BROSKIE` repo on branch
`arena/01a0706f-broskie` (rebase onto `main` if it has moved). The project is
**+one**, an Expo SDK 57 / React Native 0.86 messenger. The web app already builds
and ships to `plusoneco.in/app` via Vercel; the Node/Socket.IO/SQLite backend runs on
Railway at `https://broskie-h.up.railway.app`. **Do not touch the web export or the
backend.** Your job is only the Android binary.

## Goal

1. Produce an installable Android **APK** with EAS (profile `preview`).
2. Make sure it runs smoothly on **every** Android phone we can reasonably expect —
   from a 2 GB-RAM Android 7 budget device to a 2026 flagship — with no crashes on
   launch, no jank in the chat list, no broken permissions, no blank screens.
3. Publish it and update the download page.

Work in phases. After each phase, stop and report before continuing.

## Phase 0 — Read the ground truth (10 min, no edits)

- `app/app.json`, `app/eas.json`, `app/package.json`, `app/plugins/withAuthNetworkSecurity.js`
- `APP_STATUS.md` (current release metadata), `DEPLOY.md` (EAS Update section),
  `PUSH_SETUP.md`, `QA_LOOP2_REPORT.md`, `app/PERFORMANCE_FIX_BRIEF.md`
- `app/src/api.js` (how the native app resolves the API + socket origin)

Facts already verified — do not re-derive them, just confirm nothing changed:

| Item | Value |
|---|---|
| Package / applicationId | `ai.arena.tomodachi` |
| Version / versionCode | `1.4.0` / **8** (bumped from 7 on this branch) |
| EAS project id | `cfaadedd-ce58-4cec-b88f-261178485cda`, updates channel `stable`, runtime policy `fingerprint` |
| `minSdkVersion` | 24 (Android 7.0) |
| Prebuild defaults | New Architecture **on**, Hermes **on**, edge-to-edge **on**, ABIs `armeabi-v7a, arm64-v8a, x86, x86_64` |
| Native modules that force a new binary | `expo-notifications`, `react-native-webrtc` (124.0.8), `expo-location`, `expo-audio`, `expo-gl` / three, `lottie-react-native`, `react-native-reanimated` 4 + `react-native-worklets` |
| Deep links | `https://www.plusoneco.in/{c/*, gc/*, communities, communities/*, app}` with `autoVerify` — assetlinks served from the Railway backend |
| Known open issue | Last published APK on GitHub Releases is tag `newrelease` (Aug 20). `app/web/download.html` links to it. |

`expo prebuild --platform android` has already been run on this branch and completes
cleanly, so config-plugin errors are not expected.

## Phase 1 — Compatibility hardening (edit, then `npx expo prebuild --platform android --clean` to confirm it still prebuilds)

Make these changes in `app/app.json` unless noted. Keep every change minimal and
explain each one in the commit message.

1. **Pin the Android SDK levels explicitly** via `expo-build-properties`
   (`npx expo install expo-build-properties`) so a Play-Store-style target level is
   guaranteed rather than inherited:
   - `compileSdkVersion` 36, `targetSdkVersion` 36, `minSdkVersion` 24 (keep 24 — do
     **not** raise it; budget phones matter).
   - `enableProguardInReleaseBuilds: true`, `enableShrinkResourcesInReleaseBuilds: true`
     (the last APK was 112 MB; shrinking matters on 32 GB phones).
   - If ProGuard breaks anything at runtime (test on a release build!), add the
     narrow keep rules with `extraProguardRules` instead of turning it off.
2. **16 KB page-size compliance** (required for Android 15+ devices and Play
   from Nov 2025): after a build, run `zipalign -c -P 16 -v 4 app.apk` or the
   `check_elf_alignment.sh` script from the Android docs against every `.so` in the
   APK. Anything not 16 KB-aligned must be fixed by upgrading that library
   (most likely candidates: `react-native-webrtc`, `expo-gl`, `libsodium-wrappers`
   fallbacks). Report which `.so` files fail before you change any versions.
3. **Edge-to-edge is on by default in SDK 57.** Audit every screen for content under
   the status/nav bars: search `app/src/screens` and `app/src/components` for
   hard-coded `paddingTop`/`marginBottom` values and make sure `SafeAreaView` /
   `useSafeAreaInsets` from `react-native-safe-area-context` is used at the root of
   every screen, and that the chat composer sits above the gesture nav bar and the
   keyboard (`softwareKeyboardLayoutMode: "resize"` is already set — verify it still
   behaves with edge-to-edge; if it doesn't, use `KeyboardAvoidingView` behavior
   `"padding"` on Android only where needed).
4. **Predictive back gesture (Android 13+):** `enableOnBackInvokedCallback` is
   currently `false` in the generated manifest. Leave it `false` *unless* you
   confirm that React Navigation's back handling works with it on — do not flip it
   blindly.
5. **Orientation:** `orientation` is `"default"` → manifest `unspecified`. Confirm
   the call overlay, image editor and camera flows handle rotation without losing
   state. If any of them break, lock only that screen with
   `expo-screen-orientation` (already installed) rather than the whole app.
6. **Low-end device budget.** Search for anything that runs unconditionally at
   startup and is expensive: `@react-three/fiber` / `three` / `expo-gl` scenes, Lottie
   animations, the AI greeter, font loading of 7 Google-font families. Make sure:
   - 3D / GL content is lazy-loaded (`app/src/lazy.js` exists — use it) and gated
     behind a capability check (skip it entirely when `Device.totalMemory` < 3 GB or
     when `expo-gl` context creation fails).
   - Fonts: load only the weights actually used; the rest can stay web-only.
   - Reanimated worklets don't allocate per frame in the chat list; FlatList /
     FlashList has `windowSize`, `maxToRenderPerBatch`, `removeClippedSubviews`
     tuned, and every list row is memoised.
   - Images from `/uploads` go through `expo-image-manipulator` resizing before
     display in lists (thumbnails), not full-size decodes.
7. **Permissions at runtime**, not just in the manifest: verify each of
   `RECORD_AUDIO`, `CAMERA`, `POST_NOTIFICATIONS` (Android 13+), `ACCESS_FINE_LOCATION`
   (when-in-use only), and photo picking is requested lazily at the moment of use,
   handles "denied" and "denied forever" without crashing, and never blocks the
   sign-up / login flow. `READ_EXTERNAL_STORAGE` is a no-op on Android 13+ — make
   sure the picker uses the Photo Picker path there.
8. **Network on real phones:** `withAuthNetworkSecurity` disables cleartext.
   Confirm the native app only ever talks to `https://plusoneco.in` (HTTP via the
   Vercel proxy) and `https://broskie-h.up.railway.app` (sockets), and that a
   phone with a hostile DNS / captive portal shows a friendly "can't reach server"
   state rather than an infinite spinner. Check `EXPO_PUBLIC_API_URL` is **unset**
   for the EAS build (the resolver in `api.js` falls back correctly, but don't rely
   on it).
9. **Push:** `google-services.json` is in the repo. Confirm the FCM v1 service
   account is uploaded to EAS (`eas credentials -p android` → Push Notifications) —
   without it Android push is silently dead in the APK.
10. **Crash visibility:** the app has no crash reporter. If it is cheap (< 30 min),
    add `expo-updates` error recovery config (`updates.fallbackToCacheTimeout` is
    already 5000) and make sure the root `ErrorBoundary` shows a retry screen
    rather than a white screen. Do not add a third-party SDK without asking.

Run the unit tests (`cd app && npm test`) after edits.

## Phase 2 — Build

```bash
cd app
npx eas-cli login
npx eas-cli build -p android --profile preview --non-interactive
```

- The Android keystore already lives on the EAS project; do **not** generate a new
  one (a new keystore = users can't update over the old install).
- Download the APK. Record: size, and the output of
  `aapt2 dump badging <apk> | grep -E "package|sdkVersion|native-code"`.
- Verify the ABIs list shows all four architectures and `versionCode='8'`.

## Phase 3 — Test matrix (this is the part that makes it "every phone")

Use real devices where you have them and Android Emulator system images for the
rest. **Minimum matrix — do not skip any row:**

| Device class | API | RAM | What it catches |
|---|---|---|---|
| Emulator, Pixel 2, **API 24** (Android 7.0) | 24 | 2 GB | minSdk crashes, missing `Intl`, old WebView, Hermes on ARMv7 |
| Emulator, small phone, API 28 | 28 | 2 GB | notification channels, runtime permission flows |
| Emulator, Pixel 6, API 33 | 33 | 4 GB | `POST_NOTIFICATIONS`, Photo Picker, predictive back |
| Emulator, Pixel 8, **API 35/36**, 16 KB page size image | 36 | 8 GB | 16 KB page alignment, edge-to-edge, targetSdk 36 behaviour |
| Emulator, tablet / foldable (Pixel Fold) | 34+ | — | `DesktopLayout.js` breakpoints, rotation, split screen |
| Real phone(s) you own | any | any | camera / mic / actual calls, push, deep links |

For each row, run this script and note pass/fail:

1. Cold start with airplane mode **on** → must show a clear offline state, not crash.
2. Airplane mode off → sign up a fresh account, log out, log back in.
3. Open a chat with 200+ messages → scroll top-to-bottom at speed; no dropped
   frames visible, opens at the latest message (regression from QA_LOOP2).
4. Send: text, emoji, photo from gallery, photo from camera, voice note (hold mic),
   location-based greeting.
5. Receive a push with the app in background **and** fully killed → tap it → lands
   in the right chat.
6. Start a voice call and a video call with a second device; rotate mid-call;
   background the app mid-call; come back.
7. Tap `https://www.plusoneco.in/c/<any-invite>` from the messages app → opens in
   the app, not the browser (`adb shell pm get-app-links ai.arena.tomodachi`
   should show `verified`).
8. Switch dark/light system theme while the app is open.
9. Background the app for 10+ minutes → resume → socket reconnects, unread counts
   correct.
10. `adb shell dumpsys meminfo ai.arena.tomodachi` after 5 min of use — flag if
    > 350 MB PSS on the 2 GB device.
11. Change system font size to largest → nothing clipped in the composer or
    settings.
12. Kill the app via "Force stop" and via swipe; relaunch — no white screen, no
    stale JS bundle mismatch (check `expo-updates` didn't fetch an update built
    for a different fingerprint).

Also run `adb logcat *:E` during every session and treat any `FATAL EXCEPTION`,
`ANR`, or `Reanimated`/`Worklets` version-mismatch error as a blocker.

Fix what you find, rebuild, re-run only the failed rows. Iterate until the matrix
is green.

## Phase 4 — Ship

1. Publish the APK:
   ```bash
   gh release create v1.4.0-android <apk> \
     --title "+one v1.4.0 (Android, versionCode 8)" \
     --notes "<what changed, which devices were tested>"
   ```
2. Update `app/web/download.html` to the new asset URL (both occurrences), and
   regenerate the QR (`app/web/assets/qr-apk.svg`) if it encodes the URL.
3. Update `APP_STATUS.md` release metadata (version / versionCode / date / device
   matrix results) and the checklist item about distributing the 1.4.0 APK.
4. Commit everything to `arena/01a0706f-broskie`, push, open a PR against `main`
   with the matrix results table in the description.
5. **Only after** the APK is live and confirmed installing over the old one, publish
   the JS to the channel so existing installs on the *same* fingerprint get it:
   `npx eas update --channel stable --message "1.4.0 vc8"`. If the fingerprint
   changed (it will — native modules changed), skip this; the APK is the update.

## Rules

- Never raise `minSdkVersion` above 24, never generate a new keystore, never change
  `package`, `slug`, or the EAS project id.
- Don't disable ProGuard/Hermes/New Architecture to "fix" a crash — find the
  actual cause; if you truly must, explain why and what it costs.
- Prefer removing work from the startup path over adding loading spinners.
- If something needs a credential you don't have (Expo login, FCM key, Apple), stop
  and ask — don't fake it or skip the step silently.
- Report in the format: **what you changed → why → how you verified it → what's
  still open**, with device/API level for every observed bug.
