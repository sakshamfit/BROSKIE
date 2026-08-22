/**
 * +one — image editor configuration.
 *
 * Aspect-ratio presets and per-surface defaults. Every image-upload surface
 * (post, story, profile, community, chat) resolves its editor behaviour from
 * here, so there is exactly one place that decides what an editor can do.
 */

export const RATIOS = {
  original: { key: 'original', label: 'Original', note: 'As shot', aspect: null },
  square: { key: 'square', label: '1:1', note: 'Square', aspect: 1 },
  portrait: { key: 'portrait', label: '4:5', note: 'Portrait', aspect: 4 / 5 },
  landscape: { key: 'landscape', label: '16:9', note: 'Wide', aspect: 16 / 9 },
  story: { key: 'story', label: '9:16', note: 'Story', aspect: 9 / 16 },
};

export const RATIO_OPTIONS = [
  RATIOS.original,
  RATIOS.square,
  RATIOS.portrait,
  RATIOS.landscape,
  RATIOS.story,
];

const MODES = {
  // Normal Network posts: Original / 1:1 / 4:5 / 16:9.
  post: {
    title: 'Edit photo',
    ratios: [RATIOS.original, RATIOS.square, RATIOS.portrait, RATIOS.landscape],
    defaultRatio: 'original',
    allowRotation: true,
    allowZoom: true,
    allowPan: true,
    allowFreeCrop: true,
    maxDimension: 1920,
    quality: 0.86,
  },
  // Stories are vertical-first, but the user can still choose any frame.
  story: {
    title: 'Edit story',
    ratios: [RATIOS.story, RATIOS.original, RATIOS.square, RATIOS.landscape],
    defaultRatio: 'story',
    allowRotation: true,
    allowZoom: true,
    allowPan: true,
    allowFreeCrop: true,
    maxDimension: 1920,
    quality: 0.86,
  },
  // Profile avatars are always square.
  profile: {
    title: 'Edit profile photo',
    ratios: [RATIOS.square],
    defaultRatio: 'square',
    allowRotation: true,
    allowZoom: true,
    allowPan: true,
    allowFreeCrop: false,
    maxDimension: 1024,
    quality: 0.85,
  },
  // Community content reuses post framing but may keep the original crop.
  community: {
    title: 'Edit photo',
    ratios: [RATIOS.original, RATIOS.square, RATIOS.portrait, RATIOS.landscape],
    defaultRatio: 'original',
    allowRotation: true,
    allowZoom: true,
    allowPan: true,
    allowFreeCrop: true,
    maxDimension: 1920,
    quality: 0.86,
  },
  // Chat media: light-touch, original framing by default, still rotatable.
  chat: {
    title: 'Edit photo',
    ratios: [RATIOS.original],
    defaultRatio: 'original',
    allowRotation: true,
    allowZoom: true,
    allowPan: true,
    allowFreeCrop: true,
    maxDimension: 1600,
    quality: 0.82,
  },
};

export function editorConfigFor(mode) {
  return MODES[mode] || MODES.post;
}
