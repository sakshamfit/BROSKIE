import React, { useState, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Icon from '../icons/Icon';
import { useTheme } from '../store/ThemeContext';
import { radius, type, inkBox, marker, tokens } from '../theme';
import { alpha } from '../chatThemes';
import { SpringPressable, motion } from '../motion';

/** Ink voice note: drawn play box + graphite waveform. */
export default function VoiceNote({ uri, duration = 0, isMine }) {
  const { theme } = useTheme();
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [player, setPlayer] = useState(null);

  useEffect(() => () => { try { player?.remove?.(); } catch {} }, [player]);

  const bars = React.useMemo(() => {
    const seed = (uri || 'x').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    return Array.from({ length: 24 }, (_, i) => 7 + ((seed * (i + 3)) % 16));
  }, [uri]);

  useEffect(() => {
    if (!playing) return;
    const total = Math.max(duration, 1) * 1000;
    const started = Date.now();
    const t = setInterval(() => {
      const p = Math.min((Date.now() - started) / total, 1);
      setProgress(p);
      if (p >= 1) { setPlaying(false); setProgress(0); clearInterval(t); }
    }, 80);
    return () => clearInterval(t);
  }, [playing, duration]);

  const toggle = async () => {
    try {
      const mod = require('expo-audio');
      if (!playing && mod?.createAudioPlayer && uri) {
        const p = player || mod.createAudioPlayer({ uri });
        setPlayer(p); p.seekTo?.(0); p.play?.();
      } else if (playing) player?.pause?.();
    } catch { /* visual-only fallback */ }
    setPlaying((v) => !v);
  };

  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const active = Math.floor(progress * bars.length);
  const activeColor = isMine ? theme.highlighter : theme.ink;
  // Idle bars/metadata sit on the bubble — tint the bubble's own ink so the
  // voice note reads correctly in every chat theme.
  const idleColor = isMine ? alpha(theme.onBubbleOut, 0.35) : theme.graphiteLine;
  const metaColor = isMine ? alpha(theme.onBubbleOut, 0.6) : theme.muted;
  const s = makeStyles(theme);

  return (
    <View style={s.wrap}>
      <SpringPressable
        accessibilityRole="button"
        accessibilityLabel={playing ? 'Pause voice note' : 'Play voice note'}
        onPress={toggle}
        style={({ pressed }) => [
          s.play,
          inkBox(theme, 'ink', isMine ? theme.onBubbleOut : theme.ink),
          pressed ? marker(theme, 2) : null,
        ]}
        scaleTo={motion.scale.row}
        haptic="selection"
      >
        <Icon name={playing ? 'pause' : 'play'} size={15} color={isMine ? theme.onBubbleOut : theme.ink} />
      </SpringPressable>
      <View style={{ flex: 1 }}>
        <View style={s.wave}>
          {bars.map((h, i) => (
            <View
              key={i}
              style={{
                width: 2, height: h, marginRight: 2.5,
                backgroundColor: i <= active && playing ? activeColor : idleColor,
              }}
            />
          ))}
        </View>
        <Text style={[type.labelXs, { fontSize: 9.5, color: metaColor, marginTop: 4 }]}>
          {fmt(playing ? duration * progress : duration)}
        </Text>
      </View>
      <Icon name="mic" size={14} color={metaColor} />
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4, minWidth: 200 },
  play: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  wave: { flexDirection: 'row', alignItems: 'center', height: 26 },
});
