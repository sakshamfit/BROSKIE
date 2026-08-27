# SEO + AI Visibility (GEO) Playbook — Plus One / plusoneco.in

Date: 2026-08-27
Goal: when people search Google **or ask an AI assistant** about "plus one",
"plus one chatting app", "chatting app", "communities", "gc / group chat"
(and close variants), Plus One shows up.

This document covers **what shipped in the repo** and **what must happen
outside the repo** to actually win the rankings. Both halves matter.

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
