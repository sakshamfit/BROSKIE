import { Platform } from 'react-native';

function loadHtmlImage(uri) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not read image'));
    image.crossOrigin = 'anonymous';
    image.src = uri;
  });
}

function canvasToJpeg(image, maxDim, quality) {
  const w = image.naturalWidth || image.width || maxDim;
  const h = image.naturalHeight || image.height || maxDim;
  const scale = Math.min(1, maxDim / Math.max(w, h, 1));
  const width = Math.max(1, Math.round(w * scale));
  const height = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Compress an outgoing image. On web we downscale to a chat-sized JPEG and
 * produce a small thumbnail. Native keeps the already-compressed picker URI
 * (expo-image-picker quality) and reuses it as the thumbnail source so we
 * never block send on extra native modules.
 */
export async function prepareOutgoingImage(uri) {
  if (!uri) return { uri, thumbUri: null, mimeType: 'image/jpeg' };
  if (Platform.OS !== 'web' || typeof document === 'undefined') {
    return { uri, thumbUri: uri, mimeType: 'image/jpeg' };
  }
  try {
    const image = await loadHtmlImage(uri);
    const compressed = canvasToJpeg(image, 1280, 0.72);
    const thumb = canvasToJpeg(image, 320, 0.62);
    return { uri: compressed, thumbUri: thumb, mimeType: 'image/jpeg' };
  } catch {
    return { uri, thumbUri: uri, mimeType: 'image/jpeg' };
  }
}

export function guessUploadName(type, mimeType) {
  if (type === 'voice') return mimeType && mimeType.includes('webm') ? 'voice.webm' : 'voice.m4a';
  if (mimeType === 'image/png') return 'photo.png';
  if (mimeType === 'image/webp') return 'photo.webp';
  return 'photo.jpg';
}
