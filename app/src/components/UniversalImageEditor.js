import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Pressable, StyleSheet, Modal, ActivityIndicator,
  ScrollView, Animated, Easing, Platform,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../icons/Icon';
import { type } from '../theme';
import { haptic } from '../motion';
import {
  prepareImage, processImage, pickImageFromLibrary, computeCrop,
  rotatedSize, fitRect, clamp, normalizeRotation, rotatePointClockwise,
  MAX_ZOOM, DOUBLE_TAP_ZOOM,
} from '../imageEditor/processing';
import { Text } from './Text';

/* ------------------------------------------------------------------ */
/* pure transform math (kept out of the component so it is testable)   */
/* ------------------------------------------------------------------ */

/**
 * Given the current transform state and a target zoom, compute the new
 * transform that keeps the on-screen anchor point stationary, then clamps the
 * pan so the image always covers the frame (no blank edges).
 */
function anchoredState(geo, rotation, prevZoom, prevTx, prevTy, nextZoom, ax, ay) {
  const next = clamp(nextZoom, 1, MAX_ZOOM);
  const sPrev = geo.sFit * prevZoom;
  const sNext = geo.sFit * next;

  const dx = ax - geo.frameW / 2 - prevTx;
  const dy = ay - geo.frameH / 2 - prevTy;
  const [lx, ly] = rotatePointClockwise(-rotation, dx, dy);
  const bw = geo.rw * sPrev;
  const bh = geo.rh * sPrev;
  const u = (lx + bw / 2) / bw;
  const v = (ly + bh / 2) / bh;

  const bw2 = geo.rw * sNext;
  const bh2 = geo.rh * sNext;
  const [lx2, ly2] = rotatePointClockwise(rotation, (u - 0.5) * bw2, (v - 0.5) * bh2);

  let tx = ax - geo.frameW / 2 - lx2;
  let ty = ay - geo.frameH / 2 - ly2;
  const maxTx = Math.max(0, (bw2 - geo.frameW) / 2);
  const maxTy = Math.max(0, (bh2 - geo.frameH) / 2);
  tx = clamp(tx, -maxTx, maxTx);
  ty = clamp(ty, -maxTy, maxTy);
  return { zoom: next, tx, ty };
}

/* ------------------------------------------------------------------ */
/* editor                                                              */
/* ------------------------------------------------------------------ */

/**
 * UniversalImageEditor — the single, reusable Instagram-style photo editor.
 *
 * Every image-upload surface routes through this one component. It accepts a
 * source URI (or picks one itself), shows a dark canvas with a clearly visible
 * crop frame, and supports pinch zoom, pan, double-tap zoom, 90° rotation,
 * reset, and aspect-ratio presets. On Done it crops/rotates/compresses the
 * ORIGINAL image locally and returns a brand-new processed file — the original
 * is never modified.
 */
