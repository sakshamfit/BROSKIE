import React, { useEffect, useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import Icon from '../icons/Icon';
import { useTheme } from '../store/ThemeContext';
import { type, inkBox, marker } from '../theme';

/**
 * A "song sketched onto paper" card — album art behind an ink frame, with a
 * play/pause control for the 30s Spotify preview (when one exists).
 */
export default function SongCard({ song, compact = false, tint }) {
  const { theme } = useTheme();
  const [playing, setPlaying] = useState(false);
  const [player, setPlayer] = useState(null);
  const s = makeStyles(theme);
  const fg = tint || theme.ink;

  useEffect(() => () => { try { player?.remove?.(); } catch {} }, [player]);
  useEffect(() => () => setPlaying(false), [song?.id]);

  if (!song) return null;

  const toggle = async () => {
    if (!song.previewUrl) return;
    try {
      const mod = require('expo-audio');
      if (!playing) {
        const p = player || mod.createAudioPlayer?.({ uri: song.previewUrl });
        setPlayer(p);
        p?.seekTo?.(0);
        p?.play?.();
      } else {
        player?.pause?.();
      }
    } catch { /* preview unsupported on this platform — visual only */ }
    setPlaying((v) => !v);
  };

  return (
    <View style={[s.wrap, compact && s.wrapCompact, inkBox(theme, 'thin', fg)]}>
      {song.albumArt ? (
        <Image source={{ uri: song.albumArt }} style={s.art} />
      ) : (
        <View style={[s.art, s.artFallback]}>
          <Icon name="musical-notes" size={18} color={fg} />
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.bodyStrong, { color: fg }]} numberOfLines={1}>{song.name}</Text>
        <Text style={[type.labelXs, { color: fg, opacity: 0.65, marginTop: 2 }]} numberOfLines={1}>{song.artist}</Text>
      </View>
      {!!song.previewUrl && (
        <Pressable
          onPress={toggle}
          style={({ pressed }) => [s.play, inkBox(theme, 'ink', fg), pressed ? marker(theme, 1) : null]}
        >
          <Icon name={playing ? 'pause' : 'play'} size={13} color={fg} />
        </Pressable>
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
});
