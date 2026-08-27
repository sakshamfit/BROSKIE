#!/usr/bin/env node
/**
 * Real-browser verification of the marketing site.
 *
 * Run on a machine/CI runner with Chrome available (GitHub Actions
 * ubuntu runners ship it). Installs nothing itself: expects lighthouse +
 * puppeteer in app/node_modules (CI installs them with --no-save).
 *
 *   1. serves dist/ with vercel cleanUrls semantics
 *   2. Lighthouse (mobile + desktop) on key routes, with score gates
 *   3. computed-style assertions — the pages actually wear the app's
 *      Graphite & Pulp tokens (body bg, headline font, nav border)
 *   4. full-page screenshots of every marketing page → ./lighthouse-artifacts
 *   5. writes a markdown summary (GITHUB_STEP_SUMMARY when in CI)
 *
 * Usage: node scripts/lighthouse-ci.mjs [distDir]
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const DIST = path.resolve(APP_ROOT, process.argv[2] || 'dist');
const ART = path.join(APP_ROOT, 'lighthouse-artifacts');
fs.mkdirSync(ART, { recursive: true });

/* ---------------------------------------------------------------- */
/* static server (cleanUrls)                                         */
/* ---------------------------------------------------------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};
function resolveFile(urlPath) {
  let p = urlPath.split('?')[0];
  if (p.endsWith('/')) p += 'index.html';
  const direct = path.normalize(path.join(DIST, p));
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct;
  if (!p.includes('.')) {
    const clean = path.normalize(path.join(DIST, `${p}.html`));
    if (fs.existsSync(clean)) return clean;
  }
  return null;
}
const server = http.createServer((req, res) => {
  const file = resolveFile(req.url);
  if (!file) { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(8891, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:8891';

/* ---------------------------------------------------------------- */
/* browsers                                                          */
/* ---------------------------------------------------------------- */
const { launch } = await import('puppeteer');
const lighthouse = (await import('lighthouse/core/index.js')).default;
const browser = await launch({ channel: 'chrome', args: ['--no-sandbox'] });
const wsEndpoint = browser.wsEndpoint();
const chromePort = new URL(wsEndpoint).port;

let failures = 0;
const ok = (cond, label) => {
  if (cond) console.log(`  ✓ ${label}`);
  else { failures += 1; console.error(`  ✗ ${label}`); }
};

const ROUTES = ['/', '/chat', '/communities', '/communities/running', '/download', '/about', '/network', '/blog/'];
const GATES = { performance: 0.9, accessibility: 0.9, 'best-practices': 0.9, seo: 0.95 };

/* ---------------------------------------------------------------- */
/* computed-style assertions + screenshots                            */
/* ---------------------------------------------------------------- */
console.log('\n━━━ visual token assertions + screenshots ━━━');
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
for (const route of ROUTES) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  const styles = await page.evaluate(() => {
    const b = getComputedStyle(document.body);
    const h = document.querySelector('h1');
    return {
      bg: b.backgroundColor,
      bodyFont: b.fontFamily,
      h1Font: h ? getComputedStyle(h).fontFamily : null,
      navBorder: document.querySelector('.nav') ? getComputedStyle(document.querySelector('.nav')).borderBottomWidth : null,
      btnFont: document.querySelector('.btn') ? getComputedStyle(document.querySelector('.btn')).fontFamily : null,
    };
  });
  ok(styles.bg === 'rgb(253, 248, 248)', `${route}: body bg = #fdf8f8 (pulp) — got ${styles.bg}`);
  ok(/Bricolage/.test(styles.h1Font || ''), `${route}: h1 uses Bricolage Grotesque`);
  ok(/Karla/.test(styles.bodyFont), `${route}: body uses Karla`);
  ok(/JetBrains Mono/.test(styles.btnFont || 'x'), `${route}: buttons use JetBrains Mono`);
  const slug = route === '/' ? 'home' : route.replaceAll('/', '');
  await page.screenshot({ path: path.join(ART, `${slug}-desktop.png`), fullPage: true });
}
await page.setViewport({ width: 412, height: 823, deviceScaleFactor: 1.75 });
await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: path.join(ART, 'home-mobile.png'), fullPage: true });
await page.close();

