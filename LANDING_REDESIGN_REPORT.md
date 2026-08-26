# +one Landing Page Redesign — Loop Report

Branch: `arena/01a03df1-broskie` · Date: 2026-08-26
Scope: visual match with the app (Graphite & Pulp) + motion (GSAP) + SEO for plusoneco.in

---

## Rendering strategy (SEO)

**Static HTML, built at export time.** The marketing pages in `app/web/` are
hand-authored HTML — every H1, paragraph, title, meta description, canonical and
JSON-LD block is in the **initial server response** with zero client rendering
(stronger than SSR: the bytes are pre-rendered at build). `app/scripts/export-web.js`
copies them into `dist/`, inlines the full stylesheet into each page (no
render-blocking CSS), and bundles the animation runtime as one deferred file.

**Deploy bug fixed:** the export script previously shipped only
`home/privacy/terms/support` — `/about`, `/communities`, `/chat`, `/network`,
`/download`, `/blog/`, `robots.txt` and `sitemap.xml` **never reached `dist/`**
(/about etc. fell through Vercel's catch-all rewrite to the homepage). All pages
+ robots + sitemap now ship; `app/public/` copies are kept in sync for
`--app-only` builds.

The React/Expo app remains a client-rendered SPA at `/app` (auth-gated product,
`Disallow: /app/` + excluded from sitemap — intentional).

## Goal 1 — Visual consistency

Tokens lifted verbatim from `app/src/theme.js` / `design.md` into
`app/web/styles.css`:

| token | value | used for |
|---|---|---|
| pulp | `#fdf8f8` | page surface, incoming bubbles |
| ink | `#1c1b1b` / `#000000` | text / primary strokes, sent bubbles, buttons |
| graphite / sub / muted / line | `#5d5f5b` `#444748` `#747878` `#c4c7c7` | secondary text, pencil lines |
| highlighter | `#ffe24d` (+soft/wash alphas) | CTAs hover, tape chips, read ticks |
| type | Bricolage Grotesque / Karla / JetBrains Mono | h1–h3 / body / labels+buttons |
| paper | 22px drafting grid, `rgba(28,27,27,.22)` @ .18, 14s drift | body background + demo bodies |
| radii | `inkBox` 4/8/4/6, sketch boxes `255px 15px 225px 15px/…`, bubble tails (mine TL8 TR6 BR0 BL8, theirs TL6 TR8 BR8 BL0) | cards, buttons, messages |
| depth | `raised()` offset shadows `3px 5px 0 rgba(0,0,0,.2)` / `6px 8px 0 …` — no blur | cards, QR note, phone frame |

Recreated UI moments (real product behaviour, real tokens — no stock graphics):
chat conversation (ink/paper bubbles, mono meta, ticks, typing dots),
disappearing-message timer (clock hand + countdown), group poll (6px ink-bordered
bars, "YOUR VOTE ✓", vote count), Network feed card (wobbly avatar, tape-chip
tag, dashed rule, like/comment actions, FOLLOW flip). Real app screenshots
(700×1244 captures) remain in the shots section / hero / network split.

Also fixed: stale mustard palette (`#f3ead8`) purged from theme-color, favicon,
QR card; favicon redrawn from tokens; PWA manifest icons now point at real files
(`/icon-192.png`, `/icon-512.png` — `/assets/icon.png` never existed).

## Goal 2 — Motion

**Library: GSAP (core only)** bundled with esbuild → `/assets/js/site.js`,
**28.5 KB gzipped, deferred, cached site-wide**. Rationale: the pages are
framework-free static HTML — Framer Motion would require shipping React +
react-dom (~45 KB gz extra) and hydrating static markup, directly violating the
"favor speed" constraint. ScrollTrigger (~17 KB gz more) was replaced by a
15-line IntersectionObserver trigger with identical one-shot behaviour.

- **Hero**: staggered fade/rise of kicker → H1 → intro → CTAs; phone frame
  settles translate-only (**never hidden — LCP-safe**) then floats ±5px on a
  5.5s loop; QR note pops in.
- **Scroll reveals**: `[data-reveal]` one-shot fades with group stagger on
  feature grids, shots, sections (not applied page-wide).
- **Looping demos**: chat (typing → reply → send → ✓ → ✓✓ → highlighter read →
  timer countdown → vanish), poll (scaleX bar fills, vote, chip pop), feed card
  (heart pulse, +1, FOLLOW → FOLLOWING ✓). All timelines **pause when
  off-screen**.
- **Micro-interactions**: button hover wash / press scale, card lift, shot
  un-tilt — pure CSS transforms.
- **Guardrails**: transform/opacity only (no width/height/top/left tweens — poll
  bars fill via `scaleX`), `prefers-reduced-motion` kills everything, no-JS
  progressive enhancement (reveal-hiding styles apply only under `html.js`;
  demos render as static UI without JS), try/catch safety net re-shows all
  content if anything throws.

## Goal 3 — SEO

- Home title/description/H1 exactly per strategy; required positioning sentence
  in crawlable text: *"Plus One is a community-based social platform built to
  help people connect, communicate and find communities around shared
  interests."*
- Real routes: `/` `/about` `/communities` `/chat` `/network` `/download`
  `/blog/` (+ privacy/terms/support) — unique title + description + canonical
  (`https://www.plusoneco.in/…`) + og/twitter tags each; all interlinked from
  nav + footer.
- `robots.txt` (allows marketing, `Disallow: /app/ /api/`, sitemap declared) and
  `sitemap.xml` (all 10 public URLs, lastmod 2026-08-26) now actually deploy.
- JSON-LD: **WebSite** (+SearchAction), **SoftwareApplication**, **Organization**
  (home); **MobileApplication** + **BreadcrumbList** (download); **BreadcrumbList**
  (about/communities/chat/network); **FAQPage** (chat); **Blog** (blog).
- `vercel.json`: cache header added for `/assets/js/*`.

## Verification (loop results)

| check | result |
|---|---|
| `scripts/verify-site.mjs` — per-route view-source: 200 + HTML, exact/unique title & description, single H1 with required text, canonical, inlined styles, site.js reachable, JSON-LD parse + per-type structural validation, robots/sitemap reachable, every sitemap URL 200 | **148/148 PASS** |
| `scripts/check-links.mjs` — 12 pages, 215 asset refs, 187 internal links | **PASS** (all resolve) |
| `scripts/test-site-motion.mjs` — jsdom: no runtime errors, reveals fire, demos build; bundle parse+init 27.9 ms jsdom-reduced (~10–15 ms Chrome) | **PASS** (index, chat, network) |
| Page weight (gzip) | home 13 KB HTML + 28 KB deferred JS + 74 KB LCP webp + ~21 KB font; sub-pages 8–10 KB |
| Lighthouse (real Chrome) | **Blocked in this sandbox** (browser cannot execute; Chrome CDNs blocked). `.github/workflows/landing-verify.yml` runs it on GitHub runners (scores gated: perf ≥ 90, a11y/bp ≥ 90, seo ≥ 95) + saves full-page screenshots + reports as artifacts. Push blocked by expired GitHub auth — run after reconnecting. |
| Rich Results Test | JSON-LD validated structurally offline (per-type required fields + shapes). Re-run Google's live test after deploy. |

## Files changed

- `app/web/`: `styles.css` (full retokenize), `home.html`, `about.html`,
  `communities.html`, `chat.html`, `network.html`, `download.html`,
  `blog/index.html`, `privacy.html`, `terms.html`, `support.html` (nav/theme),
  `robots.txt`, `sitemap.xml`, `manifest.json`, **new** `src/site.js`
- `app/scripts/`: `export-web.js` (ships all pages + robots + sitemap, esbuild
  step), **new** `verify-site.mjs`, `test-site-motion.mjs`, `lighthouse-ci.mjs`,
  `check-links.mjs`, `preview-site.mjs`
- `app/package.json` (+dev: `gsap`, `esbuild`), `app/public/robots.txt`,
  `app/public/sitemap.xml`, `vercel.json`, `.github/workflows/landing-verify.yml`

## Remaining (outside the repo)

1. **Reconnect GitHub auth in Arena** → push branch → the landing-verify
   workflow runs real-Chrome Lighthouse + screenshots (artifacts).
2. Deploy to Vercel (buildCommand unchanged) → confirm live
   `plusoneco.in/robots.txt`, `/sitemap.xml`, `/about` … view-source.
3. Google Rich Results Test + Search Console submission after deploy.
