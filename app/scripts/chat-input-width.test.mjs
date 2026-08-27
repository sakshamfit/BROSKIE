import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'screens');

const conversationSrc = readFileSync(join(root, 'ConversationScreen.js'), 'utf8');
const gcSrc = readFileSync(join(root, 'GCChatScreen.js'), 'utf8');
const networkSrc = readFileSync(join(root, 'NetworkScreen.js'), 'utf8');
const postDetailSrc = readFileSync(join(root, 'PostDetailScreen.js'), 'utf8');

test('ConversationScreen always caps the composer row on wide layouts', () => {
  if (!/style=\{\[s\.composerRow,\s*s\.composerRowWide\]\}/.test(conversationSrc)) {
    throw new Error('Direct-chat composer is no longer using the shared 640dp width cap.');
  }
  if (/isTablet\s*&&\s*s\.composerRowWide/.test(conversationSrc)) {
    throw new Error('Direct-chat composer width is still gated on isTablet, so landscape phones can stretch edge-to-edge again.');
  }
});

test('GCChatScreen always caps the composer row on wide layouts', () => {
  if (!/style=\{\[s\.composerRow,\s*s\.composerRowWide\]\}/.test(gcSrc)) {
    throw new Error('GC composer is no longer using the shared 640dp width cap.');
  }
  if (/isTablet\s*&&\s*s\.composerRowWide/.test(gcSrc)) {
    throw new Error('GC composer width is still gated on isTablet, so landscape phones can stretch edge-to-edge again.');
  }
});

test('Network comments sheet uses the same centered 640dp row as other message-style inputs', () => {
  if (!/style=\{\[s\.commentBar,\s*s\.listWide\]\}/.test(networkSrc)) {
    throw new Error('Network comments input is missing the centered 640dp width cap.');
  }
});

test('Post detail comments remain capped on wide screens', () => {
  if (!/commentBar:\s*\{[\s\S]*maxWidth:\s*640[\s\S]*alignSelf:\s*'center'/.test(postDetailSrc)) {
    throw new Error('PostDetail comment input lost its 640dp width cap.');
  }
});
