import { useEffect, useState } from 'react';

/**
 * Web emoji-data accessor.
 *
 * The Twemoji path data is ~2.4 MB of JSON and was previously bundled
 * synchronously into the one web chunk, which made the whole app pay to
 * download/parse it before first paint. On web we keep the data in its own
 * async chunk: components render without it (using the system emoji glyph)
 * and swap to the vector art as soon as the chunk arrives.
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
