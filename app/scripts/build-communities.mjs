#!/usr/bin/env node
/**
 * Community niche pages — generator.
 *
 * app/web/community-niches.json is the single source of truth for the
 * /communities/<slug> landing pages. This script renders that data through
 * one template into:
 *
 *   1. app/web/communities/<slug>.html   — one page per niche (committed,
 *      so preview/CI/hosting need no build step to see them)
 *   2. two AUTO blocks injected into the hand-written hub page
 *      app/web/communities.html: a CollectionPage+ItemList JSON-LD in <head>
 *      and the linked "Browse by community type" directory grid in <body>
 *   3. app/web/sitemap.xml — regenerated from `sitemapStatic` + the niches,
 *      so a new niche can never be "manually forgotten" in the sitemap
 *   4. app/web/sitemap-communities.xml — communities-only sitemap (hub + the
 *      7 niche pages), generated from the same data for a dedicated Search
 *      Console submission (docs/SEO_GEO_PLAYBOOK.md §6).
 *
 * Adding a 9th niche = add one entry to the JSON + run this script. The
 * export pipeline (scripts/export-web.js) runs it automatically before every
 * build, so a stale checkout can't ship stale pages.
 *
 * Rules for anyone editing the data file:
 *   - `category` MUST exist in app/src/components/communityMeta.js. We do not
 *     build a landing page for a community type the app can't actually do.
 *   - `related` picks 3-4 contextually-sibling pages, never all of them.
 *   - No fake screenshots: visuals are CSS recreations of real in-app UI
 *     (same `.demo` system as the hub/chat pages) and say so.
 *
 * Usage:
 *   node scripts/build-communities.mjs           # write
 *   node scripts/build-communities.mjs --check   # CI: fail if out of sync
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const WEB = path.join(APP_ROOT, 'web');
const DATA = JSON.parse(fs.readFileSync(path.join(WEB, 'community-niches.json'), 'utf8'));
const ORIGIN = DATA.origin;
const HUB_URL = `${ORIGIN}${DATA.hub.url}`;
const CHECK = process.argv.includes('--check');

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */
const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const url = (slug) => `${ORIGIN}/communities/${slug}`;
const href = (slug) => `/communities/${slug}`;
const nicheBySlug = new Map(DATA.niches.map((n) => [n.slug, n]));

/* Shared chrome copied from the hand-written marketing pages so the
 * generated pages are indistinguishable from the originals. */
const FAVICON = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect fill='%23fdf8f8' width='32' height='32'/%3E%3Crect x='7' y='7' width='18' height='18' fill='%23ffe24d' transform='rotate(-3 16 16)'/%3E%3Cpath d='M16 8v16M8 16h16' stroke='%231c1b1b' stroke-width='3.4' stroke-linecap='round' transform='rotate(-3 16 16)'/%3E%3C/svg%3E`;
const CLOCK_SVG = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><circle cx="6" cy="6" r="4.9" stroke="#1c1b1b" stroke-width="1.4"/><path d="M6 3.4V6l2 1.4" stroke="#1c1b1b" stroke-width="1.4" stroke-linecap="round"/></svg>`;
const SEND_SVG = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="#f4f0ef" stroke-width="1.4" stroke-linecap="round"/></svg>`;

function header(active = '/communities') {
  const link = (to, label) => `        <a href="${to}"${to === active ? ' aria-current="page"' : ''}>${label}</a>`;
  return `  <header class="nav">
    <a class="mark" href="/"><span class="mark-plus">+</span>one</a>
    <details class="menu">
      <summary class="menu-btn" aria-label="Open menu" title="Menu">
        <span></span><span></span><span></span>
      </summary>
      <nav id="site-nav">