export default function UniversalImageEditor({
  visible = false,
  source = null,          // optional URI to edit directly (re-edit flow)
  pickOnOpen = false,     // if true and no source, open the gallery first
  config = {},
  onCancel,
  onDone,
}) {
  const insets = useSafeAreaInsets();

  const {
    title = 'Edit photo',
    ratios = [],
    defaultRatio = 'original',
    allowRotation = true,
    allowZoom = true,
    allowPan = true,
    maxDimension = 1920,
    quality = 0.86,
  } = config;

  const [prepared, setPrepared] = useState(null);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [canvasSize, setCanvasSize] = useState(null);
  const [ratioKey, setRatioKey] = useState(defaultRatio);
  const [rotation, setRotation] = useState(0); // drives the box size re-render
  const [retryNonce, setRetryNonce] = useState(0);

  // Numeric source of truth for the transform (read synchronously by gestures
  // and by the Done handler without forcing re-renders).
  const zoomRef = useRef(1);
  const txRef = useRef(0);
  const tyRef = useRef(0);
  const rotationRef = useRef(0);
  const panStart = useRef({ tx: 0, ty: 0 });
  const pinchStart = useRef(1);
  const geoRef = useRef(null);

  // Animated mirrors for smooth rendering.
  const zoomAV = useRef(new Animated.Value(1)).current;
  const txAV = useRef(new Animated.Value(0)).current;
  const tyAV = useRef(new Animated.Value(0)).current;
  const rotAV = useRef(new Animated.Value(0)).current;

  const syncTransforms = useCallback(() => {
    zoomAV.setValue(zoomRef.current);
    txAV.setValue(txRef.current);
    tyAV.setValue(tyRef.current);
  }, [zoomAV, txAV, tyAV]);

  const resetTransforms = useCallback(({ withRotation = false } = {}) => {
    zoomRef.current = 1;
    txRef.current = 0;
    tyRef.current = 0;
    zoomAV.setValue(1);
    txAV.setValue(0);
    tyAV.setValue(0);
    if (withRotation) {
      rotationRef.current = 0;
      rotAV.setValue(0);
      setRotation(0);
    }
  }, [zoomAV, txAV, tyAV, rotAV]);

  /* -------- open / prepare -------- */
  useEffect(() => {
    if (!visible) return undefined;
    let cancelled = false;
    setLoading(true);
    setError('');
    setPrepared(null);
    resetTransforms({ withRotation: true });
    setRatioKey(defaultRatio);

    // On native, wait for the full-screen modal to finish sliding in before
    // presenting the system picker — presenting a modal mid-transition throws
    // on iOS. On web there is no such transition, so open almost immediately.
    const timer = setTimeout(async () => {
      try {
        let uri = source;
        if (!uri && pickOnOpen) {
          const asset = await pickImageFromLibrary();
          if (cancelled) return;
          if (!asset) { onCancel?.(); return; } // user backed out of the gallery
          uri = asset.uri;
        }
        if (!uri) {
          setError('No image to edit.');
          return;
        }
        const preparedImage = await prepareImage(uri);
        if (!cancelled) setPrepared(preparedImage);
      } catch (e) {
        if (!cancelled) setError('That image could not be opened. It may be corrupted or too large.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, Platform.OS === 'web' ? 40 : 380);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [visible, source, pickOnOpen, defaultRatio, retryNonce, resetTransforms]); // eslint-disable-line react-hooks/exhaustive-deps

  /* -------- derived frame geometry -------- */
  const aspect = useMemo(() => {
    if (!prepared) return 1;
    const ratio = ratios.find((r) => r.key === ratioKey);
    if (ratio && ratio.aspect) return ratio.aspect;
    return prepared.width / prepared.height;
  }, [prepared, ratioKey, ratios]);

  const frame = useMemo(() => {
    if (!prepared || !canvasSize) return null;
    const margin = 18;
    const maxW = Math.max(1, canvasSize.width - margin * 2);
    const maxH = Math.max(1, canvasSize.height - margin * 2);
    return fitRect(maxW, maxH, aspect);
  }, [prepared, canvasSize, aspect]);

  // Keep a ref of the current geometry for gesture callbacks (no stale state).
  useEffect(() => {
    if (!prepared || !frame) {
      geoRef.current = null;
      return;
    }
    const { width: rw, height: rh } = rotatedSize(prepared.width, prepared.height, rotationRef.current);
    const sFit = Math.max(frame.width / rw, frame.height / rh);
    geoRef.current = { rw, rh, sFit, frameW: frame.width, frameH: frame.height };
  });

  /* -------- interactive controls -------- */
  const animateTo = useCallback((targetZoom, ax, ay) => {
    const geo = geoRef.current;
    if (!geo) return;
    const s = anchoredState(geo, rotationRef.current, zoomRef.current, txRef.current, tyRef.current, targetZoom, ax, ay);
    zoomRef.current = s.zoom;
    txRef.current = s.tx;
    tyRef.current = s.ty;
    Animated.parallel([
      Animated.timing(zoomAV, { toValue: s.zoom, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(txAV, { toValue: s.tx, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(tyAV, { toValue: s.ty, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
    haptic('selection');
  }, [zoomAV, txAV, tyAV]);

  const pinchZoom = useCallback((next, ax, ay) => {
    const geo = geoRef.current;
    if (!geo) return;
    const s = anchoredState(geo, rotationRef.current, zoomRef.current, txRef.current, tyRef.current, next, ax, ay);
    zoomRef.current = s.zoom;
    txRef.current = s.tx;
    tyRef.current = s.ty;
    syncTransforms();
  }, [syncTransforms]);

  const rotate = useCallback(() => {
    if (!allowRotation) return;
    // Keep the ref unbounded so the animation always advances +90° forwards
    // (never spins backwards across the 360° wrap); the math normalises it.
    const next = rotationRef.current + 90;
    rotationRef.current = next;
    setRotation(normalizeRotation(next));
    Animated.timing(rotAV, { toValue: next, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    haptic('selection');
  }, [allowRotation, rotAV]);

  const reset = useCallback(() => {
    // Animate everything back to the default framing, rotating forwards to
    // upright (rather than snapping) so the gesture reads as intentional.
    const upright = Math.ceil(rotationRef.current / 360) * 360;
    zoomRef.current = 1;
    txRef.current = 0;
    tyRef.current = 0;
    rotationRef.current = 0;
    setRotation(0);
    setRatioKey(defaultRatio);
    Animated.parallel([
      Animated.timing(zoomAV, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(txAV, { toValue: 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(tyAV, { toValue: 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(rotAV, { toValue: upright, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
    haptic('selection');
  }, [zoomAV, txAV, tyAV, rotAV, defaultRatio]);

  const selectRatio = useCallback((key) => {
    if (key === ratioKey) return;
    setRatioKey(key);
    resetTransforms({ withRotation: false });
    haptic('selection');
  }, [ratioKey, resetTransforms]);

  const zoomBy = useCallback((factor) => {
    const geo = geoRef.current;
    if (!geo) return;
    animateTo(clamp(zoomRef.current * factor, 1, MAX_ZOOM), geo.frameW / 2, geo.frameH / 2);
  }, [animateTo]);

  /* -------- gestures -------- */
  const composed = useMemo(() => {
    const pan = Gesture.Pan()
      .enabled(allowPan)
      .maxPointers(1)
      .onStart(() => { panStart.current = { tx: txRef.current, ty: tyRef.current }; })
      .onUpdate((e) => {
        const geo = geoRef.current;
        if (!geo) return;
        const z = zoomRef.current;
        const bw = geo.rw * geo.sFit * z;
        const bh = geo.rh * geo.sFit * z;
        const maxTx = Math.max(0, (bw - geo.frameW) / 2);
        const maxTy = Math.max(0, (bh - geo.frameH) / 2);
        txRef.current = clamp(panStart.current.tx + e.translationX, -maxTx, maxTx);
        tyRef.current = clamp(panStart.current.ty + e.translationY, -maxTy, maxTy);
        txAV.setValue(txRef.current);
        tyAV.setValue(tyRef.current);
      });

    const pinch = Gesture.Pinch()
      .enabled(allowZoom)
      .onStart(() => { pinchStart.current = zoomRef.current; })
      .onUpdate((e) => {
        pinchZoom(pinchStart.current * e.scale, e.focalX, e.focalY);
      });

    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .enabled(allowZoom)
      .onEnd((e, success) => {
        if (!success) return;
        if (zoomRef.current > 1.05) {
          const geo = geoRef.current;
          animateTo(1, geo ? geo.frameW / 2 : e.x, geo ? geo.frameH / 2 : e.y);
        } else {
          animateTo(DOUBLE_TAP_ZOOM, e.x, e.y);
        }
      });

    return Gesture.Simultaneous(pan, pinch, doubleTap);
  }, [allowPan, allowZoom, pinchZoom, animateTo, txAV, tyAV]);

  /* -------- done -------- */
  const handleDone = useCallback(async () => {
    if (!prepared || !frame || processing) return;
    setProcessing(true);
    setError('');
    try {
      const crop = computeCrop({
        width: prepared.width,
        height: prepared.height,
        rotation: rotationRef.current,
        zoom: zoomRef.current,
        tx: txRef.current,
        ty: tyRef.current,
        frame: { width: frame.width, height: frame.height },
      });
      const out = await processImage({
        uri: prepared.uri,
        rotation: rotationRef.current,
        crop,
        maxDimension,
        quality,
      });
      onDone?.({ ...out, displayAspect: out.width / out.height });
    } catch (e) {
      setError('Could not save this crop. Please try again.');
      setProcessing(false);
    }
  }, [prepared, frame, processing, maxDimension, quality, onDone]);

  /* -------- render -------- */
  const boxStyle = useMemo(() => {
    if (!prepared || !frame) return null;
    const { width: rw, height: rh } = rotatedSize(prepared.width, prepared.height, rotation);
    const sFit = Math.max(frame.width / rw, frame.height / rh);
    const boxW = rw * sFit;
    const boxH = rh * sFit;
    return {
      position: 'absolute',
      width: boxW,
      height: boxH,
      left: frame.width / 2 - boxW / 2,
      top: frame.height / 2 - boxH / 2,
      transform: [
        { translateX: txAV },
        { translateY: tyAV },
        {
          rotate: rotAV.interpolate({
            inputRange: [0, 360],
            outputRange: ['0deg', '360deg'],
            extrapolate: 'extend',
          }),
        },
        { scale: zoomAV },
      ],
    };
  }, [prepared, frame, rotation, txAV, tyAV, rotAV, zoomAV]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={processing ? undefined : onCancel}
      statusBarTranslucent={Platform.OS === 'android'}
      presentationStyle="fullScreen"
    >
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        {/* ---------- top bar ---------- */}
        <View style={styles.topBar}>
          <Pressable
            onPress={onCancel}
            disabled={processing}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Cancel editing"
            style={styles.topAction}
          >
            <Text style={[type.bodyStrong, styles.topActionText]}>Cancel</Text>
          </Pressable>
          <Text style={[type.headlineSm, styles.title]}>{title}</Text>
          <Pressable
            onPress={handleDone}
            disabled={!prepared || processing}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Apply edit and save"
            style={styles.topAction}
          >
            {processing ? (
              <ActivityIndicator size="small" color="#FFE24D" />
            ) : (
              <Text style={[type.bodyStrong, styles.doneText, (!prepared || processing) && styles.doneDisabled]}>Done</Text>
            )}
          </Pressable>
        </View>

        {/* ---------- canvas ---------- */}
        <View
          style={styles.canvas}
          onLayout={(e) => setCanvasSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
        >
          {error && !prepared ? (
            <View style={styles.centerBox}>
              <Icon name="alert-circle" size={30} color="#ffffff" />
              <Text style={[type.bodyMd, styles.errorText]}>{error}</Text>
              <Pressable
                onPress={() => setRetryNonce((n) => n + 1)}
                accessibilityRole="button"
                style={styles.retryBtn}
              >
                <Text style={[type.bodyStrong, { color: '#131313' }]}>Try again</Text>
              </Pressable>
            </View>
          ) : loading || !prepared || !frame || !boxStyle ? (
            <ActivityIndicator size="large" color="#ffffff" />
          ) : (
            <GestureDetector gesture={composed}>
              <View
                style={[styles.frame, { width: frame.width, height: frame.height }]}
                collapsable={false}
              >
                <Animated.View style={boxStyle}>
                  <Animated.Image
                    source={{ uri: prepared.previewUri }}
                    style={StyleSheet.absoluteFill}
                    resizeMode="cover"
                  />
                </Animated.View>
                {/* crop grid */}
                <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                  <View style={[styles.gridH, { top: '33.333%' }]} />
                  <View style={[styles.gridH, { top: '66.666%' }]} />
                  <View style={[styles.gridV, { left: '33.333%' }]} />
                  <View style={[styles.gridV, { left: '66.666%' }]} />
                </View>
              </View>
            </GestureDetector>
          )}
          {!!error && prepared && (
            <View style={styles.errorBanner}>
              <Text style={[type.bodySm, { color: '#ffb4ab' }]}>{error}</Text>
            </View>
          )}
        </View>

        {/* ---------- bottom controls ---------- */}
        <View style={styles.bottom}>
          {ratios.length > 1 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.ratioRow}
            >
              {ratios.map((r) => {
                const selected = r.key === ratioKey;
                return (
                  <Pressable
                    key={r.key}
                    onPress={() => selectRatio(r.key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Aspect ratio ${r.label}`}
                    style={[styles.ratioChip, selected && styles.ratioChipActive]}
                  >
                    <Text style={[type.labelSm, styles.ratioText, selected && styles.ratioTextActive]}>{r.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
          <View style={styles.actionsRow}>
            <Pressable onPress={() => zoomBy(1 / 1.4)} accessibilityRole="button" accessibilityLabel="Zoom out" hitSlop={4} style={styles.actionBtn}>
              <Text style={[type.bodyStrong, styles.actionText]}>−</Text>
            </Pressable>
            <Pressable onPress={() => zoomBy(1.4)} accessibilityRole="button" accessibilityLabel="Zoom in" hitSlop={4} style={styles.actionBtn}>
              <Text style={[type.bodyStrong, styles.actionText]}>+</Text>
            </Pressable>
            {allowRotation && (
              <Pressable onPress={rotate} accessibilityRole="button" accessibilityLabel="Rotate 90 degrees" hitSlop={4} style={styles.actionBtnWide}>
                <Icon name="arrow-redo-outline" size={18} color="#ffffff" />
                <Text style={[type.labelSm, styles.actionText]}>ROTATE</Text>
              </Pressable>
            )}
            <Pressable onPress={reset} accessibilityRole="button" accessibilityLabel="Reset edits" hitSlop={4} style={styles.actionBtnWide}>
              <Icon name="refresh" size={18} color="#ffffff" />
              <Text style={[type.labelSm, styles.actionText]}>RESET</Text>
            </Pressable>
          </View>
          <Text style={[type.labelXs, styles.hint]}>
            PINCH TO ZOOM · DRAG TO MOVE · DOUBLE-TAP TO ZOOM
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0b0b' },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, height: 56,
  },
  topAction: { minWidth: 60, minHeight: 40, justifyContent: 'center' },
  topActionText: { color: '#ffffff' },
  doneText: { color: '#FFE24D', textAlign: 'right' },
  doneDisabled: { opacity: 0.4 },
  title: { color: '#ffffff', letterSpacing: 0.2 },

  canvas: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  centerBox: { alignItems: 'center', paddingHorizontal: 32 },
  errorText: { color: '#ffffff', textAlign: 'center', marginTop: 14, marginBottom: 16 },
  retryBtn: {
    backgroundColor: '#FFE24D', borderRadius: 6, paddingHorizontal: 20, paddingVertical: 10,
  },
  frame: {
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.75)', overflow: 'hidden',
    backgroundColor: '#000000',
  },
  gridH: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.28)' },
  gridV: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(255,255,255,0.28)' },
  errorBanner: {
    position: 'absolute', bottom: 10, left: 24, right: 24,
    backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 6, padding: 10,
  },

  bottom: { paddingHorizontal: 12, paddingTop: 8 },
  ratioRow: { gap: 8, paddingHorizontal: 4, paddingBottom: 8 },
  ratioChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
  },
  ratioChipActive: { backgroundColor: '#FFE24D', borderColor: '#FFE24D' },
  ratioText: { color: '#ffffff', letterSpacing: 0.4 },
  ratioTextActive: { color: '#131313' },
  actionsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingBottom: 6 },
  actionBtn: {
    minWidth: 46, height: 42, borderRadius: 8, borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center',
  },
  actionBtnWide: {
    flexDirection: 'row', alignItems: 'center', gap: 7, height: 42, borderRadius: 8,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', paddingHorizontal: 14,
  },
  actionText: { color: '#ffffff' },
  hint: { color: 'rgba(255,255,255,0.5)', textAlign: 'center', letterSpacing: 0.8, paddingBottom: 4 },
});
