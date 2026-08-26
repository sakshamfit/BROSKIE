/* WebRTC adapter — WEB.
 * The browser's native RTCPeerConnection/getUserMedia. The native twin of
 * this file (rtc.native.js) uses react-native-webrtc instead; ChatContext
 * only ever talks to this interface, so calls work identically on both.
 *
 * Mobile-browser hardening (Android Chrome / iOS Safari):
 *  - `supported` requires a secure context AND navigator.mediaDevices.
 *    On http:// (or embedded webviews that omit mediaDevices) RTCPeerConnection
 *    still exists but getUserMedia does not — the old check reported "supported"
 *    and then every call crashed with a raw TypeError.
 *  - getUserMedia failures are mapped to human phrases the call overlay can
 *    show directly (permission denied, no device, device busy, bad https).
 *  - `preflightPermissions` must be called from the Accept/Call button tap:
 *    iOS Safari and Android Chrome are far more reliable at showing the
 *    microphone/camera prompt synchronously inside a user gesture, and iOS
 *    can silently stall a first-time prompt requested from a socket callback.
 */

export const supported = (() => {
  if (typeof window === 'undefined') return false;
  if (!window.RTCPeerConnection) return false;
  if (!window.navigator?.mediaDevices?.getUserMedia) return false;
  // getUserMedia is undefined on insecure origins; isSecureContext catches the
  // remaining edge cases (proxied http, some in-app webviews).
  if (window.isSecureContext === false) return false;
  return true;
})();

export function createPeerConnection(config) {
  return new window.RTCPeerConnection(config);
}

/** Map a getUserMedia rejection to a user-safe message. */
export function describeMediaError(error, constraints = {}) {
  const name = String(error?.name || '');
  const wantsVideo = !!constraints.video;
  const what = wantsVideo ? 'camera and microphone' : 'microphone';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return `${wantsVideo ? 'Camera and microphone' : 'Microphone'} access was blocked. Allow it in your browser settings, then call again.`;
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return `No ${what} was found on this device.`;
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return `Your ${what} is busy in another app or call. Close it and try again.`;
  }
  if (name === 'OverconstrainedError') {
    return 'The selected camera or microphone is not available.';
  }
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return 'Calling needs a secure (https://) connection.';
  }
  return error?.message || 'Could not start the microphone for this call.';
}

export async function getUserMedia(constraints) {
  if (typeof window === 'undefined' || !window.navigator?.mediaDevices?.getUserMedia) {
    throw new Error(describeMediaError({ name: 'NotSupportedError' }, constraints));
  }
  try {
    return await window.navigator.mediaDevices.getUserMedia(constraints);
  } catch (error) {
    // Surface the friendly phrase through .message — every call site already
    // renders e.message in the call overlay / alerts.
    throw new Error(describeMediaError(error, constraints));
  }
}

/**
 * Acquire media inside a user gesture (Accept/Call tap). ChatContext keeps the
 * returned stream and reuses it in ensurePeerConnection, so the browser asks
 * for permission exactly once, synchronously from the tap.
 */
export async function preflightPermissions(constraints) {
  if (!supported) throw new Error('Calling is not supported on this device');
  return getUserMedia(constraints);
}

export const SessionDescription = (sdp) => new window.RTCSessionDescription(sdp);
export const IceCandidate = (candidate) => new window.RTCIceCandidate(candidate);
