/**
 * Native emoji-data accessor. The full Twemoji table is ~3.8 MB of packed
 * JSON (4000+ emoji), so we require it lazily — on first emoji render — and
 * cache the module object. Metro/Hermes handles function-scope require()
 * fine; this keeps the path-data parse cost off the app boot/first paint.
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
