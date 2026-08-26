import emojiData from './emojiData.json';

/** Web accessor for the compact Fluent image-index/vector-fallback table. */
const data = emojiData;

export function getEmojiData() {
  return data;
}

export function loadEmojiData() {
  return Promise.resolve(data);
}

export function useEmojiDataState() {
  return { data, ready: true };
}
