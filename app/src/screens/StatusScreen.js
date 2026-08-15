import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, Modal, TextInput, RefreshControl, ActivityIndicator,
} from 'react-native';
import Icon from '../icons/Icon';
import { EmojiText } from '../icons/Emoji';
import { api } from '../api';
import { useAuth } from '../store/AuthContext';
import { useTheme } from '../store/ThemeContext';
import { Avatar, formatChatTime, ClaySurface, ClayCard } from '../components/common';
import { radius, type, clayFor, clayPressed, tokens } from '../theme';

const BG_COLORS = ['#76ebb3', '#5dfd8a', '#ffcc8e', '#84f9c0', '#67dca5', '#efbe81'];

export default function StatusScreen() {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [data, setData] = useState({ mine: null, others: [] });
  const [composer, setComposer] = useState(false);
  const [viewer, setViewer] = useState(null);
  const [body, setBody] = useState('');
  const [bg, setBg] = useState(BG_COLORS[0]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const s = makeStyles(theme);

  const load = useCallback(async () => {
    try { setData(await api.statuses()); } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const post = async () => {
    if (!body.trim()) return;
    await api.postStatus({ type: 'text', body: body.trim(), bg });
    setBody(''); setComposer(false); load();
  };

  const openViewer = async (group) => {
    setViewer({ group, index: 0 });
    if (group.items[0]) { await api.viewStatus(group.items[0].id); load(); }
  };

  const nextStatus = async () => {
    if (!viewer) return;
    const next = viewer.index + 1;
    if (next >= viewer.group.items.length) { setViewer(null); load(); return; }
    setViewer({ ...viewer, index: next });
    await api.viewStatus(viewer.group.items[next].id);
  };

  const current = viewer?.group.items[viewer.index];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Status</Text>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={theme.primary} />
      ) : (
        <ScrollView
          contentContainerStyle={s.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={theme.primary} />}
        >
          <ClaySurface style={s.row} radius={radius.md} onPress={() => (data.mine ? openViewer(data.mine) : setComposer(true))}>
            <View>
              <Avatar uri={user?.avatar} name={user?.name} id={user?.id} size={56} />
              {!data.mine && (
                <View style={[s.plus, { backgroundColor: theme.accent, borderColor: theme.card }, clayFor(theme, 1)]}>
                  <Icon name="add" size={14} color={theme.onAccent} />
                </View>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[type.headlineSm, { color: theme.text }]}>My status</Text>
              <Text style={[type.bodySm, { color: theme.subtext, marginTop: 3 }]}>
                {data.mine ? `${data.mine.items.length} update${data.mine.items.length > 1 ? 's' : ''} · ${formatChatTime(data.mine.latestAt)}` : 'Tap to add a status update'}
              </Text>
            </View>
            {data.mine && (
              <Pressable onPress={() => setComposer(true)} hitSlop={8} style={{ padding: 6 }}>
                <Icon name="add-circle-outline" size={24} color={theme.primary} />
              </Pressable>
            )}
          </ClaySurface>

          {data.others.length > 0 && (
            <>
              <Text style={[type.labelMd, { color: theme.muted, paddingHorizontal: 8, marginTop: 8 }]}>RECENT UPDATES</Text>
              {data.others.map((g) => (
                <ClaySurface key={g.user.id} style={s.row} radius={radius.md} onPress={() => openViewer(g)}>
                  <View style={[s.ring, { borderColor: g.allViewed ? theme.cardAlt : theme.accent }]}>
                    <Avatar uri={g.user.avatar} name={g.user.name} id={g.user.id} size={48} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <EmojiText style={[type.headlineSm, { color: theme.text }]}>{g.user.name}</EmojiText>
                    <Text style={[type.bodySm, { color: theme.subtext, marginTop: 3 }]}>{formatChatTime(g.latestAt)}</Text>
                  </View>
                </ClaySurface>
              ))}
            </>
          )}

          {!data.others.length && !data.mine && (
            <Text style={[type.bodySm, { color: theme.muted, textAlign: 'center', padding: 40, lineHeight: 21 }]}>
              No status updates yet. Share what's on your mind — it disappears after 24 hours.
            </Text>
          )}
        </ScrollView>
      )}

      <Pressable
        onPress={() => setComposer(true)}
        style={({ pressed }) => [s.fab, { backgroundColor: theme.accent }, pressed ? clayPressed(theme.shadowTint) : clayFor(theme, 3)]}
      >
        <Icon name="create-outline" size={24} color={theme.onAccent} />
      </Pressable>

      {/* composer */}
      <Modal visible={composer} animationType="slide" onRequestClose={() => setComposer(false)}>
        <View style={[s.composer, { backgroundColor: bg }]}>
          <Pressable style={s.closeBtn} onPress={() => setComposer(false)}>
            <Icon name="close" size={26} color={tokens.onPrimaryFixed} />
          </Pressable>
          <TextInput
            style={s.composerInput}
            placeholder="Type a status…"
            placeholderTextColor="rgba(0,33,19,0.4)"
            value={body}
            onChangeText={setBody}
            multiline autoFocus textAlign="center"
          />
          <View style={s.colorRow}>
            {BG_COLORS.map((c) => (
              <Pressable key={c} onPress={() => setBg(c)} style={[s.swatch, { backgroundColor: c }, bg === c && s.swatchActive, clayFor(theme, 1)]} />
            ))}
          </View>
          <Pressable onPress={post} style={({ pressed }) => [s.postBtn, { backgroundColor: '#fff' }, pressed ? clayPressed(theme.shadowTint) : clayFor(theme, 3)]}>
            <Icon name="send" size={21} color={tokens.primary} />
          </Pressable>
        </View>
      </Modal>

      {/* viewer */}
      <Modal visible={!!viewer} animationType="fade" onRequestClose={() => { setViewer(null); load(); }}>
        {current && (
          <Pressable style={[s.viewer, { backgroundColor: current.bg }]} onPress={nextStatus}>
            <View style={s.progressRow}>
              {viewer.group.items.map((_, i) => (
                <View key={i} style={[s.progressBar, { backgroundColor: i <= viewer.index ? tokens.onPrimaryFixed : 'rgba(0,33,19,0.25)' }]} />
              ))}
            </View>
            <View style={s.viewerHeader}>
              <Avatar uri={viewer.group.user.avatar} name={viewer.group.user.name} id={viewer.group.user.id} size={42} />
              <View style={{ flex: 1 }}>
                <EmojiText style={[type.headlineSm, { color: tokens.onPrimaryFixed }]}>
                  {viewer.group.user.id === user.id ? 'My status' : viewer.group.user.name}
                </EmojiText>
                <Text style={[type.bodySm, { color: 'rgba(0,33,19,0.6)' }]}>{formatChatTime(current.createdAt)}</Text>
              </View>
              <Pressable onPress={() => { setViewer(null); load(); }} hitSlop={10}>
                <Icon name="close" size={25} color={tokens.onPrimaryFixed} />
              </Pressable>
            </View>
            <View style={s.viewerBody}>
              <EmojiText style={s.viewerText}>{current.body}</EmojiText>
            </View>
            <Text style={[type.bodySm, { color: 'rgba(0,33,19,0.45)', textAlign: 'center', paddingBottom: 34 }]}>
              Tap anywhere to continue
            </Text>
          </Pressable>
        )}
      </Modal>
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  header: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, minHeight: 84, justifyContent: 'center' },
  headerTitle: { ...type.displayLg, color: t.text, letterSpacing: 0.4 },
  scroll: { paddingHorizontal: 20, paddingBottom: 110, gap: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16 },
  plus: { position: 'absolute', right: -2, bottom: -2, width: 24, height: 24, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', borderWidth: 2.5 },
  ring: { borderWidth: 3, borderRadius: radius.full, padding: 3 },
  fab: { position: 'absolute', right: 20, bottom: 24, width: 60, height: 60, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  composer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  closeBtn: { position: 'absolute', top: 48, left: 24, padding: 8 },
  composerInput: { ...type.displayLg, fontSize: 28, color: tokens.onPrimaryFixed, textAlign: 'center', width: '100%', maxHeight: 260, outlineStyle: 'none' },
  colorRow: { position: 'absolute', bottom: 44, left: 24, flexDirection: 'row', gap: 12 },
  swatch: { width: 34, height: 34, borderRadius: radius.full },
  swatchActive: { borderWidth: 3, borderColor: '#fff' },
  postBtn: { position: 'absolute', bottom: 38, right: 24, width: 56, height: 56, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  viewer: { flex: 1, paddingTop: 48 },
  progressRow: { flexDirection: 'row', gap: 5, paddingHorizontal: 16, marginBottom: 14 },
  progressBar: { flex: 1, height: 4, borderRadius: radius.full },
  viewerHeader: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20 },
  viewerBody: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  viewerText: { ...type.displayLg, fontSize: 28, color: tokens.onPrimaryFixed, textAlign: 'center', lineHeight: 40 },
});
