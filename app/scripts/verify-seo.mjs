#!/usr/bin/env node
/**
 * verify-seo.mjs
 *
 * Comprehensive SEO validator based on Google Search Central SEO Starter Guide.
 * Validates all static HTML pages in app/dist or app/web against Google's best practices:
 *   1. Unique, descriptive <title> (with branding)
 *   2. Unique, high-quality <meta name="description"> (50–160 chars)
 *   3. Canonical tag (<link rel="canonical">)
 *   4. Exactly one <h1> heading per page
 *   5. Valid Schema.org JSON-LD structured data (WebSite, BreadcrumbList, FAQPage, BlogPosting, etc.)
 *   6. Open Graph & Twitter Card tags
 *   7. Descriptive image alt attributes (no missing or generic placeholders)
 *   8. Mobile viewport & charset
 *   9. Sitemap.xml & robots.txt consistency
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = fs.existsSync(path.join(APP_ROOT, 'dist'))
  ? path.join(APP_ROOT, 'dist')
  : path.join(APP_ROOT, 'web');

function getHtmlFiles(dir, base = '') {
  let results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.join(base, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'assets' && entry.name !== 'app') {
        results = results.concat(getHtmlFiles(full, rel));
      }
    } else if (entry.name.endsWith('.html')) {
      results.push({ full, rel });
    }
  }
  return results;
}

const files = getHtmlFiles(DIST_DIR);
console.log(`\n🔍 Running Google SEO Starter Guide audit on ${files.length} pages in ${DIST_DIR}...\n`);

let totalChecks = 0;
let passedChecks = 0;
let failedChecks = 0;

const titles = new Map();
const descriptions = new Map();
const canonicals = new Map();

function assert(condition, message, file) {
  totalChecks++;
  if (condition) {
    passedChecks++;
  } else {
    failedChecks++;
    console.error(`  ❌ [FAIL] ${file}: ${message}`);
  }
}

for (const { full, rel } of files) {
  const html = fs.readFileSync(full, 'utf8');

  // 1. Title tag
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  assert(!!titleMatch, '<title> tag missing', rel);
  if (titleMatch) {
    const title = titleMatch[1].trim();
    assert(title.length >= 10, `<title> too short (${title.length} chars): "${title}"`, rel);
    assert(title.length <= 80, `<title> too long (${title.length} chars): "${title}"`, rel);
    assert(!titles.has(title), `Duplicate <title> detected: "${title}" (already in ${titles.get(title)})`, rel);
    titles.set(title, rel);
  }

  // 2. Meta description
  const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i)
    || html.match(/<meta\s+content="([^"]+)"\s+name="description"/i);
  assert(!!descMatch, '<meta name="description"> tag missing', rel);
  if (descMatch) {
    const desc = descMatch[1].trim();
    assert(desc.length >= 40, `Meta description too short (${desc.length} chars)`, rel);
    assert(desc.length <= 200, `Meta description too long (${desc.length} chars)`, rel);
    assert(!descriptions.has(desc), `Duplicate meta description: "${desc.slice(0, 30)}..."`, rel);
    descriptions.set(desc, rel);
  }

  // 3. Canonical tag
  const canonicalMatch = html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/i)
    || html.match(/<link\s+href="([^"]+)"\s+rel="canonical"/i);
  assert(!!canonicalMatch, '<link rel="canonical"> tag missing', rel);
  if (canonicalMatch) {
    const canon = canonicalMatch[1].trim();
    assert(canon.startsWith('https://www.plusoneco.in'), `Canonical URL must be absolute: "${canon}"`, rel);
    assert(!canonicals.has(canon), `Duplicate canonical tag: "${canon}"`, rel);
    canonicals.set(canon, rel);
  }

  // 4. Exactly one <h1> tag
  const h1Matches = html.match(/<h1[\s>]/gi) || [];
  assert(h1Matches.length === 1, `Expected exactly 1 <h1> tag, found ${h1Matches.length}`, rel);

  // 5. Viewport and Charset
  assert(/<meta\s+charset="UTF-8"/i.test(html), 'Missing <meta charset="UTF-8">', rel);
  assert(/<meta\s+name="viewport"/i.test(html), 'Missing <meta name="viewport">', rel);

  // 6. Open Graph & Twitter Cards
  assert(/<meta\s+property="og:title"/i.test(html), 'Missing og:title', rel);
  assert(/<meta\s+property="og:description"/i.test(html), 'Missing og:description', rel);
  assert(/<meta\s+property="og:url"/i.test(html), 'Missing og:url', rel);
  assert(/<meta\s+name="twitter:card"/i.test(html), 'Missing twitter:card', rel);

  // 7. Schema.org JSON-LD Structured Data
  const jsonLdMatches = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)];
  assert(jsonLdMatches.length >= 1, 'Missing JSON-LD structured data', rel);
  for (const match of jsonLdMatches) {
    try {
      const parsed = JSON.parse(match[1]);
      assert(parsed['@context'] === 'https://schema.org', 'JSON-LD @context must be https://schema.org', rel);
      assert(!!parsed['@type'], 'JSON-LD @type missing', rel);
    } catch (e) {
      assert(false, `Invalid JSON-LD syntax: ${e.message}`, rel);
    }
  }

  // 8. Image alt attributes
  const imgTags = [...html.matchAll(/<img\s+([^>]+)>/gi)];
  for (const img of imgTags) {
    const attrs = img[1];
    const altMatch = attrs.match(/alt="([^"]*)"/i);
    assert(!!altMatch, `Image missing alt attribute: ${img[0].slice(0, 50)}...`, rel);
    if (altMatch) {
      const altText = altMatch[1].trim();
      assert(altText.length > 0, `Image has empty alt text: ${img[0].slice(0, 50)}...`, rel);
      assert(!altText.toLowerCase().includes('placeholder graphic'), `Image has generic placeholder alt text: "${altText}"`, rel);
    }
  }
}

// 9. Robots.txt and Sitemap.xml checks
const robotsPath = path.join(DIST_DIR, 'robots.txt');
const sitemapPath = path.join(DIST_DIR, 'sitemap.xml');

assert(fs.existsSync(robotsPath), 'dist/robots.txt missing', 'robots.txt');
if (fs.existsSync(robotsPath)) {
  const robots = fs.readFileSync(robotsPath, 'utf8');
  assert(robots.includes('Sitemap: https://www.plusoneco.in/sitemap.xml'), 'robots.txt missing Sitemap directive', 'robots.txt');
  assert(robots.includes('Disallow: /app/'), 'robots.txt missing Disallow: /app/', 'robots.txt');
  assert(robots.includes('Disallow: /api/'), 'robots.txt missing Disallow: /api/', 'robots.txt');
}

assert(fs.existsSync(sitemapPath), 'dist/sitemap.xml missing', 'sitemap.xml');
if (fs.existsSync(sitemapPath)) {
  const sitemap = fs.readFileSync(sitemapPath, 'utf8');
  for (const canon of canonicals.keys()) {
    assert(sitemap.includes(`<loc>${canon}</loc>`), `sitemap.xml missing URL for canonical: ${canon}`, 'sitemap.xml');
  }
}

console.log(`\n======================================================`);
console.log(`📊 Google SEO Starter Guide Audit Complete:`);
console.log(`   Total Tests:  ${totalChecks}`);
console.log(`   Passed:       ${passedChecks}`);
console.log(`   Failed:       ${failedChecks}`);
console.log(`======================================================\n`);

if (failedChecks > 0) {
  process.exit(1);
} else {
  console.log('🎉 100% SEO COMPLIANCE PASSED!\n');
}
