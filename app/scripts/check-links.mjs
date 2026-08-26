#!/usr/bin/env node
/**
 * Asset + internal-link integrity for the built marketing site.
 * Crawls every dist/*.html page, collects:
 *   - local asset refs (src/href to files: fonts, images, js, css, manifest)
 *   - internal links (<a href="/...">)
 * and asserts each resolves to a file in dist (with cleanUrls mapping).
 *
 * Usage: node scripts/check-links.mjs [distDir]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '..', process.argv[2] || 'dist');

const pages = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.html')) pages.push(p);
  }
})(DIST);

function resolves(urlPath) {
  if (urlPath.startsWith('http') || urlPath.startsWith('mailto:') || urlPath.startsWith('data:')) return true;
  let p = urlPath.split('#')[0].split('?')[0];
  if (!p || p === '') p = '/';
  if (p.startsWith('/')) p = p.slice(1);
  if (p === '') return fs.existsSync(path.join(DIST, 'index.html'));
  if (p.endsWith('/')) p += 'index.html';
  let full = path.join(DIST, p);
  if (fs.existsSync(full) && fs.statSync(full).isFile()) return true;
  if (!p.includes('.')) {
    full = path.join(DIST, `${p}.html`);
    if (fs.existsSync(full)) return true;
    full = path.join(DIST, p, 'index.html'); // directory index (/app, /blog/)
    if (fs.existsSync(full)) return true;
  }
  return false;
}

let failures = 0;
let links = 0;
let assets = 0;
for (const pagePath of pages) {
  const html = fs.readFileSync(pagePath, 'utf8');
  const rel = path.relative(DIST, pagePath);
  const pageDir = path.dirname(pagePath);

  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const url = m[1];
    if (url.startsWith('#') || url === '') continue;
    if (/^(https?:|mailto:|data:|tel:)/.test(url)) continue;
    if (url.startsWith('/')) {
      // absolute from dist root
      assets += 1;
      if (!resolves(url)) { failures += 1; console.error(`✗ ${rel}: broken absolute ref ${url}`); }
    } else {
      assets += 1;
      const target = path.resolve(pageDir, url.split('#')[0].split('?')[0]);
      if (!fs.existsSync(target)) { failures += 1; console.error(`✗ ${rel}: broken relative ref ${url}`); }
    }
  }

  for (const m of html.matchAll(/<a [^>]*href="([^"]+)"/g)) {
    const url = m[1];
    if (/^(https?:|mailto:|data:|tel:)/.test(url) || url.startsWith('#')) continue;
    links += 1;
    if (!resolves(url)) { failures += 1; console.error(`✗ ${rel}: broken link ${url}`); }
  }
}

console.log(`checked ${pages.length} pages · ${assets} asset refs · ${links} internal links`);
if (failures === 0) console.log('LINK CHECK PASS — every local asset and internal link resolves');
else { console.log(`LINK CHECK FAIL — ${failures} broken`); process.exit(1); }
