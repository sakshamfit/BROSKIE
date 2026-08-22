import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator, Modal, Share } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../icons/Icon';
import { EmojiText } from '../icons/Emoji';
import { api, WEB_APP_URL } from '../api';
import { useAuth } from '../store/AuthContext';
import { useChat } from '../store/ChatContext';
import { useTheme } from '../store/ThemeContext';
import { Avatar, PaperCard, TapeChip, handleFor, Rule, InkButton, rippleFor, FrostedBackdrop, GoldTick, hasGoldTick } from '../components/common';
import { categoryMeta, JOIN_POLICY } from '../components/communityMeta';
import { radius, type, inkBox, marker, raised } from '../theme';
import { confirm } from '../hooks/confirm';
import { SpringPressable, motion } from '../motion';

/**
 * Full-screen community detail: hero (category badge, name, description,
 * join-policy), member list with admin badges, join/leave/request actions,
 * and — for admins — a pending-requests panel and a "Open group chat"
 * shortcut into the backing chat (every community owns one, reusing all
 * existing messaging plumbing).
 */
export default function CommunityDetailScreen({ communityId, onClose, onOpenChat }) {
  const { user } = useAuth();
  const { onCommunityEvent } = useChat();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const s = makeStyles(theme);

  const [community, setCommunity] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [requests, setRequests] = useState([]);
  const [showRequests, setShowRequests] = useState(false);

  /* Invite link: share it anywhere (WhatsApp/SMS). The link IS the approval —
     a valid code joins directly regardless of join policy. Long-press
     rotates the code, revoking the old link. */
  const inviteUrl = community?.inviteCode ? `${WEB_APP_URL}/c/${community.inviteCode}` : null;
  const shareInvite = async () => {
    if (!inviteUrl) return;
    try {
      await Share.share({
        title: `Invite to ${community.name}`,
        url: inviteUrl,
        message: `Join me in “${community.name}” on +one — one tap and you're in: ${inviteUrl}`,
      });
    } catch {}
  };
  const rotateInvite = async () => {
    if (!community?.inviteCode) return;
    const ok = await confirm('Make a new invite link? The current one stops working.', {
      title: 'Rotate invite link', confirmLabel: 'Rotate', destructive: true,
    });
    if (!ok) return;
    try {
      const { inviteCode } = await api.rotateInviteCode(community.id);
      setCommunity((prev) => (prev ? { ...prev, inviteCode } : prev));
    } catch {}
  };

  const load = useCallback(async () => {
    if (!communityId) return;
    try {
      const { community } = await api.community(communityId);
      setCommunity(community);
    } catch {} finally { setLoading(false); }
  }, [communityId]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  useEffect(() => {
    if (!onCommunityEvent) return;
    return onCommunityEvent((ev, payload) => {
      if (payload?.id === communityId || payload?.communityId === communityId) load();
    });
  }, [onCommunityEvent, communityId, load]);

  useEffect(() => {
    if (community?.role === 'admin' && showRequests) {
      (async () => {
        try {
          const r = await api.communityRequests(communityId);
          setRequests(r.requests);
        } catch {}
      })();
    }
  }, [community?.role, showRequests, communityId]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.ink} />
      </View>
    );
  }
  if (!community) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <Text style={[type.bodyMd, { color: theme.subtext }]}>This community could not be found.</Text>
      </View>
    );
  }

  const cat = categoryMeta(community.category);
  const policy = JOIN_POLICY[community.joinPolicy] || JOIN_POLICY.request;

  const doJoin = async () => {
    setBusy(true);
    try { await api.joinCommunity(communityId); await load(); } catch (e) { /* noop */ } finally { setBusy(false); }
  };

  const doLeave = async () => {
    const ok = await confirm('Leave this community?', { title: 'Leave community', confirmLabel: 'Leave', destructive: true });
    if (!ok) return;
    setBusy(true);
    try { await api.leaveCommunity(communityId); onClose?.(); } catch {} finally { setBusy(false); }
  };

  const doDisband = async () => {
    const ok = await confirm('This deletes the community and its chat for everyone. This cannot be undone.', {
      title: 'Disband community', confirmLabel: 'Disband', destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try { await api.deleteCommunity(communityId); onClose?.(); } catch {} finally { setBusy(false); }
  };

  const respond = async (userId, action) => {
    try {
      await api.respondCommunityRequest(communityId, userId, action);
      setRequests((prev) => prev.filter((r) => r.user.id !== userId));
    } catch {}
  };

  const joinAction = () => {
    if (community.isMember) return null;
    if (community.pendingRequest) {
      return (
        <View style={[s.pendingPill, { borderColor: theme.graphiteLine }]}>
          <Icon name="hourglass-outline" size={15} color={theme.subtext} />
          <Text style={[type.labelSm, { color: theme.subtext }]}>Request sent — waiting on an admin</Text>
        </View>
      );
    }
    if (community.joinPolicy === 'invite') {
      return (
        <View style={[s.pendingPill, { borderColor: theme.graphiteLine }]}>
          <Icon name="lock-open-outline" size={15} color={theme.subtext} />
          <Text style={[type.labelSm, { color: theme.subtext }]}>Invite only — ask an admin to add you</Text>
        </View>
      );
    }
    return (
      <InkButton
        label={community.joinPolicy === 'open' ? 'Join community' : 'Ask to join'}
        icon="person-add-outline"
        onPress={doJoin}
        busy={busy}
        filled
      />
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView contentContainerStyle={[s.scroll, { paddingTop: 16 + insets.top }]}>
        <Pressable onPress={onClose} hitSlop={8} style={s.back}>
          <Icon name="arrow-back" size={22} color={theme.ink} />
        </Pressable>

        <PaperCard style={s.hero} weight="ink">
          <View style={[s.categoryBadge, inkBox(theme, 'ink'), { transform: [{ rotate: '-2deg' }] }]}>
            <Icon name={cat.icon} size={26} color={theme.ink} />
          </View>
          <EmojiText style={[type.headlineMd, { color: theme.text, marginTop: 16, textAlign: 'center' }]}>
            {community.name}
          </EmojiText>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            <TapeChip label={cat.label.toUpperCase()} tone="accent" />
            <TapeChip label={`${community.memberCount} ${community.memberCount === 1 ? 'MEMBER' : 'MEMBERS'}`} />
          </View>
          {!!community.description && (
            <Text style={[type.bodySm, { color: theme.subtext, marginTop: 14, textAlign: 'center' }]}>
              {community.description}
            </Text>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 }}>
            <Icon name={policy.icon} size={13} color={theme.muted} />
            <Text style={[type.labelXs, { color: theme.muted }]}>{policy.blurb.toUpperCase()}</Text>
          </View>
          <View style={{ marginTop: 18, width: '100%', alignItems: 'center' }}>
            {joinAction()}
          </View>
        </PaperCard>

        {community.isMember && (
          <SpringPressable
            onPress={() => onOpenChat?.(community.chatId)}
            android_ripple={rippleFor(theme)}
            style={({ pressed }) => [s.chatRow, inkBox(theme, 'ink'), pressed && marker(theme, 1)]}
            scaleTo={motion.scale.row}
            haptic="selection"
          >
            <Icon name="chatbubbles-outline" size={19} color={theme.ink} />
            <Text style={[type.bodyMd, { color: theme.text, flex: 1 }]}>Open group chat</Text>
            <Icon name="chevron-forward-outline" size={16} color={theme.muted} />
          </SpringPressable>
        )}

        {community.role === 'admin' && inviteUrl && (
          <SpringPressable
            onPress={shareInvite}
            onLongPress={rotateInvite}
            android_ripple={rippleFor(theme)}
            style={({ pressed }) => [s.chatRow, inkBox(theme, 'thin'), pressed && marker(theme, 1)]}
            scaleTo={motion.scale.row}
            haptic="selection"
          >
            <Icon name="share-outline" size={19} color={theme.ink} />
            <View style={{ flex: 1 }}>
              <Text style={[type.bodyMd, { color: theme.text }]}>Invite with a link</Text>
              <Text style={[type.labelXs, { color: theme.muted, marginTop: 2 }]}>
                ANYONE WITH THE LINK JOINS · HOLD TO ROTATE
              </Text>
            </View>
            <Icon name="chevron-forward-outline" size={16} color={theme.muted} />
          </SpringPressable>
        )}

        {community.role === 'admin' && community.requestCount > 0 && (
          <SpringPressable
            onPress={() => setShowRequests(true)}
            android_ripple={rippleFor(theme)}
            style={({ pressed }) => [s.chatRow, inkBox(theme, 'thin'), { backgroundColor: theme.highlighterWash }, pressed && marker(theme, 1)]}
            scaleTo={motion.scale.row}
            haptic="selection"
          >
            <Icon name="hourglass-outline" size={19} color={theme.ink} />
            <Text style={[type.bodyMd, { color: theme.text, flex: 1 }]}>
              {community.requestCount} pending {community.requestCount === 1 ? 'request' : 'requests'}
            </Text>
            <Icon name="chevron-forward-outline" size={16} color={theme.muted} />
          </SpringPressable>
        )}

        <PaperCard>
          <Text style={[type.labelXs, { color: theme.muted, marginBottom: 14 }]}>
            {community.memberCount} {community.memberCount === 1 ? 'MEMBER' : 'MEMBERS'}
          </Text>
          <View style={{ gap: 16 }}>
            {community.members.map((m) => (
              <View key={m.id} style={s.memberRow}>
                <Avatar uri={m.avatar} name={m.name} id={m.id} size={42} profileId={m.id} />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <EmojiText style={[type.bodyMd, { color: theme.text, flexShrink: 1 }]}>
                      {m.id === user.id ? 'You' : m.name}
                    </EmojiText>
                    {hasGoldTick(m) && <GoldTick size={14} />}
                  </View>
                  <Text style={[type.labelXs, { color: theme.graphite, marginTop: 2 }]}>{handleFor(m)}</Text>
                </View>
                {m.role === 'admin' && <TapeChip label="ADMIN" tone="accent" />}
              </View>
            ))}
          </View>
        </PaperCard>

        {community.isMember && (
          <View style={{ marginTop: 4, gap: 10 }}>
            <InkButton label="Leave community" icon="exit-outline" onPress={doLeave} busy={busy} />
            {community.createdBy === user.id && (
              <InkButton label="Disband community" icon="trash-outline" onPress={doDisband} busy={busy} danger />
            )}
          </View>
        )}
      </ScrollView>

      <Modal visible={showRequests} animationType="slide" transparent onRequestClose={() => setShowRequests(false)}>
        <View style={[s.reqOverlay, { backgroundColor: 'transparent' }]}>
          <FrostedBackdrop />
          <View style={[s.reqSheet, raised(theme, 2), { backgroundColor: theme.bg, borderTopColor: theme.ink, paddingBottom: Math.max(insets.bottom, 20) }]}>
            <View style={s.reqHead}>
              <Text style={[type.headlineSm, { color: theme.text, flex: 1 }]}>Join requests</Text>
              <Pressable onPress={() => setShowRequests(false)} hitSlop={10}>
                <Icon name="close" size={22} color={theme.ink} />
              </Pressable>
            </View>
            <Rule style={{ marginTop: 0, marginBottom: 8 }} />
            {requests.length === 0 ? (
              <Text style={[type.bodySm, { color: theme.muted, textAlign: 'center', paddingVertical: 30 }]}>
                No pending requests.
              </Text>
            ) : (
              requests.map((r) => (
                <View key={r.user.id} style={s.reqRow}>
                  <Avatar uri={r.user.avatar} name={r.user.name} id={r.user.id} size={38} profileId={r.user.id} />
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <EmojiText style={[type.bodyMd, { color: theme.text, flexShrink: 1 }]}>{r.user.name}</EmojiText>
                      {hasGoldTick(r.user) && <GoldTick size={14} />}
                    </View>
                    <Text style={[type.labelXs, { color: theme.graphite, marginTop: 2 }]}>{handleFor(r.user)}</Text>
                  </View>
                  <Pressable onPress={() => respond(r.user.id, 'decline')} style={[s.reqBtn, { borderColor: theme.graphiteLine }]}>
                    <Icon name="close" size={16} color={theme.subtext} />
                  </Pressable>
                  <Pressable onPress={() => respond(r.user.id, 'approve')} style={[s.reqBtn, { backgroundColor: theme.ink, borderColor: theme.ink }]}>
                    <Icon name="checkmark" size={16} color={theme.onPrimary} />
                  </Pressable>
                </View>
              ))
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  scroll: { padding: 20, paddingTop: 16, paddingBottom: 40, gap: 16 },
  back: { padding: 6, alignSelf: 'flex-start' },
  hero: { alignItems: 'center', paddingVertical: 28 },
  categoryBadge: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  chatRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 8 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  pendingPill: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },

  reqOverlay: { flex: 1, justifyContent: 'flex-end' },
  reqSheet: { paddingHorizontal: 20, paddingTop: 16, maxHeight: '80%', borderTopWidth: 3, borderTopLeftRadius: 18, borderTopRightRadius: 18 },
  reqHead: { flexDirection: 'row', alignItems: 'center' },
  reqRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  reqBtn: { width: 34, height: 34, borderRadius: radius.full, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginLeft: 6 },
});
