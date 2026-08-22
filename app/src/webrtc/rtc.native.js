/* WebRTC adapter — NATIVE (Android/iOS).
 * Real peer-to-peer audio/video via react-native-webrtc, which requires a
 * custom dev build / EAS build (added in Phase 3) — the ringing, accept and
 * signalling flow was already real; this adds the actual media connection.
 *
 * Differences from the browser API handled here:
 *  - permissions are requested via PermissionsAndroid before getUserMedia
 *  - SDP offer/answer payloads must be wrapped in RTCSessionDescription and
 *    candidates in RTCIceCandidate (the browser classes don't exist natively)
 *  - video renders through <RTCView streamURL={stream.toURL()}>, not <video>
 */
import { PermissionsAndroid, Platform } from 'react-native';
import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  RTCView,
  mediaDevices,
} from 'react-native-webrtc';

export const supported = Platform.OS === 'android' || Platform.OS === 'ios';

async function ensurePermissions(constraints = {}) {
  if (Platform.OS !== 'android') return;
  // Voice calls must not prompt for (or fail because of) camera access.
  const needed = [
    ...(constraints.audio ? [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] : []),
    ...(constraints.video ? [PermissionsAndroid.PERMISSIONS.CAMERA] : []),
  ];
  if (!needed.length) return;
  try {
    const granted = await PermissionsAndroid.requestMultiple(needed);
    const denied = Object.values(granted).some((v) => v !== PermissionsAndroid.RESULTS.GRANTED);
    if (denied) throw new Error('Camera and microphone permissions are needed to call');
  } catch (e) {
    if (String(e?.message || '').includes('permissions')) throw e;
    // PermissionsAndroid is a no-op outside Android — never block the call.
  }
}

export async function getUserMedia(constraints) {
  await ensurePermissions(constraints);
  return mediaDevices.getUserMedia(constraints);
}

export function createPeerConnection(config) {
  return new RTCPeerConnection(config);
}

export const SessionDescription = (sdp) => new RTCSessionDescription(sdp);
export const IceCandidate = (candidate) => new RTCIceCandidate(candidate);

/** Native video surface for a MediaStream (see CallOverlay). */
export function StreamView({ stream, muted = false, style, objectFit = 'cover' }) {
  if (!stream) return null;
  return (
    <RTCView
      streamURL={typeof stream.toURL === 'function' ? stream.toURL() : stream.id}
      muted={muted}
      style={style}
      objectFit={objectFit}
      zOrder={muted ? 1 : 0}
    />
  );
}
