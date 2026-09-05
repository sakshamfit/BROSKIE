#!/usr/bin/env node
/*
 * +one web export pipeline.
 *
 * Default (site layout — used by Vercel/plusoneco.in):
 *   npm run export:web
 *   → expo export into app/dist
 *   → moves the app shell to dist/app/index.html   (the app lives at /app)
 *   → bundles app/web/src/site.js with esbuild (GSAP) → dist/assets/js/site.js
 *   → copies the static marketing pages from app/web/ to dist/
 *     (home → index.html; about/communities/chat/network/download → *.html;
 *      blog → blog/index.html; privacy/terms/support → *.html)
 *   → copies robots.txt + sitemap.xml over the app-public copies
 *     (app/web is the single source of truth for the marketing site)
 *   → compiles app/web/styles.css once into a fingerprinted, immutable asset
 *     and points every marketing page at it. This keeps raw HTML mostly
 *     meaningful content instead of repeated CSS, improves cache reuse, and
 *     avoids Site Audit high HTML-to-text / large-HTML warnings.
 *
 * --app-only (used by Railway single-host and Cloudflare Workers builds,
 *             where the app must keep serving at the domain root):
 *   → just the plain expo export, exactly as before.
 *
 *   → also runs scripts/build-communities.mjs first so the /communities/*
 *     niche pages + sitemap can never go stale relative to
 *     app/web/community-niches.json
 *
 * --site-preview (local QA only — not a deploy mode):
 *   → skips the expo export entirely and builds just the marketing pages
 *     into the output dir, with a stub app shell at /app and, when node_modules
 *     are unavailable, a no-motion stub for /assets/js/site.js. Lets
 *     verify-site.mjs / check-links.mjs / lighthouse run against real output
 *     on machines that can't run the full Expo export.
 *
 * Usage: node scripts/export-web.js [--app-only] [--site-preview] [--output-dir <dir>]
 */
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const APP_ROOT = path.resolve(__dirname, '..');
const WEB_DIR = path.join(APP_ROOT, 'web');

function parseArgs(argv) {
  const args = { appOnly: false, sitePreview: false, outputDir: 'dist' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--app-only') args.appOnly = true;
    else if (a === '--site-preview') args.sitePreview = true;
    else if (a === '--output-dir') args.outputDir = argv[++i] || 'dist';
    else if (a === '--') break;
    else throw new Error(`Unknown arg: ${a}`);
  }
  return args;
}

/* Niche landing pages are GENERATED from app/web/community-niches.json —
 * always regenerate before copying, so shipping a page that disagrees with
 * the data (or forgetting its sitemap entry) is impossible. `--check` mode
 * in scripts/build-communities.mjs is what CI uses to catch hand-edits. */
function buildCommunityPages() {
  console.log('[export-web] node scripts/build-communities.mjs');
  execFileSync(process.execPath, [path.join(__dirname, 'build-communities.mjs')], {
    cwd: APP_ROOT,
    stdio: 'inherit',
  });
}

function buildBlogLinks() {
  console.log('[export-web] node scripts/build-blog-links.mjs');
  execFileSync(process.execPath, [path.join(__dirname, 'build-blog-links.mjs')], {
    cwd: APP_ROOT,
    stdio: 'inherit',
  });
}

function runExport(outputDir) {
  const rel = path.relative(APP_ROOT, path.resolve(outputDir));
  fs.rmSync(path.resolve(outputDir), { recursive: true, force: true });
  console.log(`[export-web] expo export --platform web --output-dir ${rel}`);
  execFileSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['expo', 'export', '--platform', 'web', '--output-dir', rel],
    {
      cwd: APP_ROOT,
      stdio: 'inherit',
      env: { ...process.env, CI: 'true' },
    }
  );
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

/* Build one compact, content-addressed stylesheet instead of repeating the
 * 36 KB source stylesheet inside every document. A hash tied to the source
 * content makes the Vercel immutable-cache rule safe: an edit gets a new URL.
 * esbuild is available in production builds; the small fallback keeps
 * --site-preview useful on machines without node_modules. */
