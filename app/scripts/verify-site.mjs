#!/usr/bin/env node
/**
 * Marketing-site verification harness.
 *
 * Serves app/dist the way Vercel does (cleanUrls: /about → about.html,
 * /blog/ → blog/index.html) and asserts the SEO invariants from the
 * landing-page brief against the RAW server response (view-source, not
 * the hydrated DOM):
 *
 *   1. every route answers 200 with text/html
 *   2. unique <title> + meta description present on every page
 *   3. exactly one <h1> with real crawlable text, distinct from the title
 *   4. canonical URL matches the requested URL (https://www.plusoneco.in)
 *   5. every ld+json block parses and structurally validates per @type
 *   6. /robots.txt + /sitemap.xml reachable, sitemap URLs all 200
 *   7. /sitemap-communities.xml lists exactly the hub + every niche page
 *   8. app.json declares the Android App Link intent filter (autoVerify,
 *      www.plusoneco.in) so true one-tap app links can't regress silently
 *   9. a shared fingerprinted stylesheet and deferred site.js both exist
 *  10. pages retain substantive readable copy and have at least two
 *      non-self internal paths in — guards against thin and orphaned pages
 *
 * Usage: node scripts/verify-site.mjs [distDir]
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '..', process.argv[2] || 'dist');
const ORIGIN = 'https://www.plusoneco.in';

/* ---------------------------------------------------------------- */
/* minimal static server with vercel cleanUrls semantics             */
/* ---------------------------------------------------------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

function resolveFile(urlPath) {
  let p = urlPath.split('?')[0];
  if (p.endsWith('/')) p += 'index.html';
  // /about → about.html (cleanUrls), /about/ → about/index.html fallback
  const direct = path.normalize(path.join(DIST, p));
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct;
  if (!p.includes('.')) {
    const clean = path.normalize(path.join(DIST, `${p}.html`));
    if (fs.existsSync(clean)) return clean;
  }
  return null;
}

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const file = resolveFile(req.url);
      if (!file) { res.writeHead(404).end('not found'); return; }
      const body = fs.readFileSync(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(body);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/* ---------------------------------------------------------------- */
/* fetch raw html                                                    */
/* ---------------------------------------------------------------- */
async function get(port, p) {
  const res = await fetch(`http://127.0.0.1:${port}${p}`, { redirect: 'manual' });
  return { status: res.status, type: res.headers.get('content-type'), body: await res.text() };
}

/* ---------------------------------------------------------------- */
/* assertions                                                        */
/* ---------------------------------------------------------------- */
let failures = 0;
let checks = 0;
const ok = (cond, label) => {
  checks += 1;
  if (cond) console.log(`  ✓ ${label}`);
  else { failures += 1; console.error(`  ✗ ${label}`); }
};

const decode = (s) => s
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'");

