import React from 'react';
import { View, Text, Pressable, StyleSheet, Platform, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../icons/Icon';
import { RemoteVideo, LocalVideo } from './CallVideo';
import { useChat } from '../store/ChatContext';
import { useTheme } from '../store/ThemeContext';
import { Avatar, rippleFor, GoldTick, hasGoldTick } from './common';
import { radius, type, inkBox } from '../theme';
import { SpringPressable, motion } from '../motion';

/**
 * Real 1:1 voice/video calling, rendered as a global overlay so it shows up
 * no matter which screen you're on (matching how a phone's OS call UI
 * works, and how WhatsApp/every messenger handles incoming calls). Backed
 * by actual WebRTC — audio/video is a genuine peer-to-peer connection, not
 * a mock. On web this "just works" via the browser's RTCPeerConnection;
 * native iOS/Android capture needs `react-native-webrtc` + a custom dev
 * build (not available in this managed/Expo Go workflow) so on native the
 * ringing/accept/decline/call-history signaling still works for real, but
 * media capture shows a clear "needs a browser" message instead of silently
 * failing.
 */
export default function CallOverlay() {
  const {
    call, localStream, remoteStream, micOn, camOn, callSupported,
    acceptCall, declineCall, hangUp, toggleMic, toggleCam,
  } = useChat();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const s = makeStyles(theme);
  if (!call) return null;

  const isIncoming = call.direction === 'incoming' && call.status === 'ringing';
  const isRingingOut = call.direction === 'outgoing' && call.status === 'ringing';
  const isConnecting = call.status === 'connecting';
  const isOngoing = call.status === 'ongoing';
  const isEnded = call.status === 'ended';
  const isVideo = call.type === 'video';

  const statusLabel = isEnded
    ? (call.endedReason === 'declined' ? 'Declined'
      : call.endedReason === 'missed' ? 'No answer'
      : call.endedReason === 'busy' ? 'Busy'
      : call.endedReason === 'failed' ? (call.error || 'Call failed')
      : 'Call ended')
    : isIncoming ? `Incoming ${isVideo ? 'video' : 'voice'} call…`
    : isRingingOut ? 'Ringing…'
    : isConnecting ? 'Connecting…'
    : isOngoing ? (isVideo ? 'Video call' : 'Voice call')
    : '';

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => {}}>
      <View style={[s.root, { backgroundColor: isVideo && isOngoing ? '#0a0a0a' : theme.bg }]}>
        {isVideo && isOngoing && (
          <>
            <RemoteVideo stream={remoteStream} style={webStyles.remoteVideo} />
            <LocalVideo stream={localStream} style={webStyles.localVideo} />
          </>
        )}

        <View style={[s.content, { paddingTop: insets.top + 40 }]}>
          {!(isVideo && isOngoing) && (
            <>
              <Avatar uri={call.with?.avatar} name={call.with?.name} id={call.with?.id} size={128} />
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 22 }}>
                <Text style={[type.headlineLg, { color: isVideo && isOngoing ? '#fff' : theme.text }]}>
                  {call.with?.name || 'Unknown'}
                </Text>
                {hasGoldTick(call.with) && <GoldTick size={22} />}
              </View>
            </>
          )}
          <Text style={[type.bodyLg, { color: isVideo && isOngoing ? 'rgba(255,255,255,0.8)' : theme.subtext, marginTop: 8 }]}>
            {statusLabel}
          </Text>
          {!callSupported && (isIncoming || isRingingOut) && (
            <Text style={[type.bodySm, { color: theme.danger, marginTop: 10, textAlign: 'center', maxWidth: 280 }]}>
              Calling is not available on this device yet.
            </Text>
          )}
        </View>

        <View style={[s.actions, { paddingBottom: insets.bottom + 40 }]}>
          {isIncoming && (
            <View style={s.actionRow}>
              <CallButton icon="close" label="Decline" tone="danger" onPress={declineCall} theme={theme} />
              <CallButton icon={isVideo ? 'videocam' : 'call'} label="Accept" tone="accept" onPress={acceptCall} theme={theme} />
            </View>
          )}

          {(isRingingOut || isConnecting) && (
            <View style={s.actionRow}>
              <CallButton icon="close" label="Cancel" tone="danger" onPress={hangUp} theme={theme} />
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
              />
              {isVideo && (
                <CallButton
                  icon={camOn ? 'videocam' : 'videocam-outline'}
                  label={camOn ? 'Camera' : 'Off'}
                  tone={camOn ? 'neutral' : 'active'}
                  onPress={toggleCam}
                  theme={theme}
                  dark
                />
              )}
              <CallButton icon="close" label="End" tone="danger" onPress={hangUp} theme={theme} dark={isVideo} />
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

function CallButton({ icon, label, tone, onPress, theme, dark }) {
  const bg = tone === 'danger' ? theme.danger : tone === 'accept' ? '#0a8a2f' : tone === 'active' ? theme.highlighter : (dark ? 'rgba(255,255,255,0.15)' : theme.cardAlt);
  const fg = tone === 'danger' || tone === 'accept' ? '#fff' : tone === 'active' ? theme.ink : (dark ? '#fff' : theme.ink);
  return (
    <SpringPressable
      onPress={onPress}
      android_ripple={rippleFor(theme, { borderless: true, radius: 34 })}
      style={({ pressed }) => [
        buttonStyles.wrap,
        { backgroundColor: bg, opacity: pressed && Platform.OS !== 'android' ? 0.85 : 1 },
      ]}
      scaleTo={motion.scale.row}
      haptic="selection"
    >
      <Icon name={icon} size={24} color={fg} />
      <Text style={[type.labelXs, { color: dark ? 'rgba(255,255,255,0.75)' : theme.muted, marginTop: 6 }]}>
        {label.toUpperCase()}
      </Text>
    </SpringPressable>
  );
}

const buttonStyles = StyleSheet.create({
  wrap: { width: 68, height: 68, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
});

// Works for web <video> (objectFit) and native RTCView alike (objectFit is
// passed as a prop there; the style key is simply ignored natively).
const webStyles = {
  remoteVideo: Platform.OS === 'web'
    ? { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }
    : { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
  localVideo: Platform.OS === 'web'
    ? { position: 'absolute', top: 24, right: 20, width: 110, height: 150, objectFit: 'cover', borderRadius: 12, borderWidth: 2, borderColor: '#fff' }
    : { position: 'absolute', top: 24, right: 20, width: 110, height: 150, borderRadius: 12, borderWidth: 2, borderColor: '#fff' },
};

const makeStyles = (t) => StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'space-between' },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  actions: { width: '100%', alignItems: 'center' },
  actionRow: { flexDirection: 'row', gap: 28, alignItems: 'center' },
  endedBadge: { width: 44, height: 44, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
});
