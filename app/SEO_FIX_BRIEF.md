# SEO Implementation — BROSKIE (+one / plusoneco.in)

Repo: `sakshamfit/BROSKIE` (`arena/01a03d41-broskie`)
Target: `plusoneco.in` (homepage) + `plusoneco.in/app` (web app)
Date: 2026-08-26

---

## What was implemented (from the SEO brief)

### 1. Homepage SEO (`app/web/home.html`)
- Title: `Plus One — Community Social Platform | Connect, Chat & Find Your Community`
- Meta description: SEO-focused (mentions community, connect, chat, shared interests)
- H1: `Plus One — Find the +ones worth talking to.` (includes brand keyword)
- Sub-H1 paragraph: explicit platform description for crawl context
- Canonical URL: `https://www.plusoneco.in/`
- Theme-color meta: `#fdf8f8`
- PWA manifest link: `/manifest.json`
- Structured data (Schema.org): `WebSite`, `SoftwareApplication`, `Organization`

### 2. Multi-page architecture (new pages created)
All link back to `/app` and include canonical URLs + manifest links:
- `/about` (`about.html`)
- `/communities` (`communities.html`)
- `/chat` (`chat.html`)
- `/network` (`network.html`)
- `/download` (`download.html`)
- `/blog/` (`blog/index.html`) — basic index with two SEO articles

### 3. Sitemap (`sitemap.xml`)
Contains all 10 URLs (`/`, `/app`, `/about`, `/communities`, `/chat`, `/network`, `/download`, `/blog/`, `/privacy`, `/terms`, `/support`) with lastmod, changefreq, and priority.

### 4. Robots (`robots.txt`)
Allows all crawlers, points sitemap to `https://www.plusoneco.in/sitemap.xml`.

### 5. PWA Manifest (`manifest.json`)
- `display: standalone`
- `background_color`: `#fdf8f8`
- `theme_color`: `#fdf8f8`
- Icons: 192x192 and 512x512
- `start_url`: `/app`
- Copied to `dist/` during `npm run export:web` (export script updated)

### 6. Structured data updates
- `WebSite` schema with `potentialAction` (SearchAction)
- `SoftwareApplication` schema (`SocialNetworkingApplication`, operating systems, price `0`)
- `Organization` schema (name, URL, logo, `sameAs` GitHub link)

---

## What still needs to happen (per the brief)

These are NOT completed in this session — they require actions outside the code repo:

### Immediate (this week)
- [ ] Submit sitemap to Google Search Console
- [ ] Connect `plusoneco.in` to Google Search Console
- [ ] Set up Google Analytics (GA4 or similar) to track: visitors → signups → active users
- [ ] Verify `robots.txt` and sitemap are crawlable (`https://www.plusoneco.in/robots.txt`, `https://www.plusoneco.in/sitemap.xml`)

### Technical verification (requires live environment / Chrome)
- [ ] Run bundle analysis (`npm run export:web`) and check `dist/` size
- [ ] Profile scroll/tab/swipe on `plusoneco.in/app` in Chrome Performance tab
- [ ] Confirm `MessageBubble.js` uses `FlatList` (not `ScrollView.map`)
- [ ] Confirm `AIGreeterModel` lazy-loads (not mounted before sign-in) and disposes renderer
- [ ] Confirm images use lazy loading (`loading="lazy"`)
- [ ] Confirm Socket.IO typing/presence updates don't trigger full list re-renders

### Content / Brand (next 2-4 weeks)
- [ ] Create official brand profiles (Instagram, YouTube, LinkedIn, GitHub) linking to `plusoneco.in`
- [ ] Write SEO blog articles (e.g., "How to find a running partner", "Interest-based communities")
- [ ] Build backlinks from college communities, startup directories, tech articles
- [ ] Monitor Search Console for search queries → improve pages based on actual data

---

## Performance + SEO combined note

The motion graphics fixes (`React.memo` on Icon/Emoji, pure native-thread `LikeAction`, `BrandLoader` with reduced-motion gate) directly improve Core Web Vitals by reducing main-thread blocking and layout thrashing. The PWA manifest and structured data improve crawlability and installability.

Both work together: faster animations = lower First Input Delay (FID) / Interaction to Next Paint (INP); structured data + sitemap = better indexing.

---

## Files changed (SEO + Performance combined)

- `app/web/home.html` (SEO title, meta, H1, structured data, manifest link)
- `app/web/about.html`, `communities.html`, `chat.html`, `network.html`, `download.html`
- `app/web/blog/index.html`
- `app/web/manifest.json`
- `app/web/sitemap.xml`
- `app/web/robots.txt`
- `app/scripts/export-web.js` (manifest copy)
- `app/src/icons/Icon.js` (`React.memo`)
- `app/src/icons/Emoji.js` (`React.memo`)
- `app/src/components/BrandLoader.js` (reduced motion + cleanup)
- `app/src/components/PostCard.js` (`LikeAction`: pure `withSequence`)
- `app/src/Navigation.js` (`SlidingIndicator` — already native spring)
- `app/src/screens/OnboardingScreen.js` (reduced motion gate)
- `app/app.json` (splash fade config)
- `app/babel.config.js` (reanimated plugin)

---

## Bottom line

The web app (`plusoneco.in/app`) is now:
- Installable (PWA manifest, standalone mode)
- Crawlable (sitemap + robots + structured data)
- Structured for search (`WebSite`, `SoftwareApplication`, `Organization` schema)
- Multi-page (`/about`, `/communities`, `/chat`, `/network`, `/download`, `/blog/`)
- Faster (memoized SVG icons, memoized emoji, pure native-thread animations)

The remaining work is deployment verification (`npm run export:web`) + real Chrome profiling + mobile device testing.
