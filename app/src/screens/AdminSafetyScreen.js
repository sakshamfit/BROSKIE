import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView, TextInput, FlatList,
  ActivityIndicator, Modal, RefreshControl, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../icons/Icon';
import { api } from '../api';
import { useAuth } from '../store/AuthContext';
import { useChat } from '../store/ChatContext';
import { useTheme } from '../store/ThemeContext';
import { Avatar, PaperCard, TapeChip, Rule, InkButton, InkField, GoldTick, hasGoldTick } from '../components/common';
import { type, inkBox, marker, dashedRule, radius, raised } from '../theme';
import { haptic } from '../motion';
import { confirm } from '../hooks/confirm';
import { useDebouncedCallback } from '../rateLimit';

/* ------------------------------------------------------------------ */
/* Admin Safety & Moderation Center                                    */
/* ------------------------------------------------------------------ */
/*
 * Private to accounts with the backend `admin` role. The UI is hidden for
 * normal users, but EVERY request is re-verified server-side — nothing here
 * is security by obscurity. Denser than the consumer screens by design.
 *
 * Sections: Overview (counts + recent alerts), Cases (filter/search/sort +
 * detail review + enforcement), Audit (append-only log), Settings.
 * Realtime: HIGH/CRITICAL detections arrive over the socket and refresh the
 * dashboard without a pull.
 */

const SEVERITY_TONE = {
  CRITICAL: { emoji: '🔴', color: '#d13c3c', bg: 'rgba(209,60,60,0.12)' },
  HIGH: { emoji: '🚨', color: '#e07a2e', bg: 'rgba(224,122,46,0.12)' },
  MEDIUM: { emoji: '⚠', color: '#c9a227', bg: 'rgba(201,162,39,0.12)' },
  LOW: { emoji: '·', color: '#8a8a86', bg: 'rgba(138,138,134,0.10)' },
  INFO: { emoji: '·', color: '#8a8a86', bg: 'rgba(138,138,134,0.10)' },
};

