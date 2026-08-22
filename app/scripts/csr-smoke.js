#!/usr/bin/env node
/**
 * CSR smoke test — runs the REAL exported web bundle in jsdom (a browser-like
 * DOM) and asserts the client-side render actually mounts:
 *
 *   - #root receives children (the app boots, not a blank div),
 *   - the auth screen (signed-out first paint) is present,
 *   - no console.error / uncaught errors fire during boot.
 *
 * Catches the class of "bundle loads but page is blank" client-side bugs that
 * static analysis misses (undefined browser APIs, render-time crashes, bad
 * platform branches).
 *
 * Usage:  node scripts/csr-smoke.js <path-to-exported-dist>   (from app/)
 * Default dist path: /tmp/plusone-csr-dist
 */
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { JSDOM, VirtualConsole } = require('jsdom');

const distDir = process.argv[2] || '/tmp/plusone-csr-dist';

function main() {
  const htmlPath = path.join(distDir, 'index.html');
  if (!fs.existsSync(htmlPath)) {
    console.log('[csr-smoke] no export found — building web bundle first...');
    execSync(
      `npx expo export --platform web --output-dir ${distDir}`,
      { cwd: path.resolve(__dirname, '..'), stdio: 'ignore', env: { ...process.env, NODE_ENV: 'production' } },
    );
  }
  if (!fs.existsSync(htmlPath)) {
    console.error(`[csr-smoke] FAIL — ${htmlPath} not found. Run the export first.`);
    process.exit(1);
  }
  const html = fs.readFileSync(htmlPath, 'utf8');
  const jsDir = path.join(distDir, '_expo', 'static', 'js', 'web');
  const bundleFile = fs.readdirSync(jsDir).find((f) => f.endsWith('.js'));
  const bundlePath = path.join(jsDir, bundleFile);

  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('error', (...args) => errors.push(args.map(String).join(' ')));
  virtualConsole.on('jsdomError', (err) => errors.push(`jsdomError: ${err && err.message}`));
  virtualConsole.on('warn', () => {});
  virtualConsole.on('log', () => {});

  // Browser APIs jsdom lacks that RNW/Expo touch during boot.
  const dom = new JSDOM(html, {
    url: 'https://plusoneeeee.vercel.app/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  window.matchMedia = window.matchMedia || ((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
  window.scrollTo = window.scrollTo || (() => {});
  window.HTMLElement.prototype.scrollIntoView = window.HTMLElement.prototype.scrollIntoView || (() => {});
  window.HTMLCanvasElement.prototype.getContext = window.HTMLCanvasElement.prototype.getContext || (() => null);
  window.IntersectionObserver = window.IntersectionObserver || class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
  };
  window.ResizeObserver = window.ResizeObserver || class {
    observe() {} unobserve() {} disconnect() {}
  };
  // No real network in the smoke test: sockets/API calls fail fast and
  // quietly, exactly like an offline first paint.
  window.fetch = () => Promise.reject(new Error('offline'));
  window.WebSocket = class { constructor() { setTimeout(() => this.onerror && this.onerror(new Error('offline')), 0); } close() {} };
  window.XMLHttpRequest = class {
    open() {} send() { setTimeout(() => this.onerror && this.onerror(new Error('offline')), 0); }
    setRequestHeader() {} abort() {}
    get responseText() { return ''; }
    get status() { return 0; }
  };
  window.navigator.serviceWorker = undefined;

  const bundleCode = fs.readFileSync(bundlePath, 'utf8');

  // Pre-JS first paint: the static boot shell must be present in the served
  // HTML so users (and bots) never see a blank page while the bundle loads.
  const preBoot = window.document.getElementById('static-boot');
  if (!preBoot) {
    console.error('[csr-smoke] FAIL — static boot shell missing from exported index.html (blank first paint before JS).');
    process.exit(1);
  }
  if (!/LOADING \+ONE/.test(preBoot.textContent || '')) {
    console.error('[csr-smoke] FAIL — static boot shell has no LOADING +ONE label.');
    process.exit(1);
  }

  try {
    dom.window.eval(bundleCode);
  } catch (error) {
    console.error('[csr-smoke] FAIL — bundle threw synchronously on eval:');
    console.error((error && error.stack) || error);
    process.exit(1);
  }

  const deadline = Date.now() + 15000;
  (function check() {
    const root = window.document.getElementById('root');
    const hasChildren = !!root && root.childNodes.length > 0;
    if (hasChildren && Date.now() > deadline - 13000) {
      // give boot two seconds of "timers" to settle
      if (check.settledAt && Date.now() - check.settledAt > 2000) return report(hasChildren);
      check.settledAt = check.settledAt || Date.now();
    }
    if (Date.now() > deadline) return report(hasChildren);
    return setTimeout(check, 200);
  })();

  function report(hasChildren) {
    const root = window.document.getElementById('root');
    const text = (root && root.textContent) || '';
    const failures = [];
    if (!hasChildren) failures.push('#root has no children — the app never mounted (blank page)');
    // The app must have replaced the static boot shell with real UI.
    if (window.document.getElementById('static-boot')) {
      failures.push('static boot shell still present after mount — React did not take over #root');
    }
    // Signed-out first paint must be the auth screen.
    if (!/LOG IN|SIGN UP|username/i.test(text)) {
      failures.push(`auth screen not detected; root text: "${text.slice(0, 160)}"`);
    }
    const fatal = errors.filter((e) =>
      !/offline|fetch|WebSocket|socket|network|not implemented/i.test(e)
    );
    if (fatal.length) {
      failures.push(`${fatal.length} client error(s):`);
      fatal.slice(0, 8).forEach((e) => failures.push('   ' + e.slice(0, 400)));
    }
    if (failures.length) {
      console.error('[csr-smoke] FAIL —\n' + failures.join('\n'));
      process.exit(1);
    }
    console.log(`[csr-smoke] ok — app mounted in jsdom; root text starts: "${text.slice(0, 80).replace(/\s+/g, ' ')}"`);
    process.exit(0);
  }
}

main();
