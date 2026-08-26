/**
 * Headless smoke test for the web bundle.
 *
 * Boots the real Metro-built app inside jsdom, drives a few interactions
 * (press the auth mode tabs, submit with an empty form) and reports any
 * uncaught error, React warning or failed render. It is not a substitute
 * for a device, but it catches the class of mistakes a motion refactor
 * actually makes: bad hooks order, undefined animated values, components
 * that no longer render, style objects that reference deleted keys.
 *
 * Usage:  node scripts/smoke-web.js [bundleFile]
 * (bundle defaults to a live fetch from the Metro dev server on :8081)
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const BUNDLE_URL = 'http://localhost:8081/index.bundle?platform=web&dev=true&minify=false';

async function getBundle(argPath) {
  if (argPath && fs.existsSync(argPath)) return fs.readFileSync(argPath, 'utf8');
  const res = await fetch(BUNDLE_URL);
  if (!res.ok) throw new Error(`bundle fetch failed: ${res.status}`);
  return res.text();
}

(async () => {
  const code = await getBundle(process.argv[2]);

  const dom = new JSDOM(
    '<!doctype html><html><head></head><body><div id="root"></div></body></html>',
    { url: 'http://localhost:8081/', pretendToBeVisual: true, runScripts: 'outside-only' },
  );
  const { window } = dom;

  const problems = [];
  const note = (kind, args) => {
    const text = args.map((a) => (a && a.stack) || String(a)).join(' ');
    problems.push(`${kind}: ${text.slice(0, process.env.SMOKE_VERBOSE ? 3000 : 400)}`);
  };

  window.console = {
    ...console,
    error: (...a) => note('console.error', a),
    warn: (...a) => {
      const t = String(a[0] || '');
      // Expected in a headless DOM with no backend / no native modules.
      if (/deprecated|not supported|useNativeDriver|Network|fetch|expo-|AsyncStorage|shadow|pointerEvents|props\.pointerEvents/i.test(t)) return;
      note('console.warn', a);
    },
    log: () => {},
    info: () => {},
    debug: () => {},
  };
  window.onerror = (msg, src, line, col, err) => note('window.onerror', [err || msg]);
  window.addEventListener('unhandledrejection', (e) => note('unhandledrejection', [e.reason]));

  // Minimal browser surface the app expects.
  // SMOKE_REDUCED=1 runs the whole app as a user with "reduce motion" on.
  const reducedMotion = !!process.env.SMOKE_REDUCED;
  window.matchMedia = (q) => ({
    matches: reducedMotion && /prefers-reduced-motion/.test(q),
    media: q,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  });
  // Talk to the mock API (scripts/mock-api.js) if it is up; the app resolves
  // localhost:4000 automatically when it is served from :8081.
  window.fetch = (...args) => fetch(...args);
  // Boot straight into the logged-in app when a session is seeded.
  if (process.env.SMOKE_LOGGED_IN) {
    window.localStorage.setItem('tomodachi.token', 'test-token');
    // Skip the once-a-day AI greeting overlay so the test lands on the app.
    const d = new Date();
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    window.localStorage.setItem(`+one.ai-greeting.u1.${day}`, 'shown');
  }
  window.scrollTo = () => {};
  window.HTMLCanvasElement.prototype.getContext = () => null;
  // jsdom has no layout engine, so every element measures 0x0 and anything
  // gated on onLayout (the page pager, the sheets) would never render. Report
  // a plausible phone-sized box instead so real content mounts.
  const VIEW_W = Number(process.env.SMOKE_WIDTH || 390);
  const VIEW_H = Number(process.env.SMOKE_HEIGHT || 844);
  window.ResizeObserver = class {
    constructor(cb) { this.cb = cb; }
    observe(target) {
      const rect = { x: 0, y: 0, top: 0, left: 0, right: VIEW_W, bottom: VIEW_H, width: VIEW_W, height: VIEW_H };
      setTimeout(() => { try { this.cb([{ target, contentRect: rect }], this); } catch {} }, 0);
    }
    unobserve() {} disconnect() {}
  };
  window.Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return { x: 0, y: 0, top: 0, left: 0, right: VIEW_W, bottom: VIEW_H, width: VIEW_W, height: VIEW_H, toJSON() {} };
  };
  // react-native-web measures with offsetWidth/offsetHeight, which jsdom
  // always reports as 0.
  Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', { get() { return VIEW_W; }, configurable: true });
  Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', { get() { return VIEW_H; }, configurable: true });
  Object.defineProperty(window.HTMLElement.prototype, 'offsetLeft', { get() { return 0; }, configurable: true });
  Object.defineProperty(window.HTMLElement.prototype, 'offsetTop', { get() { return 0; }, configurable: true });
  Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', { get() { return null; }, configurable: true });
  Object.defineProperty(window, 'innerWidth', { value: VIEW_W, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: VIEW_H, configurable: true });
  window.navigator.vibrate = () => true;
  // Metro's HMR client would otherwise open a websocket back to the dev
  // server and confuse it; the test only cares about the rendered app.
  window.WebSocket = class { constructor() {} send() {} close() {} addEventListener() {} removeEventListener() {} };
  window.EventSource = class { constructor() {} close() {} addEventListener() {} removeEventListener() {} };
  window.speechSynthesis = {
    cancel() {}, speak() {}, pause() {}, resume() {}, getVoices: () => [],
    addEventListener() {}, removeEventListener() {},
  };
  window.SpeechSynthesisUtterance = function SpeechSynthesisUtterance(t) { this.text = t; };

  try {
    window.eval(code);
  } catch (e) {
    note('bundle threw', [e]);
  }

  // Let effects, fonts and the first paint settle.
  await new Promise((r) => setTimeout(r, 2500));

  const root = window.document.getElementById('root') || window.document.body;
  const html = window.document.body.innerHTML;
  const text = window.document.body.textContent || '';

  // ---- drive real interactions and assert on the outcome ----
  const settle = (ms = 500) => new Promise((r) => setTimeout(r, ms));
  const byLabel = (label) => window.document.querySelector(`[aria-label="${label}"]`);
  const press = (el) => {
    if (!el) return false;
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
      el.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true }));
    });
    return true;
  };
  const check = (name, ok) => { if (!ok) problems.push(`interaction failed: ${name}`); };
  /** Poll until `fn()` is truthy — screens are code-split, so "how long until
   *  it appears" is not a fixed number. */
  const waitFor = async (fn, timeout = 4000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (fn()) return true;
      await settle(100);
    }
    return false;
  };
  const bodyText = () => window.document.body.textContent || '';

  const clickable = [...window.document.querySelectorAll('[role="button"], button')];

  // like → the control must flip to the "Unlike" state (icon morph + count)
  if (byLabel('Like')) {
    press(byLabel('Like'));
    check('like toggles to Unlike', await waitFor(() => !!byLabel('Unlike')));
  }

  // follow → the pill must report the opposite action afterwards
  const followBtn = [...window.document.querySelectorAll('[aria-label^="Follow "]')][0];
  if (followBtn) {
    const before = followBtn.getAttribute('aria-label');
    press(followBtn);
    const changed = await waitFor(() => {
      const after = [...window.document.querySelectorAll('[aria-label^="Follow "], [aria-label^="Unfollow "]')]
        .map((e) => e.getAttribute('aria-label'));
      return !after.includes(before) || after.length === 0;
    });
    check('follow changes state', changed);
  }

  // tab bar → switching to Chats must bring the conversation list in
  if (byLabel('Chats')) {
    press(byLabel('Chats'));
    check('chats tab shows conversations',
      await waitFor(() => /Grace Hopper|Katherine Johnson/.test(bodyText())));
  }

  // open a conversation → the thread and its composer must appear
  const chatRow = [...window.document.querySelectorAll('[aria-label^="Open chat with"]')][0]
    || [...window.document.querySelectorAll('[role="button"], button')]
      .find((el) => /Grace Hopper|Katherine Johnson/.test(el.textContent || ''));
  if (process.env.SMOKE_DUMP) console.log('chatRow found:', !!chatRow, window.document.querySelectorAll('[aria-label^="Open chat with"]').length);
  if (chatRow) {
    press(chatRow);
    const inThread = await waitFor(() => /long-pressing this bubble|Message 0 in/i.test(bodyText()));
    check('chat row opens the conversation', inThread);

    // long-press a bubble → the action menu must open
    if (inThread) {
      // Bottom-anchored chat list (see ConversationScreen): the newest
      // message must render immediately and NO programmatic corrective
      // scroll may have happened anywhere in the thread — the old build
      // rendered from the top and scrollToEnd'd on content-size changes,
      // which users saw as "chat opens at the top, then scrolls down".
      // (jsdom has no layout engine, so position assertions live in the
      // source-level regression test instead: scripts/check-chat-anchor.mjs)
      const touched = [...window.document.querySelectorAll('div')]
        .filter((el) => /overflow(-y)?:\s*(auto|scroll)/.test(el.getAttribute('style') || ''))
        .some((el) => (el.scrollTop ?? 0) > 1);
      check('no corrective scroll ran while opening the chat', !touched);
      check('newest message is rendered', /Message 2/.test(bodyText()));

      const bubble = [...window.document.querySelectorAll('div')]
        .find((el) => (el.textContent || '').trim() === 'Try long-pressing this bubble.');
      // Synthesised long-press: hold past delayLongPress, then release.
      // Retried a couple of times — the press timer competes with whatever
      // else the app is doing on its first frames.
      const menuOpen = () => /Reply|Forward|Star message/.test(bodyText());
      let opened = false;
      for (let attempt = 0; bubble && !opened && attempt < 3; attempt += 1) {
        bubble.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
        bubble.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        await settle(700);
        bubble.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, cancelable: true }));
        bubble.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        opened = await waitFor(menuOpen, 1500);
      }
      if (bubble) check('long-press opens the message menu', opened);
    }
    // Return to the inbox so subsequent tab flows start from Home
    if (byLabel('Back')) {
      press(byLabel('Back'));
      await waitFor(() => /Grace Hopper|Katherine Johnson/.test(bodyText()));
    }
  }

  // ---- GC flow: GC tab → tap joined GC → GC Chat directly (not GC detail)
  // → tap chat header → GC Detail → back to GC Chat → back to GC List.
  // The normal Chats inbox must remain exactly as it was (no GC rows, no GC messages).
  if (byLabel('GC')) {
    press(byLabel('GC'));
    const gcListShown = await waitFor(() => /Gaming Hub/.test(bodyText()));
    check('GC tab shows GC list', gcListShown);

    const gcRow = [...window.document.querySelectorAll('[aria-label^="Open GC "]')][0]
      || [...window.document.querySelectorAll('[role="button"], button')]
        .find((el) => /Gaming Hub/.test(el.textContent || ''));
    if (gcRow) {
      press(gcRow);
      const gcChatShown = await waitFor(() => /GC-only message check\./.test(bodyText()));
      check('GC row opens GC Chat directly (not GC Detail)', gcChatShown);
      check('GC chat header identifies the group', /members/i.test(bodyText()));
      check('GC chat shows no direct-chat content', !/Try long-pressing this bubble/.test(bodyText()));

      // Tap GC chat header to open GC profile / description / details
      const gcHeader = [...window.document.querySelectorAll('[aria-label^="GC Gaming Hub"]')][0]
        || [...window.document.querySelectorAll('[role="button"], button')]
          .find((el) => /Gaming Hub.*members/i.test(el.textContent || '') || el.textContent?.trim() === 'Gaming Hub');
      if (gcHeader) {
        press(gcHeader);
        const detailShown = await waitFor(() => /GC ·|MEMBERS|GC rules/i.test(bodyText()));
        check('GC chat header opens GC Detail', detailShown);

        // Back from GC details returns to GC chat
        const backToChat = byLabel('Back to GC') || byLabel('Back to GCs') || byLabel('Back');
        if (backToChat) {
          press(backToChat);
          const backInChat = await waitFor(() => /GC-only message check\./.test(bodyText()));
          check('GC detail back returns to GC chat', backInChat);
        }
      }

      // Back from GC chat returns to GC list
      const backToGcList = byLabel('Back to GC') || byLabel('Back to GCs');
      if (backToGcList) {
        press(backToGcList);
        const backInList = await waitFor(() => /Gaming Hub/.test(bodyText()) && !/GC-only message check\./.test(bodyText()));
        check('GC chat back returns to GC list', backInList);
      }
    }

    // Back to Chats: the three direct chats must still be listed. (Strict
    // "GC rows never enter /api/chats / Chats state" assertions live in the
    // server-side gc-isolation suite; the page pager keeps neighbour pages
    // in the DOM, so whole-body text here would see the GC pane too.)
    press(byLabel('Chats'));
    check('Chats still lists the direct chats after GC flow',
      await waitFor(() => /Grace Hopper/.test(bodyText()) && /Katherine Johnson/.test(bodyText())));
    check('Chats tab shows a real direct chat thread list',
      !!byLabel('Open chat with Grace Hopper') || [...window.document.querySelectorAll('[aria-label^="Open chat with"]')].length >= 3);
  }

  // ---- Find One (find +ones): the +one indicator must render at the START
  // of each person row — before the avatar, name and handle — at every width.
  const findOneEntry = byLabel('find +ones');
  if (findOneEntry) {
    press(findOneEntry);
    const findOneShown = await waitFor(() => /Grace Hopper/.test(bodyText())
      && !!window.document.querySelector('[aria-label="Send +one request"], [aria-label="Request sent"], [aria-label="Already connected"]'));
    check('find +ones opens the Find One list', findOneShown);

    const plusOnes = [...window.document.querySelectorAll(
      '[aria-label="Send +one request"], [aria-label="Request sent"], [aria-label="Already connected"]',
    )];
    check('Find One rows render a +one indicator', plusOnes.length > 0);
    for (const indicator of plusOnes) {
      const row = indicator.parentElement;
      const kids = row ? [...row.children] : [];
      const leading = kids.indexOf(indicator) === 0
        && !(kids.slice(0, kids.indexOf(indicator)).map((k) => k.textContent).join('').trim());
      check(`+one indicator precedes the row content ("${(row?.textContent || '').trim().slice(0, 40)}")`, leading);
    }
  }

  // press everything else that is still on screen; nothing may throw
  for (const el of clickable.slice(0, 20)) {
    try { press(el); } catch (e) { note('interaction', [e]); }
  }
  await new Promise((r) => setTimeout(r, 900));

  const rendered = html.length;
  console.log(`rendered ${rendered} bytes of DOM, ${clickable.length} pressable targets`);
  const clean = text.replace(/BESbswy/g, '').replace(/\s+/g, ' ').trim();
  console.log(`text sample: ${clean.slice(0, 700)}`);

  if (rendered < 500) problems.push(`app rendered almost nothing (${rendered} bytes)`);
  if (process.env.SMOKE_DUMP) {
    require('fs').writeFileSync('/tmp/smoke-dom.html', html);
    console.log('dumped /tmp/smoke-dom.html');
  }

  const unique = [...new Set(problems)];
  if (unique.length) {
    console.log(`\n${unique.length} problem(s):`);
    unique.slice(0, 25).forEach((p) => console.log(' - ' + p));
    process.exitCode = 1;
  } else {
    console.log('\nno errors, no warnings, interactions dispatched cleanly');
  }
  window.close();
})().catch((e) => { console.error('smoke runner failed:', e); process.exitCode = 2; });