/* ---------------------------------------------------------------- */
/* animation sanity in the real browser: reveals fire, demos play     */
/* ---------------------------------------------------------------- */
const anim = await browser.newPage();
await anim.setViewport({ width: 1280, height: 900 });
const animErrors = [];
anim.on('pageerror', (e) => animErrors.push(String(e)));
await anim.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
await anim.evaluate(async () => {
  // scroll through the page so every reveal fires
  for (let y = 0; y <= document.body.scrollHeight; y += 400) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
  await new Promise((r) => setTimeout(r, 900));
});
const animState = await anim.evaluate(() => {
  const reveals = [...document.querySelectorAll('[data-reveal]')];
  return {
    total: reveals.length,
    shown: reveals.filter((el) => el.classList.contains('is-in')).length,
    heroOpacity: document.querySelector('.hero-copy') ? getComputedStyle(document.querySelector('.hero-copy')).opacity : null,
  };
});
ok(animErrors.length === 0, `no page errors during animated scroll ${animErrors.length ? `— ${animErrors[0]}` : ''}`);
ok(animState.total > 0 && animState.shown === animState.total, `all scroll reveals fired in Chrome (${animState.shown}/${animState.total})`);
ok(animState.heroOpacity === '1', `hero copy ends fully visible (opacity ${animState.heroOpacity})`);
await anim.close();

/* ---------------------------------------------------------------- */
/* lighthouse                                                        */
/* ---------------------------------------------------------------- */
console.log('\n━━━ lighthouse ━━━');
const summary = ['| route | mode | perf | a11y | bp | seo | LCP | CLS | TBT |', '|---|---|---|---|---|---|---|---|---|'];
const reports = [];

async function runLh(route, mode) {
  const result = await lighthouse(`${BASE}${route}`, {
    port: chromePort,
    output: 'html',
    onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
    ...(mode === 'desktop'
      ? { formFactor: 'desktop', screenEmulation: { disabled: true }, throttling: { rttMs: 40, throughputKbps: 10240, cpuSlowdownFactor: 1, requestLatencyMs: 0, downloadThroughputKbps: 0, uploadThroughputKbps: 0 } }
      : { formFactor: 'mobile', screenEmulation: { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false }, throttling: { rttMs: 40, throughputKbps: 10240, cpuSlowdownFactor: 1, requestLatencyMs: 0, downloadThroughputKbps: 0, uploadThroughputKbps: 0 } }),
  }, undefined);
  const { categories, audits } = result.lhr;
  const fmt = (a) => (categories[a].score === null ? '–' : Math.round(categories[a].score * 100));
  const row = {
    route, mode,
    perf: categories.performance.score, a11y: categories.accessibility.score,
    bp: categories['best-practices'].score, seo: categories.seo.score,
    lcp: audits['largest-contentful-paint'].displayValue,
    cls: audits['cumulative-layout-shift'].displayValue,
    tbt: audits['total-blocking-time'].displayValue,
  };
  summary.push(`| ${route} | ${mode} | ${row.perf === null ? '–' : Math.round(row.perf * 100)} | ${Math.round(row.a11y * 100)} | ${Math.round(row.bp * 100)} | ${Math.round(row.seo * 100)} | ${row.lcp} | ${row.cls} | ${row.tbt} |`);
  console.log(`${route} [${mode}]  perf ${Math.round(row.perf * 100)}  a11y ${Math.round(row.a11y * 100)}  bp ${Math.round(row.bp * 100)}  seo ${Math.round(row.seo * 100)}  LCP ${row.lcp}  CLS ${row.cls}  TBT ${row.tbt}`);

  for (const [cat, gate] of Object.entries(GATES)) {
    const score = categories[cat].score;
    if (score !== null && score < gate) failures += 1;
  }
  const slug = (route === '/' ? 'home' : route.replaceAll('/', '')) + '-' + mode;
  fs.writeFileSync(path.join(ART, `lh-${slug}.html`), result.report);
  reports.push(row);
}

await runLh('/', 'mobile');
await runLh('/', 'desktop');
await runLh('/chat', 'mobile');
await runLh('/download', 'mobile');

fs.writeFileSync(path.join(ART, 'summary.md'), summary.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${summary.join('\n')}\n`);
}

await browser.close();
server.close();
console.log(failures === 0 ? '\nLIGHTHOUSE CI PASS' : `\nLIGHTHOUSE CI FAIL (${failures} gate/style failures)`);
process.exit(failures === 0 ? 0 : 1);
