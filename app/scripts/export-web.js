#!/usr/bin/env node
/*
 * +one web export pipeline.
 *
 * Default (site layout — used by Vercel/plusoneco.in):
 *   npm run export:web
 *   → expo export into app/dist
 *   → moves the app shell to dist/app/index.html   (the app lives at /app)
 *   → copies the static marketing/legal pages from app/web/ to dist/
 *     (home → index.html, privacy/terms/support → *.html)
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

function inlineStyles(html, css) {
  const marker = '<link rel="stylesheet" href="./styles.css" />';
  if (!html.includes(marker)) {
    throw new Error('Page is missing the styles.css <link> marker for inlining');
  }
  return html.replace(marker, () => `<style>\n${css}\n</style>`);
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
    { src: 'privacy.html', dest: 'privacy.html' },
    { src: 'terms.html', dest: 'terms.html' },
    { src: 'support.html', dest: 'support.html' },
  ];
  for (const page of pages) {
    const html = fs.readFileSync(path.join(WEB_DIR, page.src), 'utf8');
    const withCss = inlineStyles(html, css);
    fs.writeFileSync(path.join(dist, page.dest), withCss);
    console.log(`[export-web] ${page.src} → ${page.dest} (${kmb(Buffer.byteLength(withCss))})`);
  }

  copyDir(path.join(WEB_DIR, 'assets'), path.join(dist, 'assets'));
  console.log('[export-web] static assets copied (images, fonts, QR).');

  for (const f of ['index.html', 'privacy.html', 'terms.html', 'support.html']) {
    console.log(`[export-web]   ${f}: ${kmb(fs.statSync(path.join(dist, f)).size)}`);
  }
}

main();