const visibleText = (html) => decode(html
  .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
  .replace(/<!--([\s\S]*?)-->/g, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim());
const wordCount = (html) => visibleText(html).split(/\s+/).filter(Boolean).length;
const normaliseTitleText = (text) => decode(text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());

const PAGES = [
  { route: '/', title: 'Plus One — Chatting App for Friends, Group Chats & Communities',
    desc: 'Plus One (+one) is a free chatting app for 1:1 chats, group chats (GCs) and interest-based communities — realtime messaging, polls, voice notes and disappearing messages on Android, iOS and web.',
    h1: 'Plus One — the chatting app for friends, GCs & communities',
    mustInclude: ['Plus One is a free chatting app: real-time 1:1 and group chats (GCs), interest-based communities, polls, voice notes and disappearing messages — on Android, iOS and the web.'] },
  { route: '/about', title: 'About Plus One — The Ink-and-Paper Social Platform', h1: 'A social platform that feels like paper' },
  { route: '/communities', title: 'Communities — Find & Build Interest-Based Groups — Plus One', h1: 'Find your people by what you do' },
  { route: '/chat', title: 'Chat & Group Chat — Free Real-Time Messaging | Plus One', h1: 'Chat that arrives instantly' },
  { route: '/group-chat', title: 'Group Chat (GC) App — Start a GC for Your Friends | Plus One',
    desc: 'Plus One is a group chat app built for real GCs: live polls, voice notes, disappearing messages and admin controls. Make a GC in seconds — free on Android, iOS and web, no phone number.',
    h1: 'A group chat app that keeps the plan alive' },
  { route: '/chatting-app', title: 'Plus One — A Free Chatting App for Friends & Communities',
    desc: 'Looking for a chatting app? Plus One is a free chatting app with real-time messaging, group chats, communities, voice notes and disappearing messages — no ads, no phone number.',
    h1: 'A chatting app that stays light as paper' },
  { route: '/plus-one', title: 'What Is Plus One? The Chatting App for Communities & GCs',
    desc: "Plus One (+one) is a free chatting app for group chats and communities — realtime messaging, polls, voice notes and disappearing messages. What it is, and why it's called Plus One.",
    h1: 'Plus One is a chatting app for communities & GCs' },
  { route: '/network', title: 'The Network — A Worldwide Social Feed — Plus One', h1: 'A worldwide feed that still feels handwritten' },
  { route: '/download', title: 'Download Plus One — Android APK, iOS & Web App', h1: 'Get Plus One on anything' },
  { route: '/privacy', title: 'Privacy Policy — Plus One', h1: 'Privacy Policy' },
  { route: '/terms', title: 'Terms of Service — Plus One', h1: 'Terms of Service' },
  { route: '/support', title: 'Support & FAQ — Help, Troubleshooting & Guides — Plus One', h1: 'Support & FAQ' },
  { route: '/blog/', title: 'Plus One Blog — Community, Connection & Discovery', h1: 'The Plus One blog' },
  { route: '/blog/how-to-find-a-running-partner', title: 'How to Find a Running Partner & Running Groups Near You — Plus One Blog', h1: 'How to Find a Running Partner & Running Groups Near You' },
  { route: '/blog/interest-based-social-network', title: 'Why Interest-Based Communities Beat Follower Graphs — Plus One Blog', h1: 'Why Interest-Based Communities Beat Follower Graphs' },
  { route: '/blog/what-does-gc-mean', title: 'What Does GC Mean? GC Meaning in Texting & Social Media', h1: 'What Does GC Mean? The Group Chat, Explained' },
  { route: '/blog/plus-one-meaning', title: 'What Does “Plus One” (+1) Mean? Invites, Texting & the App', h1: 'What Does “Plus One” Mean? Every Sense of +1' },
  { route: '/blog/how-to-make-a-group-chat', title: 'How to Make a Group Chat: The Complete GC Guide', h1: 'How to Make a Group Chat That Actually Sticks' },
  { route: '/blog/disappearing-messages', title: 'How Disappearing Messages Work & When to Use Them | Plus One', h1: 'Disappearing Messages: What They Are & When to Use Them' },
  { route: '/blog/end-to-end-encryption', title: 'What Is End-to-End Encryption (E2EE)? Secret Chats, Explained', h1: 'What Is End-to-End Encryption? Secret Chats, Explained' },
  { route: '/blog/chat-without-phone-number', title: 'Why Chat Without a Phone Number? Username-Only Signup, Explained', h1: 'Why Chat Without a Phone Number?' },
  { route: '/blog/how-to-plan-trip-with-friends', title: 'How to Plan a Trip With Friends: The Group Chat + Poll Method', h1: 'How to Plan a Trip With Friends' },
  { route: '/blog/how-to-build-study-group', title: 'How to Build a Study Group That Actually Shows Up | Plus One', h1: 'How to Build a Study Group That Actually Shows Up' },
];

/* The /communities/<slug> niche pages are generated from community-niches.json
 * (source of truth) — derive their expected title/h1/description from the same
 * data so this harness checks the promise, not just "something exists". */
const NICHES = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'web', 'community-niches.json'), 'utf8')
).niches;
for (const n of NICHES) {
  PAGES.push({ route: `/communities/${n.slug}`, title: n.title, h1: n.h1, desc: n.metaDesc });
}

/* JSON-LD structural validation — the shape Google's Rich Results test
 * checks for each type we emit. */
const LD_RULES = {
  Organization: { req: ['name', 'url'] },
  WebSite: { req: ['name', 'url'] },
  SoftwareApplication: { req: ['name', 'operatingSystem', 'applicationCategory', 'offers'] },
  MobileApplication: { req: ['name', 'operatingSystem'] },
  BreadcrumbList: { req: ['itemListElement'], custom: (d) => Array.isArray(d.itemListElement) && d.itemListElement.length >= 1 },
  CollectionPage: {
    req: ['name', 'url'],
    custom: (d) => d.mainEntity?.['@type'] === 'ItemList'
      && Array.isArray(d.mainEntity.itemListElement)
      && d.mainEntity.itemListElement.every((it, i) => it['@type'] === 'ListItem' && it.position === i + 1 && it.url),
  },
  WebPage: { req: ['name', 'url'], custom: (d) => !!d.isPartOf?.url },
  FAQPage: {
    req: ['mainEntity'],
    custom: (d) => d.mainEntity.every((q) => q['@type'] === 'Question' && q.name && q.acceptedAnswer?.text),
  },
  HowTo: {
    req: ['name', 'step'],
    custom: (d) => Array.isArray(d.step) && d.step.length >= 1
      && d.step.every((s) => s['@type'] === 'HowToStep' && s.name && s.text),
  },
  BlogPosting: { req: ['headline', 'author', 'datePublished'] },
  Blog: { req: ['name', 'url'] },
};

