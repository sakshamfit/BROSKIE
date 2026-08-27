# Community Landing Pages + Internal Linking — Build Report

Repo: `sakshamfit/BROSKIE` (branch `arena/01a042a4-broskie`)
Target: `plusoneco.in/communities/*` marketing pages
Date: 2026-08-27

---

## STEP 1 — Niche gate: built only what the app can actually do

Every page maps 1:1 to a real category in `app/src/components/communityMeta.js`.
The app ships exactly 8 community categories; 7 got landing pages:

| Page (URL) | In-app category | Verified in-app features cited on the page |
|---|---|---|
| `/communities/travel` | `trip` — Trip Planning | Discover filter, polls, join policies, invite links, disappearing ink |
| `/communities/running` | `run` — Running Group | same + voice notes/photos, member counts |
| `/communities/nightlife` | `club` — Club Night | same + admin promote/remove, last-admin protection, invite-code rotation |
| `/communities/gaming` | `game` — Game Night | same + group calls, revocable `/c/<code>` invite links |
| `/communities/study-groups` | `study` — Study Group | same + shared media, open-join Discover cards |
| `/communities/chai-chat` | `chai` — Chai Chat | open joining, polls, disappearing ink |
| `/communities/house-parties` | `party` — House Party | rotating invite codes, ask-to-join, multi-admin |

**Skipped on purpose** (no dedicated in-app feature — a landing page would
over-promise and bounce real searchers):

- **Fitness / gym accountability** — not a category; "Something Else" only.
  The closest real thing (`run`) covers "morning workouts" and the Running
  page copy addresses the accountability angle honestly.
- **Book clubs / hobbies** — not a category; would have pointed at the
  freeform `custom` catch-all. The hub links *Something Else* to the app
  itself instead, which is the truth.
- **Local / neighborhood meetups** — no location feature; replaced by the
  real `chai` "casual hangouts" category, which is the closest honest match.

`custom` / "Something Else" is intentionally **not** given a page (it is a
freeform fallback, not a niche).

## STEP 2 — Reusable template, data-driven

- **Single source of truth:** `app/web/community-niches.json` — niche name,
  headline, copy, demo copy, related links, per-page title/description,
  lastmod. **Adding a 9th niche = add one JSON entry + run the generator.**
- **Template:** `app/scripts/build-communities.mjs` renders every page from
  that data (one HTML template, zero per-page code). It also:
  - injects the hub's **"Browse by community type" directory** and its
    CollectionPage+ItemList JSON-LD between AUTO markers in the hand-written
    `app/web/communities.html` (hub upgraded in place; URL and all existing
    copy preserved), and
  - **regenerates `app/web/sitemap.xml`** — niche URLs can no longer be
    "manually forgotten"; `--check` mode makes CI enforce it, and
    `export-web.js` runs the generator on every build.
- Each page, in the requested order: H1 matching search intent → 3 short
  specific paragraphs (real features named: live poll bars, open/ask/invite
  join policies, `/c/<code>` invite links, per-message disappearing ink,
  member counts) → visual → CTA → "Explore other communities" (3–4
  contextual siblings, not all seven; encoded as real `<a href>`s and also
  mirrored in `WebPage.relatedLink` JSON-LD).

### ⚑ Flag: screenshots (per the "don't fake it" rule)

**No real screenshot of the Communities screen exists in the repo** — the
earlier fake-photos pass left labelled `SCREENSHOT PENDING` placeholders
everywhere. The niche pages therefore use the site's established honest
pattern: a CSS recreation of the **real community poll UI** (same `.demo`
system, real tokens, real animated behaviour that `test-site-motion.mjs`
verifies) with a visible caption stating it's a recreation and pointing at
where the real capture goes. When someone captures the app's Communities
screen, drop it at `app/web/assets/images/` and reference it — the pages do
not fabricate imagery.

### CTA deep links (user-approved app-side addition)

CTAs say "Join a <niche> community on +one" and link to
`/app?tab=communities&category=<run|trip|club|…>`, which now genuinely works:

- `app/src/push/links.js` — web boot reads the query (no URL-based routing in
  the app, so it survives the login redirect); `plusone://communities/<cat>`
  handled on native through the same path.
