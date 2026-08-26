import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet, Animated, Easing, Platform } from 'react-native';
import Icon from '../icons/Icon';
import { useTheme } from '../store/ThemeContext';
import { type, inkBox, marker } from '../theme';
import { SpringPressable, motion } from '../motion';
import {
  playPreview, stopPreview, pausePreview,
  subscribePreview, togglePreviewMuted, isPreviewMuted,
} from '../previewPlayer';

/**
 * Song UI + preview audio.
 *
 * Variants:
 *  - row      picker / composer list row (tap play)
 *  - sticker  Instagram music id — overlay on a post or status. Auto-plays
 *             when `autoPlay` is true; mute lives on the pill.
 *
 * One preview plays in the whole app. Native uses expo-audio; web uses
 * HTMLAudio (works in Chrome, Safari, iOS in-app browsers, Android WebView).
 */

const PREVIEW_MS = 30000;

export default function SongCard({
  song,
  compact = false,
  tint,
  variant = 'row',
  autoPlay = false,
  paused = false,
  onRemove,
}) {
  const { theme } = useTheme();
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(isPreviewMuted());
  const [progress, setProgress] = useState(0);
  const pollRef = useRef(null);
  const spin = useRef(new Animated.Value(0)).current;
  const s = makeStyles(theme);
  const fg = tint || theme.ink;

  const title = song?.title || song?.name || '';
  const artist = song?.artist || '';
  const artwork = song?.artwork || song?.albumArt || null;
  const key = song?.id || song?.previewUrl || title;
  const canPlay = !!song?.previewUrl;

  const stopPolling = () => { clearInterval(pollRef.current); pollRef.current = null; };

  useEffect(() => subscribePreview((snap) => {
    const mine = snap.key === key;
    setPlaying(mine && snap.playing);
    setMuted(snap.muted);
    if (!mine) { stopPolling(); setProgress(0); }
  }), [key]);

  useEffect(() => () => {
    stopPolling();
    stopPreview(key);
  }, [key]);

  useEffect(() => {
    if (variant !== 'sticker' || !canPlay) return undefined;
    if (!autoPlay) {
      stopPreview(key);
      return undefined;
    }
    if (paused) {
      pausePreview();
      return undefined;
    }
    playPreview(song.previewUrl, key, { loop: true });
    return undefined;
  }, [variant, autoPlay, paused, canPlay, key, song?.previewUrl]);

  const onStickerPress = (event) => {
    event?.stopPropagation?.();
    if (!canPlay) return;
    if (playing) {
      togglePreviewMuted();
      return;
    }
    playPreview(song.previewUrl, key, { loop: true });
  };

  useEffect(() => {
    if (!playing) {
      spin.stopAnimation();
      return undefined;
    }
    const anim = Animated.loop(Animated.timing(spin, {
      toValue: 1, duration: 4200, easing: Easing.linear, useNativeDriver: true,
    }));
    anim.start();
    return () => anim.stop();
  }, [playing, spin]);

  if (!song) return null;

  const startRowPreview = async () => {
    if (!canPlay) return;
    if (playing) {
      pausePreview();
      stopPolling();
      setPlaying(false);
      return;
    }
    stopPolling();
    await playPreview(song.previewUrl, key, { loop: false });
    const total = Math.min(Number(song.durationMs) || PREVIEW_MS, PREVIEW_MS);
    pollRef.current = setInterval(() => {
      // progress is visual only for the picker row
      setProgress((p) => {
        const next = Math.min(1, p + 500 / total);
        if (next >= 0.999) {
          stopPolling();
          stopPreview(key);
          return 0;
        }
        return next;
      });
    }, 500);
  };

  const spinStyle = {
    transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }],
  };

  if (variant === 'sticker') {
    return (
      <View style={s.stickerRow} pointerEvents="box-none">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={muted ? 'Unmute song' : 'Mute song'}
          onPress={onStickerPress}
          onPressIn={(event) => event?.stopPropagation?.()}
          hitSlop={10}
          style={({ pressed }) => [s.sticker, pressed && { opacity: 0.88 }]}
        >
          {artwork ? (
            <Animated.Image source={{ uri: artwork }} style={[s.stickerArt, playing && spinStyle]} />
          ) : (
            <Animated.View style={[s.stickerArt, s.stickerArtFallback, playing && spinStyle]}>
              <Icon name="musical-notes" size={13} color="#ffffff" />
            </Animated.View>
          )}
          <View style={{ flexShrink: 1, minWidth: 0, maxWidth: 180 }}>
            <Text style={s.stickerTitle} numberOfLines={1}>{title || 'Song'}</Text>
            {!!artist && <Text style={s.stickerArtist} numberOfLines={1}>{artist}</Text>}
          </View>
          {canPlay && (
            <Icon name={muted ? 'volume-mute' : 'volume-high-outline'} size={14} color="#ffffff" />
          )}
        </Pressable>
        {!!onRemove && (
          <Pressable onPress={onRemove} hitSlop={8} style={s.stickerX}>
            <Icon name="close" size={12} color="#ffffff" />
          </Pressable>
        )}
      </View>
    );
  }

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
      {canPlay && (
        <SpringPressable
          onPress={startRowPreview}
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

  stickerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sticker: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 6, paddingLeft: 6, paddingRight: 10,
    borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.58)',
    maxWidth: 260,
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(10px)' } : {}),
  },
  stickerArt: { width: 26, height: 26, borderRadius: 13 },
  stickerArtFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#333' },
  stickerTitle: { color: '#ffffff', fontSize: 12, fontWeight: '700', letterSpacing: 0.1 },
  stickerArtist: { color: 'rgba(255,255,255,0.72)', fontSize: 10, marginTop: 1 },
  stickerX: {
    width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
});