function validateJsonLd(html, pageRoute) {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  ok(blocks.length > 0, `${pageRoute}: has JSON-LD (${blocks.length} block${blocks.length > 1 ? 's' : ''})`);
  const types = [];
  for (const m of blocks) {
    let data;
    try {
      data = JSON.parse(m[1]);
    } catch (e) {
      ok(false, `${pageRoute}: ld+json parses (${e.message})`);
      continue;
    }
    const t = data['@type'];
    types.push(t);
    ok(data['@context'] === 'https://schema.org', `${pageRoute}: ${t} @context correct`);
    const rule = LD_RULES[t];
    if (!rule) { ok(false, `${pageRoute}: ${t} has no validation rule (add one)`); continue; }
    const missing = rule.req.filter((k) => data[k] === undefined || data[k] === null || data[k] === '');
    ok(missing.length === 0, `${pageRoute}: ${t} required fields (${rule.req.join(', ')})${missing.length ? ` MISSING: ${missing.join(', ')}` : ''}`);
    if (rule.custom) {
      let customError = null;
      try { if (!rule.custom(data)) customError = 'custom check failed'; } catch (e) { customError = e.message; }
      ok(!customError, `${pageRoute}: ${t} structure valid${customError ? ` (${customError})` : ''}`);
    }
  }
  return types;
}

