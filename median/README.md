# +one — Median App Studio assets & setup

Everything here is generated from the canonical **+one** brush artwork in
`source-logo.png`, on the warm paper `#fdf8f8` used by the app, so the splash,
icon, status bar and in-app UI all share one identity.

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
| `splash-animated.json` | **Hand-authored Lottie splash animation** with your logo embedded (base64 image layer, fully self-contained). Upload this to Median App Studio → **Splash Screen → Lottie**. |
| `preview-splash.gif` | Animated preview of the splash (what you'll see in Median). |
| `preview-splash-frame.png` | Final frame still (full res). |

## What the animation does

Designed to match the app's **"Graphite & Pulp"** identity — no more blue
wipe, just three quiet beats (1.5 s total, 30 fps):

1. **Paper background** (`#fdf8f8`) fills the screen.
2. The **+one logo fades in and scales up** gently (88% → 100%, ease-out).
3. The final frame holds briefly before the app opens.

Everything is keyframes with no external files, so it works in any Lottie
player (Median, lottie-web, lottie-android).

## Regenerating / tweaking

```bash
# rebuild the JSON after editing constants in make_splash_animation.py
python3 make_splash_animation.py

# re-render the previews
python3 make_preview.py
```

Tweak the timing/position in `make_splash_animation.py` (constants at the
top: `DUR`, `LOGO_CX/CY`, `SCALE`, `LOGO_FADE_T`, and `LOGO_SCALE_T`).

> **iOS splash tip:** Apple wants launch screens via a *storyboard*, which
> Median auto-generates from the app icon. If you'd rather use the full-screen
> images above, keep it simple — the brand mark is centered with generous
> margins, so it survives any safe-area/letterbox handling.

## Recommended Median App Studio settings

1. **App Icon** → upload `icon-1024.png`.
2. **Splash Screen**
   - Android 12+: the splash shows the masked app icon centered. Use the
     generated `icon-1024.png` and set the surrounding background to black.
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
