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
 *   → inlines app/web/styles.css into every page (no render-blocking
 *     <link rel="stylesheet"> on the public site)
 *
 * --app-only (used by Railway single-host and Cloudflare Workers builds,
 *             where the app must keep serving at the domain root):
 *   → just the plain expo export, exactly as before.
 *
 * Usage: node scripts/export-web.js [--app-only] [--output-dir <dir>]
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP_ROOT = path.resolve(__dirname, '..');
const WEB_DIR = path.join(APP_ROOT, 'web');

function parseArgs(argv) {
  const args = { appOnly: false, outputDir: 'dist' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--app-only') args.appOnly = true;
    else if (a === '--output-dir') args.outputDir = argv[++i] || 'dist';
    else if (a === '--') break;
    else throw new Error(`Unknown arg: ${a}`);
  }
  return args;
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

/* Inlines the shared stylesheet. Pages live at dist/ root and reference
 * ./styles.css; the blog lives one level deeper and uses ../styles.css.
 * Both markers resolve to the same file. */
function inlineStyles(html, css) {
  const out = html.replace(
    /<link rel="stylesheet" href="(\.\.\/|\.?\/)?styles\.css" \/>/,
    () => `<style>\n${css}\n</style>`
  );
  if (out === html) {
    throw new Error('Page is missing the styles.css <link> marker for inlining');
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
  const { appOnly, outputDir } = parseArgs(process.argv.slice(2));
  const dist = path.resolve(APP_ROOT, outputDir);
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

  const css = fs.readFileSync(path.join(WEB_DIR, 'styles.css'), 'utf8');
  const pages = [
    { src: 'home.html', dest: 'index.html' },
    { src: 'about.html', dest: 'about.html' },
    { src: 'communities.html', dest: 'communities.html' },
    { src: 'chat.html', dest: 'chat.html' },
    { src: 'network.html', dest: 'network.html' },
    { src: 'download.html', dest: 'download.html' },
    { src: 'privacy.html', dest: 'privacy.html' },
    { src: 'terms.html', dest: 'terms.html' },
    { src: 'support.html', dest: 'support.html' },
    { src: 'blog/index.html', dest: 'blog/index.html' },
  ];
  for (const page of pages) {
    const html = fs.readFileSync(path.join(WEB_DIR, page.src), 'utf8');
    const withCss = inlineStyles(html, css);
    const destPath = path.join(dist, page.dest);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, withCss);
    console.log(`[export-web] ${page.src} → ${page.dest} (${kmb(Buffer.byteLength(withCss))})`);
  }

  copyDir(path.join(WEB_DIR, 'assets'), path.join(dist, 'assets'));
  bundleSiteJs(dist);
  console.log('[export-web] static assets copied (images, fonts, QR, site.js).');

  // Copy PWA manifest for native-like web app experience
  const manifestSrc = path.join(WEB_DIR, 'manifest.json');
  const manifestDest = path.join(dist, 'manifest.json');
  if (fs.existsSync(manifestSrc)) {
    fs.copyFileSync(manifestSrc, manifestDest);
    console.log('[export-web] PWA manifest copied.');
  }

  // robots.txt + sitemap.xml: app/web is the source of truth for the
  // marketing site — overwrite the copies expo brought in from app/public.
  for (const f of ['robots.txt', 'sitemap.xml']) {
    fs.copyFileSync(path.join(WEB_DIR, f), path.join(dist, f));
    console.log(`[export-web] ${f} → dist/${f}`);
  }

  for (const f of ['index.html', 'about.html', 'communities.html', 'chat.html', 'network.html', 'download.html', 'blog/index.html', 'assets/js/site.js']) {
    const p = path.join(dist, f);
    console.log(`[export-web]   ${f}: ${fs.existsSync(p) ? kmb(fs.statSync(p).size) : 'MISSING'}`);
  }
}

main();
