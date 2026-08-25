/* Call video surface — WEB: plain <video>/<audio> elements fed by MediaStreams.
 *
 * Mobile-browser hardening (Android Chrome / iOS Safari):
 *  - The element receives the stream via srcObject and then explicitly calls
 *    play(). Relying on the autoPlay attribute alone is unreliable on iOS
 *    Safari, where srcObject is often attached after the element's autoplay
 *    evaluation has already run.
 *  - Remote audio for VOICE calls renders through a hidden <audio> element:
 *    iOS Safari frequently refuses (or delays) audio from a zero-sized,
 *    fully transparent <video>, which is exactly what the old voice-call
 *    overlay used — the call "connected" with no sound on iPhones.
 */
import React, { useEffect, useRef } from 'react';

/** Attach a MediaStream to a DOM media element and start playback. */
function useStreamMedia(ref, stream) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (el.srcObject !== (stream || null)) el.srcObject = stream || null;
    if (stream) {
      // Explicit play(): autoPlay alone misses the srcObject-after-mount case
      // on mobile Safari. Unmuted playback is unlocked by the Accept tap that
      // preceded the call, so no further gesture should be needed.
      const p = el.play?.();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
    return undefined;
  }, [ref, stream]);
}

/** Remote (their) video. */
export function RemoteVideo({ stream, style }) {
  const ref = useRef(null);
  useStreamMedia(ref, stream);
  // eslint-disable-next-line jsx-a11y/media-has-caption
  return <video ref={ref} autoPlay playsInline style={style} />;
}

/** Remote (their) audio — voice calls and voice-only fallback on web. */
export function RemoteAudio({ stream, style }) {
  const ref = useRef(null);
  useStreamMedia(ref, stream);
  // eslint-disable-next-line jsx-a11y/media-has-caption
  return <audio ref={ref} autoPlay style={style} />;
}

/** Local (yours) video preview. */
export function LocalVideo({ stream, style }) {
  const ref = useRef(null);
  useStreamMedia(ref, stream);
  // eslint-disable-next-line jsx-a11y/media-has-caption
  return <video ref={ref} autoPlay playsInline muted style={style} />;
}
