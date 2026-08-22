/**
 * +one — universal image processing service.
 *
 * This is the single source of truth for every image-editing concern in the
 * app: picking, EXIF/orientation normalisation, preview generation, the
 * zoom/pan/rotate → crop math, and the final processed-file export.
 *
 * Everything runs locally (before any network call) so slow connections never
 * pay for an un-cropped upload, and the user's original file is never touched:
 * the manipulator always writes brand-new files.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { capSize, normalizeRotation } from './geometry';

export * from './geometry';

/** Preview images are capped so huge camera photos decode quickly on screen. */
const PREVIEW_MAX = 1600;

/** Highest allowed zoom multiplier (relative to "fit"). */
export const MAX_ZOOM = 6;
/** Zoom level a double-tap jumps to. */
export const DOUBLE_TAP_ZOOM = 2.6;

/* ------------------------------------------------------------------ */
/* picking                                                             */
/* ------------------------------------------------------------------ */

/**
 * Open the system photo library. Full quality, no native crop — we crop
 * ourselves in the universal editor so the experience is identical on every
 * platform.
 */
export async function pickImageFromLibrary() {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
    allowsEditing: false,
    presentationStyle: 'fullScreen',
  });
  if (result.canceled || !result.assets || !result.assets.length) return null;
  return result.assets[0];
}

/* ------------------------------------------------------------------ */
/* preparation & measurement                                           */
/* ------------------------------------------------------------------ */

/**
 * Prepare an image for editing.
 *
 * The manipulator bakes EXIF orientation into its output on every platform
 * (iOS `ImageFixOrientationTransformer`, Android's oriented image loader, and
 * the browser's orientation-aware `naturalWidth/Height`), so we measure the
 * *displayed* dimensions once and use an orientation-corrected preview for the
 * canvas. All later crop math is therefore EXIF-free and identical on iOS,
 * Android and web.
 *
 * @returns {{ uri, width, height, previewUri }}
 */
export async function prepareImage(uri) {
  const source = ImageManipulator.manipulate(uri);
  let full;
  try {
    full = await source.renderAsync();
  } catch (e) {
    source.release?.();
    throw e;
  }
  // Read the oriented dimensions, then free the full-resolution bitmap before
  // decoding the (much smaller) preview so memory peaks stay low.
  const width = full.width;
  const height = full.height;
  full.release?.();
  source.release?.();

  const longEdge = Math.max(width, height, 1);
  const target = Math.min(longEdge, PREVIEW_MAX);
  const resize = width >= height ? { width: target } : { height: target };

  const previewSource = ImageManipulator.manipulate(uri);
  try {
    const previewRef = await previewSource.resize(resize).renderAsync();
    const preview = await previewRef.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
    previewRef.release?.();
    return { uri, width, height, previewUri: preview.uri };
  } finally {
    previewSource.release?.();
  }
}

/* ------------------------------------------------------------------ */
/* final processing                                                    */
/* ------------------------------------------------------------------ */

/**
 * Apply the user's framing to the ORIGINAL image (never the preview) and write
 * a compressed output file: rotate → crop → cap dimensions → save.
 */
export async function processImage({
  uri,
  rotation = 0,
  crop,
  maxDimension = 1920,
  quality = 0.86,
  format = SaveFormat.JPEG,
}) {
  const context = ImageManipulator.manipulate(uri);
  try {
    const deg = normalizeRotation(rotation);
    if (deg !== 0) context.rotate(deg);
    context.crop(crop);

    const capped = capSize(crop.width, crop.height, maxDimension);
    if (capped.width !== Math.round(crop.width) || capped.height !== Math.round(crop.height)) {
      context.resize(capped);
    }

    const ref = await context.renderAsync();
    const out = await ref.saveAsync({ format, compress: quality });
    ref.release?.();

    const ext = format === SaveFormat.PNG ? 'png' : format === SaveFormat.WEBP ? 'webp' : 'jpg';
    return {
      uri: out.uri,
      width: out.width,
      height: out.height,
      fileName: `edit-${Date.now()}.${ext}`,
      mimeType: `image/${ext}`,
    };
  } finally {
    context.release?.();
  }
}
