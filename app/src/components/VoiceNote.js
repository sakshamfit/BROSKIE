import React, { useState, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Icon from '../icons/Icon';
import { useTheme } from '../store/ThemeContext';
import { radius, type, clayFor, clayPressed, tokens } from '../theme';

/** Clay voice note: puffed play bead + soft waveform. */
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
  const activeColor = isMine ? tokens.onPrimaryFixed : theme.primary;
  const idleColor = isMine ? 'rgba(0,33,19,0.3)' : theme.muted;
  const s = makeStyles(theme);

  return (
    <View style={s.wrap}>
      <Pressable
        onPress={toggle}
        style={({ pressed }) => [s.play, { backgroundColor: isMine ? theme.card : theme.accent }, pressed ? clayPressed(theme.shadowTint) : clayFor(theme, 2)]}
      >
        <Icon name={playing ? 'pause' : 'play'} size={16} color={isMine ? theme.primary : theme.onAccent} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <View style={s.wave}>
          {bars.map((h, i) => (
            <View
              key={i}
              style={{
                width: 3, height: h, borderRadius: radius.full, marginRight: 2.5,
                backgroundColor: i <= active && playing ? activeColor : idleColor,
              }}
            />
          ))}
        </View>
        <Text style={[type.bodySm, { fontSize: 11, color: isMine ? 'rgba(0,33,19,0.55)' : theme.muted, marginTop: 4 }]}>
          {fmt(playing ? duration * progress : duration)}
        </Text>
      </View>
      <Icon name="mic" size={15} color={isMine ? 'rgba(0,33,19,0.45)' : theme.muted} />
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4, minWidth: 200 },
  play: { width: 40, height: 40, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  wave: { flexDirection: 'row', alignItems: 'center', height: 26 },
});
