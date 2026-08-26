/**
 * One shared ~30s preview player for the whole app (feed + status).
 *
 * Instagram rules:
 *  - only one clip plays at a time
 *  - mute is global (mute on a post, the next post stays muted)
 *  - browsers that block unmuted autoplay fall back to muted, then the
 *    user can tap the speaker
 *  - native uses expo-audio; web uses HTMLAudioElement (Safari / Chrome /
 *    iOS in-app browsers all honour playsInline + muted autoplay)
 */
import { AppState, Platform } from 'react-native';

if (typeof AppState?.addEventListener === 'function') {
  AppState.addEventListener('change', (state) => {
    if (state !== 'active') pausePreview();
  });
}

let player = null;
let currentKey = null;
let muted = false;
const listeners = new Set();

function snapshot() {
  const playing = !!(player && !player._paused);
  return { key: currentKey, playing, muted };
}

function emit() {
  const snap = snapshot();
  listeners.forEach((fn) => { try { fn(snap); } catch {} });
}

export function subscribePreview(fn) {
  listeners.add(fn);
  try { fn(snapshot()); } catch {}
  return () => listeners.delete(fn);
}

export function isPreviewMuted() {
  return muted;
}

function applyMute() {
  if (!player) return;
  if (player._el) {
    player._el.muted = muted;
    try { player._el.volume = muted ? 0 : 1; } catch {}
  }
  try { if ('muted' in player) player.muted = muted; } catch {}
  try { if ('volume' in player) player.volume = muted ? 0 : 1; } catch {}
}

export function setPreviewMuted(next) {
  muted = !!next;
  applyMute();
  emit();
}

export function togglePreviewMuted() {
  setPreviewMuted(!muted);
}

function destroy() {
  if (!player) return;
  try { player.pause?.(); } catch {}
  try { player.remove?.(); } catch {}
  if (player._el) {
    try {
      player._el.pause();
      player._el.removeAttribute('src');
      player._el.load();
    } catch {}
  }
  player = null;
  currentKey = null;
}

export function stopPreview(key) {
  if (key && currentKey !== key) return;
  destroy();
  emit();
}

function attachWeb(uri, loop) {
  const el = new Audio();
  el.preload = 'auto';
  el.loop = !!loop;
  el.playsInline = true;
  el.setAttribute('playsinline', 'true');
  el.setAttribute('webkit-playsinline', 'true');
  el.crossOrigin = 'anonymous';
  el.src = uri;
  el.muted = muted;
  const wrap = {
    _el: el,
    _paused: true,
    play: () => {
      const p = el.play();
      wrap._paused = false;
      return p;
    },
    pause: () => { el.pause(); wrap._paused = true; },
    remove: () => { el.pause(); el.removeAttribute('src'); el.load(); },
    get currentTime() { return el.currentTime; },
    seekTo: (sec) => { try { el.currentTime = sec; } catch {} },
  };
  el.addEventListener('pause', () => { wrap._paused = true; emit(); });
  el.addEventListener('play', () => { wrap._paused = false; emit(); });
  el.addEventListener('ended', () => {
    if (loop) {
      try { el.currentTime = 0; el.play(); } catch {}
    } else {
      wrap._paused = true;
      emit();
    }
  });
  return wrap;
}

function attachNative(uri) {
  const mod = require('expo-audio');
  const p = mod.createAudioPlayer?.({ uri });
  Promise.resolve(mod.setAudioModeAsync?.({
    allowsRecording: false,
    playsInSilentMode: true,
    interruptionMode: 'duckOthers',
    shouldPlayInBackground: false,
    shouldRouteThroughEarpiece: false,
  })).catch(() => {});
  if (p) {
    p._paused = true;
    const origPlay = p.play?.bind(p);
    const origPause = p.pause?.bind(p);
    p.play = () => { p._paused = false; return origPlay?.(); };
    p.pause = () => { p._paused = true; return origPause?.(); };
  }
  return p;
}

export async function playPreview(uri, key, { loop = true } = {}) {
  if (!uri) return false;
  if (currentKey === key && player) {
    try {
      const res = player.play?.();
      if (res && typeof res.then === 'function') await res;
    } catch {}
    emit();
    return true;
  }
  destroy();
  currentKey = key;
  try {
    player = (Platform.OS === 'web' && typeof Audio !== 'undefined')
      ? attachWeb(uri, loop)
      : attachNative(uri);
    if (!player) {
      currentKey = null;
      emit();
      return false;
    }
    applyMute();
    try { player.seekTo?.(0); } catch {}
    const attempt = async () => {
      try {
        const res = player.play?.();
        if (res && typeof res.then === 'function') await res;
        return true;
      } catch {
        return false;
      }
    };
    let ok = await attempt();
    // Chrome / Safari / iOS WebView block unmuted autoplay. Retry muted so
    // the clip still starts; the sticker shows an unmute control.
    if (!ok && !muted) {
      muted = true;
      applyMute();
      ok = await attempt();
    }
    emit();
    return ok;
  } catch {
    destroy();
    emit();
    return false;
  }
}

export function pausePreview() {
  try { player?.pause?.(); } catch {}
  emit();
}

export function resumePreview() {
  try { player?.play?.(); } catch {}
  emit();
}

export function activePreviewKey() {
  return currentKey;
}
