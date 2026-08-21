import { AppState, Platform } from 'react-native';
import { API_URL } from '../api';

/**
 * Connectivity is a set of signals, never a single boolean that is allowed
 * to drop a message. Timeouts, socket drops, and "offline" are hints that
 * the outbox should wait and retry — not that the send never happened.
 */
export function createConnectivityManager() {
  let socketConnected = false;
  let browserOnline = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  let appState = AppState.currentState || 'active';
  let lastSuccessAt = 0;
  let lastFailureAt = 0;
  let consecutiveFailures = 0;
  let authBlockedUntil = 0;
  const listeners = new Set();
  const subs = [];

  const emit = () => {
    const snap = snapshot();
    listeners.forEach((fn) => { try { fn(snap); } catch {} });
  };

  function snapshot() {
    return {
      socketConnected,
      browserOnline,
      appState,
      lastSuccessAt,
      lastFailureAt,
      consecutiveFailures,
      authBlocked: Date.now() < authBlockedUntil,
      // Hint only. Outbox still tries; this just avoids hammering a dead link.
      likelyOnline: browserOnline && (socketConnected || consecutiveFailures < 2),
    };
  }

  function setSocketConnected(value) {
    const next = !!value;
    if (socketConnected === next) return;
    socketConnected = next;
    if (next) {
      consecutiveFailures = 0;
      lastSuccessAt = Date.now();
    }
    emit();
  }

  function noteHttpSuccess() {
    lastSuccessAt = Date.now();
    consecutiveFailures = 0;
    emit();
  }

  function noteHttpFailure() {
    lastFailureAt = Date.now();
    consecutiveFailures += 1;
    emit();
  }

  function noteAuthFailure() {
    authBlockedUntil = Date.now() + 15_000;
    emit();
  }

  function clearAuthFailure() {
    if (!authBlockedUntil) return;
    authBlockedUntil = 0;
    emit();
  }

  async function probe() {
    try {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = setTimeout(() => controller?.abort(), 4000);
      const response = await fetch(`${API_URL || ''}/api/health`, {
        method: 'GET',
        cache: 'no-store',
        signal: controller?.signal,
      });
      clearTimeout(timer);
      if (response.ok) noteHttpSuccess();
      else noteHttpFailure();
      return response.ok;
    } catch {
      noteHttpFailure();
      return false;
    }
  }

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const onOnline = () => { browserOnline = true; emit(); };
    const onOffline = () => { browserOnline = false; emit(); };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    subs.push(() => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    });
  }

  const appSub = AppState.addEventListener('change', (next) => {
    appState = next;
    emit();
  });
  subs.push(() => appSub.remove());

  return {
    snapshot,
    setSocketConnected,
    noteHttpSuccess,
    noteHttpFailure,
    noteAuthFailure,
    clearAuthFailure,
    probe,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    dispose() {
      listeners.clear();
      subs.forEach((off) => { try { off(); } catch {} });
    },
  };
}
