#!/usr/bin/env node
/**
 * SSR smoke test — proves the app renders to HTML in a browser-less environment.
 *
 * 1. Bundles ssr-entry.js for the web platform with Expo's own export pipeline
 *    (same Metro config/resolution as the real web build).
 * 2. Evaluates the bundle in a Node VM context that has NO `window`,
 *    `document`, `localStorage`, `matchMedia`, `sessionStorage` — a stricter
 *    environment than any real SSR host.
 * 3. Renders the full <App /> tree with react-dom/server and asserts real
 *    markup comes out.
 *
 * Usage:  node scripts/ssr-smoke.js        (from app/)
 */
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const { execSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');

async function main() {
  const pkgPath = path.join(projectRoot, 'package.json');
  const pkgOriginal = fs.readFileSync(pkgPath, 'utf8');
  const pkg = JSON.parse(pkgOriginal);
  if (pkg.main !== 'ssr-entry.js') {
    pkg.main = 'ssr-entry.js';
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  }

  const outDir = '/tmp/plusone-ssr-dist';
  try {
    console.log('[ssr-smoke] bundling for web via expo export...');
    execSync(
      `npx expo export --platform web --no-minify --no-bytecode --output-dir ${outDir}`,
      { cwd: projectRoot, stdio: 'ignore', env: { ...process.env, NODE_ENV: 'production' } },
    );
  } finally {
    fs.writeFileSync(pkgPath, pkgOriginal);
  }

  const jsDir = path.join(outDir, '_expo', 'static', 'js', 'web');
  const bundleFile = fs.readdirSync(jsDir).find((f) => f.endsWith('.js'));
  if (!bundleFile) throw new Error('no js bundle produced by expo export');
  let code = fs.readFileSync(path.join(jsDir, bundleFile), 'utf8');

  // Metro stubs `node:async_hooks` to an empty module in web bundles, but
  // expo-font's SSR path needs a real AsyncLocalStorage. Re-point that one
  // import at the host implementation (exactly what a server-target bundle
  // would do by externalizing it).
  const asyncHooksUsage = 'var _nodeAsync_hooks = require(_dependencyMap[0]);';
  if (code.includes(asyncHooksUsage)) {
    code = code.replace(
      asyncHooksUsage,
      'var _nodeAsync_hooks = global.__SSR_NODE_ASYNC_HOOKS__ || {};'
    );
  }

  // A fresh context with only server-like globals. No window/document/etc.
  const sandbox = {
    __SSR_NODE_ASYNC_HOOKS__: require('node:async_hooks'),
    process: {
      env: { ...process.env, NODE_ENV: 'production' },
      version: process.version,
      platform: process.platform,
      nextTick: process.nextTick.bind(process),
      cwd: process.cwd,
      hrtime: process.hrtime.bind(process),
      browser: false,
      argv: [],
    },
    Buffer,
    setTimeout: (...args) => global.setTimeout(...args),
    clearTimeout,
    setInterval: (...args) => {
      // Report code that parks an interval during an SSR pass — a real SSR
      // host must not be kept alive (or leak work) by a render.
      console.warn('[ssr-smoke] setInterval during SSR from:\n' + (new Error().stack || '').split('\n').slice(2, 5).join('\n'));
      return global.setInterval(...args);
    },
    clearInterval,
    setImmediate,
    clearImmediate,
    console: {
      log: (...a) => console.log('[ssr-bundle]', ...a),
      warn: (...a) => console.warn('[ssr-bundle warn]', ...a),
      error: (...a) => { (sandbox.__consoleErrors ||= []).push(a.map(String).join(' ')); },
      info: () => {},
      debug: () => {},
    },
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    AbortController,
    fetch: () => Promise.reject(new Error('fetch disabled in SSR smoke test')),
    // Node's real global scope provides these since v15 — SSR hosts have them.
    MessageChannel,
    MessagePort,
    structuredClone,
    performance,
    queueMicrotask,
  };
  // Deliberately NOT defined: window, document, navigator, localStorage,
  // sessionStorage, matchMedia, history, location, self.

  const context = vm.createContext(sandbox);
  console.log('[ssr-smoke] evaluating bundle without window/document...');
  vm.runInContext(code, context, { filename: 'ssr-bundle.js' });

  const result = sandbox.__SSR_RESULT__;
  const consoleErrors = sandbox.__consoleErrors || [];
  if (!result) {
    console.error('[ssr-smoke] FAIL — bundle did not produce a result (threw before registration?)');
    if (consoleErrors.length) console.error(consoleErrors.join('\n'));
    process.exit(1);
  }
  if (!result.ok) {
    console.error('[ssr-smoke] FAIL —\n' + result.failures.join('\n'));
    process.exit(1);
  }
  console.log(`[ssr-smoke] ok — rendered ${result.length} chars of HTML; boot screen: ${result.showsBootScreen}`);
  console.log('[ssr-smoke] html preview:\n' + (result.preview || '').slice(0, 1100));
  if (consoleErrors.length) {
    console.warn(`[ssr-smoke] note — ${consoleErrors.length} console.error call(s) during import/render:`);
    consoleErrors.slice(0, 10).forEach((e) => console.warn('   ', e.slice(0, 300)));
  }
  // The bundle may have scheduled host timers (tracked above); a smoke test
  // exits deterministically instead of waiting them out.
  process.exit(0);
}

main().catch((error) => {
  console.error('[ssr-smoke] FAIL —', (error && error.stack) || error);
  process.exit(1);
});