${link('/communities', 'Communities')}
${link('/chat', 'Chat')}
${link('/network', 'Network')}
${link('/about', 'About')}
${link('/download', 'Download')}
        <a class="btn btn-ink nav-cta" href="/app">Open the app</a>
      </nav>
    </details>
  </header>`;
}

const footer = `  <footer class="foot">
    <span>+one</span>
    <nav class="foot-links" aria-label="Site">
      <a href="/about">About</a>
      <a href="/communities">Communities</a>
      <a href="/chat">Chat</a>
      <a href="/group-chat">Group chat (GC)</a>
      <a href="/chatting-app">Chatting app</a>
      <a href="/plus-one">What is Plus One?</a>
      <a href="/network">Network</a>
      <a href="/download">Download</a>
      <a href="/blog/">Blog</a>
      <a href="/privacy">Privacy</a>
      <a href="/terms">Terms</a>
      <a href="/support">Support</a>
      <a href="https://github.com/sakshamfit/BROSKIE" target="_blank" rel="noopener">GitHub</a>
    </nav>
    <span>Not affiliated with WhatsApp. Original messenger.</span>
  </footer>`;

/* ------------------------------------------------------------------ */
/* pieces                                                              */
/* ------------------------------------------------------------------ */
function appLink(niche) {
  return `/app?tab=communities&amp;category=${niche.category}`;
}

function demoBlock(niche) {
  const d = niche.demo;
  const opts = d.options.map((o) => `            <div class="poll-opt ${o.mine ? 'mine' : 'theirs'}">
              <div class="row"><span>${esc(o.text)}</span><span class="poll-pct">0%</span></div>
              <div class="poll-bar"><div class="poll-fill"></div></div>
            </div>`).join('\n');
  return `        <div class="demo" id="poll-demo" data-reveal aria-label="Animated demo of a ${esc(niche.label)} community poll on Plus One">
          <div class="demo-head">
            ${CLOCK_SVG}
            ${esc(d.name)}
            <span class="demo-status">${esc(d.status)}</span>
          </div>
          <div class="demo-body">
            <div class="poll msg them">
              <span class="lbl">POLL · ${esc(d.asker)}</span>
              <p class="poll-q">${esc(d.question)}</p>
${opts}
              <p class="poll-foot"><span class="voted">YOUR VOTE ✓</span><span class="poll-votes">${esc(d.votes)}</span> · tap an option to vote</p>
            </div>
            <span class="tape-chip accent">${esc(d.chip)}</span>
          </div>
          <div class="demo-input">
            <span class="field">Tap an option to vote</span>
            <span class="send" aria-hidden="true">
              ${SEND_SVG}
            </span>
          </div>
        </div>
        <p class="demo-note" data-reveal>The live demo above recreates the real community poll screen from the app's own type and tokens — vote bars fill as the poll runs. A production screenshot of this exact screen has not been captured yet; when it is, it drops in here (see app/web/assets/images/).</p>`;
}

function exploreSection(niche) {
  const cards = niche.related.map((slug) => {
    const n = nicheBySlug.get(slug);
    if (!n) throw new Error(`niche "${niche.slug}" lists unknown related slug "${slug}"`);
    return `        <article data-reveal>
          <span class="tag">${esc(n.category)}</span>
          <h3><a href="${href(n.slug)}">${esc(n.h1.replace(/^Find |^Meet /, ''))}</a></h3>
          <p>${esc(n.tagline)}</p>
          <a class="niche-browse" href="${href(n.slug)}">${esc(n.browse)} →</a>
        </article>`;
  }).join('\n');
  return `      <h2 data-reveal style="margin-top:clamp(2.4rem,5vw,3.6rem)">Explore other communities</h2>
      <div class="grid" data-reveal-group style="grid-template-columns:repeat(auto-fit,minmax(230px,1fr));margin-top:1.2rem">
${cards}
        <article data-reveal>
          <span class="tag">all</span>
          <h3>Every community type</h3>
          <p>Club nights, house parties, chai chats, trips, runs, game nights and study groups — the full map.</p>
          <a class="niche-browse" href="${DATA.hub.url}">See all communities →</a>
        </article>
      </div>`;
}