const SEV_FILTERS = ['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const CAT_FILTERS = [
  ['threat', 'Threats'], ['violence', 'Violence'], ['harassment', 'Harassment'],
  ['hate', 'Hate'], ['spam', 'Spam'], ['scam', 'Scams'], ['extremism', 'Terrorism'],
  ['child_safety', 'Child safety'], ['other', 'Other'],
];
const SOURCE_LABEL = { auto: '🤖 Automated Detection', user: '👤 User Report', mixed: '🤖 + 👤 Multiple Signals' };
const REPORT_REASONS = [
  ['harassment', 'Harassment'], ['threat', 'Threat'], ['hate', 'Hate'], ['violence', 'Violence'],
  ['spam', 'Spam'], ['scam', 'Scam'], ['sexual_exploitation', 'Sexual content'],
  ['child_safety', 'Child safety'], ['extremism', 'Terrorism/extremism'], ['other', 'Other'],
];
const timeAgo = (ts) => {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
const fullTime = (ts) => new Date(ts).toLocaleString();

export default function AdminSafetyScreen({ navigation }) {
  const { user } = useAuth();
  const { onModerationEvent } = useChat();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const s = makeStyles(theme);

  const [tab, setTab] = useState('overview'); // overview | cases | audit | settings
  const [overview, setOverview] = useState(null);
  const [cases, setCases] = useState([]);
  const [casesMeta, setCasesMeta] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openCase, setOpenCase] = useState(null);   // case detail object
  const [caseLoading, setCaseLoading] = useState(false);
  const [reviewUser, setReviewUser] = useState(null); // user panel id
  const [liveAlert, setLiveAlert] = useState(null);

  // case filters
  const [severity, setSeverity] = useState('ALL');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [source, setSource] = useState('');
  const [sort, setSort] = useState('new');
  const [q, setQ] = useState('');

  const isAdmin = user?.role === 'admin';

  const loadOverview = useCallback(async () => {
    try { setOverview(await api.adminModerationOverview()); } catch {}
  }, []);

  const loadCases = useCallback(async () => {
    try {
      const params = { sort };
      if (severity !== 'ALL') params.severity = severity;
      if (category) params.category = category;
      if (source) params.source = source;
      if (status === 'ACTIVE') params.status = 'OPEN,UNDER_REVIEW,ESCALATED'.split(',');
      else if (status !== 'ALL') params.status = status;
      if (q.trim()) params.q = q.trim();
      const r = await api.adminModerationCases(params);
      setCases(r.cases || []);
      setCasesMeta({ hasMore: r.hasMore });
    } catch {}
  }, [severity, category, status, source, sort, q]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadOverview(), loadCases()]);
  }, [loadOverview, loadCases]);

  useEffect(() => { refreshAll().finally(() => setLoading(false)); }, [refreshAll]);

  // realtime safety alerts — dashboard refreshes itself, no pull needed.
  useEffect(() => {
    if (!onModerationEvent) return undefined;
    return onModerationEvent((payload) => {
      if (payload?.severity === 'HIGH' || payload?.severity === 'CRITICAL') {
        setLiveAlert(payload);
      }
      refreshAll();
      if (openCase && payload.caseId === openCase.case?.id) {
        api.adminModerationCase(openCase.case.id).then(setOpenCase).catch(() => {});
      }
    });
  }, [onModerationEvent, refreshAll, openCase]);

  // Debounced case search: the filter box pauses 250ms before the
  // moderation API is hit, instead of one request per keystroke. Filter
  // chips (severity/category/status) reload through the same path.
  const debouncedLoadCases = useDebouncedCallback(() => loadCases(), 250);
  useEffect(() => {
    debouncedLoadCases();
  }, [q, loadCases, debouncedLoadCases]);

  if (!isAdmin) {
    return (
      <View style={[s.denyRoot, { paddingTop: insets.top }]}>
        <Icon name="lock-closed-outline" size={42} color={theme.muted} />
        <Text style={[type.headlineSm, { color: theme.text, marginTop: 14 }]}>Access denied</Text>
        <Text style={[type.bodySm, { color: theme.muted, marginTop: 6 }]}>
          The Safety Center is restricted to +one administrators.
        </Text>
      </View>
    );
  }

  const openCaseDetail = async (id) => {
    setCaseLoading(true);
    setOpenCase({ loading: true });
    try {
      setLiveAlert(null);
      const detail = await api.adminModerationCase(id);
      setOpenCase(detail);
    } catch {
      setOpenCase(null);
    } finally {
      setCaseLoading(false);
    }
  };

  const review = async (caseId, action, reasonPrompt) => {
    let reason = '';
    if (reasonPrompt) {
      // Minimal inline prompt — the app has no generic text-input modal, so
      // required reasons use a small sheet state.
      reason = reasonPrompt;
    }
    try {
      await api.adminModerationReview(caseId, action, reason);
      await Promise.all([refreshAll(), openCaseDetail(caseId)]);
    } catch (e) {
      await confirm(e.message || 'Action failed', { title: 'Safety Center', confirmLabel: 'OK' });
    }
  };

  const userAction = async (targetId, action, opts = {}) => {
    const needsConfirm = ['ban', 'suspend'].includes(action);
    const labels = {
      warn: 'Send this user a warning?', restrict: 'Restrict this user\u2019s messaging?',
      suspend: `Temporarily suspend ${opts.days || 7} days? They cannot sign in.`,
      ban: `Are you sure you want to permanently ban @${reviewUser?.user?.username || openCase?.user?.username || 'this user'}?`,
    };
    if (needsConfirm) {
      const ok = await confirm(labels[action] || 'Proceed?', {
        title: 'Irreversible action', confirmLabel: 'Confirm', destructive: true,
      });
      if (!ok) return;
    }
    try {
      await api.adminModerationUserAction(targetId, {
        action,
        reason: opts.reason || '',
        days: opts.days,
        caseId: opts.caseId,
        confirmIrreversible: needsConfirm,
      });
      await refreshAll();
      if (opts.caseId) await openCaseDetail(opts.caseId);
    } catch (e) {
      await confirm(e.message || 'Action failed', { title: 'Safety Center', confirmLabel: 'OK' });
    }
  };

  const Tab = ({ key: k, label }) => (
    <Pressable key={k} onPress={() => setTab(k)} style={[s.tabBtn, tab === k && { backgroundColor: theme.ink, borderColor: theme.ink }]}>
      <Text style={[type.labelSm, { color: tab === k ? theme.onPrimary : theme.text }]}>{label.toUpperCase()}</Text>
    </Pressable>
  );

  return (
    <View style={[s.root, { backgroundColor: theme.bg }]}>
      <View style={[s.header, { paddingTop: Math.max(insets.top, 12) }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={{ padding: 6 }}>
          <Icon name="arrow-back" size={22} color={theme.ink} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[type.headlineMd, { color: theme.text }]}>Safety Center</Text>
          <Text style={[type.labelXs, { color: theme.muted, marginTop: 2 }]}>
            ADMIN ▸ SAFETY &amp; MODERATION — PRIVATE
          </Text>
        </View>
        {!!liveAlert && (
          <Pressable onPress={() => openCaseDetail(liveAlert.caseId)} style={[s.livePill, { borderColor: theme.danger }]}>
            <Text style={[type.labelXs, { color: theme.danger }]}>NEW ALERT</Text>
          </Pressable>
        )}
      </View>

      <View style={[s.tabRow, { borderColor: theme.ink }]}>
        <Tab key="overview" label="Overview" />
        <Tab key="cases" label="Cases" />
        <Tab key="audit" label="Audit" />
        <Tab key="settings" label="Settings" />
      </View>

      {tab === 'overview' && (
        <OverviewTab theme={theme} s={s} overview={overview} loading={loading} onOpenCase={openCaseDetail} onGoCases={() => setTab('cases')} />
      )}
      {tab === 'cases' && (
        <CasesTab
          theme={theme} s={s} cases={cases} meta={casesMeta} loading={loading}
          severity={severity} setSeverity={setSeverity} category={category} setCategory={setCategory}
          status={status} setStatus={setStatus} source={source} setSource={setSource}
          sort={sort} setSort={setSort} q={q} setQ={setQ}
          onRefresh={() => refreshAll()} onOpenCase={openCaseDetail}
        />
      )}
      {tab === 'audit' && <AuditTab theme={theme} s={s} />}
      {tab === 'settings' && <SettingsTab theme={theme} s={s} onChanged={refreshAll} />}

      {/* Case detail sheet */}
      <Modal visible={!!openCase} animationType="slide" onRequestClose={() => setOpenCase(null)}>
        {openCase && !openCase.loading && (
          <CaseDetail
            theme={theme} s={s} detail={openCase}
            onClose={() => setOpenCase(null)}
            onReview={review}
            onUserAction={userAction}
            onReviewUser={(id) => { setOpenCase(null); setReviewUser(id); }}
          />
        )}
        {openCase?.loading && (
          <View style={s.denyRoot}><ActivityIndicator color={theme.ink} /></View>
        )}
      </Modal>

      {/* User moderation panel */}
      <Modal visible={!!reviewUser} animationType="slide" onRequestClose={() => setReviewUser(null)}>
        {reviewUser && (
          <UserPanel theme={theme} s={s} userId={reviewUser} onClose={() => setReviewUser(null)} onAction={userAction} />
        )}
      </Modal>
    </View>
  );
}