function fallbackMinifyCss(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,>])\s*/g, '$1')
    .replace(/;}(?=})/g, '}')
    .trim();
}

function buildStylesheet(dist) {
  const source = path.join(WEB_DIR, 'styles.css');
  const css = fs.readFileSync(source, 'utf8');
  const hash = crypto.createHash('sha256').update(css).digest('hex').slice(0, 12);
  const relativeHref = `/assets/css/site.${hash}.css`;
  const out = path.join(dist, relativeHref.slice(1));
  const esbuild = path.join(APP_ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild');
  fs.mkdirSync(path.dirname(out), { recursive: true });

  try {
    execFileSync(esbuild, [source, '--minify', `--outfile=${out}`, '--log-level=warning'], {
      cwd: APP_ROOT,
      stdio: 'inherit',
    });
    console.log(`[export-web] minified stylesheet → ${relativeHref} (${kmb(fs.statSync(out).size)})`);
  } catch {
    fs.writeFileSync(out, fallbackMinifyCss(css));
    console.log(`[export-web] stylesheet fallback → ${relativeHref} (${kmb(fs.statSync(out).size)}; esbuild unavailable)`);
  }
  return relativeHref;
}

function pointToStylesheet(html, stylesheetHref) {
  const out = html.replace(
    /<link rel="stylesheet" href="(\.\.\/|\.?\/)?styles\.css" \/>/,
    `<link rel="stylesheet" href="${stylesheetHref}" />`
  );
  if (out === html) {
    throw new Error('Page is missing the styles.css <link> marker for stylesheet replacement');
  }
  return out;
}

/* Bundles the GSAP-driven site runtime (see app/web/src/site.js) into a
 * single minified iife, cached by the browser as /assets/js/site.js. */
function bundleSiteJs(dist) {
  const entry = path.join(WEB_DIR, 'src', 'site.js');
  const outDir = path.join(dist, 'assets', 'js');
  fs.mkdirSync(outDir, { recursive: true });
  const esbuild = path.join(APP_ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild');
  const out = path.join(outDir, 'site.js');
  console.log('[export-web] esbuild → assets/js/site.js');
  execFileSync(esbuild, [
    entry,
    '--bundle',
    '--minify',
    '--format=iife',
    `--outfile=${out}`,
    '--log-level=warning',
  ], { cwd: APP_ROOT, stdio: 'inherit' });
  return out;
}

function kmb(bytes) {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function main() {
  const { appOnly, sitePreview, outputDir } = parseArgs(process.argv.slice(2));
  const dist = path.resolve(APP_ROOT, outputDir);

  buildBlogLinks();
  buildCommunityPages();

  if (sitePreview && appOnly) throw new Error('--site-preview and --app-only are mutually exclusive');

  if (sitePreview) {
    /* QA-only build: marketing pages + assets, stub app shell, site.js best
     * effort (real bundle if node_modules are installed, no-motion stub if not). */
    fs.rmSync(dist, { recursive: true, force: true });
    fs.mkdirSync(path.join(dist, 'app'), { recursive: true });
    fs.writeFileSync(
      path.join(dist, 'app', 'index.html'),
      '<!DOCTYPE html><html><head><title>+one app — preview stub</title></head><body>Local site-preview stub. The real app shell comes from the expo export in full builds.</body></html>\n',
    );
    console.log('[export-web] --site-preview: expo export skipped; /app stubbed for link checks');
  } else {
    runExport(outputDir);

    if (appOnly) {
      console.log('[export-web] --app-only: app shell stays at the domain root.');
      return;
    }

    /* ---- site layout ---------------------------------------------------- */
    const appIndex = path.join(dist, 'index.html');
    const appDir = path.join(dist, 'app');
    fs.mkdirSync(appDir, { recursive: true });
    fs.renameSync(appIndex, path.join(appDir, 'index.html'));
    console.log('[export-web] app shell → /app/index.html');
  }

  const stylesheetHref = buildStylesheet(dist);
  const generated = fs.readdirSync(path.join(WEB_DIR, 'communities'))
    .filter((f) => f.endsWith('.html'))
    .map((f) => ({ src: `communities/${f}`, dest: `communities/${f}` }));
  const blogPages = fs.existsSync(path.join(WEB_DIR, 'blog'))
    ? fs.readdirSync(path.join(WEB_DIR, 'blog'))
      .filter((f) => f.endsWith('.html'))
      .map((f) => ({ src: `blog/${f}`, dest: `blog/${f}` }))
    : [];
  const pages = [
    { src: 'home.html', dest: 'index.html' },
    { src: 'about.html', dest: 'about.html' },
    { src: 'communities.html', dest: 'communities.html' },
    ...generated,
    ...blogPages,
    { src: 'chat.html', dest: 'chat.html' },
    { src: 'group-chat.html', dest: 'group-chat.html' },
    { src: 'chatting-app.html', dest: 'chatting-app.html' },
    { src: 'plus-one.html', dest: 'plus-one.html' },
    { src: 'network.html', dest: 'network.html' },
    { src: 'download.html', dest: 'download.html' },
    { src: 'privacy.html', dest: 'privacy.html' },
    { src: 'terms.html', dest: 'terms.html' },
    { src: 'support.html', dest: 'support.html' },
  ];
  for (const page of pages) {
    const html = fs.readFileSync(path.join(WEB_DIR, page.src), 'utf8');
    const withCss = pointToStylesheet(html, stylesheetHref);
    const destPath = path.join(dist, page.dest);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, withCss);
    console.log(`[export-web] ${page.src} → ${page.dest} (${kmb(Buffer.byteLength(withCss))})`);
  }

  copyDir(path.join(WEB_DIR, 'assets'), path.join(dist, 'assets'));
  if (sitePreview) {
    try {
      bundleSiteJs(dist);
    } catch {
      const out = path.join(dist, 'assets', 'js', 'site.js');
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, '/* site-preview stub: no gsap/esbuild available — reveal-on-load, no motion. */\ndocument.querySelectorAll("[data-reveal]").forEach(function (el) { el.classList.add("is-in"); });\n');
      console.log('[export-web] --site-preview: site.js stubbed (no motion runtime without node_modules)');
    }
  } else {
    bundleSiteJs(dist);
  }
  console.log('[export-web] static assets copied (images, fonts, QR, site.js).');

  // Copy PWA manifest for native-like web app experience
  const manifestSrc = path.join(WEB_DIR, 'manifest.json');
  const manifestDest = path.join(dist, 'manifest.json');
  if (fs.existsSync(manifestSrc)) {
    fs.copyFileSync(manifestSrc, manifestDest);
    console.log('[export-web] PWA manifest copied.');
  }

  // robots.txt + sitemaps + llms files: app/web is the source of truth
  // for the marketing site — overwrite the copies expo brought in from
  // app/public. llms.txt / llms-full.txt brief AI answer engines (GEO).
  // sitemap-communities.xml is the communities-only sitemap submitted
  // separately in Search Console (docs/SEO_GEO_PLAYBOOK.md §6).
  for (const f of ['robots.txt', 'sitemap.xml', 'sitemap-communities.xml', 'llms.txt', 'llms-full.txt']) {
    fs.copyFileSync(path.join(WEB_DIR, f), path.join(dist, f));
    console.log(`[export-web] ${f} → dist/${f}`);
  }

  for (const f of ['index.html', 'about.html', 'communities.html', 'chat.html', 'network.html', 'download.html', 'blog/index.html', 'assets/js/site.js', ...generated.map((g) => g.dest)]) {
    const p = path.join(dist, f);
    console.log(`[export-web]   ${f}: ${fs.existsSync(p) ? kmb(fs.statSync(p).size) : 'MISSING'}`);
  }
}

main();
