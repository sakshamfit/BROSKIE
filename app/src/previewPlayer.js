/**
 * One shared ~30s preview player for the whole app (stories + posts).
 *
 * Instagram rules, enforced here — not in each card:
 *  - only one Audio / expo-audio instance exists at a time
 *  - mute is global for the session (mute on a post, the next story stays muted)
 *  - browsers that block unmuted autoplay fall back to muted, then the
 *    user can tap the speaker
 *  - native uses expo-audio; web uses HTMLAudioElement
 *  - leaving a surface, switching clips, or backgrounding the app fully
 *    unloads the current sound (never a leftover instance)
 */
import { AppState, Platform } from 'react-native';

if (typeof AppState?.addEventListener === 'function') {
  AppState.addEventListener('change', (state) => {
    if (state !== 'active') stopPreview();
  });
}

let player = null;
let currentKey = null;
let muted = false;
let playGen = 0;
// Load/unload are async (element load on web, createAudioPlayer on native).
// Running them through one chain means a second clip can never begin
// attaching while the previous one is still resolving — the window in which
// two clips could briefly be audible at once.
let opChain = Promise.resolve();
const listeners = new Set();

function enqueue(run) {
  const next = opChain.then(run, run);
  opChain = next.then(() => {}, () => {});
  return next;
}

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
  try { player.muted = muted; } catch {}
  try { if ('volume' in player) player.volume = muted ? 0 : 1; } catch {}
}

export function setPreviewMuted(next) {
  muted = !!next;
  applyMute();
  if (!muted && player) {
    try {
      const res = player.play?.();
      if (res && typeof res.then === 'function') res.catch(() => {});
    } catch {}
  }
  emit();
}

export function togglePreviewMuted() {
  setPreviewMuted(!muted);
}

function destroy() {
  const dying = player;
  player = null;
  currentKey = null;
  if (!dying) return;
  try { dying.pause?.(); } catch {}
  try { dying.loop = false; } catch {}
  try { dying.remove?.(); } catch {}
  try { dying.release?.(); } catch {}
  if (dying._el) {
    try {
      dying._el.pause();
      dying._el.removeAttribute('src');
      dying._el.load();
    } catch {}
  }
}

export function stopPreview(key) {
  if (key && currentKey !== key) return;
  playGen += 1;
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
  el.volume = muted ? 0 : 1;
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

function attachNative(uri, loop) {
  const mod = require('expo-audio');
  Promise.resolve(mod.setAudioModeAsync?.({
    allowsRecording: false,
    // Same session as voice notes / the greeter — not call audio.
    playsInSilentMode: true,
    interruptionMode: 'duckOthers',
    shouldPlayInBackground: false,
    shouldRouteThroughEarpiece: false,
  })).catch(() => {});
  const p = mod.createAudioPlayer?.({ uri });
  if (!p) return null;
  try { p.loop = !!loop; } catch {}
  p._paused = true;
  const origPlay = p.play?.bind(p);
  const origPause = p.pause?.bind(p);
  p.play = () => { p._paused = false; return origPlay?.(); };
  p.pause = () => { p._paused = true; return origPause?.(); };
  // If the native player ignores `.loop`, restart when the clip ends.
  try {
    p.addListener?.('playbackStatusUpdate', (status) => {
      if (!status?.didJustFinish) return;
      if (loop && player === p) {
        try { p.seekTo?.(0); } catch {}
        try { p.play?.(); } catch {}
      } else {
        p._paused = true;
        emit();
      }
    });
  } catch {}
  return p;
}

export function playPreview(uri, key, { loop = true } = {}) {
  if (!uri) return Promise.resolve(false);
  // Claim the player synchronously, before queueing: a later request must
  // always win over an earlier one that is still loading, even if the earlier
  // one has not reached the front of the queue yet.
  const gen = ++playGen;
  return enqueue(() => playPreviewQueued(uri, key, gen, loop));
}

async function playPreviewQueued(uri, key, gen, loop) {
  // Superseded while waiting our turn — never touch the player.
  if (gen !== playGen) return false;

  if (currentKey === key && player) {
    applyMute();
    try {
      const res = player.play?.();
      if (res && typeof res.then === 'function') await res;
    } catch {}
    if (gen !== playGen) return false;
    emit();
    return true;
  }

  destroy();
  currentKey = key;
  try {
    player = (Platform.OS === 'web' && typeof Audio !== 'undefined')
      ? attachWeb(uri, loop)
      : attachNative(uri, loop);
    if (!player) {
      currentKey = null;
      emit();
      return false;
    }
    applyMute();
    try { player.seekTo?.(0); } catch {}

    const attempt = async () => {
      if (gen !== playGen || !player) return false;
      try {
        const res = player.play?.();
        if (res && typeof res.then === 'function') await res;
        return gen === playGen;
      } catch {
        return false;
      }
    };

    let ok = await attempt();
    // Chrome / Safari / iOS WebView block unmuted autoplay. Retry muted so
    // the clip still starts; the sticker shows an unmute control.
    if (!ok && !muted && gen === playGen) {
      muted = true;
      applyMute();
      ok = await attempt();
    }
    if (gen !== playGen) return false;
    emit();
    return ok;
  } catch {
    if (gen === playGen) {
      destroy();
      emit();
    }
    return false;
  }
}

export function pausePreview() {
  try { player?.pause?.(); } catch {}
  emit();
}

export function resumePreview() {
  if (!player) return;
  applyMute();
  try {
    const res = player.play?.();
    if (res && typeof res.then === 'function') res.catch(() => {});
  } catch {}
  emit();
}

export function activePreviewKey() {
  return currentKey;
}
