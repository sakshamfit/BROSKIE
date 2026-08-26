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
 *   3. exactly one <h1> with real crawlable text
 *   4. canonical URL matches the requested URL (https://www.plusoneco.in)
 *   5. every ld+json block parses and structurally validates per @type
 *   6. /robots.txt + /sitemap.xml reachable, sitemap URLs all 200
 *   7. styles are inlined (no render-blocking css link) and site.js exists
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

const PAGES = [
  { route: '/', title: 'Plus One – Connect, Chat & Find Your Community',
    desc: 'Plus One is a community-based social platform where you can connect with people, chat, share posts and discover communities based on your interests.',
    h1: 'Plus One — Connect, Chat & Find Your Community',
    mustInclude: ['Plus One is a community-based social platform built to help people connect, communicate and find communities around shared interests.'] },
  { route: '/about', title: 'About Plus One — The Ink-and-Paper Social Platform', h1: 'A social platform that feels like paper' },
  { route: '/communities', title: 'Communities — Find & Build Interest-Based Groups — Plus One', h1: 'Find your people by what you do' },
  { route: '/chat', title: 'Chat & Real-Time Messaging — Plus One', h1: 'Chat that arrives instantly' },
  { route: '/network', title: 'The Network — A Worldwide Social Feed — Plus One', h1: 'A worldwide feed that still feels handwritten' },
  { route: '/download', title: 'Download Plus One — Android APK, iOS & Web App', h1: 'Get Plus One on anything' },
  { route: '/blog/', title: 'Plus One Blog — Community, Connection & Discovery', h1: 'The Plus One blog' },
];

/* JSON-LD structural validation — the shape Google's Rich Results test
 * checks for each type we emit. */
const LD_RULES = {
  Organization: { req: ['name', 'url'] },
  WebSite: { req: ['name', 'url'] },
  SoftwareApplication: { req: ['name', 'operatingSystem', 'applicationCategory', 'offers'] },
  MobileApplication: { req: ['name', 'operatingSystem'] },
  BreadcrumbList: { req: ['itemListElement'], custom: (d) => Array.isArray(d.itemListElement) && d.itemListElement.length >= 1 },
  FAQPage: {
    req: ['mainEntity'],
    custom: (d) => d.mainEntity.every((q) => q['@type'] === 'Question' && q.name && q.acceptedAnswer?.text),
  },
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

    const h1s = [...body.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => decode(m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()));
    ok(h1s.length === 1, `${page.route}: exactly one <h1> in raw HTML`);
    ok(h1s[0] === page.h1, `${page.route}: <h1> text = "${h1s[0]}"`);

    for (const needle of page.mustInclude || []) {
      ok(body.includes(needle), `${page.route}: crawlable text contains "${needle.slice(0, 58)}…")`);
    }

    ok(!body.includes('<link rel="stylesheet"'), `${page.route}: styles inlined (no render-blocking link)`);
    ok(body.includes('/assets/js/site.js'), `${page.route}: site.js referenced`);
    const js = await get(port, '/assets/js/site.js');
    ok(js.status === 200 && js.type.includes('javascript'), '/assets/js/site.js: reachable');

    validateJsonLd(body, page.route);
    console.log('');
  }

  console.log('— robots.txt & sitemap.xml');
  const robots = await get(port, '/robots.txt');
  ok(robots.status === 200 && robots.type.includes('text/plain'), '/robots.txt: 200 text/plain');
  ok(robots.body.includes('Sitemap: https://www.plusoneco.in/sitemap.xml'), '/robots.txt: declares sitemap');

  const sitemap = await get(port, '/sitemap.xml');
  ok(sitemap.status === 200 && sitemap.type.includes('xml'), '/sitemap.xml: 200 xml');
  const locs = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const expectedLocs = ['/', '/communities', '/chat', '/network', '/download', '/about', '/blog/'];
  for (const expected of expectedLocs) {
    ok(locs.includes(`${ORIGIN}${expected}`), `/sitemap.xml: lists ${expected}`);
  }
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
