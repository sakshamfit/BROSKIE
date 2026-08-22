/**
 * Unit tests for the pure image-editor geometry. Run with:
 *   node --test src/imageEditor/geometry.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp,
  normalizeRotation,
  rotatePointClockwise,
  rotatedSize,
  fitRect,
  computeCrop,
  capSize,
} from './geometry.js';

const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('normalizeRotation wraps into [0, 360)', () => {
  assert.equal(normalizeRotation(0), 0);
  assert.equal(normalizeRotation(90), 90);
  assert.equal(normalizeRotation(450), 90);
  assert.equal(normalizeRotation(-90), 270);
  assert.equal(normalizeRotation(360), 0);
  assert.equal(normalizeRotation(undefined), 0);
});

test('rotatedSize swaps dimensions for 90/270 and keeps them for 0/180', () => {
  assert.deepEqual(rotatedSize(4000, 3000, 0), { width: 4000, height: 3000 });
  assert.deepEqual(rotatedSize(4000, 3000, 90), { width: 3000, height: 4000 });
  assert.deepEqual(rotatedSize(4000, 3000, 180), { width: 4000, height: 3000 });
  assert.deepEqual(rotatedSize(4000, 3000, 270), { width: 3000, height: 4000 });
});

test('rotatePointClockwise rotates cardinal points clockwise', () => {
  const [x90, y90] = rotatePointClockwise(90, 1, 0);
  assert.ok(close(x90, 0) && close(y90, -1));
  const [x180, y180] = rotatePointClockwise(180, 1, 0);
  assert.ok(close(x180, -1) && close(y180, 0));
  const [x270, y270] = rotatePointClockwise(270, 1, 0);
  assert.ok(close(x270, 0) && close(y270, 1));
});

test('fitRect never exceeds the box and honours aspect', () => {
  const wide = fitRect(400, 800, 16 / 9);
  assert.ok(wide.width <= 400 && wide.height <= 800);
  assert.ok(close(wide.width / wide.height, 16 / 9));
  const tall = fitRect(400, 800, 9 / 16);
  assert.ok(tall.width <= 400 && tall.height <= 800);
  assert.ok(close(tall.width / tall.height, 9 / 16));
  const square = fitRect(300, 300, 1);
  assert.deepEqual(square, { width: 300, height: 300 });
});

test('computeCrop returns the full image at fit for a matching aspect', () => {
  const crop = computeCrop({
    width: 1000, height: 1000, rotation: 0, zoom: 1, tx: 0, ty: 0,
    frame: { width: 500, height: 500 },
  });
  assert.deepEqual(crop, { originX: 0, originY: 0, width: 1000, height: 1000 });
});

test('computeCrop cover-crops the long side for a portrait image in a square frame', () => {
  // 1000x2000 portrait in a 500x500 frame: cover fit = max(500/1000, 500/2000)
  // = 0.5 px/px, so the visible window is a centred 1000x1000 square.
  const crop = computeCrop({
    width: 1000, height: 2000, rotation: 0, zoom: 1, tx: 0, ty: 0,
    frame: { width: 500, height: 500 },
  });
  assert.deepEqual(crop, { originX: 0, originY: 500, width: 1000, height: 1000 });
});

test('computeCrop cover-crops the short side for a landscape image in a square frame', () => {
  // 2000x1000 landscape in a 500x500 frame: cover fit = 500/1000 = 0.5 px/px,
  // width cropped to 1000 (frame 500/0.5), full height... wait height 1000*0.5=500.
  const crop = computeCrop({
    width: 2000, height: 1000, rotation: 0, zoom: 1, tx: 0, ty: 0,
    frame: { width: 500, height: 500 },
  });
  // sFit = max(500/2000, 500/1000) = 0.5. sw = 500/0.5 = 1000, sh = 500/0.5 = 1000.
  assert.deepEqual(crop, { originX: 500, originY: 0, width: 1000, height: 1000 });
});

test('computeCrop zooms into the centre at 2x', () => {
  // Square 2000x2000 in 500x500 frame: sFit=0.25, at zoom 2 sRender=0.5.
  // sw = 500/0.5 = 1000, centred origin = (2000-1000)/2 = 500.
  const crop = computeCrop({
    width: 2000, height: 2000, rotation: 0, zoom: 2, tx: 0, ty: 0,
    frame: { width: 500, height: 500 },
  });
  assert.deepEqual(crop, { originX: 500, originY: 500, width: 1000, height: 1000 });
});

test('computeCrop shifts with pan and clamps to image bounds', () => {
  // Panning the image left (tx < 0) reveals its right edge: origin clamps to
  // the far side of the window.
  const left = computeCrop({
    width: 2000, height: 2000, rotation: 0, zoom: 2, tx: -100000, ty: -100000,
    frame: { width: 500, height: 500 },
  });
  assert.deepEqual(left, { originX: 1000, originY: 1000, width: 1000, height: 1000 });

  // Panning the image right (tx > 0) reveals its left edge: origin clamps to 0.
  const right = computeCrop({
    width: 2000, height: 2000, rotation: 0, zoom: 2, tx: 100000, ty: 100000,
    frame: { width: 500, height: 500 },
  });
  assert.deepEqual(right, { originX: 0, originY: 0, width: 1000, height: 1000 });
});

test('computeCrop respects rotation (90° swaps the frame mapping)', () => {
  // A square source rotated 90° is still square: full-image crop at fit.
  const crop = computeCrop({
    width: 1000, height: 1000, rotation: 90, zoom: 1, tx: 0, ty: 0,
    frame: { width: 500, height: 500 },
  });
  assert.deepEqual(crop, { originX: 0, originY: 0, width: 1000, height: 1000 });

  // A 2000x1000 landscape rotated 90° inside a 500x500 frame behaves like a
  // 1000x2000 portrait, so the visible window is a centred 1000x1000 square.
  const rotated = computeCrop({
    width: 2000, height: 1000, rotation: 90, zoom: 1, tx: 0, ty: 0,
    frame: { width: 500, height: 500 },
  });
  assert.deepEqual(rotated, { originX: 0, originY: 500, width: 1000, height: 1000 });
});

test('computeCrop always returns a valid in-bounds rect (invariant)', () => {
  const cases = [
    { width: 4000, height: 3000, rotation: 0, zoom: 1, tx: 0, ty: 0 },
    { width: 3000, height: 4000, rotation: 90, zoom: 6, tx: 37, ty: -12 },
    { width: 4000, height: 3000, rotation: 270, zoom: 3.4, tx: -40, ty: 20 },
    { width: 800, height: 800, rotation: 180, zoom: 1.05, tx: 0, ty: 0 },
    { width: 12000, height: 9000, rotation: 0, zoom: 1, tx: 0, ty: 0 },
    { width: 500, height: 500, rotation: 0, zoom: 1, tx: 0, ty: 0 },
  ];
  const frames = [
    { width: 300, height: 300 },
    { width: 300, height: 533 }, // 9:16
    { width: 533, height: 300 }, // 16:9
    { width: 350, height: 350 },
  ];
  for (const c of cases) {
    for (const frame of frames) {
      const { width: rw, height: rh } = rotatedSize(c.width, c.height, c.rotation);
      const crop = computeCrop({ ...c, frame });
      assert.ok(crop.originX >= 0 && crop.originY >= 0, `origin negative: ${JSON.stringify(crop)}`);
      assert.ok(crop.width >= 1 && crop.height >= 1, `degenerate: ${JSON.stringify(crop)}`);
      assert.ok(crop.originX + crop.width <= rw, `x overflow: ${JSON.stringify(crop)} vs ${rw}`);
      assert.ok(crop.originY + crop.height <= rh, `y overflow: ${JSON.stringify(crop)} vs ${rh}`);
    }
  }
});

test('capSize never upscales and caps the long edge', () => {
  assert.deepEqual(capSize(500, 500, 1024), { width: 500, height: 500 });
  assert.deepEqual(capSize(4000, 3000, 1000), { width: 1000, height: 750 });
  const story = capSize(1080, 1920, 1080);
  assert.ok(story.height === 1080 && story.width === 608);
});

test('clamp bounds a value', () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-5, 0, 3), 0);
  assert.equal(clamp(1.5, 0, 3), 1.5);
});
