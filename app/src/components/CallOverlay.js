import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Platform, Modal, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../icons/Icon';
import { RemoteVideo, LocalVideo } from './CallVideo';
import { useChatCall, useChatActions } from '../store/ChatContext';
import { useTheme } from '../store/ThemeContext';
import { Avatar, rippleFor, GoldTick, hasGoldTick } from './common';
import { radius, type, inkBox, sketchBox, raised, lightTheme } from '../theme';
import { SpringPressable, motion } from '../motion';
import GridPaper from './GridPaper';

/**
 * BROSKIE Premium Calling UI & WebRTC overlay.
 * Custom gridline drafting background, sketched asymmetrical profile frame,
 * premium pulsating rings, and solid connection state handling.
 */
export default function CallOverlay() {
  const { call, localStream, remoteStream, micOn, camOn, speakerOn, callSupported } = useChatCall();
  const { acceptCall, declineCall, hangUp, toggleMic, toggleCam, toggleSpeaker, switchCamera } = useChatActions();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const s = makeStyles(theme);

  // Call duration timer
  const [duration, setDuration] = useState(0);
  useEffect(() => {
    let timer;
    if (call?.status === 'ongoing' || call?.status === 'connected') {
      setDuration(0);
      timer = setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);
    } else {
      setDuration(0);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [call?.status]);

  if (!call) return null;

  const isIncoming = call.direction === 'incoming' && call.status === 'ringing';
  const isCalling = call.status === 'calling';
  const isRingingOut = call.direction === 'outgoing' && call.status === 'ringing';
  const isConnecting = call.status === 'connecting';
  const isOngoing = call.status === 'ongoing' || call.status === 'connected';
  const isEnded = call.status === 'ended';
  const isVideo = call.type === 'video';

  // Format call duration
  const formatDuration = (secs) => {
    const m = Math.floor(secs / 60);
    const sec = secs % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  // Map WebRTC/Socket statuses to premium, non-technical BROSKIE labels
  const getStatusLabel = () => {
    if (isEnded) {
      if (call.endedReason === 'declined') return 'Call rejected';
      if (call.endedReason === 'missed') return 'Missed call';
      if (call.endedReason === 'busy') return 'Busy';
      if (call.endedReason === 'failed') return call.error || 'Call failed';
      return 'Call ended';
    }
    if (isCalling) return 'Calling…';
    if (isIncoming) return `Incoming ${isVideo ? 'video' : 'voice'} call…`;
    if (isRingingOut) return 'Ringing…';
    if (isConnecting) return 'Connecting…';
    if (isOngoing) {
      if (call.connectionState === 'disconnected' || call.iceConnectionState === 'disconnected') {
        return 'Connection unstable';
      }
      if (call.connectionState === 'connecting' || call.iceConnectionState === 'checking') {
        return 'Reconnecting…';
      }
      return 'Connected';
    }
    return '';
  };

  const statusLabel = getStatusLabel();

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => {}}>
      <View style={[s.root, { backgroundColor: isVideo && isOngoing ? '#0a0a0a' : theme.bg }]}>
        
        {/* BROSKIE signature background drafting-grid lines */}
        {!(isVideo && isOngoing) && (
          <GridPaper opacity={theme.dark ? 0.08 : 0.16} style={StyleSheet.absoluteFillObject} />
        )}

        {/* Video calling rendering */}
        {isVideo && isOngoing && (
          <>
            <RemoteVideo stream={remoteStream} style={webStyles.remoteVideo} />
            <LocalVideo stream={localStream} style={webStyles.localVideo} />
          </>
        )}

        {/* Voice calling hidden surface to play sound on web browser */}
        {!isVideo && isOngoing && Platform.OS === 'web' && (
          <RemoteVideo stream={remoteStream} style={{ width: 0, height: 0, position: 'absolute', opacity: 0 }} />
        )}

        {/* Header and center info */}
        <View style={[s.content, { paddingTop: insets.top + 40 }]}>
          {!(isVideo && isOngoing) ? (
            <>
              <PulsingAvatar
                uri={call.with?.avatar}
                name={call.with?.name}
                id={call.with?.id}
                size={128}
                theme={theme}
                pulsing={isIncoming || isRingingOut || isConnecting}
              />
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 24 }}>
                <Text style={[type.headlineLg, { color: theme.text }]}>
                  {call.with?.name || 'Unknown'}
                </Text>
                {hasGoldTick(call.with) && <GoldTick size={22} />}
              </View>
            </>
          ) : (
            // Immersive Video details overlay
            <View style={s.immersiveHeader}>
              <Text style={[type.headlineSm, { color: '#fff' }]}>
                {call.with?.name || 'Unknown'}
              </Text>
              <Text style={[type.bodySm, { color: 'rgba(255,255,255,0.8)' }]}>
                {isOngoing ? formatDuration(duration) : statusLabel}
              </Text>
            </View>
          )}

          {/* Status and timer info */}
          {!(isVideo && isOngoing) && (
            <View style={{ alignItems: 'center', marginTop: 12 }}>
              <Text style={[type.bodyLg, { color: theme.text, fontFamily: type.mono(500) }]}>
                {isOngoing ? formatDuration(duration) : statusLabel}
              </Text>
              
              {call.connectionState && call.connectionState !== 'closed' && (
                <Text style={[type.labelXs, { color: theme.muted, marginTop: 6 }]}>
                  QUALITY: {call.connectionState === 'connected' ? 'EXCELLENT' : call.connectionState.toUpperCase()}
                </Text>
              )}
            </View>
          )}

          {!callSupported && (isIncoming || isRingingOut || isCalling) && (
            <Text style={[type.bodySm, { color: theme.danger, marginTop: 16, textAlign: 'center', maxWidth: 280 }]}>
              Calling is not available on this device yet.
            </Text>
          )}
        </View>

        {/* Call actions and controls */}
        <View style={[s.actions, { paddingBottom: insets.bottom + 40 }]}>
          
          {isIncoming && (
            <View style={s.actionRow}>
              <CallButton
                icon="close"
                label="Decline"
                tone="danger"
                onPress={declineCall}
                theme={theme}
                accessibilityLabel="Decline incoming call"
              />
              <CallButton
                icon={isVideo ? 'videocam' : 'call'}
                label="Accept"
                tone="accept"
                onPress={acceptCall}
                theme={theme}
                accessibilityLabel="Accept incoming call"
              />
            </View>
          )}

          {(isCalling || isRingingOut || isConnecting) && (
            <View style={s.actionRow}>
              <CallButton
                icon="close"
                label="Cancel"
                tone="danger"
                onPress={hangUp}
                theme={theme}
                accessibilityLabel="Cancel outgoing call"
              />
            </View>
          )}

          {isOngoing && (
            <View style={s.actionRow}>
              <CallButton
                icon={micOn ? 'mic' : 'mic-off-outline'}
                label={micOn ? 'Mute' : 'Muted'}
                tone={micOn ? 'neutral' : 'active'}
                onPress={toggleMic}
                theme={theme}
                dark={isVideo}
                accessibilityLabel={micOn ? "Mute microphone" : "Unmute microphone"}
              />
              
              {/* Speaker routing controls */}
              <CallButton
                icon={speakerOn ? 'volume-high-outline' : 'volume-mute-outline'}
                label={speakerOn ? 'Speaker' : 'Muted'}
                tone={speakerOn ? 'neutral' : 'active'}
                onPress={toggleSpeaker}
                theme={theme}
                dark={isVideo}
                accessibilityLabel={speakerOn ? "Mute speaker audio" : "Unmute speaker audio"}
              />

              {isVideo && (
                <>
                  <CallButton
                    icon={camOn ? 'videocam' : 'videocam-outline'}
                    label={camOn ? 'Camera' : 'Off'}
                    tone={camOn ? 'neutral' : 'active'}
                    onPress={toggleCam}
                    theme={theme}
                    dark
                    accessibilityLabel={camOn ? "Turn off camera" : "Turn on camera"}
                  />
                  <CallButton
                    icon="camera-reverse-outline"
                    label="Switch"
                    tone="neutral"
                    onPress={switchCamera}
                    theme={theme}
                    dark
                    accessibilityLabel="Switch camera device"
                  />
                </>
              )}
              
              <CallButton
                icon="close"
                label="End"
                tone="danger"
                onPress={hangUp}
                theme={theme}
                dark={isVideo}
                accessibilityLabel="End call"
              />
            </View>
          )}

          {isEnded && (
            <View style={[s.endedBadge, inkBox(theme, 'thin')]}>
              <Icon name="checkmark-circle" size={16} color={theme.muted} />
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

/** Pulsing Avatar wrapping a standard sketched avatar with premium growing rings */
function PulsingAvatar({ uri, name, id, size = 128, theme, pulsing }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    if (!pulsing) {
      scaleAnim.setValue(1);
      opacityAnim.setValue(0);
      return;
    }
    const pulse = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scaleAnim, { toValue: 1.35, duration: 1800, useNativeDriver: true }),
          Animated.timing(scaleAnim, { toValue: 1.0, duration: 1800, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(opacityAnim, { toValue: 0.05, duration: 1800, useNativeDriver: true }),
          Animated.timing(opacityAnim, { toValue: 0.4, duration: 1800, useNativeDriver: true }),
        ]),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [scaleAnim, opacityAnim, pulsing]);

  return (
    <View style={avatarStyles.container}>
      {pulsing && (
        <>
          <Animated.View
            style={[
              avatarStyles.pulseRing,
              {
                width: size,
                height: size,
                borderRadius: size / 2,
                borderColor: theme.accent,
                opacity: opacityAnim,
                transform: [{ scale: scaleAnim }],
              },
            ]}
          />
          <Animated.View
            style={[
              avatarStyles.pulseRing,
              {
                width: size,
                height: size,
                borderRadius: size / 2,
                borderColor: theme.accent,
                opacity: Animated.multiply(opacityAnim, 0.6),
                transform: [{ scale: scaleAnim.interpolate({
                  inputRange: [1, 1.35],
                  outputRange: [1, 1.45],
                }) }],
              },
            ]}
          />
        </>
      )}
      <Avatar uri={uri} name={name} id={id} size={size} shape="sketch" />
    </View>
  );
}

