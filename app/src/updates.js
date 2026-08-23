import { AppState, Platform } from 'react-native';
import { useCallback, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';

import appConfig from '../app.json';

/**
 * Update centre — one shared, platform-aware brain for "is there a newer +one
 * and how do I get it right now?".
 *
 * Native (EAS Update / expo-updates)
 *   check   → Updates.checkForUpdateAsync()
 *   fetch   → Updates.fetchUpdateAsync()   (downloads the new JS bundle)
 *   apply   → Updates.reloadAsync()        (restarts into the new bundle)
 *
 *   Expo only *activates* a downloaded update on the next cold start, which is
 *   exactly why the app felt like it "never updates": people leave the app in
 *   the background for weeks and never truly relaunch it. So we (a) apply
 *   pending updates ourselves when the app comes back to the foreground, and
 *   (b) expose an explicit "Update now" button that downloads *and* restarts
 *   immediately.
 *
 * Web / PWA
 *   There is no OTA bundle — the "update" is the newly deployed static build.
 *   We detect it by re-fetching index.html with caching disabled and comparing
 *   the hashed Expo bundle filename with the one this tab is running. Applying
 *   it means: unregister service workers, wipe CacheStorage, then reload with a
 *   cache-busting parameter so no stale HTML/JS can survive.
 *
 * The module is framework-free (plain observable store) so App.js can drive
 * background checks and Settings can render live status from the same state.
 */

/* ------------------------------------------------------------------ */
/* constants                                                           */
/* ------------------------------------------------------------------ */

// Bump on every web release that must retire stale PWA/browser caches.
export const WEB_BUILD = '2026-08-20-update-center-v1';

const AUTO_KEY = '+one.auto-update';
const LAST_CHECK_KEY = '+one.update-last-check';
const CACHE_BUST_PARAM = 'u';

/** Foreground checks are throttled so app switching doesn't hammer the CDN. */
const CHECK_THROTTLE_MS = 15 * 60 * 1000;

export const APP_VERSION = appConfig?.expo?.version || '1.0.0';
export const BUILD_NUMBER = Platform.select({
  ios: String(appConfig?.expo?.ios?.buildNumber ?? ''),
  android: String(appConfig?.expo?.android?.versionCode ?? ''),
  default: '',
});

/** True when this binary can actually receive OTA updates. */
export const nativeUpdatesEnabled =
  Platform.OS !== 'web' && !__DEV__ && !!Updates.isEnabled;

/* ------------------------------------------------------------------ */
/* observable store                                                    */
/* ------------------------------------------------------------------ */

/**
 * status:
 *   'idle'        nothing known yet
 *   'checking'    asking the update server
 *   'downloading' pulling the new bundle
 *   'ready'       downloaded / detected — restart to run it
 *   'current'     confirmed up to date
 *   'error'       last attempt failed (see `error`)
 *   'unsupported' this build can't self-update (Expo Go / dev client)
 */
let state = {
  status: nativeUpdatesEnabled || Platform.OS === 'web' ? 'idle' : 'unsupported',
  error: '',
  lastCheckedAt: null,
  // A bundle downloaded in an earlier session but not yet launched into.
  pending: nativeUpdatesEnabled ? !!Updates.isUpdatePending : false,
  autoInstall: true,
  busy: false,
  applying: false,
  // Web only: false when the running/deployed bundles can't be fingerprinted
  // (dev server, non-Expo host), so "up to date" would be a guess.
  detectable: true,
};

const listeners = new Set();

function emit() {
  listeners.forEach((fn) => {
    try { fn(state); } catch { /* a bad subscriber must not break the rest */ }
  });
}

function setState(patch) {
  const next = { ...state, ...patch };
  const changed = Object.keys(next).some((key) => next[key] !== state[key]);
  if (!changed) return;
  state = next;
  emit();
}

export function getUpdateState() {
  return state;
}

export function subscribeToUpdates(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/* ------------------------------------------------------------------ */
/* persistence                                                         */
/* ------------------------------------------------------------------ */

async function rememberCheckTime(at) {
  setState({ lastCheckedAt: at });
  try { await AsyncStorage.setItem(LAST_CHECK_KEY, String(at)); } catch { /* non-fatal */ }
}

/** Load persisted preferences. Safe to call more than once. */
let hydrated = false;
export async function hydrateUpdatePrefs() {
  if (hydrated) return;
  hydrated = true;
  try {
    const [auto, last] = await Promise.all([
      AsyncStorage.getItem(AUTO_KEY),
      AsyncStorage.getItem(LAST_CHECK_KEY),
    ]);
    setState({
      autoInstall: auto === null ? true : auto === '1',
      lastCheckedAt: last ? Number(last) || null : null,
    });
  } catch {
    /* defaults are fine */
  }
}

export async function setAutoInstall(value) {
  setState({ autoInstall: !!value });
  try { await AsyncStorage.setItem(AUTO_KEY, value ? '1' : '0'); } catch { /* non-fatal */ }
}

/* ------------------------------------------------------------------ */
/* web helpers                                                         */
/* ------------------------------------------------------------------ */

const isWeb = Platform.OS === 'web';
const hasDom = () => isWeb && typeof window !== 'undefined' && typeof document !== 'undefined';

/** Hashed Expo web bundles look like /_expo/static/js/web/entry-<hash>.js */
const BUNDLE_RE = /_expo\/static\/js\/web\/[A-Za-z0-9._-]+\.js/g;

function fingerprintFrom(text) {
  const found = String(text || '').match(BUNDLE_RE);
  if (!found || !found.length) return null;
  return Array.from(new Set(found.map((src) => src.split('/').pop()))).sort().join('|');
}

function runningWebFingerprint() {
  if (!hasDom()) return null;
  const sources = Array.from(document.querySelectorAll('script[src]'))
    .map((node) => node.getAttribute('src') || '')
    .join(' ');
  return fingerprintFrom(sources);
}

async function deployedWebFingerprint() {
  if (!hasDom()) return null;
  const url = new URL(window.location.href);
  // Always ask the origin, never the (possibly stale) HTTP cache.
  url.searchParams.set('_updateCheck', String(Date.now()));
  const res = await fetch(url.toString(), {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
  });
  if (!res.ok) throw new Error(`Update check failed (${res.status})`);
  return fingerprintFrom(await res.text());
}

/** Remove every service worker + CacheStorage entry this origin owns. */
async function purgeWebCaches() {
  if (!hasDom()) return;
  try {
    const registrations = (await window.navigator?.serviceWorker?.getRegistrations?.()) || [];
    await Promise.all(registrations.map((registration) => registration.unregister().catch(() => false)));
  } catch { /* browsers without SW support */ }
  try {
    const keys = (await window.caches?.keys?.()) || [];
    await Promise.all(keys.map((key) => window.caches.delete(key).catch(() => false)));
  } catch { /* private mode can throw */ }
  try { window.localStorage?.removeItem('+one.web-build'); } catch { /* ignore */ }
}

/** Hard reload onto a URL the browser cannot answer from cache. */
function hardReload() {
  if (!hasDom()) return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('_updateCheck');
    url.searchParams.set(CACHE_BUST_PARAM, Date.now().toString(36));
    window.location.replace(url.toString());
  } catch {
    window.location.reload();
  }
}

/**
 * Drop the cache-busting parameter from the address bar after a reload so the
 * URL stays shareable. Called once at startup.
 */
export function tidyUpdateUrl() {
  if (!hasDom()) return;
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(CACHE_BUST_PARAM) && !url.searchParams.has('_updateCheck')) return;
    url.searchParams.delete(CACHE_BUST_PARAM);
    url.searchParams.delete('_updateCheck');
    window.history?.replaceState?.({}, '', url.pathname + url.search + url.hash);
  } catch { /* ignore */ }
}