function headBlock(niche) {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: niche.h1,
    description: niche.metaDesc,
    url: url(niche.slug),
    inLanguage: 'en',
    dateModified: niche.lastmod,
    isPartOf: { '@type': 'CollectionPage', name: DATA.hub.name, url: HUB_URL },
    relatedLink: [...niche.related.map((s) => url(s)), HUB_URL],
  };
  const crumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: 'Communities', item: HUB_URL },
      { '@type': 'ListItem', position: 3, name: niche.label, item: url(niche.slug) },
    ],
  };
  const json = (o) => JSON.stringify(o, null, 2).replace(/^/gm, '  ');
  return `  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>${esc(niche.title)}</title>
  <meta name="description" content="${esc(niche.metaDesc)}" />
  <meta name="theme-color" content="#fdf8f8" />
  <link rel="canonical" href="${url(niche.slug)}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Plus One" />
  <meta property="og:title" content="${esc(niche.title)}" />
  <meta property="og:description" content="${esc(niche.metaDesc)}" />
  <meta property="og:url" content="${url(niche.slug)}" />
  <meta property="og:image" content="${ORIGIN}/icon-512.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <link rel="manifest" href="/manifest.json" />
  <link rel="icon" href="${FAVICON}" />
  <link rel="stylesheet" href="../styles.css" />
  <script>document.documentElement.classList.add('js')</script>
  <script defer src="/assets/js/site.js"></script>
  <script type="application/ld+json">
  ${json(ld).trim()}
  </script>
  <script type="application/ld+json">
  ${json(crumbs).trim()}
  </script>`;
}

function renderNiche(niche) {
  const paras = niche.intro.map((p, i) => (i === 0
    ? `      <p class="sub-h1">${esc(p)}</p>`
    : `      <p data-reveal>${esc(p)}</p>`)).join('\n');
  const who = niche.who.map((x) => `            <li>${esc(x)}</li>`).join('\n');
  const tools = niche.tools.map((x) => `            <li>${esc(x)}</li>`).join('\n');
  return `<!DOCTYPE html>
<!--
  GENERATED FILE — do not hand-edit.
  Source of truth: app/web/community-niches.json
  Regenerate:      node scripts/build-communities.mjs
-->
<html lang="en">
<head>
${headBlock(niche)}
</head>
<body>
  <div class="paper" aria-hidden="true"></div>

${header()}

  <main>
    <section class="page-hero">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> / <a href="${DATA.hub.url}">Communities</a> / <span>${esc(niche.label)}</span></nav>
      <p class="kicker">Community type · ${esc(niche.label)}</p>
      <h1>${esc(niche.h1)}</h1>
${paras}
      <div class="hero-actions">
        <a class="btn btn-ink" href="${appLink(niche)}">${esc(niche.cta)}</a>
        <a class="btn btn-ghost" href="/download">Get it for Android</a>
      </div>
    </section>

    <section class="page-body">
      <div class="page-cols" style="margin-top:.4rem">
        <div data-reveal-group>
          <h2 data-reveal>What a ${esc(niche.label.toLowerCase())} looks like inside +one</h2>
          <ul class="checks" style="margin-top:1rem" data-reveal>
${who}
          </ul>
          <h2 data-reveal style="margin-top:2rem">Built with the group tools that ship in the app</h2>
          <ul class="checks" style="margin-top:1rem" data-reveal>
${tools}
          </ul>
        </div>
        <div>
${demoBlock(niche)}
        </div>
      </div>

${exploreSection(niche)}

      <div class="hero-actions" data-reveal style="margin-top:clamp(2.2rem,4vw,3rem)">
        <a class="btn btn-ink" href="${appLink(niche)}">${esc(niche.cta)}</a>
        <a class="btn btn-ghost" href="${DATA.hub.url}">Or start your own community</a>
      </div>
    </section>
  </main>

${footer}
</body>
</html>
`;
}