- `app/src/push/routing.js` — `openCommunitiesTab(category)` + pending/consume
  plumbing (mirrors the existing invite-link mechanism, so it works even when
  screens aren't mounted yet).
- `NetworkScreen` switches to the Communities section; `CommunitiesScreen`
  pre-applies the category filter chip. Unknown categories fall back to the
  unfiltered Discover grid — links can never dead-end.

Secondary CTA → `/download` (real APK release link + web app; there is no
App Store / Play Store listing yet — the pages don't claim one).

## STEP 3 — SEO/technical

1. **Unique titles + descriptions** on all 7 pages, intent-matched (e.g.
   "Running Communities & Running Groups — Plus One"). Enforced by
   `verify-site.mjs` (title/h1/description must match the data exactly, and
   must be unique site-wide).
2. **Structured data** (property names checked against schema.org docs, not
   guessed): hub = `CollectionPage` → `mainEntity: ItemList` (7 `ListItem`s
   with position+name+url) + existing `BreadcrumbList`; niche pages =
   `WebPage` (`isPartOf` hub, `relatedLink`, `dateModified`) + `BreadcrumbList`.
   `verify-site.mjs` got new structural rules for `CollectionPage`/`WebPage`.
3. **Sitemap:** regenerated by the generator, copied over the app's by
   `export-web.js`, now 17 URLs (10 previous + 7 new). Verified: every URL
   answers 200 and every niche is present.
4. **Real crawlable links:** all internal links (hub ⇄ niche, explore-others,
   CTAs) are `<a href>`; no JS-only navigation. `check-links.mjs` confirms
   **413 internal links** across **19 pages** all resolve.
5. **Speed / SSR-SSG:** these pages are static HTML shipped through the same
   `expo export` → Vercel static pipeline as the PageSpeed-fixed pages — no
   client fetch, no hydration, styles inlined at build, one deferred cached
   `site.js` (74 KB raw / ~29 KB gz). A full real `CI=true node
   scripts/export-web.js` ran in this session and all pages came out at
   ~42 KB HTML with **zero images** (LCP is the text H1). Real-Chrome
   Lighthouse can't run in this sandbox (no Chrome; CDN download egress-
   blocked — same limitation documented in `LANDING_REDESIGN_REPORT.md`), so
   the gate lives in CI: `/communities/running` was added to
   `lighthouse-ci.mjs` routes + the `landing-verify` workflow gained a
   generator-freshness (`--check`) step. Run PageSpeed Insights against
   `https://www.plusoneco.in/communities/travel` after deploy.

## STEP 4 — Verification results (this session)

- `node scripts/build-communities.mjs --check` → in sync, idempotent.
- `CI=true node scripts/export-web.js` (full production pipeline) → all 7
  pages + hub in `dist/`, no MISSING entries.
- `node scripts/verify-site.mjs` → **ALL PASS — 313/313 checks** (titles,
  descriptions, H1, canonicals, JSON-LD structure incl. new types, sitemap).
- `node scripts/check-links.mjs` → **PASS — 455 asset refs, 413 internal
  links, all resolve.**
- `node scripts/test-site-motion.mjs communities/travel.html` → **PASS**
  (15/15 reveals, no runtime errors, demo binds).
- Deep-link parser: 11/11 assertions, incl. non-regression of `/c/<code>`
  invite links and chat routes.
- CTAs lead somewhere real in-app (Communities grid, pre-filtered) or
  `/download` (APK). Nothing 404s locally; hub, all niches, sitemap, robots
  serve 200.
- **No existing pages/routes broke**: all previous routes pass every check,
  the hub's hand-written copy is untouched outside the generated grid, and
  the app-side changes are additive (new exports + two new listeners).
- Incidental fix: font `url()`s in `styles.css` made absolute — required for
  the deeper `/communities/<slug>` pages to load brand fonts when the CSS is
  inlined (also fixes the same latent break on `/blog/`).

## For Google Search Console (manual, per brief)

Re-submit `https://www.plusoneco.in/sitemap.xml`, then watch indexing for
these 8 URLs (7 new + changed hub):

- `/communities` (changed — new directory grid + ItemList schema)
- `/communities/travel`
- `/communities/running`
- `/communities/nightlife`
- `/communities/gaming`
- `/communities/study-groups`
- `/communities/chai-chat`
- `/communities/house-parties`

In a few weeks, sort the Performance tab by page and double down on whichever
niches draw impressions (the generator makes both adding an 8th real category
— once the app grows one — and pruning a dead page a data edit).

## Known follow-ups (not blocking)

1. Capture the real Communities screen (Discover grid + a live community)
   and swap the demo recreations for screenshots.
2. Optional: register `plusone://communities/<category>` as an Android/iOS
   App Link host path so the APK picks up the same deep link when the app is
   installed (parsing already works).
3. The `landing-verify` workflow ships as `.github/landing-verify.yml.txt` —
   `mv` it to `.github/workflows/` to activate real-Chrome Lighthouse + the
   new `--check` gate (bot token can't write to `workflows/`).
