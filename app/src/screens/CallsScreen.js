import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../icons/Icon';
import { EmojiText } from '../icons/Emoji';
import { api } from '../api';
import { useAuth } from '../store/AuthContext';
import { useChatCall, useChatActions } from '../store/ChatContext';
import { useTheme } from '../store/ThemeContext';
import { Avatar, EmptyState, formatChatTime, rippleFor, GoldTick, hasGoldTick } from '../components/common';
import useResponsive from '../hooks/useResponsive';
import { type, dashedRule, marker } from '../theme';
import { SpringPressable, motion } from '../motion';

/**
 * Real call history — every ringing/accepted/declined/missed/hung-up call
 * is logged server-side (server/src/db.js `calls` table) and shown here,
 * not a mock list. Tap a row to call that person back directly.
 */
export default function CallsScreen({ navigation, embedded = false }) {
  const { user } = useAuth();
  const { startCall } = useChatActions();
  const { call: activeCall, callSupported } = useChatCall();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { isTablet } = useResponsive();
  const s = makeStyles(theme);

  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setCalls((await api.calls()).calls); } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Refresh when a call ends so the new entry shows up without a manual pull.
  useEffect(() => {
    if (activeCall?.status === 'ended') {
      const t = setTimeout(load, 600);
      return () => clearTimeout(t);
    }
  }, [activeCall?.status, load]);

  const onRefresh = async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  };

  const callBack = (item, type) => {
    if (activeCall) return;
    startCall(item.chatId, item.with.id, type);
  };

  const iconFor = (item) => {
    if (item.status === 'missed' && item.direction === 'incoming') return { name: 'call', color: theme.danger };
    if (item.direction === 'incoming') return { name: 'arrow-undo-outline', color: theme.subtext };
    return { name: 'arrow-forward', color: theme.subtext };
  };

  const statusLabel = (item) => {
    if (item.status === 'missed') return item.direction === 'incoming' ? 'Missed' : 'No answer';
    if (item.status === 'declined') return item.direction === 'incoming' ? 'Declined' : 'Declined by them';
    if (item.status === 'busy') return 'Busy';
    if (item.durationMs > 0) {
      const mins = Math.floor(item.durationMs / 60000);
      const secs = Math.floor((item.durationMs % 60000) / 1000);
      return `${mins}:${String(secs).padStart(2, '0')}`;
    }
    return item.direction === 'incoming' ? 'Incoming' : 'Outgoing';
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={[s.header, !embedded && { paddingTop: 20 + insets.top }, isTablet && s.headerWide]}>
        <Text style={[type.headlineLg, { color: theme.text }]}>Calls</Text>
        {!callSupported && (
          <Text style={[type.labelXs, { color: theme.muted, marginTop: 4 }]}>
            LIVE AUDIO/VIDEO NEEDS A DESKTOP BROWSER ON THIS DEVICE
          </Text>
        )}
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={theme.ink} />
      ) : (
        <FlatList
          data={calls}
          keyExtractor={(c) => c.id}
          contentContainerStyle={[s.list, isTablet && s.listWide, !calls.length && { flexGrow: 1 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.ink} />}
          ItemSeparatorComponent={() => <View style={[dashedRule(theme), { marginHorizontal: 20 }]} />}
          ListEmptyComponent={
            <EmptyState icon="call-outline" title="No calls yet" subtitle="Call someone from their chat — voice or video." />
          }
          renderItem={({ item }) => {
            const ic = iconFor(item);
            const missed = item.status === 'missed' && item.direction === 'incoming';
            return (
              <SpringPressable
                onPress={() => callBack(item, item.type)}
                android_ripple={rippleFor(theme)}
                style={({ pressed }) => [s.row, pressed && marker(theme, 1)]}
                scaleTo={motion.scale.row}
                haptic="selection"
              >
                <Avatar uri={item.with.avatar} name={item.with.name} id={item.with.id} size={48} profileId={item.with.id} />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <EmojiText style={[type.headlineSm, { color: theme.text, flexShrink: 1 }]} numberOfLines={1}>
                      {item.with.id === user.id ? 'You' : item.with.name}
                    </EmojiText>
                    {hasGoldTick(item.with) && <GoldTick size={15} />}
                  </View>
                  <View style={s.metaRow}>
                    <Icon name={ic.name} size={13} color={missed ? theme.danger : ic.color} />
                    <Text style={[type.bodySm, { color: missed ? theme.danger : theme.subtext }]}>
                      {statusLabel(item)}
                    </Text>
                  </View>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 8 }}>
                  <Text style={[type.labelXs, { color: theme.muted }]}>{formatChatTime(item.startedAt)}</Text>
                  <Icon name={item.type === 'video' ? 'videocam' : 'call'} size={17} color={theme.ink} />
                </View>
              </SpringPressable>
            );
          }}
        />
      )}
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  header: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, minHeight: 84, justifyContent: 'center' },
  headerWide: { maxWidth: 640, width: '100%', alignSelf: 'center' },
  list: { paddingHorizontal: 20, paddingBottom: 40 },
  listWide: { maxWidth: 640, width: '100%', alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
});