/* ------------------------------------------------------------------ */

function OverviewTab({ theme, s, overview, loading, onOpenCase, onGoCases }) {
  if (loading && !overview) return <View style={s.center}><ActivityIndicator color={theme.ink} /></View>;
  if (!overview) return <View style={s.center}><Text style={[type.bodySm, { color: theme.muted }]}>Could not load the Safety Center.</Text></View>;
  const cards = [
    ['Critical', overview.counts.critical, '#d13c3c'],
    ['High', overview.counts.high, '#e07a2e'],
    ['Medium', overview.counts.medium, '#c9a227'],
    ['Open cases', overview.openCases, theme.ink],
  ];
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
      <View style={s.statRow}>
        {cards.map(([label, value, color]) => (
          <View key={label} style={[s.statCard, inkBox(theme, 'thin')]}>
            <Text style={[type.headlineLg, { color }]}>{value ?? 0}</Text>
            <Text style={[type.labelXs, { color: theme.muted, marginTop: 4 }]}>{label.toUpperCase()}</Text>
          </View>
        ))}
      </View>

      <Rule />
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={[type.labelSm, { color: theme.ink, flex: 1 }]}>RECENT ALERTS</Text>
        <Pressable onPress={onGoCases} hitSlop={8}>
          <Text style={[type.labelXs, { color: theme.muted }]}>ALL CASES →</Text>
        </Pressable>
      </View>

      {(overview.recent || []).length === 0 && (
        <Text style={[type.bodySm, { color: theme.muted, textAlign: 'center', marginVertical: 24 }]}>
          Nothing needs review. The detectors are watching quietly.
        </Text>
      )}
      {(overview.recent || []).map((c) => {
        const tone = SEVERITY_TONE[c.severity] || SEVERITY_TONE.LOW;
        return (
          <Pressable key={c.id} onPress={() => onOpenCase(c.id)} style={({ pressed }) => [s.alertRow, inkBox(theme, 'thin'), pressed && marker(theme, 1)]}>
            <Text style={{ fontSize: 18 }}>{tone.emoji}</Text>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={[type.labelSm, { color: tone.color }]}>{c.severity}</Text>
                <Text style={[type.labelXs, { color: theme.muted }]}>· {timeAgo(c.updatedAt || c.createdAt)}</Text>
              </View>
              <Text style={[type.bodyMd, { color: theme.text, marginTop: 2 }]} numberOfLines={1}>
                {c.reason || c.category}
              </Text>
              <Text style={[type.labelXs, { color: theme.muted, marginTop: 2 }]} numberOfLines={1}>
                @{c.username || 'unknown'} · {SOURCE_LABEL[c.source] || c.source} {c.signals > 1 ? `· ${c.signals} signals` : ''}
              </Text>
            </View>
            <Icon name="chevron-forward-outline" size={16} color={theme.muted} />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function CasesTab(props) {
  const { theme, s, cases, severity, setSeverity, category, setCategory, status, setStatus, source, setSource, sort, setSort, q, setQ, onOpenCase, onRefresh } = props;
  return (
    <View style={{ flex: 1 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 8, gap: 6 }}>
        {SEV_FILTERS.map((sv) => (
          <Pressable key={sv} onPress={() => setSeverity(sv)}>
            <TapeChip label={sv} tone={severity === sv ? 'accent' : 'ink'} />
          </Pressable>
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 6, gap: 6 }}>
        {CAT_FILTERS.map(([k, label]) => (
          <Pressable key={k} onPress={() => setCategory(category === k ? '' : k)}>
            <TapeChip label={label} tone={category === k ? 'accent' : 'ink'} />
          </Pressable>
        ))}
      </ScrollView>
      <View style={{ paddingHorizontal: 14, gap: 6, paddingBottom: 8 }}>
        <InkField style={s.search} focused={!!q}>
          <Icon name="search" size={17} color={theme.muted} />
          <TextInput
            value={q} onChangeText={setQ} placeholder="Search case id, @username, message or chat id"
            placeholderTextColor={theme.muted} autoCorrect={false} style={s.searchInput}
          />
          {!!q && <Pressable onPress={() => setQ('')} hitSlop={8}><Icon name="close" size={15} color={theme.muted} /></Pressable>}
        </InkField>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {['ACTIVE', 'ALL', 'CLOSED', 'FALSE_POSITIVE'].map((st) => (
            <Pressable key={st} onPress={() => setStatus(st)}>
              <TapeChip label={st === 'FALSE_POSITIVE' ? 'FALSE +' : st} tone={status === st ? 'accent' : 'ink'} />
            </Pressable>
          ))}
          <View style={{ width: 1, backgroundColor: theme.graphiteLine, marginHorizontal: 4 }} />
          {['auto', 'user', 'mixed'].map((sc) => (
            <Pressable key={sc} onPress={() => setSource(source === sc ? '' : sc)}>
              <TapeChip label={sc.toUpperCase()} tone={source === sc ? 'accent' : 'ink'} />
            </Pressable>
          ))}
          <View style={{ width: 1, backgroundColor: theme.graphiteLine, marginHorizontal: 4 }} />
          {[['new', 'NEWEST'], ['old', 'OLDEST'], ['severity', 'SEVERITY'], ['confidence', 'CONFIDENCE'], ['unreviewed', 'UNREVIEWED']].map(([k, label]) => (
            <Pressable key={k} onPress={() => setSort(k)}>
              <TapeChip label={label} tone={sort === k ? 'accent' : 'ink'} />
            </Pressable>
          ))}
        </View>
      </View>
      <FlatList
        data={cases}
        keyExtractor={(c) => String(c.id)}
        contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 30 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={onRefresh} tintColor={theme.ink} />}
        renderItem={({ item }) => {
          const tone = SEVERITY_TONE[item.severity] || SEVERITY_TONE.LOW;
          return (
            <Pressable onPress={() => onOpenCase(item.id)} style={({ pressed }) => [s.alertRow, inkBox(theme, 'thin'), pressed && marker(theme, 1)]}>
              <Text style={{ fontSize: 18 }}>{tone.emoji}</Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={[type.labelSm, { color: tone.color }]}>{item.severity}</Text>
                  <Text style={[type.labelXs, { color: theme.muted }]}>#{item.id} · {timeAgo(item.updatedAt || item.createdAt)}</Text>
                </View>
                <Text style={[type.bodyMd, { color: theme.text, marginTop: 2 }]} numberOfLines={1}>{item.reason}</Text>
                <Text style={[type.labelXs, { color: theme.muted, marginTop: 2 }]} numberOfLines={1}>
                  @{item.username} · {item.category} · {item.status}
                </Text>
              </View>
              <Icon name="chevron-forward-outline" size={16} color={theme.muted} />
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <Text style={[type.bodySm, { color: theme.muted, textAlign: 'center', marginVertical: 30 }]}>
            No cases match these filters.
          </Text>
        }
      />
    </View>
  );
}

function CaseDetail({ theme, s, detail, onClose, onReview, onUserAction, onReviewUser }) {
  const c = detail.case;
  const tone = SEVERITY_TONE[c.severity] || SEVERITY_TONE.LOW;
  const [reason, setReason] = useState('');
  const [actionBusy, setActionBusy] = useState('');
  const insets = useSafeAreaInsets();

  const withReason = (fn) => async (...args) => { setActionBusy('x'); try { await fn(...args); } finally { setActionBusy(''); } };

  const Act = ({ label, run, destructive, filled }) => (
    <Pressable
      disabled={!!actionBusy}
      onPress={run}
      style={({ pressed }) => [
        s.actBtn,
        { borderColor: destructive ? theme.danger : theme.ink },
        filled && { backgroundColor: theme.ink },
        pressed && marker(theme, 1),
      ]}
    >
      <Text style={[type.labelSm, { color: filled ? theme.onPrimary : destructive ? theme.danger : theme.ink }]}>{label.toUpperCase()}</Text>
    </Pressable>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: Math.max(insets.top, 12), gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Pressable onPress={onClose} hitSlop={8} style={{ padding: 6 }}>
            <Icon name="arrow-back" size={22} color={theme.ink} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={[type.headlineMd, { color: theme.text }]}>Case #{c.id}</Text>
            <Text style={[type.labelXs, { color: theme.muted }]}>{SOURCE_LABEL[c.source] || c.source}{c.signals > 1 ? ` · ${c.signals} detection signals` : ''}</Text>
          </View>
          <View style={[s.sevBadge, { backgroundColor: tone.bg, borderColor: tone.color }]}>
            <Text style={[type.labelSm, { color: tone.color }]}>{tone.emoji} {c.severity}</Text>
          </View>
        </View>

        <PaperCard style={{ padding: 14 }} weight="thin">
          <Row theme={theme} label="Category" value={c.category?.replace(/_/g, ' ')} />
          <Row theme={theme} label="Confidence" value={c.confidence != null ? `${Math.round(c.confidence * 100)}%` : '—'} />
          <Row theme={theme} label="Status" value={c.status} />
          <Row theme={theme} label="Reported user" value={`@${c.username || 'unknown'} (${c.userModeration})`} />
          <Row theme={theme} label="Conversation" value={detail.conversation?.name || '—'} />
          <Row theme={theme} label="Time" value={fullTime(c.createdAt)} />
        </PaperCard>

        <PaperCard style={{ padding: 14 }} weight="thin">
          <Text style={[type.labelXs, { color: theme.muted }]}>DETECTED MESSAGE {detail.message?.deleted ? '· (REMOVED)' : ''}</Text>
          <Text style={[type.bodyMd, { color: theme.text, marginTop: 8, fontStyle: 'italic' }]}>
            “{detail.message?.body || c.snapshot || '(no text preserved)'}”
          </Text>
          <Text style={[type.labelXs, { color: theme.muted, marginTop: 10 }]}>DETECTION REASON: {c.reason}</Text>
        </PaperCard>

        {!!detail.reports?.length && (
          <PaperCard style={{ padding: 14 }} weight="thin">
            <Text style={[type.labelXs, { color: theme.muted, marginBottom: 8 }]}>USER REPORTS ({detail.reports.length})</Text>
            {detail.reports.map((r) => (
              <Text key={r.id} style={[type.bodySm, { color: theme.text }]}>
                · @{r.reporter?.username || 'deleted'} — {r.reason}{r.note ? `: “${r.note}”` : ''}
              </Text>
            ))}
          </PaperCard>
        )}

        {!!detail.actions?.length && (
          <PaperCard style={{ padding: 14 }} weight="thin">
            <Text style={[type.labelXs, { color: theme.muted, marginBottom: 8 }]}>CASE HISTORY</Text>
            {detail.actions.map((a) => (
              <Text key={a.id} style={[type.bodySm, { color: theme.subtext }]}>
                · {a.admin ? `@${a.admin}` : 'admin'} → {a.action}{a.reason ? ` (${a.reason})` : ''} · {timeAgo(a.createdAt)}
              </Text>
            ))}
          </PaperCard>
        )}

        <Rule />
        <Text style={[type.labelXs, { color: theme.muted }]}>REVIEW</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Act label="Confirm" run={withReason(() => onReview(c.id, 'confirm', reason))} />
          <Act label="Dismiss" run={withReason(() => onReview(c.id, 'dismiss', reason))} />
          <Act label="Escalate" run={withReason(() => onReview(c.id, 'escalate', reason))} />
          <Act label="False positive" run={withReason(() => onReview(c.id, 'false_positive', reason || 'not a real concern'))} />
          <Act label="Under review" run={withReason(() => onReview(c.id, 'under_review', reason))} />
        </View>

        <Rule />
        <Text style={[type.labelXs, { color: theme.muted }]}>ENFORCEMENT (IRREVERSIBLE ACTIONS ASK FOR CONFIRMATION)</Text>
        <InkField style={s.search} focused={!!reason}>
          <Icon name="pencil-outline" size={15} color={theme.muted} />
          <TextInput
            value={reason} onChangeText={setReason}
            placeholder="Reason (recorded in the audit log)"
            placeholderTextColor={theme.muted} style={s.searchInput} multiline={false}
          />
        </InkField>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Act label="Warn" run={withReason(() => onUserAction(c.userId, 'warn', { reason, caseId: c.id }))} />
          <Act label="Restrict messaging" run={withReason(() => onUserAction(c.userId, 'restrict', { reason, caseId: c.id }))} />
          <Act label="Suspend 7d" destructive run={withReason(() => onUserAction(c.userId, 'suspend', { reason, caseId: c.id, days: 7 }))} />
          <Act label="Ban permanently" destructive run={withReason(() => onUserAction(c.userId, 'ban', { reason, caseId: c.id }))} />
          <Act label="Remove content" destructive run={withReason(async () => { await api.adminModerationRemoveContent(c.id, reason); })} />
          <Act label="Review user" run={() => onReviewUser(c.userId)} />
          <Act label="No action" run={withReason(() => onUserAction(c.userId, 'no_action', { reason }))} />
        </View>

        {!!detail.userHistory?.length && (
          <Text style={[type.labelXs, { color: theme.muted, marginTop: 6 }]}>
            {detail.userHistory.length} earlier case(s) for this user — open from the Users filter.
          </Text>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Row({ theme, label, value }) {
  return (
    <View style={{ flexDirection: 'row', paddingVertical: 4 }}>
      <Text style={[type.bodySm, { color: theme.muted, width: 120 }]}>{label}</Text>
      <Text style={[type.bodySm, { color: theme.text, flex: 1 }]}>{value ?? '—'}</Text>
    </View>
  );
}

function UserPanel({ theme, s, userId, onClose, onAction }) {
  const [data, setData] = useState(null);
  const insets = useSafeAreaInsets();
  const load = useCallback(async () => {
    try { setData(await api.adminModerationUser(userId)); } catch { setData(null); }
  }, [userId]);
  useEffect(() => { load(); }, [load]);
  const act = async (...args) => { await onAction(...args); load(); };
  const [reason, setReason] = useState('');
  const [tickBusy, setTickBusy] = useState(false);
  const toggleTick = async () => {
    setTickBusy(true); haptic('selection');
    try {
      await api.adminModerationGoldTick(u.id, !u.goldTick);
      await load();
    } catch (e) {
      await confirm(e.message || 'Could not update verification', { title: 'Safety Center', confirmLabel: 'OK' });
    } finally { setTickBusy(false); }
  };
  if (!data) return <View style={[s.denyRoot, { paddingTop: insets.top }]}><ActivityIndicator color={theme.ink} /></View>;
  const u = data.user;
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: Math.max(insets.top, 12), gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Pressable onPress={onClose} hitSlop={8} style={{ padding: 6 }}>
            <Icon name="arrow-back" size={22} color={theme.ink} />
          </Pressable>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Avatar uri={u.avatar} name={u.name} id={u.id} size={40} />
            <View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={[type.headlineSm, { color: theme.text }]}>{u.name}</Text>
                {hasGoldTick(u) && <GoldTick size={14} />}
              </View>
              <Text style={[type.labelXs, { color: theme.muted }]}>@{u.username} · {u.role}</Text>
            </View>
          </View>
          <TapeChip label={u.moderation?.toUpperCase() || 'ACTIVE'} tone={u.moderation === 'active' ? 'ink' : 'accent'} />
        </View>

        <PaperCard style={{ padding: 14 }} weight="thin">
          <Row theme={theme} label="State" value={u.moderation} />
          <Row theme={theme} label="Suspended until" value={u.suspendedUntil ? fullTime(u.suspendedUntil) : '—'} />
          <Row theme={theme} label="Cases" value={`${data.counts.total} total · ${data.counts.confirmed} confirmed · ${data.counts.falsePositives} false positives`} />
          <Row theme={theme} label="Joined" value={fullTime(u.createdAt)} />
        </PaperCard>

        <InkField style={s.search} focused={!!reason}>
          <Icon name="pencil-outline" size={15} color={theme.muted} />
          <TextInput value={reason} onChangeText={setReason} placeholder="Reason for the action below" placeholderTextColor={theme.muted} style={s.searchInput} />
        </InkField>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Pressable
            onPress={toggleTick}
            disabled={tickBusy}
            style={[s.actBtn, { borderColor: theme.ink }, u.goldTick && { backgroundColor: theme.highlighter, borderColor: theme.ink }]}
          >
            <Text style={[type.labelSm, { color: theme.ink }]}>{u.goldTick ? 'GOLD TICK ✓' : 'GOLD TICK'}</Text>
          </Pressable>
          <Pressable onPress={() => act(u.id, 'warn', { reason })} style={[s.actBtn, { borderColor: theme.ink }]}><Text style={[type.labelSm, { color: theme.ink }]}>WARN</Text></Pressable>
          <Pressable onPress={() => act(u.id, 'restrict', { reason })} style={[s.actBtn, { borderColor: theme.ink }]}><Text style={[type.labelSm, { color: theme.ink }]}>RESTRICT</Text></Pressable>
          <Pressable onPress={() => act(u.id, 'unrestrict', { reason })} style={[s.actBtn, { borderColor: theme.ink }]}><Text style={[type.labelSm, { color: theme.ink }]}>UNRESTRICT</Text></Pressable>
          <Pressable onPress={() => act(u.id, 'suspend', { reason, days: 7 })} style={[s.actBtn, { borderColor: theme.danger }]}><Text style={[type.labelSm, { color: theme.danger }]}>SUSPEND 7D</Text></Pressable>
          <Pressable onPress={() => act(u.id, 'unsuspend', { reason })} style={[s.actBtn, { borderColor: theme.ink }]}><Text style={[type.labelSm, { color: theme.ink }]}>UNSUSPEND</Text></Pressable>
          <Pressable onPress={() => act(u.id, 'ban', { reason })} style={[s.actBtn, { borderColor: theme.danger }]}><Text style={[type.labelSm, { color: theme.danger }]}>BAN</Text></Pressable>
          <Pressable onPress={() => act(u.id, 'unban', { reason })} style={[s.actBtn, { borderColor: theme.ink }]}><Text style={[type.labelSm, { color: theme.ink }]}>UNBAN</Text></Pressable>
        </View>

        <Rule />
        <Text style={[type.labelXs, { color: theme.muted }]}>MODERATION HISTORY</Text>
        {data.cases.map((c) => (
          <View key={c.id} style={[s.alertRow, inkBox(theme, 'thin')]}>
            <Text style={{ fontSize: 16 }}>{(SEVERITY_TONE[c.severity] || SEVERITY_TONE.LOW).emoji}</Text>
            <View style={{ flex: 1 }}>
              <Text style={[type.bodySm, { color: theme.text }]} numberOfLines={1}>#{c.id} {c.category} · {c.status}</Text>
              <Text style={[type.labelXs, { color: theme.muted }]}>{c.reason} · {timeAgo(c.createdAt)}</Text>
            </View>
          </View>
        ))}
        {data.cases.length === 0 && <Text style={[type.bodySm, { color: theme.muted }]}>No prior cases.</Text>}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function AuditTab({ theme, s }) {
  const [entries, setEntries] = useState(null);
  const load = useCallback(async () => {
    try { const r = await api.adminModerationAudit(); setEntries(r.entries || []); } catch { setEntries([]); }
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!entries) return <View style={s.center}><ActivityIndicator color={theme.ink} /></View>;
  return (
    <FlatList
      data={entries}
      keyExtractor={(e) => String(e.id)}
      contentContainerStyle={{ padding: 16, gap: 10 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={theme.ink} />}
      renderItem={({ item }) => (
        <View style={[s.alertRow, inkBox(theme, 'thin')]}>
          <Icon name="time-outline" size={16} color={theme.muted} />
          <View style={{ flex: 1 }}>
            <Text style={[type.bodySm, { color: theme.text }]}>
              {item.admin ? `@${item.admin}` : 'admin'} · <Text style={{ fontFamily: 'JetBrainsMono_500Medium' }}>{item.action}</Text>
              {item.target ? ` → ${item.target}` : ''}{item.caseId ? ` · case #${item.caseId}` : ''}
            </Text>
            {!!item.detail && <Text style={[type.labelXs, { color: theme.muted, marginTop: 2 }]}>{item.detail}</Text>}
            <Text style={[type.labelXs, { color: theme.muted, marginTop: 2 }]}>{fullTime(item.createdAt)}</Text>
          </View>
        </View>
      )}
      ListEmptyComponent={<Text style={[type.bodySm, { color: theme.muted, textAlign: 'center', marginVertical: 30 }]}>No admin actions recorded yet.</Text>}
      ListHeaderComponent={<Text style={[type.labelXs, { color: theme.muted }]}>APPEND-ONLY — EVERY ADMIN ACTION IS RECORDED</Text>}
    />
  );
}

function SettingsTab({ theme, s, onChanged }) {
  const [settings, setSettings] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { const r = await api.adminModerationSettings(); setSettings(r.settings); } catch { setSettings(null); }
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!settings) return <View style={s.center}><ActivityIndicator color={theme.ink} /></View>;

  const update = async (patch) => {
    setBusy(true); haptic('selection');
    try {
      const r = await api.adminModerationUpdateSettings(patch);
      setSettings(r.settings);
      onChanged();
    } catch (e) {
      await confirm(e.message || 'Could not save', { title: 'Safety Center', confirmLabel: 'OK' });
    } finally { setBusy(false); }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
      <PaperCard style={{ padding: 14 }} weight="thin">
        <Text style={[type.labelXs, { color: theme.muted, marginBottom: 10 }]}>ALERT PUSH LEVEL — only these create immediate admin notifications</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {['CRITICAL', 'HIGH', 'NONE'].map((level) => (
            <Pressable key={level} disabled={busy} onPress={() => update({ alertPushLevel: level })} style={[s.actBtn, settings.alertPushLevel === level && { backgroundColor: theme.ink, borderColor: theme.ink }]}>
              <Text style={[type.labelSm, { color: settings.alertPushLevel === level ? theme.onPrimary : theme.ink }]}>{level}</Text>
            </Pressable>
          ))}
        </View>
      </PaperCard>

      <PaperCard style={{ padding: 14 }} weight="thin">
        <Text style={[type.labelXs, { color: theme.muted, marginBottom: 10 }]}>CASE CREATION LEVEL — below this, events are only aggregated counters</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {['LOW', 'MEDIUM', 'HIGH'].map((level) => (
            <Pressable key={level} disabled={busy} onPress={() => update({ caseLevel: level })} style={[s.actBtn, settings.caseLevel === level && { backgroundColor: theme.ink, borderColor: theme.ink }]}>
              <Text style={[type.labelSm, { color: settings.caseLevel === level ? theme.onPrimary : theme.ink }]}>{level}</Text>
            </Pressable>
          ))}
        </View>
      </PaperCard>

      <PaperCard style={{ padding: 14 }} weight="thin">
        <Row theme={theme} label="LOW aggregation" value={`${settings.lowAggregationMinutes} min`} />
        <Row theme={theme} label="Retention" value={`${settings.retentionDays} days (closed cases & reports; audit keeps 2×)`} />
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          {[90, 180, 365].map((d) => (
            <Pressable key={d} disabled={busy} onPress={() => update({ retentionDays: d })} style={[s.actBtn, Number(settings.retentionDays) === d && { backgroundColor: theme.ink, borderColor: theme.ink }]}>
              <Text style={[type.labelSm, { color: Number(settings.retentionDays) === d ? theme.onPrimary : theme.ink }]}>{d}D</Text>
            </Pressable>
          ))}
        </View>
      </PaperCard>

      <Text style={[type.bodySm, { color: theme.muted, lineHeight: 19 }]}>
        Privacy: moderation stores message/chat ids plus a bounded text snapshot only — never copies of private conversations. Automated detection prioritizes review; enforcement is always a human decision here. The reported user is never shown alerts or reports.
      </Text>
    </ScrollView>
  );
}

const makeStyles = (t) => StyleSheet.create({
  root: { flex: 1 },
  denyRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: t.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 10 },
  tabRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 14, paddingBottom: 8, borderBottomWidth: 1 },
  tabBtn: { flex: 1, alignItems: 'center', paddingVertical: 8, borderWidth: 1, borderRadius: 999 },
  livePill: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  statRow: { flexDirection: 'row', gap: 10 },
  statCard: { flex: 1, alignItems: 'center', paddingVertical: 16, borderRadius: radius.md },
  alertRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.md, backgroundColor: t.card },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  searchInput: { flex: 1, fontFamily: 'Karla_400Regular', fontSize: 14, color: t.text, padding: 0 },
  sevBadge: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  actBtn: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
});