/* ---------------------------------------------------------------- */
async function main() {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error(`dist not found at ${DIST} — run: npm run export:web`);
    process.exit(1);
  }
  const { server, port } = await serve();
  console.log(`serving ${DIST} on 127.0.0.1:${port}\n`);

  const seenTitles = new Set();
  const seenDescs = new Set();
  const pageBodies = new Map();

  for (const page of PAGES) {
    console.log(`— ${page.route}`);
    const { status, type, body } = await get(port, page.route);
    ok(status === 200, `${page.route}: 200`);
    ok(type && type.includes('text/html'), `${page.route}: served as HTML`);

    const title = decode(body.match(/<title>([^<]*)<\/title>/)?.[1] || '');
    ok(!!title, `${page.route}: <title> present`);
    ok(title === page.title, `${page.route}: title exact — "${title}"`);
    ok(!seenTitles.has(title), `${page.route}: title unique across site`);
    seenTitles.add(title);

    const desc = body.match(/<meta name="description" content="([^"]*)" \/>/)?.[1];
    ok(!!desc, `${page.route}: meta description present`);
    ok(!seenDescs.has(desc), `${page.route}: description unique across site`);
    seenDescs.add(desc);
    if (page.desc) ok(desc === page.desc, `${page.route}: description exact per brief`);

    const canonical = body.match(/<link rel="canonical" href="([^"]*)" \/>/)?.[1];
    ok(canonical === `${ORIGIN}${page.route === '/' ? '/' : page.route}`, `${page.route}: canonical = ${canonical}`);

    const h1s = [...body.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => normaliseTitleText(m[1]));
    ok(h1s.length === 1, `${page.route}: exactly one <h1> in raw HTML`);
    ok(h1s[0] === page.h1, `${page.route}: <h1> text = "${h1s[0]}"`);
    ok(normaliseTitleText(title) !== h1s[0], `${page.route}: title and H1 are distinct`);
    ok(wordCount(body) >= 200, `${page.route}: substantive readable copy (${wordCount(body)} words)`);

    for (const needle of page.mustInclude || []) {
      ok(body.includes(needle), `${page.route}: crawlable text contains "${needle.slice(0, 58)}…")`);
    }

    const stylesheetLinks = [...body.matchAll(/<link rel="stylesheet" href="([^"]+)" \/>/g)].map((m) => m[1]);
    ok(stylesheetLinks.length === 1, `${page.route}: exactly one shared stylesheet link`);
    const stylesheetHref = stylesheetLinks[0] || '';
    ok(/^\/assets\/css\/site\.[a-f0-9]{12}\.css$/.test(stylesheetHref), `${page.route}: stylesheet is fingerprinted`);
    ok(!/<style\b/i.test(body), `${page.route}: no repeated inline stylesheet`);
    const css = await get(port, stylesheetHref || '/assets/css/missing.css');
    ok(css.status === 200 && css.type.includes('text/css'), `${page.route}: shared stylesheet reachable`);
    ok(body.includes('/assets/js/site.js'), `${page.route}: site.js referenced`);
    const js = await get(port, '/assets/js/site.js');
    ok(js.status === 200 && js.type.includes('javascript'), '/assets/js/site.js: reachable');

    pageBodies.set(page.route, body);
    validateJsonLd(body, page.route);
    console.log('');
  }

  console.log('— internal discoverability');
  const knownRoutes = new Set(PAGES.map((page) => page.route));
  const incoming = new Map(PAGES.map((page) => [page.route, new Set()]));
  const routeForPath = (pathname) => {
    if (knownRoutes.has(pathname)) return pathname;
    const withoutTrailingSlash = pathname.replace(/\/+$/, '') || '/';
    if (knownRoutes.has(withoutTrailingSlash)) return withoutTrailingSlash;
    const withTrailingSlash = withoutTrailingSlash === '/' ? '/' : `${withoutTrailingSlash}/`;
    return knownRoutes.has(withTrailingSlash) ? withTrailingSlash : null;
  };
  for (const [sourceRoute, body] of pageBodies) {
    const links = [...body.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>/gi)].map((m) => m[1]);
    for (const href of links) {
      let target;
      try {
        const parsed = new URL(href, `${ORIGIN}${sourceRoute}`);
        if (parsed.origin !== ORIGIN) continue;
        target = routeForPath(parsed.pathname);
      } catch {
        continue;
      }
      if (target && target !== sourceRoute) incoming.get(target).add(sourceRoute);
    }
  }
  for (const page of PAGES) {
    const sources = [...incoming.get(page.route)].sort();
    ok(sources.length >= 2, `${page.route}: discoverable from ${sources.length} non-self internal page${sources.length === 1 ? '' : 's'}`);
  }

  console.log('— robots.txt & sitemaps');
  const robots = await get(port, '/robots.txt');
  ok(robots.status === 200 && robots.type.includes('text/plain'), '/robots.txt: 200 text/plain');
  ok(robots.body.includes('Sitemap: https://www.plusoneco.in/sitemap.xml'), '/robots.txt: declares sitemap');
  ok(robots.body.includes('Sitemap: https://www.plusoneco.in/sitemap-communities.xml'), '/robots.txt: declares communities sitemap');

  const sitemap = await get(port, '/sitemap.xml');
  ok(sitemap.status === 200 && sitemap.type.includes('xml'), '/sitemap.xml: 200 xml');
  const locs = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const expectedLocs = ['/', '/communities', '/chat', '/chatting-app', '/group-chat', '/plus-one',
    '/network', '/download', '/about', '/blog/',
    '/blog/what-does-gc-mean', '/blog/plus-one-meaning',
    ...NICHES.map((n) => `/communities/${n.slug}`)];
  const nicheCount = locs.filter((l) => /\/communities\/[a-z-]+$/.test(l)).length;
  ok(nicheCount === NICHES.length, `/sitemap.xml: lists all ${NICHES.length} generated niche pages (found ${nicheCount})`);
  for (const expected of expectedLocs) {
    ok(locs.includes(`${ORIGIN}${expected}`), `/sitemap.xml: lists ${expected}`);
  }

  console.log('— communities sitemap');
  const cs = await get(port, '/sitemap-communities.xml');
  ok(cs.status === 200 && cs.type.includes('xml'), '/sitemap-communities.xml: 200 xml');
  const clocs = [...cs.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const expectedClocs = [`${ORIGIN}/communities`, ...NICHES.map((n) => `${ORIGIN}/communities/${n.slug}`)];
  for (const loc of expectedClocs) {
    ok(clocs.includes(loc), `/sitemap-communities.xml: lists ${loc.replace(ORIGIN, '')}`);
  }
  ok(clocs.length === expectedClocs.length, `/sitemap-communities.xml: exactly hub + ${NICHES.length} niches (found ${clocs.length})`);
  for (const loc of expectedClocs) {
    const res = await get(port, loc.replace(ORIGIN, ''));
    ok(res.status === 200, `communities sitemap URL answers 200: ${loc.replace(ORIGIN, '')}`);
  }

  console.log('— Android App Links config (app.json)');
  const appConfig = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'app.json'), 'utf8'));
  const filters = appConfig?.expo?.android?.intentFilters || [];
  const appLink = filters.find((f) => f.action === 'VIEW' && f.autoVerify === true
    && (f.data || []).some((d) => d.scheme === 'https' && d.host === 'www.plusoneco.in'));
  ok(Boolean(appLink), 'app.json: Android App Link intent filter exists (VIEW, autoVerify, https://www.plusoneco.in)');
  ok(appConfig?.expo?.android?.package === 'ai.arena.tomodachi', 'app.json: package matches assetlinks default (ai.arena.tomodachi)');

  for (const loc of locs) {
    const route = loc.replace(ORIGIN, '') || '/';
    const res = await get(port, route);
    ok(res.status === 200, `sitemap URL answers 200: ${route}`);
  }

  console.log(`\n${failures === 0 ? 'ALL PASS' : 'FAILURES'} — ${checks - failures}/${checks} checks passed`);
  server.close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