const avatarStyles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', position: 'relative' },
  pulseRing: {
    position: 'absolute',
    borderWidth: 2.5,
    borderStyle: 'solid',
  },
});

/** Custom Tactile, Asymmetrical, Sketched Action Buttons fitting the BROSKIE language */
function CallButton({ icon, label, tone, onPress, theme, dark, accessibilityLabel }) {
  const bg = tone === 'danger'
    ? theme.danger
    : tone === 'accept'
    ? '#0a8a2f'
    : tone === 'active'
    ? theme.highlighter
    : (dark ? 'rgba(255,255,255,0.15)' : theme.cardAlt);
  
  const fg = tone === 'danger' || tone === 'accept'
    ? '#fff'
    : tone === 'active'
    ? theme.ink
    : (dark ? '#fff' : theme.ink);

  // Asymmetrical sketchy border box styling
  const customBoxStyle = sketchBox(theme, 'ink', 68);

  return (
    <SpringPressable
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      android_ripple={rippleFor(theme, { borderless: true, radius: 34 })}
      style={({ pressed }) => [
        buttonStyles.wrap,
        customBoxStyle,
        {
          backgroundColor: bg,
          opacity: pressed && Platform.OS !== 'android' ? 0.82 : 1,
        },
        raised(theme, tone === 'active' || tone === 'accept' ? 2 : 1),
      ]}
      scaleTo={motion.scale.row}
      haptic="selection"
    >
      <Icon name={icon} size={24} color={fg} />
      <Text style={[type.labelXs, { color: dark ? 'rgba(255,255,255,0.75)' : theme.muted, marginTop: 6, textAlign: 'center' }]}>
        {label.toUpperCase()}
      </Text>
    </SpringPressable>
  );
}

const buttonStyles = StyleSheet.create({
  wrap: {
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

const webStyles = {
  remoteVideo: Platform.OS === 'web'
    ? { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }
    : { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
  localVideo: Platform.OS === 'web'
    ? {
        position: 'absolute',
        top: 40,
        right: 20,
        width: 110,
        height: 150,
        objectFit: 'cover',
        borderWidth: 2,
        borderColor: '#000',
        borderRadius: 8,
        ...raised(lightTheme, 2),
      }
    : {
        position: 'absolute',
        top: 40,
        right: 20,
        width: 110,
        height: 150,
        borderWidth: 2,
        borderColor: '#000',
        borderRadius: 8,
      },
};

const makeStyles = (t) => StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'space-between' },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, width: '100%' },
  immersiveHeader: {
    position: 'absolute',
    top: 40,
    left: 20,
    zIndex: 10,
    alignItems: 'flex-start',
  },
  actions: { width: '100%', alignItems: 'center' },
  actionRow: { flexDirection: 'row', gap: 20, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' },
  endedBadge: { width: 44, height: 44, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
});