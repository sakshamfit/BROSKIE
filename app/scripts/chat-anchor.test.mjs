/**
 * Source-level regression lock for the bottom-anchored chat list.
 *
 * The chat screens must use an INVERTED FlatList (newest message = index 0 at
 * the visual bottom), so opening a conversation lands directly on the latest
 * message. The old implementation rendered oldest-first from the top and
 * called scrollToEnd() from onContentSizeChange — users saw the chat open at
 * the TOP and then visibly scroll down. These checks make that pattern
 * impossible to reintroduce silently.
 *
 * Run: node --test scripts/chat-anchor.test.mjs   (also wired into ci.sh)
 */
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'screens');

const screens = [
  { file: join(root, 'ConversationScreen.js'), name: 'ConversationScreen' },
  { file: join(root, 'GCChatScreen.js'), name: 'GCChatScreen' },
];

for (const { file, name } of screens) {
  const src = readFileSync(file, 'utf8');

  test(`${name}: chat list is inverted (bottom-anchored)`, () => {
    if (!/\binverted\b/.test(src)) {
      throw new Error(`${name} no longer passes \`inverted\` to its FlatList — chats would open at the top and scroll down again.`);
    }
  });

  test(`${name}: data is ordered newest-first for the inverted list`, () => {
    if (!/\.reverse\(\)/.test(src)) {
      throw new Error(`${name} does not reverse its rows; an inverted list needs newest-first data.`);
    }
  });

  test(`${name}: no scrollToEnd correction on content-size change`, () => {
    if (/scrollToEnd\s*\(/.test(src)) {
      throw new Error(`${name} still calls scrollToEnd — that was the visible "open at top, then scroll down" jump.`);
    }
    if (/onContentSizeChange\s*=\s*\{[^}]*scroll/.test(src)) {
      throw new Error(`${name} scrolls from onContentSizeChange.`);
    }
  });

  test(`${name}: keyboard/response scroll targets offset 0 (the newest message)`, () => {
    if (!/scrollToOffset\(\{ offset: 0/.test(src)) {
      throw new Error(`${name} should scroll to offset 0 (newest) in its scrollToLatest helper.`);
    }
  });

  test(`${name}: still keeps viewport anchored across data changes`, () => {
    if (!/maintainVisibleContentPosition/.test(src)) {
      throw new Error(`${name} lost maintainVisibleContentPosition — incoming messages will jump the list.`);
    }
  });
}
