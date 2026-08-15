import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, Modal, TextInput, RefreshControl, ActivityIndicator,
} from 'react-native';
import Icon from '../icons/Icon';
import { EmojiText } from '../icons/Emoji';
import { api } from '../api';
import { useAuth } from '../store/AuthContext';
import { useTheme } from '../store/ThemeContext';
import { Avatar, formatChatTime, PaperSurface, PaperCard, Rule } from '../components/common';
import { radius, type, inkBox, marker, dashedRule, tokens } from '../theme';

// paper-and-ink status backgrounds
const BG_COLORS = ['#FFE24D', '#1c1b1b', '#e2e3de', '#fdf8f8', '#c8c6c5', '#5d5f5b'];

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
          <PaperSurface style={s.row} onPress={() => (data.mine ? openViewer(data.mine) : setComposer(true))} dogEar>
            <View>
              <Avatar uri={user?.avatar} name={user?.name} id={user?.id} size={56} />
              {!data.mine && (
                <View style={[s.plus, { backgroundColor: theme.highlighter, borderColor: theme.ink }]}>
                  <Icon name="add" size={12} color={theme.ink} />
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
          </PaperSurface>

          {data.others.length > 0 && (
            <>
              <Text style={[type.labelXs, { color: theme.muted, paddingHorizontal: 2, marginTop: 10, marginBottom: 2 }]}>RECENT UPDATES</Text>
              {data.others.map((g) => (
                <PaperSurface key={g.user.id} style={s.row} onPress={() => openViewer(g)} dogEar>
                  <View style={[s.ring, { borderColor: g.allViewed ? theme.graphiteLine : theme.ink, borderStyle: g.allViewed ? 'dashed' : 'solid' }]}>
                    <Avatar uri={g.user.avatar} name={g.user.name} id={g.user.id} size={48} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <EmojiText style={[type.headlineSm, { color: theme.text }]}>{g.user.name}</EmojiText>
                    <Text style={[type.bodySm, { color: theme.subtext, marginTop: 3 }]}>{formatChatTime(g.latestAt)}</Text>
                  </View>
                </PaperSurface>
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
        style={({ pressed }) => [s.fab, inkBox(theme, 'bold'), { backgroundColor: pressed ? theme.highlighter : theme.ink }]}
      >
        <Icon name="create-outline" size={21} color={theme.onPrimary} />
      </Pressable>

      {/* composer */}
      <Modal visible={composer} animationType="slide" onRequestClose={() => setComposer(false)}>
        <View style={[s.composer, { backgroundColor: bg }]}>
          <Pressable style={s.closeBtn} onPress={() => setComposer(false)}>
            <Icon name="close" size={24} color={bg === '#1c1b1b' ? '#fdf8f8' : tokens.onSurface} />
          </Pressable>
          <TextInput
            style={s.composerInput}
            placeholder="Type a status…"
            placeholderTextColor={bg === '#1c1b1b' ? 'rgba(253,248,248,0.45)' : 'rgba(28,27,27,0.4)'}
            value={body}
            onChangeText={setBody}
            multiline autoFocus textAlign="center"
          />
          <View style={s.colorRow}>
            {BG_COLORS.map((c) => (
              <Pressable key={c} onPress={() => setBg(c)} style={[s.swatch, { backgroundColor: c, borderWidth: 1.5, borderColor: tokens.onSurface }, bg === c && s.swatchActive]} />
            ))}
          </View>
          <Pressable onPress={post} style={({ pressed }) => [s.postBtn, inkBox(theme, 'bold', tokens.onSurface), { backgroundColor: pressed ? tokens.highlighter : '#fdf8f8' }]}>
            <Icon name="send" size={19} color={tokens.onSurface} />
          </Pressable>
        </View>
      </Modal>

      {/* viewer */}
      <Modal visible={!!viewer} animationType="fade" onRequestClose={() => { setViewer(null); load(); }}>
        {current && (
          <Pressable style={[s.viewer, { backgroundColor: current.bg }]} onPress={nextStatus}>
            <View style={s.progressRow}>
              {viewer.group.items.map((_, i) => (
                <View key={i} style={[s.progressBar, { backgroundColor: i <= viewer.index ? tokens.onSurface : 'rgba(28,27,27,0.22)' }]} />
              ))}
            </View>
            <View style={s.viewerHeader}>
              <Avatar uri={viewer.group.user.avatar} name={viewer.group.user.name} id={viewer.group.user.id} size={42} />
              <View style={{ flex: 1 }}>
                <EmojiText style={[type.headlineSm, { color: tokens.onSurface }]}>
                  {viewer.group.user.id === user.id ? 'My status' : viewer.group.user.name}
                </EmojiText>
                <Text style={[type.labelXs, { color: 'rgba(28,27,27,0.55)' }]}>{formatChatTime(current.createdAt)}</Text>
              </View>
              <Pressable onPress={() => { setViewer(null); load(); }} hitSlop={10}>
                <Icon name="close" size={23} color={tokens.onSurface} />
              </Pressable>
            </View>
            <View style={s.viewerBody}>
              <EmojiText style={s.viewerText}>{current.body}</EmojiText>
            </View>
            <Text style={[type.labelXs, { color: 'rgba(28,27,27,0.4)', textAlign: 'center', paddingBottom: 34 }]}>
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
  headerTitle: { ...type.headlineLg, color: t.text },
  scroll: { paddingHorizontal: 20, paddingBottom: 110, gap: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 14 },
  plus: { position: 'absolute', right: -5, bottom: -5, width: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  ring: { borderWidth: 2, padding: 3 },
  fab: { position: 'absolute', right: 24, bottom: 26, width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  composer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  closeBtn: { position: 'absolute', top: 48, left: 24, padding: 8 },
  composerInput: { ...type.headlineMd, fontSize: 26, color: tokens.onSurface, textAlign: 'center', width: '100%', maxHeight: 260, outlineStyle: 'none' },
  colorRow: { position: 'absolute', bottom: 44, left: 24, flexDirection: 'row', gap: 12 },
  swatch: { width: 30, height: 30 },
  swatchActive: { borderWidth: 3 },
  postBtn: { position: 'absolute', bottom: 38, right: 24, width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  viewer: { flex: 1, paddingTop: 48 },
  progressRow: { flexDirection: 'row', gap: 5, paddingHorizontal: 16, marginBottom: 14 },
  progressBar: { flex: 1, height: 3 },
  viewerHeader: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20 },
  viewerBody: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  viewerText: { ...type.headlineMd, fontSize: 26, color: tokens.onSurface, textAlign: 'center', lineHeight: 40 },
});
