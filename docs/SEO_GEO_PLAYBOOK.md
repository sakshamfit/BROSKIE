# SEO + AI Visibility (GEO) Playbook — Plus One / plusoneco.in

Date: 2026-08-27
Goal: when people search Google **or ask an AI assistant** about "plus one",
"plus one chatting app", "chatting app", "communities", "gc / group chat"
(and close variants), Plus One shows up.

This document covers **what shipped in the repo** and **what must happen
outside the repo** to actually win the rankings. Both halves matter.

---

## 0a. Update — 2026-09-19: "real-time chat" + "make friends online" clusters, brand disambiguation, share cards

Brief for this pass (owner's words): make Google surface plusoneco.in for
**"plus one" / "+one"**, **"chatting app"**, **"real time chatting app"**,
**"I want to meet friends online" / "online friends" / "friends talking"**
and **"group" (group chat)** — after researching competitors and the
keywords those SERPs actually reward.

### What the research showed (Sept 2026 SERPs)

| Query cluster | Who ranks today | What the winners have in common | Our play |
|---|---|---|---|
| `real time chatting app`, `realtime chat app`, `real-time messaging app` | Mostly **developer** content (Socket.IO / Firebase / Stream tutorials, GitHub repos) — few consumer apps compete | "how it works" explanations, WebSocket vocabulary, open-source code | **Low competition.** New `/real-time-chat-app` speaks both to users (instant delivery, typing, presence, read receipts) and devs (Socket.IO, open-source repo). |
| `make friends online`, `apps to make friends`, `online friends`, `friendship app`, `meet new people online` | Listicles (Timeleft, Introvrs, Science of People, Grey Journal…) + Bumble BFF, Meetup, Slowly, Boo, 222, Yubo, Discord | Comparison tables, FAQ blocks, "free / no swiping / introverts / new city" angles, honest pros-cons | New `/make-friends-online` (communities-first, no swiping, no photo, no phone number, safety) + listicle `/blog/best-apps-to-make-friends-online` + guide `/blog/how-to-make-online-friends`. |
| `plus one app`, `plus one chatting app`, `+one app` | OnePlus (phones), eventsplusone.com (event companions), a "plusone" companionship/dating app, misc. | Brand entity clarity | `/plus-one` gained an explicit **"Plus One vs. OnePlus (and other PlusOne apps)"** section + FAQ; Organization/WebSite/SoftwareApplication schema gained `alternateName` (`+one`, `Plus One app`, `plusoneco`), founders, India origin, Instagram/GitHub `sameAs`. Bare **"plus one"** remains an unwinnable dictionary/etiquette query — see §1. |
| `chatting app`, `best chatting apps in India`, `chatting app without phone number` | WhatsApp/Telegram/Signal roundups, "Indian chat apps" listicles (Arattai, JioChat, ShareChat) | India angle, "no phone number", free | `/chatting-app` keywords + copy now include *real time chatting app*, *Indian chatting app*, *chatting app to make friends*; new FAQ answers "for new friends or people I know?". Homepage title/H1 now carry **"real-time"**. |
| `group chat app`, `online group chat`, `create a group chat online` | Slack/Discord/WhatsApp/GroupMe roundups | how-to + feature grids | `/group-chat` keywords + copy: *online group chat*, browser use without install, cross-links to the two new pages. |

Competitors catalogued for the honest listicle: **Bumble BFF / Bumble For
Friends** (swipe, photos + phone required, relaunched late 2025 with Groups),
**Meetup** (tens of millions of members, free to attend, organisers pay),
**Discord** (servers, email signup), **Timeleft** (paid dinners with five
strangers), **Slowly** (delayed pen-pal letters). Plus One's own weaknesses
are stated in the post (young; densest in Indian cities/campuses; no event
ticketing) — credibility is the ranking asset for a listicle from a vendor.

### Keyword → page map additions

| Query family | Canonical page | Support |
|---|---|---|
| real time chatting app · realtime chat app · instant messaging app · live chat with friends · open source chat app | `/real-time-chat-app` | home "Realtime, not almost" card, `/chat`, `/chatting-app`, `/group-chat` in-copy links, footer |
| make friends online · meet friends online · online friends · make new friends app · friendship app · talk to new people online · friends near me / from my college | `/make-friends-online` | `/blog/best-apps-to-make-friends-online`, `/blog/how-to-make-online-friends`, home Explore card + communities strip, `/communities`, footer |
| plus one app · +one app · plusoneco · plus one chat app (brand) | `/` + `/plus-one` | schema `alternateName`, OnePlus disambiguation FAQ, llms.txt "not OnePlus / not a dating app" facts |

### What was implemented

- **New landing pages** (site chrome, animated demo, checks list, `.compare`
  table, FAQ, explore grid; WebPage + BreadcrumbList + FAQPage JSON-LD,
  HowTo on the friends page): `app/web/real-time-chat-app.html`,
  `app/web/make-friends-online.html`.
- **New blog posts**: `blog/best-apps-to-make-friends-online.html`
  (BlogPosting + **ItemList** + FAQPage), `blog/how-to-make-online-friends.html`
  (BlogPosting + HowTo + FAQPage); both carded at the top of `/blog/`.
- **Homepage retune**: title → *Plus One — Real-Time Chatting App for Friends,
  GCs & Communities*; H1/sub-H1 and 158-char description now contain
  "real-time" and "make friends online"; keywords meta extended; Explore grid
  6 cards (+ real-time, + make friends). `SoftwareApplication` gained
  `softwareVersion 1.4.0`, `installUrl/downloadUrl`, `screenshot`, `image`,
  fuller `featureList`, `applicationSubCategory`; `Organization` gained
  `alternateName`, `description`, `foundingLocation: India`, `founder`,
  Instagram `sameAs`. **No `aggregateRating`** (no verifiable review source —
  faking one is a manual-action risk).
- **Share cards**: new 1200×630 `app/web/assets/images/og-plus-one.png`
  (logo + "Free real-time chatting app · Group chats · Communities · Make
  friends online · No ads · No phone number"). Every page — hand-written,
  blog, and the generated community pages via `build-communities.mjs` — now
  emits `og:image` (+ `width/height/alt`), `og:locale en_IN`,
  `twitter:card summary_large_image`, `twitter:title/description/image`.
  JSON-LD `logo` still points at the square `icon-512.png` (correct for logos).
- **Footer** on every page (+ generator template): *Real-time chat app*,
  *Make friends online*.
- **App shell kept out of the index**: `<meta name="robots" content="noindex,
  nofollow">` in `app/public/index.html`; `X-Robots-Tag: noindex, nofollow`
  headers in `vercel.json` for `/app`, `/app/*`, `/c/*`, `/gc/*` (works even
  where `robots.txt` blocks the crawl).
- **GEO**: `llms.txt` / `llms-full.txt` gained the two pages, the two posts,
  "Is Plus One a real-time chat app?", "Can I make friends online on Plus
  One?", "Is Plus One a dating app?", "Is Plus One the same as OnePlus?",
  origin (India, founders, MIT on GitHub). `app/public` copies synced.
- **Plumbing**: `community-niches.json` `sitemapStatic` (+4 URLs, `lastmod`
  bumped on retuned pages) → `sitemap.xml` now **34 URLs**;
  `export-web.js` pages list; `verify-site.mjs` exact title/H1/description
  for the new + retuned pages, new `ItemList` schema rule, sitemap
  expectations; `styles.css` gained `.compare` (responsive table),
  `.steps` (numbered how-to) and inline `code`.

**Verification after this pass:** `build-communities.mjs --check` green,
`verify-site.mjs` **729/729**, `verify-seo.mjs` **893/893** (34 pages),
`check-links.mjs` 1,080 internal links + 1,160 asset refs all resolve.

### Still needs a human (nothing in the repo can do these)

1. **Deploy, then Search Console**: *URL Inspection → Request indexing* for
   `/real-time-chat-app`, `/make-friends-online`, the two posts and `/`;
   resubmit `sitemap.xml`. Expect first impressions in 1–3 weeks.
2. **Validate rich results** for the four new URLs at
   search.google.com/test/rich-results (FAQ, HowTo, Breadcrumb, ItemList) and
   the share card at developers.facebook.com/tools/debug + cards-dev.twitter.
3. **Google Play / App Store listings** (when live) are the single strongest
   signal for "plus one app": same name, same 1-line description, link back
   to `https://www.plusoneco.in`, and add the store URLs to `sameAs` +
   `installUrl`.
4. **Backlinks are what move "chatting app" / "make friends online"** — both
   are competitive SERPs. Cheapest wins: the GitHub README linking to the two
   new pages with those anchor texts; Product Hunt / AlternativeTo /
   Slant / SaaSHub listings; a "made in India" angle to Indian tech press and
   campus newsletters; answer Quora/Reddit threads on "apps to make friends
   in India" honestly with the guide URL.
5. **Keep the Instagram bio link** pointing at `https://www.plusoneco.in`
   so the `sameAs` entity link is reciprocal.

### Honest expectation

- **"plus one app", "plus one chatting app", "+one app", "plusoneco"**:
  winnable within weeks of indexing — brand + disambiguation now explicit.
- **"real time chatting app" / "realtime chat app"**: realistic first-page
  target within 1–3 months — SERP is developer-heavy and thin on products.
- **"chatting app", "make friends online", "online friends", "group chat"**:
  head terms owned by WhatsApp/Telegram/Bumble/Meetup domains; the new pages
  make Plus One *eligible* and set up long-tail wins ("chatting app to make
  friends", "make friends online no swiping", "online group chat no phone
  number"). First page for the bare head terms needs sustained backlinks —
  content alone won't do it.
- **Bare "plus one"**: still a dictionary/etiquette query — not a target.

---

## 0. Update — 2026-09-04: blog long-tail expansion

A second blog pass shipped six new posts that bite off the long-tail queries
around the app itself (not just the brand/slang terms). Each is a full
BlogPosting + FAQPage (+ HowTo where relevant) page, wired into `/blog/`,
`sitemap.xml`, `llms.txt` / `llms-full.txt`, and asserted by `verify-site.mjs`.

| New URL | Targets |
|---|---|
| `/blog/how-to-make-a-group-chat` | how to make a group chat, create a group chat, make a GC |
| `/blog/disappearing-messages` | disappearing messages, auto-delete messages, ephemeral chat |
| `/blog/end-to-end-encryption` | e2ee meaning, what is e2ee, secret chat, encrypted messaging |
| `/blog/chat-without-phone-number` | chat app without phone number, no-phone-number signup |
| `/blog/how-to-plan-trip-with-friends` | plan a trip with friends, trip group chat, "who's in" poll |
| `/blog/how-to-build-study-group` | build a study group, find study partners, study group app |

Each post is written to be useful first (plain facts, concrete steps, honest
caveats) because that is what both Google and AI answer engines reward, and
it's what a reader keeps. Internal links run sitewide (footer) and in-copy to
the product/community pages, so the long-tail posts route authority back to
`/group-chat`, `/communities`, `/chatting-app`, etc.

**Verification after this pass:** `verify-seo.mjs` 783/783 (31 pages),
`verify-site.mjs` 612/612, `check-links.mjs` 857 internal links all resolve,
`build-communities.mjs --check` green. `sitemap.xml` now lists **30 URLs**
(23 static pages incl. 11 blog URLs + 7 generated community niches).

---

## 1. The honest reality first

On-page SEO is fully in your control and is now done. Rankings are not:

- **Head terms like "chatting app"** compete with WhatsApp, Telegram,
  Messenger — domains with millions of backlinks. No code change can put a
  new site above them this month. What on-page work does is make you the
  *best possible candidate* for the long-tail, which is where a new domain
  wins first.
- **Winnable soon (weeks–months):** "plus one chatting app", "plus one app",
  "gc app", "group chat app for friends", "chatting app without phone
  number", "what does gc mean", "plus one meaning" — low-competition,
  high-intent, and we now own dedicated, optimized pages for every one.
- **The AI half is faster:** ChatGPT / Perplexity / Gemini / Claude answers
  cite pages that state facts plainly and are crawlable. `llms.txt`,
  FAQ schema, and the new direct-answer pages are exactly that. Expect AI
  citation within days–weeks of (re)crawl, long before the head-term Google
  rankings move.

---

## 2. Keyword → page map (what ships for each query)

| Query people type | Page that targets it |
|---|---|
| plus one, plus one app, what is plus one, +one | `/plus-one` (new) |
| plus one chatting app | `/plus-one` + `/chatting-app` (new) + `/` |
| chatting app, free chatting app, chat app, chatting app in india | `/chatting-app` (new) |
| gc, gc app, group chat app, make a gc | `/group-chat` (new) |
| what does gc mean, gc meaning, gc full form | `/blog/what-does-gc-mean` (new) |
| plus one meaning, +1 meaning | `/blog/plus-one-meaning` (new) |
| communities, interest-based communities | `/communities` + 7 niche pages (existing) |
| chat, realtime messaging | `/chat` (retuned) |
| homepage / brand | `/` (retuned title/H1/desc/schema) |

Every new page has: unique title + meta description, canonical, one H1 with
the keyword, keyword in the first paragraph, FAQ section, internal links
(footer site-wide + in-copy), Open Graph/Twitter cards, and JSON-LD.

## 3. What was implemented (in this repo)

### New landing pages (hand-written, site chrome, all validated by CI)
- `/plus-one` — "What is Plus One?" brand page: FAQPage + BreadcrumbList + WebPage schema.
- `/group-chat` — GC landing: **HowTo schema** ("how to make a group chat in 3 steps") + FAQPage + BreadcrumbList.
- `/chatting-app` — chatting-app landing with honest feature comparison + FAQPage.

### New blog explainers (snippet bait for definitional queries)
- `/blog/what-does-gc-mean` — BlogPosting + FAQPage. Targets "what does gc
  mean" (high volume, near-zero competition).
- `/blog/plus-one-meaning` — BlogPosting + FAQPage. Targets "plus one
  meaning" / "+1 meaning".

### Existing pages retuned
- `/` — title now "Plus One — Chatting App for Friends, Group Chats &
  Communities"; H1 and sub-H1 say "chatting app", "group chats (GCs)",
  "communities"; SoftwareApplication schema gained `keywords` +
  `featureList` + alternateNames; new "Explore" internal-link grid.
- `/chat` — title/desc now carry "group chat", "chatting", "free".
- `/communities` — description now mentions "group chats" and "communities".
- Footer on **every** page (hand-written + generated) links to the three new
  keyword pages — keyword-rich sitewide internal links.

### AI visibility (GEO — Generative Engine Optimization)
- **`/llms.txt` + `/llms-full.txt`** — the emerging standard AI crawlers
  read (llmstxt.org). Contains the short answer, key facts, direct Q&A
  answers, and links. This is what makes ChatGPT/Perplexity/claude.ai cite
  Plus One accurately.
- **`robots.txt`** explicitly allows every major AI crawler by name:
  GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-User,
  Claude-SearchBot, PerplexityBot, Perplexity-User, Google-Extended,
  GoogleOther, Applebot, Applebot-Extended, meta-externalagent, FacebookBot,
  YouBot, cohere-ai, Amazonbot, DuckAssistBot (all keep `/app/` and `/api/`
  disallowed).
- **FAQPage schema** on all new pages — answer engines lift Q&A pairs
  directly; these are also the sentences LLMs quote.
- Facts are stated plainly and repeated consistently everywhere ("free, no
  ads, no phone number") — repetition of short factual claims is what gets
  models to repeat them back.

### Build & QA integration
- Sitemap: new URLs added to `app/web/community-niches.json` (`sitemapStatic`
  — single source of truth) and regenerated → `/sitemap.xml` now lists 24 URLs.
- `export-web.js` copies the new pages + llms files into every deploy.
- `verify-site.mjs` now asserts the new pages' exact title/H1/description,
  HowTo + BlogPosting JSON-LD shapes, and their sitemap entries.
- `verify-seo.mjs`: **617/617 checks pass**; `check-links.mjs`: 681 internal
  links all resolve; `verify-site.mjs`: 447/447 pass; `build-communities
  --check` green.

---

## 4. What must happen outside the repo (do this next)

### Immediate (this week) — without these, Google can't rank you at all
1. **Google Search Console**: verify `plusoneco.in`, submit
   `https://www.plusoneco.in/sitemap.xml`, then use *URL Inspection →
   Request indexing* on the 5 new URLs. This is the single biggest lever.
2. **Bing Webmaster Tools**: import from Search Console, submit sitemap.
   Bing powers ChatGPT Search's index too — double win.
3. **Verify robots/llms are live**: `plusoneco.in/robots.txt`,
   `/sitemap.xml`, `/llms.txt`, `/llms-full.txt` after deploy.

### AI-visibility checks (days after deploy)
- Ask ChatGPT (with search), Perplexity, Gemini and Copilot: *"What is Plus
  One app?"*, *"best free group chat apps for friends"*, *"what does GC
  mean?"* — see who cites plusoneco.in. Perplexity cites sources within days.
- If an answer engine gets a fact wrong, fix the fact in `llms-full.txt`
  first — that file is written for them.

### Weeks 2–8 — authority building (this is what moves "chatting app")
- **Backlinks**: college WhatsApp/Instagram communities, campus pages,
  startup directories (Product Hunt, AlternativeTo, SaaSHub — "WhatsApp
  alternative" listings are perfect), dev articles about the Expo/Node stack.
  Every listing should link to `plusoneco.in` (and ideally `/chatting-app`).
- **Brand profiles**: Instagram, X, YouTube, LinkedIn, GitHub org — all
  linking to the site (fills the "Plus One" knowledge panel and confirms
  entity-ness to Google/AI).
- **App store presence**: even a Play Store listing via internal testing
  creates a second, high-authority "Plus One app" result you can own.
- **Content cadence**: 1 blog post/week on chatting/group-chat long-tails
  ("group chat names ideas", "how to leave a group chat politely", "discord
  vs group chat") — the blog is the long-tail engine.

### Measure & iterate
- Search Console → Performance: filter queries containing "plus one", "gc",
  "chatting". Whatever impressions grow, double down with content.
- Re-run `npm run verify-seo` + the site checks before every deploy (CI does).

---

## 5. Files changed in this pass

- New: `app/web/plus-one.html`, `app/web/group-chat.html`,
  `app/web/chatting-app.html`, `app/web/blog/what-does-gc-mean.html`,
  `app/web/blog/plus-one-meaning.html`, `app/web/llms.txt`,
  `app/web/llms-full.txt` (+ copies in `app/public/`)
- Tuned: `app/web/home.html`, `chat.html`, `communities.html`, all other
  marketing pages (footer links), `blog/index.html` (new posts listed)
- Infra: `app/web/robots.txt` (AI crawlers), `app/web/sitemap.xml`
  (regenerated, 24 URLs), `app/web/community-niches.json` (5 new
  `sitemapStatic` entries), `app/scripts/export-web.js` (new pages + llms
  copies), `app/scripts/build-communities.mjs` (footer), 
  `app/scripts/verify-site.mjs` (assertions for everything above)

---

## 6. Launch checklist — communities sitemap + true one-tap Android App Links

Two things that ship *in the repo* below need one-time actions *outside* the
repo. Do both after the deploy of this pass has gone live.

### 6.1 `/sitemap-communities.xml` — submit once in Search Console

The repo now generates a communities-only sitemap
(`app/web/sitemap-communities.xml`, generated from `community-niches.json`
by `build-communities.mjs` — the same source of truth as `sitemap.xml`, so
the two can never disagree). It lists the hub + all 7 niche pages:

```
https://www.plusoneco.in/communities
https://www.plusoneco.in/communities/travel
https://www.plusoneco.in/communities/running
https://www.plusoneco.in/communities/nightlife
https://www.plusoneco.in/communities/gaming
https://www.plusoneco.in/communities/study-groups
https://www.plusoneco.in/communities/chai-chat
https://www.plusoneco.in/communities/house-parties
```

After deploy:

1. Confirm the file is live: `curl -s https://www.plusoneco.in/sitemap-communities.xml`.
2. Google Search Console → **Sitemaps** → enter
   `https://www.plusoneco.in/sitemap-communities.xml` → **Submit** (once).
3. `robots.txt` already declares it (`Sitemap:` line); Vercel serves it with
   `Cache-Control: public, max-age=3600`.

Why a dedicated file when the URLs are already in `sitemap.xml`: the
communities set is the fastest-moving part of the site, and a separate
sitemap can be refreshed/discovered on its own. Submitting it once is
enough — Google picks up changes automatically afterwards.

### 6.2 True one-tap Android App Links (`https://…` opens the installed app)

A custom scheme (`plusone://…`) always shows a confirmation prompt. App
Links (`https://www.plusoneco.in/…`) open the installed app directly with
**no chooser** once the association is verified. Four pieces make that work:

| Piece | Where | Status after this pass |
|---|---|---|
| `intentFilters` with `autoVerify: true` for `www.plusoneco.in` | `app/app.json` (android) | ✅ in repo |
| `/.well-known/assetlinks.json` served at the domain | Railway backend, rewritten by Vercel (`vercel.json`) | ✅ in repo; **needs env vars** |
| Association JSON = installed APK's signing cert | `ANDROID_PACKAGE_NAME` + `ANDROID_CERT_FINGERPRINT` env | ⚠️ set on Railway (below) |
| APK rebuilt with the new manifest | EAS / local build, then reinstall | ⚠️ **required** — OTA updates can't add intent filters |

Setup steps:

1. **Get the release APK's signing-cert fingerprint** (the one users install,
   not a debug build):
   ```
   keytool -printcert -jarfile plusone.apk | grep -A1 "SHA256:"
   ```
   (If you build with EAS, the cert comes from the EAS keystore — the APK
   itself is the ground truth either way, so this command is exact.)
2. **Railway → project → Variables**, set both, then redeploy the backend
   (a variable change restarts it):
   ```
   ANDROID_PACKAGE_NAME=ai.arena.tomodachi
   ANDROID_CERT_FINGERPRINT=AA:BB:CC:…   # the SHA-256 from step 1
   ```
   Colon, space, dash or bare-hex formatting all work — the server
   normalizes to `AA:BB:…`.
3. **Verify** the association is live:
   ```
   curl -s https://www.plusoneco.in/.well-known/assetlinks.json
   # → [{"relation":["delegate_permission/common.handle_all_urls"],"target":{…}}]
   ```
   While the env vars are missing the endpoint deliberately answers **503
   “not configured”** — never a fake fingerprint (Android silently
   un-verifies a wrong one, which is much harder to debug).
   Google's own checker:
   `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://www.plusoneco.in&relation=delegate_permission/common.handle_all_urls`
4. **Rebuild the APK** with the new `app.json` (intent filters are manifest
   config — the EAS update channel cannot add them), bump `versionCode`,
   install it, and test:
   ```
   adb shell am start -a android.intent.action.VIEW \
     -d "https://www.plusoneco.in/communities/travel"
   ```
   Expected: the app opens straight into **Communities → Trip Planning**
   (the deep-link parser maps the page slug `travel` to the app category
   `trip` via `community-niches.json`). No chooser, no `plusone://` prompt.
5. **If the chooser still appears**, in order: re-check the fingerprint in
   `assetlinks.json` matches the *installed* APK (`keytool` on that exact
   file), confirm `autoVerify` actually landed in the manifest of the
   installed build, and check `adb logcat | grep -i intentfilter`.

Links this covers today: `/c/<code>` (community invites), `/gc/<id>`
(group chats), `/communities`, `/communities/<slug>`, `/app` (the app shell).
Only `www.plusoneco.in` is verified — the apex `plusoneco.in` is never used
for app links (canonical is `www` everywhere).

> iOS equivalent (Universal Links / `apple-app-site-association`) is a
> separate future step; only the Android half ships here.

### 6.3 Files changed in this pass

- New: `server/src/appLinks.js` (pure Digital Asset Links builder),
  `server/test-app-links.js` (offline unit tests).
- Generated: `app/web/sitemap-communities.xml` (from `community-niches.json`).
- Note: `assetlinks.json` is intentionally NOT a static file — it is built on
  the Railway backend from env vars so the fingerprint can be changed without
  a web redeploy (see §6.2).
- App: `app/app.json` (android `intentFilters` with `autoVerify`),
  `app/src/push/links.js` (slug → app-category mapping on deep links).
- Infra: `server/src/index.js` (`/.well-known/assetlinks.json` route),
  `vercel.json` (assetlinks rewrite + sitemap-communities exclusion/headers),
  `app/web/robots.txt` (second `Sitemap:` line), `app/scripts/export-web.js`
  (copies the community sitemap), `app/scripts/build-communities.mjs`
  (generates it), `app/scripts/verify-site.mjs` (asserts both), CI
  (`test:app-links`).
