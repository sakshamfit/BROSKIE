import DATA from './emojiData.json';

/**
 * Native emoji-data accessor. React Native/Hermes release bundles cannot
 * use dynamic import(), and native bundles are not code-split the way web
 * bundles are, so the data stays synchronously available exactly as before.
 */
export function getEmojiData() {
  return DATA;
}

export function loadEmojiData() {
  return Promise.resolve(DATA);
}

export function useEmojiDataState() {
  return { data: DATA, ready: true };
}