/* ------------------------------------------------------------------ */
/* hub injections                                                      */
/* ------------------------------------------------------------------ */
function hubSchemaBlock() {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: DATA.hub.name,
    description: DATA.hub.description,
    url: HUB_URL,
    isPartOf: { '@type': 'WebSite', name: 'Plus One', url: `${ORIGIN}/` },
    mainEntity: {
      '@type': 'ItemList',
      name: 'Community types on Plus One',
      numberOfItems: DATA.niches.length,
      itemListOrder: 'https://schema.org/ItemListUnordered',
      itemListElement: DATA.niches.map((n, i) => ({
        '@type': 'ListItem', position: i + 1, name: `${n.label} communities`, url: url(n.slug),
      })),
    },
  };
  return `  <!-- BEGIN AUTO:COMMUNITY-SCHEMA — generated by scripts/build-communities.mjs; edit app/web/community-niches.json -->
  <script type="application/ld+json">
  ${JSON.stringify(ld, null, 2).replace(/^/gm, '  ').trim()}
  </script>
  <!-- END AUTO:COMMUNITY-SCHEMA -->`;
}

function hubDirectoryBlock() {
  const cards = DATA.niches.map((n) => `        <article data-reveal>
          <span class="tag">${esc(n.category)}</span>
          <h3><a href="${href(n.slug)}">${esc(n.label)}</a></h3>
          <p>${esc(n.tagline)}</p>
          <a class="niche-browse" href="${href(n.slug)}">${esc(n.browse)} →</a>
        </article>`).join('\n');
  const custom = DATA.customCard;
  return `      <!-- BEGIN AUTO:COMMUNITY-DIRECTORY — generated by scripts/build-communities.mjs; edit app/web/community-niches.json -->
      <h2 data-reveal>Browse by community type</h2>
      <p data-reveal style="margin-top:.6rem">Every card below maps to a real category inside the app's Communities grid — the filter chips you see there are these exact seven, plus a freeform <em>Something Else</em>.</p>
      <div class="grid" data-reveal-group style="grid-template-columns:repeat(auto-fit,minmax(230px,1fr));margin-top:1.2rem">
${cards}
        <article data-reveal>
          <span class="tag">custom</span>
          <h3>${esc(custom.label)}</h3>
          <p>${esc(custom.tagline)}</p>
          <a class="niche-browse" href="/app?tab=communities">Start one from the app →</a>
        </article>
      </div>
      <!-- END AUTO:COMMUNITY-DIRECTORY -->`;
}

function injectBetween(source, begin, end, content, label) {
  const b = source.indexOf(begin);
  const e = source.indexOf(end);
  if (b === -1 || e === -1 || e < b) {
    throw new Error(`hub page is missing the ${label} AUTO markers — restore them in app/web/communities.html`);
  }
  return source.slice(0, b) + content + source.slice(e + end.length);
}

const HUB_HEAD_BEGIN = '  <!-- BEGIN AUTO:COMMUNITY-SCHEMA';
const HUB_HEAD_END = '<!-- END AUTO:COMMUNITY-SCHEMA -->';
const HUB_GRID_BEGIN = '      <!-- BEGIN AUTO:COMMUNITY-DIRECTORY';
const HUB_GRID_END = '<!-- END AUTO:COMMUNITY-DIRECTORY -->';

/* ------------------------------------------------------------------ */
/* sitemaps                                                            */
/* ------------------------------------------------------------------ */
function renderSitemap() {
  const entry = (loc, { lastmod, changefreq, priority }) => `  <url>
    <loc>${loc}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
  const urls = [];
  for (const s of DATA.sitemapStatic) {
    urls.push(entry(`${ORIGIN}${s.path}`, s));
    if (s.path === DATA.hub.url) {
      for (const n of DATA.niches) {
        urls.push(entry(url(n.slug), { lastmod: n.lastmod, changefreq: 'weekly', priority: '0.8' }));
      }
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Sitemap for the +one marketing site (plusoneco.in).
  app/scripts/export-web.js copies this file into dist/ so it is served at
  https://www.plusoneco.in/sitemap.xml.

  GENERATED FILE — do not hand-edit. Source of truth for the /communities/*
  entries (and this file) is app/web/community-niches.json +
  app/scripts/build-communities.mjs, which the export runs on every build.
  Add a niche to the JSON and it lands here automatically; keep
  <lastmod> on the static pages fresh when those pages change.
  The app shell under /app is auth-gated and intentionally not indexed.
-->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`;
}

