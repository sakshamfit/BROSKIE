import { useEffect, useRef, useState } from 'react';

/**
 * Small rate-limiting primitives shared across the app.
 *
 * - `debounce(fn, wait)`  — trailing edge: `fn` runs only after `wait` ms of
 *   silence, so a fast typist fires one network call instead of one per
 *   keystroke. Perfect for server search, availability checks, drafts.
 * - `throttle(fn, wait)`  — at most one `fn` call per `wait` ms window, so a
 *   hot event (typing indicator, scroll) degrades to a steady cadence.
 * - `useDebouncedCallback` / `useThrottledCallback` — the same, as stable
 *   React hooks that always call the latest callback and cancel their
 *   pending timer on unmount.
 *
 * Both primitives return a wrapped function with:
 *   .cancel()  — drop any pending trailing invocation
 *   .flush()   — run the pending invocation immediately (debounce only)
 *   .pending() — is a trailing invocation scheduled?
 */

export function debounce(fn, wait = 250, { leading = false } = {}) {
  let timer = null;
  let lastInvokeAt = 0;
  let lastArgs = null;
  let lastThis = null;

  const invoke = () => {
    timer = null;
    lastInvokeAt = Date.now();
    fn.apply(lastThis, lastArgs);
  };

  const wrapped = function (...args) {
    lastArgs = args;
    lastThis = this;
    if (timer) clearTimeout(timer);
    const elapsed = Date.now() - lastInvokeAt;
    // Leading edge: fire immediately when idle instead of waiting out the
    // whole window (e.g. the first keystroke of a search feels instant).
    // Like lodash, a leading burst still settles with one trailing call.
    if (leading && !timer && elapsed >= wait) {
      lastInvokeAt = Date.now();
      fn.apply(this, args);
      return;
    }
    timer = setTimeout(invoke, wait);
  };

  wrapped.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  wrapped.flush = () => {
    if (timer) {
      clearTimeout(timer);
      invoke();
    }
  };
  wrapped.pending = () => timer !== null;
  return wrapped;
}

export function throttle(fn, wait = 250, { leading = true, trailing = true } = {}) {
  let timeout = null;
  let previous = 0;
  let lastArgs = null;
  let lastThis = null;

  const later = () => {
    previous = leading === false ? 0 : Date.now();
    timeout = null;
    fn.apply(lastThis, lastArgs);
  };

  const wrapped = function (...args) {
    const now = Date.now();
    if (!previous && leading === false) previous = now;
    const remaining = wait - (now - previous);
    lastArgs = args;
    lastThis = this;
    if (remaining <= 0) {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      previous = now;
      fn.apply(this, args);
    } else if (!timeout && trailing !== false) {
      timeout = setTimeout(later, remaining);
    }
  };

  wrapped.cancel = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
  };
  wrapped.pending = () => timeout !== null;
  return wrapped;
}

/**
 * Debounced callback hook. The returned function has a stable identity for
 * the life of the component (safe to hand to `onChangeText`), always invokes
 * the latest `callback` (no stale closures), and cancels any pending
 * invocation on unmount. `wait` is captured at creation time.
 */
export function useDebouncedCallback(callback, wait = 250) {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const [debounced] = useState(() =>
    debounce((...args) => callbackRef.current(...args), wait)
  );
  useEffect(() => () => debounced.cancel(), [debounced]);
  return debounced;
}

/**
 * Throttled callback hook — same guarantees as useDebouncedCallback, with
 * `options` ({ leading, trailing }) captured at creation time. Defaults to
 * leading + trailing edge, i.e. work starts immediately and a final call
 * lands after the burst settles.
 */
export function useThrottledCallback(callback, wait = 250, options = {}) {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const [throttled] = useState(() =>
    throttle((...args) => callbackRef.current(...args), wait, options)
  );
  useEffect(() => () => throttled.cancel(), [throttled]);
  return throttled;
}
