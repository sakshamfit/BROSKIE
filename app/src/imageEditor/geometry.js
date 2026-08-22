/**
 * +one — pure image-editor geometry.
 *
 * No platform imports here on purpose: every function is deterministic and
 * unit-tested with Node's built-in test runner, independent of Expo.
 */

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Normalise any degree value into [0, 360). */
export function normalizeRotation(deg) {
  return ((Math.round(deg || 0) % 360) + 360) % 360;
}

/** Rotate an (x, y) point clockwise by `deg` degrees. */
export function rotatePointClockwise(deg, x, y) {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [x * c + y * s, -x * s + y * c];
}

/** Size of an image after being rotated clockwise by `deg` (90° steps). */
export function rotatedSize(width, height, rotation) {
  const n = normalizeRotation(rotation);
  return n % 180 === 0
    ? { width, height }
    : { width: height, height: width };
}

/** Fit a rect of the given aspect inside a max box without exceeding it. */
export function fitRect(maxW, maxH, aspect) {
  let w = maxW;
  let h = w / aspect;
  if (h > maxH) {
    h = maxH;
    w = h * aspect;
  }
  return { width: w, height: h };
}

/**
 * Convert the on-screen transform (zoom, pan, rotation) into a crop rectangle
 * expressed in the *rotated* image's pixel space — exactly what the user sees
 * inside the crop frame.
 *
 * The image is always "cover" fitted into the frame (min zoom = 1), so the
 * result never contains blank/letterboxed edges.
 */
export function computeCrop({ width, height, rotation, zoom, tx, ty, frame }) {
  const { width: rw, height: rh } = rotatedSize(width, height, rotation);
  const sFit = Math.max(frame.width / rw, frame.height / rh);
  const sRender = sFit * Math.max(zoom, 1);

  const sw = Math.min(rw, frame.width / sRender);
  const sh = Math.min(rh, frame.height / sRender);
  const sx = rw / 2 - (frame.width / 2 + tx) / sRender;
  const sy = rh / 2 - (frame.height / 2 + ty) / sRender;

  // Clamp the window's origin so the crop never escapes the image, even if a
  // stray floating-point pan pushes the transform out of range.
  const originX = clamp(Math.round(clamp(sx, 0, rw - sw)), 0, rw - 1);
  const originY = clamp(Math.round(clamp(sy, 0, rh - sh)), 0, rh - 1);
  const widthCrop = clamp(Math.round(sw), 1, rw - originX);
  const heightCrop = clamp(Math.round(sh), 1, rh - originY);

  return { originX, originY, width: widthCrop, height: heightCrop };
}

/** Cap the long edge of a size while preserving aspect ratio. */
export function capSize(w, h, maxDimension) {
  const width = Math.max(1, Math.round(w));
  const height = Math.max(1, Math.round(h));
  const longEdge = Math.max(width, height);
  if (longEdge <= maxDimension) return { width, height };
  const k = maxDimension / longEdge;
  return {
    width: Math.max(1, Math.round(width * k)),
    height: Math.max(1, Math.round(height * k)),
  };
}
