import { useEffect, useState } from 'react';
import emojiData from './emojiData.json';

/**
 * Web emoji-data accessor (statically loaded).
 */
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
