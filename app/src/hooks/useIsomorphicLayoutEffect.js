import { useEffect, useLayoutEffect } from 'react';

/**
 * useLayoutEffect on the client, useEffect on the server.
 *
 * React warns when useLayoutEffect runs during a server/static render (there
 * is no DOM to measure before paint). This hook keeps the pre-paint timing on
 * the client — where it prevents visible flashes when real window/screen
 * values replace the SSR "unknown" seed — while staying a plain passive
 * effect during server rendering.
 */
export default typeof window !== 'undefined' ? useLayoutEffect : useEffect;
