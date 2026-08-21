/* WebRTC adapter — WEB.
 * The browser's native RTCPeerConnection/getUserMedia. The native twin of
 * this file (rtc.native.js) uses react-native-webrtc instead; ChatContext
 * only ever talks to this interface, so calls work identically on both. */

export const supported = typeof window !== 'undefined' && !!window.RTCPeerConnection;

export function createPeerConnection(config) {
  return new window.RTCPeerConnection(config);
}

export async function getUserMedia(constraints) {
  return window.navigator.mediaDevices.getUserMedia(constraints);
}

export const SessionDescription = (sdp) => new window.RTCSessionDescription(sdp);
export const IceCandidate = (candidate) => new window.RTCIceCandidate(candidate);
