/**
 * Native emoji-data accessor. The compact table maps 4000+ stable Unicode
 * keys to Fluent Emoji 3D image indexes or Twemoji vector fallbacks. Require
 * it on first emoji render and cache the module object; Metro/Hermes handles
 * function-scope require() while keeping JSON parsing off the first paint.
 */
let DATA = null;

export function getEmojiData() {
  if (!DATA) {
    // eslint-disable-next-line global-require
    DATA = require('./emojiData.json');
  }
  return DATA;
}

export function loadEmojiData() {
  return Promise.resolve(getEmojiData());
}

export function useEmojiDataState() {
  return { data: getEmojiData(), ready: true };
}
