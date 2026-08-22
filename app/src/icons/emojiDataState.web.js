import { useEffect, useState } from 'react';

/**
 * Web emoji-data accessor.
 *
 * The full Twemoji path table is ~3.8 MB of packed JSON (4000+ emoji) — far
 * too heavy for the app shell's first paint. On web it stays in its own
 * async chunk: components render without it (falling back to the system
 * glyph for a beat) and swap to the vector art as soon as the chunk arrives.
 */
let data = null;
let promise = null;
let failed = false;

export function getEmojiData() {
  return data;
}

export function loadEmojiData() {
  if (data) return Promise.resolve(data);
  if (!promise) {
    promise = import('./emojiData.json').then((mod) => {
      data = mod.default || mod;
      failed = false;
      return data;
    }).catch((error) => {
      failed = true;
      promise = null;
      throw error;
    });
  }
  return promise;
}

export function useEmojiDataState() {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (getEmojiData() || failed) return undefined;
    let active = true;
    loadEmojiData()
      .then(() => { if (active) setTick((n) => n + 1); })
      .catch(() => { if (active) setTick((n) => n + 1); });
    return () => { active = false; };
  }, []);
  return { data: getEmojiData(), ready: !!getEmojiData() || failed };
}