/* ------------------------------------------------------------------ */
/* check / download / apply                                            */
/* ------------------------------------------------------------------ */

let inFlight = null;

/**
 * Look for a newer release.
 *
 * @param {object}  options
 * @param {boolean} options.download  also fetch the bundle when one is found
 * @param {boolean} options.silent    background call — don't surface errors
 * @returns {Promise<boolean>} true when an update is ready/available
 */
export async function checkForUpdate({ download = true, silent = false } = {}) {
  if (state.status === 'unsupported') return false;
  if (inFlight) return inFlight;

  const run = async () => {
    setState({ status: 'checking', busy: true, error: silent ? state.error : '' });
    try {
      if (isWeb) {
        const running = runningWebFingerprint();
        const deployed = await deployedWebFingerprint();
        await rememberCheckTime(Date.now());
        // When the page was opened from a file/dev server we can't fingerprint;
        // treat that as "unknown" rather than lying about being up to date.
        const conclusive = !!running && !!deployed;
        const available = conclusive && running !== deployed;
        setState({
          status: available ? 'ready' : 'current',
          pending: available,
          detectable: conclusive,
          busy: false,
          error: '',
        });
        return available;
      }

      const result = await Updates.checkForUpdateAsync();
      await rememberCheckTime(Date.now());
      if (!result.isAvailable) {
        setState({ status: state.pending ? 'ready' : 'current', busy: false, error: '' });
        return state.pending;
      }
      if (!download) {
        setState({ status: 'ready', pending: true, busy: false, error: '' });
        return true;
      }
      setState({ status: 'downloading' });
      const fetched = await Updates.fetchUpdateAsync();
      const ready = !!fetched?.isNew || state.pending;
      setState({
        status: ready ? 'ready' : 'current',
        pending: ready,
        busy: false,
        error: '',
      });
      return ready;
    } catch (error) {
      const message = error?.message || 'Could not reach the update server.';
      setState({
        status: silent && state.status !== 'error' ? (state.pending ? 'ready' : 'idle') : 'error',
        busy: false,
        error: silent ? '' : message,
      });
      if (!silent) throw error;
      return false;
    } finally {
      inFlight = null;
    }
  };

  inFlight = run();
  return inFlight;
}