/* Communities-only sitemap: the hub + every niche page, generated from the
 * same JSON as sitemap.xml so the two can never disagree. Submitted once in
 * Search Console (docs/SEO_GEO_PLAYBOOK.md §6) so the communities set can be
 * refreshed/re-checked without resubmitting the whole site. */
function renderCommunitiesSitemap() {
  const entry = (loc, { lastmod, changefreq, priority }) => `  <url>
    <loc>${loc}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
  const staticHub = DATA.sitemapStatic.find((s) => s.path === DATA.hub.url);
  const hubLastmod = staticHub?.lastmod || DATA.niches[0]?.lastmod;
  const urls = [
    entry(HUB_URL, { lastmod: hubLastmod, changefreq: 'weekly', priority: '0.9' }),
    ...DATA.niches.map((n) => entry(url(n.slug), { lastmod: n.lastmod, changefreq: 'weekly', priority: '0.8' })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Communities-only sitemap (/sitemap-communities.xml) for plusoneco.in.
  Hub + the generated /communities/<slug> niche pages, pulled from the same
  single source of truth (app/web/community-niches.json) as sitemap.xml.

  GENERATED FILE — do not hand-edit. Regenerate with
    node scripts/build-communities.mjs
  robots.txt declares this sitemap; submit it once in Search Console:
    https://search.google.com/search-console → Sitemaps →
    https://www.plusoneco.in/sitemap-communities.xml
-->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`;
}

/* ------------------------------------------------------------------ */
/* write / check                                                       */
/* ------------------------------------------------------------------ */
/** @returns {Array<{file:string, action:'write'|'stale'|'ok'|'create'}>} */
function run({ write }) {
  const report = [];
  const target = (p, content) => {
    const prev = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
    if (prev === content) { report.push({ file: path.relative(APP_ROOT, p), action: 'ok' }); return; }
    report.push({ file: path.relative(APP_ROOT, p), action: prev === null ? 'create' : 'stale' });
    if (write) fs.writeFileSync(p, content);
  };

  fs.mkdirSync(path.join(WEB, 'communities'), { recursive: true });
  for (const niche of DATA.niches) {
    target(path.join(WEB, 'communities', `${niche.slug}.html`), renderNiche(niche));
  }
  // Prune orphaned pages whose niche was removed from the data.
  if (write) {
    const wanted = new Set(DATA.niches.map((n) => `${n.slug}.html`));
    for (const f of fs.readdirSync(path.join(WEB, 'communities'))) {
      if (f.endsWith('.html') && !wanted.has(f)) {
        fs.rmSync(path.join(WEB, 'communities', f));
        console.log(`[communities] pruned orphaned page ${f}`);
      }
    }
  }

  const hubPath = path.join(WEB, 'communities.html');
  let hub = fs.readFileSync(hubPath, 'utf8');
  hub = injectBetween(hub, HUB_HEAD_BEGIN, HUB_HEAD_END, hubSchemaBlock(), 'COMMUNITY-SCHEMA');
  hub = injectBetween(hub, HUB_GRID_BEGIN, HUB_GRID_END, hubDirectoryBlock(), 'COMMUNITY-DIRECTORY');
  target(hubPath, hub);

  target(path.join(WEB, 'sitemap.xml'), renderSitemap());
  target(path.join(WEB, 'sitemap-communities.xml'), renderCommunitiesSitemap());
  return report;
}

const report = run({ write: !CHECK });
const bad = report.filter((r) => r.action !== 'ok');
if (CHECK && bad.length) {
  console.error('[communities] generated files are out of sync with community-niches.json:');
  for (const r of bad) console.error(`  ✗ ${r.file} (${r.action})`);
  console.error('  fix: cd app && node scripts/build-communities.mjs && git add -A web');
  process.exit(1);
}
for (const r of report) console.log(`[communities] ${r.file}: ${r.action}`);
console.log(`[communities] ${CHECK ? 'check' : 'build'} done — ${DATA.niches.length} niche pages, sitemaps regenerated.`);
