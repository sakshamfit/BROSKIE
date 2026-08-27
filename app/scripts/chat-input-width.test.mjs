import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const screensDir = join(appRoot, 'src', 'screens');

const read = (...p) => readFileSync(join(appRoot, ...p), 'utf8');

const conversationSrc = read('src', 'screens', 'ConversationScreen.js');
const gcSrc = read('src', 'screens', 'GCChatScreen.js');
const networkSrc = read('src', 'screens', 'NetworkScreen.js');
const postDetailSrc = read('src', 'screens', 'PostDetailScreen.js');
const chatInputSrc = read('src', 'components', 'ChatInput.js');

/**
 * The composer width has now been "fixed" three times. Attempts 1 and 2
 * patched a style block on one screen at a time, and the assertions below
 * used to check for those exact style arrays — so the suite went green while
 * three other input surfaces stayed wrong, and the next per-screen edit
 * silently reintroduced the drift.
 *
 * These tests assert the invariant that actually prevents the bug instead:
 * there is exactly ONE input component, every message/comment surface uses
 * it, and nothing hand-rolls a competing field.
 */

test('every message and comment surface renders the shared ChatInput', () => {
  const surfaces = {
    'ConversationScreen (1:1 chat)': conversationSrc,
    'GCChatScreen (group chat)': gcSrc,
    'NetworkScreen (comment sheet)': networkSrc,
    'PostDetailScreen (post comments)': postDetailSrc,
  };
  for (const [name, src] of Object.entries(surfaces)) {
    if (!/from '\.\.\/components\/ChatInput'/.test(src)) {
      throw new Error(`${name} does not import the shared ChatInput.`);
    }
    if (!/<ChatInput[\s>]/.test(src)) {
      throw new Error(`${name} imports ChatInput but never renders it.`);
    }
  }
});

test('no screen hand-rolls its own composer row or field box any more', () => {
  const handRolled = {
    'ConversationScreen': /composerRow|composerRowWide|inputBar/.test(conversationSrc),
    'GCChatScreen': /composerRow|composerRowWide|inputBar/.test(gcSrc),
    'NetworkScreen': /commentInput/.test(networkSrc),
    'PostDetailScreen': /commentInput/.test(postDetailSrc),
  };
  const offenders = Object.keys(handRolled).filter((k) => handRolled[k]);
  if (offenders.length) {
    throw new Error(
      `${offenders.join(', ')} still define a private composer row / field box. `
      + 'Move it into components/ChatInput.js so the width cannot drift per screen.'
    );
  }
});

test('ChatInput caps the row at the shared content column and centres it', () => {
  if (!/contentMaxWidth/.test(chatInputSrc)) {
    throw new Error('ChatInput no longer derives its width cap from the shared contentMaxWidth token.');
  }
  if (!/alignSelf: 'center'/.test(chatInputSrc)) {
    throw new Error('ChatInput row is no longer centred, so wide layouts will hug one edge.');
  }
  if (!/flex: 1,\s*\n\s*minWidth: 0,/.test(chatInputSrc)) {
    throw new Error('ChatInput field lost flex:1 / minWidth:0, so long text can push the box past the row.');
  }
});

test('ChatInput is a bounded box, not a borderless strip, and cannot grow forever', () => {
  if (!/inkBox\(theme, 'ink'\)/.test(chatInputSrc)) {
    throw new Error('ChatInput lost its ink outline — it must read as a defined box.');
  }
  if (!/theme\.inputBackground \|\| theme\.cardAlt/.test(chatInputSrc)) {
    throw new Error('ChatInput lost its background fill (with the base-theme fallback).');
  }
  if (!/MESSAGE_MAX_HEIGHT/.test(chatInputSrc) || !/COMMENT_MAX_HEIGHT/.test(chatInputSrc)) {
    throw new Error('ChatInput lost its multi-line height cap; the send button could be pushed off screen.');
  }
  if (!/maxFontSizeMultiplier=\{MAX_FONT_SCALE\}/.test(chatInputSrc)) {
    throw new Error('ChatInput no longer caps OS text scaling, so the composer can reflow.');
  }
});

test('comment surfaces use the shared component too, not just the two chat screens', () => {
  for (const [name, src] of [['NetworkScreen', networkSrc], ['PostDetailScreen', postDetailSrc]]) {
    if (!/size="comment"/.test(src)) {
      throw new Error(`${name} is not rendering ChatInput at the shared comment size.`);
    }
  }
});

test('no screen re-introduces a hand-rolled composer (field + send button)', () => {
  // Form fields — search boxes, OTP entry, a post body, a profile "about"
  // editor, a GC description — are NOT message inputs and must stay plain
  // TextInputs. What must never come back is a *composer*: a multiline field
  // sitting next to a send control. That is the shape that drifted twice.
  const offenders = [];
  for (const file of readdirSync(screensDir)) {
    if (!file.endsWith('.js')) continue;
    const src = readFileSync(join(screensDir, file), 'utf8');
    if (/from '\.\.\/components\/ChatInput'/.test(src)) continue; // already consolidated
    const hasMultilineField = /<TextInput[\s\S]{0,400}?\bmultiline(\s|>|=\{true\})/.test(src);
    const hasSendControl = /name="send"|"Send message"|accessibilityLabel="Post comment"/.test(src);
    if (hasMultilineField && hasSendControl) offenders.push(file);
  }
  if (offenders.length) {
    throw new Error(
      `These screens hand-roll a composer (multiline field + send control) instead of using `
      + `ChatInput: ${offenders.join(', ')}`
    );
  }
});
