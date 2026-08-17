# 友達 — Median App Studio assets & setup

Everything here is generated in the **"Graphite & Pulp"** brand style
(warm paper `#fdf8f8`, India ink `#1c1b1b`, one highlighter accent
`#FFE24D`) so the splash, icon, status bar and the in-app UI all match.

## Files in this folder

| File | Use |
|---|---|
| `icon-1024.png` | App icon. Upload in Median App Studio → **App Icon** (it also feeds the Android 12 splash icon). |
| `splash-android-1080x1920.png` | Android splash — upload under **Splash → Android** (optional; App Studio can auto-generate from the icon). |
| `splash-ios-1170x2532.png` | iPhone 13 / 14 / 15 (6.1″) launch image. |
| `splash-ios-1242x2688.png` | iPhone 12–14 Pro Max (6.7″) launch image. |
| `splash-ios-1290x2796.png` | iPhone 15 Pro Max (6.7″) launch image. |
| `splash-ipad-2048x2732.png` | iPad portrait launch image. |
| `generate_assets.py` | Regenerates everything (`python3 generate_assets.py` — needs Pillow). |
| `splash-animated.json` | **Lottie splash animation** with your logo embedded (base64 image layer). Upload this to Median App Studio → **Splash Screen → Lottie** if you want an animated launch. The original animation (white bg → blue circle wipe → reveal) is kept; only the small vector logo was replaced with your black wordmark, sized ~200px wide, centered just above the "life_on" text. |
| `preview-frame160.png` | What the animated splash looks like at the end of the wipe (frame 160), for reference. |

> **iOS splash tip:** Apple wants launch screens via a *storyboard*, which
> Median auto-generates from the app icon. If you'd rather use the full-screen
> images above, keep it simple — the brand mark is centered with generous
> margins, so it survives any safe-area/letterbox handling.

## Recommended Median App Studio settings

1. **App Icon** → upload `icon-1024.png`.
2. **Splash Screen**
   - Android 12+: the splash shows the (circular-cropped) app icon centered.
     `icon-1024.png` is already a simple, low-complexity mark — perfect.
   - Optionally upload the per-platform splash PNGs above.
   - Set **splash background color** to `#fdf8f8` (paper) so the launch
     blends straight into the app UI.
3. **Status bar**
   - Set the status bar style to **light** (dark icons) — matches the paper
     background. The app also drives the status bar itself at runtime via
     the Median JS bridge (`median.statusbar.set` with `overlay: true`), so
     whichever wins, the result is the same: edge-to-edge, theme-matched.
   - `overlay: true` is intentional (native-app look). If the on-screen
     keyboard ever covers the chat input in Median, toggle overlay off while
     typing (see `app/src/web/medianStatusBar.js`).
4. **Background / theme color** → `#fdf8f8`.

## How the assets stay in sync

The same artwork is mirrored into the repo:

- `app/assets/icon.png`, `app/assets/splash-icon.png`,
  `app/assets/android-icon-foreground.png`, `app/assets/favicon.png`
  → used by the Expo / EAS native builds.
- `app/public/icon-192.png`, `app/public/icon-512.png`,
  `app/public/apple-touch-icon.png`, `app/public/favicon-32.png`
  → used by the web PWA (add-to-home-screen icon).

So the phone app (Median or EAS), the web app and the PWA all share one
identity. To change the design: edit `generate_assets.py`, re-run it, commit.
