import test from 'node:test';
import assert from 'node:assert';
import { pickActiveSongPostId, SONG_SETTLE_MS } from './feedAudio.js';

const withSong = (id, index) => ({
  isViewable: true, index, item: { id, song: { previewUrl: `https://x/${id}.mp3` } },
});
const noSong = (id, index) => ({ isViewable: true, index, item: { id, song: null } });

test('nothing visible → nothing plays', () => {
  assert.strictEqual(pickActiveSongPostId([]), null);
  assert.strictEqual(pickActiveSongPostId(null), null);
  assert.strictEqual(pickActiveSongPostId(undefined), null);
});

test('no visible post has a song → nothing plays', () => {
  assert.strictEqual(pickActiveSongPostId([noSong('a', 0), noSong('b', 1)]), null);
});

test('a post with a song but no previewUrl is never chosen', () => {
  const items = [{ isViewable: true, index: 0, item: { id: 'a', song: { title: 'no url' } } }];
  assert.strictEqual(pickActiveSongPostId(items), null);
});

test('non-viewable rows are ignored even when they carry a song', () => {
  const items = [
    { ...withSong('a', 0), isViewable: false },
    withSong('b', 1),
  ];
  assert.strictEqual(pickActiveSongPostId(items), 'b');
});

test('single songed post in view plays', () => {
  assert.strictEqual(pickActiveSongPostId([withSong('a', 3)]), 'a');
});

test('THE BUG: picks the most central post, not the first one still poking in', () => {
  // Rows 4,5,6 on screen. The old `.find()` handed playback to row 4 — the one
  // scrolling off the top — while the user was looking at row 5.
  const items = [withSong('leaving', 4), withSong('centre', 5), withSong('entering', 6)];
  assert.strictEqual(pickActiveSongPostId(items), 'centre');
});

test('skips central posts that have no song and takes the nearest that does', () => {
  const items = [withSong('top', 4), noSong('middle', 5), withSong('bottom', 6)];
  // Both songed rows are equidistant from the middle → resolves upwards.
  assert.strictEqual(pickActiveSongPostId(items), 'top');
});

test('centre is measured over ALL visible rows, not only songed ones', () => {
  const items = [noSong('a', 0), noSong('b', 1), noSong('c', 2), withSong('d', 3), withSong('e', 9)];
  // Visible run 0..9 → middle 4.5; row 3 is nearer than row 9.
  assert.strictEqual(pickActiveSongPostId(items), 'd');
});

test('ties are stable — repeated calls never flicker between two rows', () => {
  const items = [withSong('x', 2), withSong('y', 3)];
  const first = pickActiveSongPostId(items);
  for (let i = 0; i < 20; i += 1) {
    assert.strictEqual(pickActiveSongPostId(items), first);
  }
});

test('input order does not change the winner', () => {
  const forward = [withSong('a', 4), withSong('b', 5), withSong('c', 6)];
  const reversed = [...forward].reverse();
  assert.strictEqual(pickActiveSongPostId(forward), pickActiveSongPostId(reversed));
});

test('scrolling one row at a time hands playback over exactly once per row', () => {
  const rows = Array.from({ length: 8 }, (_, i) => withSong(`p${i}`, i));
  const seen = [];
  for (let top = 0; top + 2 < rows.length; top += 1) {
    seen.push(pickActiveSongPostId(rows.slice(top, top + 3)));
  }
  assert.deepStrictEqual(seen, ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
});

test('settle window is short enough to feel responsive', () => {
  assert.ok(SONG_SETTLE_MS > 0 && SONG_SETTLE_MS <= 200, `got ${SONG_SETTLE_MS}ms`);
});

test('a fast fling applies ONE decision, and it is where the scroll landed', async () => {
  // Replays the debounce the feed screens use around the picker.
  let applied = [];
  let timer = null;
  const onViewable = (items) => {
    const next = pickActiveSongPostId(items);
    clearTimeout(timer);
    timer = setTimeout(() => applied.push(next), SONG_SETTLE_MS);
  };
  const rows = Array.from({ length: 12 }, (_, i) => withSong(`p${i}`, i));
  // 9 viewability callbacks in ~45ms, as a fling produces.
  for (let top = 0; top < 9; top += 1) {
    onViewable(rows.slice(top, top + 3));
    await new Promise((r) => setTimeout(r, 5));
  }
  await new Promise((r) => setTimeout(r, SONG_SETTLE_MS * 3));
  assert.deepStrictEqual(applied, ['p9'], 'only the landing post ever loads audio');
});

test('slow scrolling still hands over on every row', async () => {
  let applied = [];
  let timer = null;
  const onViewable = (items) => {
    const next = pickActiveSongPostId(items);
    clearTimeout(timer);
    timer = setTimeout(() => applied.push(next), SONG_SETTLE_MS);
  };
  const rows = Array.from({ length: 6 }, (_, i) => withSong(`p${i}`, i));
  for (let top = 0; top < 4; top += 1) {
    onViewable(rows.slice(top, top + 3));
    await new Promise((r) => setTimeout(r, SONG_SETTLE_MS * 2));
  }
  assert.deepStrictEqual(applied, ['p1', 'p2', 'p3', 'p4']);
});

test('scrolling past the last songed post stops playback', async () => {
  const items = [noSong('a', 7), noSong('b', 8)];
  assert.strictEqual(pickActiveSongPostId(items), null);
});
