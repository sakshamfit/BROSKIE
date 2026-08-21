/* Call video surface — NATIVE: react-native-webrtc's RTCView. Streams carry
 * a toURL() handle the native view renders; video calls were signalling-only
 * on Android/iOS before Phase 3 and are now live. */
import React from 'react';
import { StreamView } from '../webrtc/rtc.native';

export function RemoteVideo({ stream, style }) {
  return <StreamView stream={stream} style={style} objectFit="cover" />;
}

export function LocalVideo({ stream, style }) {
  return <StreamView stream={stream} muted style={style} objectFit="cover" />;
}
