import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import Icon from '../icons/Icon';
import { useTheme } from '../store/ThemeContext';
import { type, inkBox, marker } from '../theme';
import { SpringPressable, motion } from '../motion';

/**
 * A "song sketched onto paper" card — album art behind an ink frame, with a
 * play/pause control for the ~30-second preview and a subtle progress bar so
 * it's obvious this is a PREVIEW, not the full song (previews only, by
 * design — same model as Instagram/TikTok music stickers; full-track
 * playback would need a licensing deal).
 *
 * Behaviour contract:
 *  - renders BOTH stored eras: the Phase-9 canonical shape
 *    ({title, artist, artwork, previewUrl}) and the pre-Phase-9 shape
 *    ({name, albumArt}) that still exists on old posts/statuses;
 *  - only ONE preview plays in the whole app at a time — starting a new one
 *    stops the previous (module-level active player);
 *  - playback stops when the card unmounts (FlatList windowing = scrolled
 *    off-screen), so audio is never left playing invisibly;
 *  - the audio session matches the app's voice-note precedent: duck other
 *    audio, respect the platform mixer, never play in background (this is
 *    not a music player — backgrounding the app stops previews).
 */

// Single app-wide preview player: (player, key) of whichever card is live.
let activePlayer = null;
let activeKey = null;

function stopActivePlayer() {
  if (!activePlayer) return;
  try { activePlayer.pause?.(); } catch {}
  try { activePlayer.remove?.(); } catch {}
  activePlayer = null;
  activeKey = null;
}

const PREVIEW_MS = 30000; // both providers serve ~30-second clips

export default function SongCard({ song, compact = false, tint }) {
  const { theme } = useTheme();
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0); // 0..1 through the preview
  const playerRef = useRef(null);
  const pollRef = useRef(null);
  const s = makeStyles(theme);
  const fg = tint || theme.ink;

  const title = song?.title || song?.name || '';
  const artist = song?.artist || '';
  const artwork = song?.artwork || song?.albumArt || null;
  const key = song?.id || song?.previewUrl || title;

  const stopPolling = () => { clearInterval(pollRef.current); pollRef.current = null; };

  // Stopped/unmounted (also scrolled off a windowed list) → release audio.
  useEffect(() => () => {
    stopPolling();
    if (activeKey === key && activePlayer) stopActivePlayer();
  }, [key]);

  useEffect(() => () => setPlaying(false), [song?.id]);

  if (!song) return null;

  const toggle = async () => {
    if (!song.previewUrl) return;
    try {
      if (playing) {
        try { playerRef.current?.pause?.(); } catch {}
        stopPolling();
        setPlaying(false);
        return;
      }
      // Starting this card stops whichever preview is playing anywhere else.
      stopActivePlayer();
      stopPolling();
      const mod = require('expo-audio');
      const p = mod.createAudioPlayer?.({ uri: song.previewUrl });
      playerRef.current = p;
      activePlayer = p;
      activeKey = key;
      // Match the voice-note audio-session precedent: duck other audio,
      // never in background (previews must stop when the app is backgrounded).
      Promise.resolve(
        mod.setAudioModeAsync?.({
          allowsRecording: false,
          playsInSilentMode: true,
          interruptionMode: 'duckOthers',
          shouldPlayInBackground: false,
          shouldRouteThroughEarpiece: false,
        })
      ).catch(() => {});
      try { p?.seekTo?.(0); } catch {}
      p?.play?.();
      setPlaying(true);
      setProgress(0);
      const total = Math.min(Number(song.durationMs) || PREVIEW_MS, PREVIEW_MS);
      pollRef.current = setInterval(() => {
        const sec = Number(p?.currentTime);
        const frac = Number.isFinite(sec) && total > 0 ? Math.min(1, sec * 1000 / total) : 0;
        setProgress(frac);
        if (frac >= 0.999) { // preview finished on its own
          stopPolling();
          setPlaying(false);
          setProgress(0);
          try { p?.remove?.(); } catch {}
          if (activeKey === key) { activePlayer = null; activeKey = null; }
        }
      }, 500);
    } catch { /* preview unsupported on this platform — visual only */ }
  };

  return (
    <View style={[s.wrap, compact && s.wrapCompact, inkBox(theme, 'thin', fg)]}>
      {artwork ? (
        <Image source={{ uri: artwork }} style={s.art} />
      ) : (
        <View style={[s.art, s.artFallback]}>
          <Icon name="musical-notes" size={18} color={fg} />
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.bodyStrong, { color: fg }]} numberOfLines={1}>{title}</Text>
        <Text style={[type.labelXs, { color: fg, opacity: 0.65, marginTop: 2 }]} numberOfLines={1}>
          {artist}{playing ? '  ·  0:30 PREVIEW' : ''}
        </Text>
        {!!playing && (
          <View style={[s.progressTrack, { backgroundColor: `${fg}33` }]}>
            <View style={[s.progressFill, { backgroundColor: fg, width: `${Math.round(progress * 100)}%` }]} />
          </View>
        )}
      </View>
      {!!song.previewUrl && (
        <SpringPressable
          onPress={toggle}
          style={({ pressed }) => [s.play, inkBox(theme, 'ink', fg), pressed ? marker(theme, 1) : null]}
          scaleTo={motion.scale.row}
          haptic="selection"
        >
          <Icon name={playing ? 'pause' : 'play'} size={13} color={fg} />
        </SpringPressable>
      )}
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, backgroundColor: 'transparent' },
  wrapCompact: { padding: 6, gap: 8 },
  art: { width: 42, height: 42, borderRadius: 3 },
  artFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: t.cardAlt },
  play: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  progressTrack: { height: 3, borderRadius: 2, marginTop: 6, overflow: 'hidden' },
  progressFill: { height: 3, borderRadius: 2 },
});
