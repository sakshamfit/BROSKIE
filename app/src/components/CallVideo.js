/* Call video surface — WEB: plain <video> elements fed by MediaStreams. */
import React, { useEffect, useRef } from 'react';

/** Remote (their) video. */
export function RemoteVideo({ stream, style }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream || null;
  }, [stream]);
  // eslint-disable-next-line jsx-a11y/media-has-caption
  return <video ref={ref} autoPlay playsInline style={style} />;
}

/** Local (yours) video preview. */
export function LocalVideo({ stream, style }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream || null;
  }, [stream]);
  // eslint-disable-next-line jsx-a11y/media-has-caption
  return <video ref={ref} autoPlay playsInline muted style={style} />;
}