/** Restart into the already-downloaded update. */
export async function applyUpdate() {
  if (isWeb) {
    setState({ applying: true });
    await purgeWebCaches();
    hardReload();
    return true;
  }
  if (!nativeUpdatesEnabled) return false;
  setState({ applying: true });
  try {
    await Updates.reloadAsync();
    return true;
  } catch (error) {
    setState({ applying: false, status: 'error', error: error?.message || 'Restart failed.' });
    return false;
  }
}

/**
 * The one-tap path behind the Settings button: find the newest release,
 * download it, and restart straight into it.
 *
 * @returns {Promise<'updated'|'current'|'error'>}
 */
export async function updateNow() {
  if (state.status === 'unsupported') return 'current';
  try {
    const ready = state.pending ? true : await checkForUpdate({ download: true, silent: false });
    if (!ready) {
      // On web we can't always tell old from new (dev server, custom host).
      // Rather than claim "up to date" and do nothing — which is exactly the
      // complaint this screen exists to fix — purge caches and reload.
      if (isWeb && !state.detectable) {
        await applyUpdate();
        return 'updated';
      }
      return 'current';
    }
    await applyUpdate();
    return 'updated';
  } catch {
    return 'error';
  }
}

/* ------------------------------------------------------------------ */
/* background lifecycle                                                */
/* ------------------------------------------------------------------ */

let lifecycleStarted = false;

/**
 * Start silent background checks.
 *
 * Runs on launch and on every return to the foreground. When a bundle is ready
 * and auto-install is on, it is applied the moment the user comes back from the
 * background — never mid-session, so nothing is interrupted while typing.
 */
export function startUpdateLifecycle() {
  if (lifecycleStarted) return () => {};
  lifecycleStarted = true;

  hydrateUpdatePrefs();
  tidyUpdateUrl();

  if (state.status === 'unsupported') return () => {};

  let lastCheck = 0;
  let leftForegroundAt = 0;

  // Reloading a browser tab throws away anything half-typed, so the web build
  // only self-applies after the tab has genuinely been away for a while.
  const WEB_IDLE_BEFORE_RELOAD_MS = 5 * 60 * 1000;

  const maybeCheck = async () => {
    const now = Date.now();
    if (now - lastCheck < CHECK_THROTTLE_MS) return;
    lastCheck = now;
    await checkForUpdate({ download: true, silent: true });
  };

  const onForeground = async () => {
    const awayFor = leftForegroundAt ? Date.now() - leftForegroundAt : 0;
    leftForegroundAt = 0;
    // A bundle downloaded during an earlier session is installed on the way
    // back in — the one moment a restart is invisible to the user. Anything
    // downloaded during *this* foreground pass waits for the next return.
    const returning = awayFor > 0 && (!isWeb || awayFor > WEB_IDLE_BEFORE_RELOAD_MS);
    if (returning && state.pending && state.autoInstall && !state.applying) {
      await applyUpdate();
      return;
    }
    await maybeCheck();
  };

  maybeCheck();

  const subscription = AppState.addEventListener('change', (next) => {
    if (next === 'active') onForeground();
    else if (!leftForegroundAt) leftForegroundAt = Date.now();
  });

  return () => {
    subscription.remove();
    lifecycleStarted = false;
  };
}

/* ------------------------------------------------------------------ */
/* react binding                                                       */
/* ------------------------------------------------------------------ */

export function useAppUpdates() {
  const subscribe = useCallback((fn) => subscribeToUpdates(fn), []);
  return useSyncExternalStore(subscribe, getUpdateState, getUpdateState);
}

/** Human summary of what's currently installed. */
export function describeInstalled() {
  const parts = [`VERSION ${APP_VERSION}`];
  if (BUILD_NUMBER) parts.push(`BUILD ${BUILD_NUMBER}`);
  if (isWeb) {
    parts.push('WEB');
  } else if (nativeUpdatesEnabled) {
    const id = Updates.updateId ? Updates.updateId.slice(0, 8).toUpperCase() : 'EMBEDDED';
    parts.push(`BUNDLE ${id}`);
    if (Updates.channel) parts.push(Updates.channel.toUpperCase());
  } else {
    parts.push('DEVELOPMENT');
  }
  return parts.join(' · ');
}

/** "2 minutes ago" style stamp for the last successful check. */
export function describeLastChecked(at) {
  if (!at) return 'NEVER CHECKED';
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return 'CHECKED JUST NOW';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `CHECKED ${minutes} MIN AGO`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `CHECKED ${hours} HR AGO`;
  const days = Math.round(hours / 24);
  return `CHECKED ${days} DAY${days === 1 ? '' : 'S'} AGO`;
}
