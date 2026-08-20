import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Animated, Easing } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';

let gradientSeq = 0;

/**
 * One opaque layer of the chat backdrop: base color + a soft SVG gradient +
 * two large translucent color washes for atmosphere. Pure react-native-svg
 * (already a dependency) — no image wallpapers are loaded here, so theme
 * changes stay lightweight until a theme actually ships a wallpaper asset.
 */
function BackdropLayer({ layer }) {
  const idRef = useRef(null);
  if (!idRef.current) idRef.current = `chatbackdrop_${(gradientSeq += 1)}`;
  const id = idRef.current;
  const { background, backgroundGradient = [], backgroundWashA, backgroundWashB } = layer;
  const stops = backgroundGradient.length ? backgroundGradient : [background];
  return (
    <View style={StyleSheet.absoluteFill}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: background }]} />
      {stops.length > 1 && (
        <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
              {stops.map((c, i) => (
                <Stop key={i} offset={`${Math.round((i / (stops.length - 1)) * 100)}%`} stopColor={c} />
              ))}
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill={`url(#${id})`} />
        </Svg>
      )}
      {!!backgroundWashA && <View style={[styles.washA, { backgroundColor: backgroundWashA }]} />}
      {!!backgroundWashB && <View style={[styles.washB, { backgroundColor: backgroundWashB }]} />}
    </View>
  );
}

/**
 * The conversation backdrop. When the active ChatTheme changes, the previous
 * layer crossfades out over ~280ms while the new layer sits beneath — a
 * subtle, premium transition (target band: 200–350ms), no flashes, no full
 * app re-render.
 */
export default function ChatBackground({ theme }) {
  const layer = {
    chatThemeId: theme.chatThemeId,
    background: theme.chatBg || theme.background || theme.bg,
    backgroundGradient: theme.backgroundGradient,
    backgroundWashA: theme.backgroundWashA,
    backgroundWashB: theme.backgroundWashB,
  };
  // Composite key: theme switch OR same theme recolored by the app dark-mode
  // toggle both deserve a gentle crossfade.
  const layerKey = [
    layer.chatThemeId,
    layer.background,
    ...(layer.backgroundGradient || []),
    layer.backgroundWashA,
    layer.backgroundWashB,
  ].join('|');
  const prevRef = useRef(null);
  const [prevLayer, setPrevLayer] = useState(null);
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (prevRef.current && prevRef.current.key !== layerKey) {
      setPrevLayer(prevRef.current);
      fade.setValue(1);
      Animated.timing(fade, {
        toValue: 0,
        duration: 280,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setPrevLayer(null);
      });
    }
    prevRef.current = { ...layer, key: layerKey };
    return () => fade.stopAnimation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerKey]);

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.root]}>
      <BackdropLayer layer={layer} />
      {!!prevLayer && (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]}>
          <BackdropLayer layer={prevLayer} />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { zIndex: 0, overflow: 'hidden' },
  // Big soft "pulp" washes — translucent circles, not hard shapes.
  washA: {
    position: 'absolute', top: '-30%', right: '-18%',
    width: '78%', aspectRatio: 1, borderRadius: 9999,
  },
  washB: {
    position: 'absolute', bottom: '-22%', left: '-14%',
    width: '64%', aspectRatio: 1, borderRadius: 9999,
  },
});
