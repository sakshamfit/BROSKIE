# +one — landing page

Marketing site for **[+one](https://github.com/sakshamfit/BROSKIE)**, an ink-and-paper messenger.

Drawn in the same Graphite & Pulp system as the app: warm pulp paper, India-ink strokes, highlighter yellow, Bricolage Grotesque / Karla / JetBrains Mono.

## Preview locally

```bash
python3 -m http.server 4173
```

Open `http://localhost:4173`.

## What’s on the page

- Hero with the brush wordmark and live-looking chat mockups
- Feature grid (chat, ticks, requests, calls, disappearing ink, polls, Network, colleagues, stories)
- Deeper sections for The Network, Colleagues, and the daily AI greeting
- Light / Dark / Kinetic Ink theme cards
- CTAs into the live messenger at [broskie-h.up.railway.app](https://broskie-h.up.railway.app)

Override the app URL with `?app=` or `window.PLUSONE_APP_URL`.

## Deploy

This repo is static HTML/CSS/JS. GitHub Pages (root of `main`) is enough. No build step.
