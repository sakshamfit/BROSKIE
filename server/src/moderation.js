/* ------------------------------------------------------------------ */
/* Safety & Moderation Center — detection engine + case management    */
/* ------------------------------------------------------------------ */
/*
 * PIPELINE (fires after a message is stored and delivered — messaging is
 * never blocked or delayed by analysis):
 *
 *   message stored → analyze (rules + context scoring) →
 *     safe            → nothing
 *     LOW             → aggregated case (no alert; sampled via settings)
 *     MEDIUM          → reviewable case (dashboard update, no push)
 *     HIGH / CRITICAL → case + realtime admin alert + admin push
 *
 * CONTEXT-AWARENESS: patterns never fire on words alone. Every rule is
 * scored, then contextual signals adjust confidence/severity down:
 * quotations ("he said ..."), educational/news framing ("violence is bad",
 * "article about"), negation, questions. "Violence is harmful." must never
 * produce an alert; "I'm going to hurt you" must. Detection is heuristic and
 * transparent by design: every case records the reason so a human reviews
 * what actually matched. Automated results PRIORITIZE review — they never
 * auto-punish (see enforcement policy below).
 *
 * The classifier is intentionally local (no external AI key, no secrets).
 * A future provider can be slotted behind classifyText() without touching
 * the pipeline.
 */
const db = require('./db');

const now = () => Date.now();

/* ------------------------------------------------------------------ */
/* categories + severities                                            */
/* ------------------------------------------------------------------ */

const CATEGORIES = [
  'threat', 'violence', 'graphic_violence', 'weapons', 'hate', 'harassment',
  'self_harm', 'sexual_exploitation', 'child_safety', 'extremism', 'illegal',
  'scam', 'spam', 'doxxing', 'dangerous', 'profanity', 'other',
];

const SEVERITIES = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const SEVERITY_RANK = { INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
const CASE_STATUSES = ['OPEN', 'UNDER_REVIEW', 'CONFIRMED', 'FALSE_POSITIVE', 'ACTION_TAKEN', 'ESCALATED', 'CLOSED'];

const REPORT_REASONS = {
  harassment: 'Harassment', threat: 'Threat', hate: 'Hate', violence: 'Violence',
  spam: 'Spam', scam: 'Scam', sexual_exploitation: 'Sexual content',
  child_safety: 'Child safety', extremism: 'Terrorism/extremism', other: 'Other',
};

/* ------------------------------------------------------------------ */
/* settings (admin-editable, safe defaults)                           */
/* ------------------------------------------------------------------ */

const DEFAULT_SETTINGS = {
  // Minimum severity that pushes to the admin immediately.
  alertPushLevel: 'HIGH',            // HIGH | CRITICAL | NONE
  // Create reviewable cases from MEDIUM up (LOW events always aggregate
  // silently — counters only — unless this is lowered).
  caseLevel: 'LOW',                  // LOW | MEDIUM | HIGH
  // LOW-event aggregation window: repeated low signals collapse into one
  // case per user/category inside this window.
  lowAggregationMinutes: 60,
  // Retention for closed cases + reports (audit log keeps 2x this).
  retentionDays: 180,
};

function getModerationSettings() {
  const out = { ...DEFAULT_SETTINGS };
  try {
    db.prepare('SELECT key, value FROM moderation_settings').all().forEach(({ key, value }) => {
      if (key in out) out[key] = value;
    });
  } catch {}
  if (!SEVERITIES.includes(out.alertPushLevel)) out.alertPushLevel = DEFAULT_SETTINGS.alertPushLevel;
  if (!['LOW', 'MEDIUM', 'HIGH'].includes(out.caseLevel)) out.caseLevel = DEFAULT_SETTINGS.caseLevel;
  out.lowAggregationMinutes = Number(out.lowAggregationMinutes) || DEFAULT_SETTINGS.lowAggregationMinutes;
  out.retentionDays = Number(out.retentionDays) || DEFAULT_SETTINGS.retentionDays;
  return out;
}

function setModerationSetting(key, value) {
  if (!(key in DEFAULT_SETTINGS)) throw new Error('Unknown setting');
  db.prepare('INSERT INTO moderation_settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

/* ------------------------------------------------------------------ */
/* context signals                                                    */
/* ------------------------------------------------------------------ */

const RE_EDU = /\b(is|are|was|were)\s+(bad|wrong|harmful|never)|(never|don'?t|stop|not)\s+(the\s+)?(answer|solution)|\b(educational|in\s+school|we\s+learned|documentary|history\s+(class|lesson)|study|research|essay|article(?:\s+about)?|news\s+(report|about)|reported\s+that|statistics\s+on)\b|\bviolence\s+(is|has|was|should)\b|\bagainst\s+violence\b/i;
const RE_QUOTE = /["“].+["”]|\bsaid[,:]|says?\s+that|quoted|according\s+to/i;
const RE_QUESTION = /^(why|what|how|is|are|does|do|can)\b.+\?$/i;
const RE_NEGATION = /\b(not|never|no|don'?t|doesn'?t|didn'?t|won'?t|wouldn'?t|can'?t|against|condemn|oppose|prevent|stop)\b/i;

/** 0..1 confidence multiplier for the surrounding context. */
function contextMultiplier(text) {
  let m = 1;
  if (RE_QUESTION.test(text)) m *= 0.35;
  if (RE_EDU.test(text)) m *= 0.4;
  if (RE_QUOTE.test(text)) m *= 0.45;
  else if (RE_NEGATION.test(text)) m *= 0.5;
  return Math.max(0.15, m);
}

/* ------------------------------------------------------------------ */
/* detector rules                                                     */
/* ------------------------------------------------------------------ */
/*
 * Each rule: { category, base: severity, w: weight, patterns, guard? }
 * Rules describe INTENT SHAPES (directed first/second-person future
 * threats, instructions, solicitation, pressure) — not bare words.
 */

const RULES = [
  // ---- direct threats (directed, future intent) ----
  {
    category: 'threat', base: 'HIGH', w: 0.95,
    patterns: [
      /\bi\s+(?:am\s+going\s+to|'?(?:ll|will)\s+(?:have\s+to)?|wanna|might)\s+(?:kill|murder|hunt\s+down|find\s+(?:you|him|her|them)|hurt|beat(?:\s+up)?|stab|shoot|strangle|end)\b/i,
      /\byou'?re\s+(?:going\s+to\s+be\s+)?dead\b/i,
      /\bi\s+know\s+where\s+(?:you|he|she|they)\s+(?:live|work|study)\b.*\b(and|so)\b/i,
      /\bmark\s+my\s+words\b.*\b(kill|hurt|dead)\b/i,
      /\b(?:dead|kill)\s+(?:man|men|woman|women)\s+walking\b/i,
    ],
    reason: 'Potential directed threat',
  },
  // ---- encouragement of self-harm ----
  {
    category: 'self_harm', base: 'HIGH', w: 0.9,
    patterns: [
      /\b(?:kill|go\s+kill|hurt|cut)\s+yourself\b/i,
      /\bthe\s+world\s+would\s+be\s+better\s+(?:off|without)\s+you\b/i,
      /\bnobody\s+would\s+(?:miss|care)\s+if\s+you\s+died\b/i,
    ],
    reason: 'Encouragement of self-harm',
  },
  // ---- stated self-harm intent (needs care response, not punishment) ----
  {
    category: 'self_harm', base: 'HIGH', w: 0.85,
    patterns: [
      /\bi\s+(?:want|am\s+going|'?m\s+going|feel\s+like)\s+to\s+(?:kill|end)\s+myself\b/i,
      /\bi\s+want\s+to\s+(?:die|disappear\s+forever)\b/i,
      /\b(?:end|taking)\s+my\s+(?:life|own\s+life)\b/i,
    ],
    reason: 'Possible self-harm intent (respond with care, review context)',
  },
  // ---- violent intent / encouragement ----
  {
    category: 'violence', base: 'HIGH', w: 0.85,
    patterns: [
      /\bwe\s+should\s+(?:kill|beat|attack|hunt|lynch|get\s+rid\s+of)\s+(?:all\s+of\s+)?(?:them|those\s+people|the\s+\w+s)\b/i,
      /\b(?:beat|attack|hurt)\s+(?:him|her|them|that\s+\w+)\s+(?:up\s+)?(?:if|when|until)\b/i,
      /\bdeserve\s+to\s+(?:die|be\s+killed)\b/i,
    ],
    reason: 'Potential encouragement of violence',
  },
  // ---- weapons threats ----
  {
    category: 'weapons', base: 'HIGH', w: 0.9,
    patterns: [
      /\bi\s+(?:have|got|'?m\s+bringing|'?m\s+taking)\s+(?:a|my)\s+(?:gun|pistol|rifle|knife)\b.*\b(if|and|to|for)\b/i,
      /\bshoot\s+up\s+(?:the\s+)?(?:school|place|office|class|mall|crowd|event)\b/i,
      /\bbring(?:ing)?\s+(?:a\s+)?(?:gun|weapon)\s+to\b/i,
    ],
    reason: 'Weapon-related threat',
  },
  // ---- terrorism / violent extremism indicators ----
  {
    category: 'extremism', base: 'CRITICAL', w: 0.95,
    patterns: [
      /\bjoin(?:ing)?\s+(?:isis|isil|al[-\s]?qaeda|taliban|a\s+terror(?:ist)?\s+(?:group|organisation|organization))\b/i,
      /\b(?:bomb|explosive)\s+(?:making|building|assembly)\s+(?:instructions|guide|manual)\b/i,
      /\bhow\s+to\s+(?:build|make)\s+(?:a\s+)?(?:bomb|pipe\s+bomb|explosive)\b/i,
      /\bmartyrdom\s+operation\b/i,
      /\bplan(?:ning)?\s+(?:a\s+)?(?:terror|terrorist|mass\s+shooting|school\s+shooting)\s+attack\b/i,
    ],
    reason: 'Possible violent-extremism indicator',
  },
  // ---- child safety (narrow, high-specificity phrases only) ----
  {
    category: 'child_safety', base: 'CRITICAL', w: 0.95,
    patterns: [
      /\bchild\s+(?:porn|pornography)\b/i,
      /\bcsam\b/i,
      /\b(?:nude|naked)\s+(?:pics?|photos?|images?)\s+of\s+(?:a\s+)?(?:child|kid|minor|1[0-5]\s*[-\s]year[-\s]old)\b/i,
    ],
    reason: 'Child-safety indicator',
  },
  // ---- sexual exploitation / pressure ----
  {
    category: 'sexual_exploitation', base: 'HIGH', w: 0.8,
    patterns: [
      /\bsend\s+(?:me\s+)?nudes\s+or\s+(?:i'?ll|i\s+will)\b/i,
      /\bi'?ll\s+(?:share|post|send|leak)\s+(?:your|those)\s+(?:photos?|pics?|nudes)\s+(?:unless|if\s+you\s+don'?t|everywhere)\b/i,
    ],
    reason: 'Possible sexual coercion / sextortion',
  },
  // ---- hate (slur + directed/identity-generalization shapes) ----
  {
    category: 'hate', base: 'HIGH', w: 0.85,
    patterns: [
      /\ball\s+\w+s\s+(?:should|deserve|must)\s+(?:die|be\s+killed|be\s+deported|leave|burn)\b/i,
      /\byou\s+(?:are|'re)\s+(?:a\s+)?(?:subhuman|animal|vermin|disgusting\s+\w+)\b/i,
      /\bgas\s+(?:the|all)\s+\w+s\b/i,
    ],
    reason: 'Hateful abuse / dehumanization',
  },
  // ---- harassment (targeted abuse) ----
  {
    category: 'harassment', base: 'MEDIUM', w: 0.7,
    patterns: [
      /\byou\s+are\s+(?:worthless|pathetic|useless|a\s+mistake|nothing)\b/i,
      /\bnobody\s+(?:loves|likes|wants)\s+you\b/i,
      /\bi\s+will\s+(?:make\s+your\s+life|destroy\s+you(?:r\s+life)?)\s+(?:a\s+hell|hell|miserable|ruin)\b/i,
    ],
    reason: 'Targeted harassment',
  },
  // ---- scam / fraud ----
  {
    category: 'scam', base: 'MEDIUM', w: 0.75,
    patterns: [
      /\bsend\s+(?:me\s+)?(?:your\s+)?(?:otp|one[-\s]?time\s+password|password|pin|cvv|card\s+number|bank\s+details|aadhaar\s+otp)\b/i,
      /\b(?:double|2x|10x)\s+your\s+(?:money|crypto|bitcoin)\b/i,
      /\byou(?:'ve|\s+have)?\s+won\s+(?:a|an)\s+(?:prize|iphone|lottery)\b.*\b(?:click|claim|send)\b/i,
      /\bgift\s+card\s+codes?\b.*\b(?:send|give)\b/i,
    ],
    reason: 'Possible scam / credential solicitation',
  },
  // ---- doxxing ----
  {
    category: 'doxxing', base: 'MEDIUM', w: 0.7,
    patterns: [
      /\b(?:his|her|their)\s+(?:home\s+)?(?:address|phone\s+number)\s+is\s+[\d\w]|\bdox(?:ing)?\s+(?:him|her|them)\b/i,
      /\b(?:leak|drop|post)\s+(?:his|her|their)\s+(?:address|number|aadhaar|id)\b/i,
    ],
    reason: 'Possible sharing of personal information',
  },
  // ---- profanity (LOW only — never alerts, aggregates silently) ----
  {
    category: 'profanity', base: 'LOW', w: 0.6,
    patterns: [
      /\b(?:fuck(?:ing)?|shit|bitch|asshole|bastard|dickhead|motherfucker)\b/i,
    ],
    reason: 'Profanity',
  },
];

/* ------------------------------------------------------------------ */
/* spam heuristics (needs conversation context)                       */
/* ------------------------------------------------------------------ */

function spamScore(text, recentMessages = []) {
  const reasons = [];
  let score = 0;
  const links = (text.match(/https?:\/\//g) || []).length;
  if (links >= 3) { score += 0.5; reasons.push(`${links} links in one message`); }
  const letters = text.replace(/[^a-z]/gi, '');
  if (letters.length > 20 && letters === letters.toUpperCase()) { score += 0.25; reasons.push('shouting (all caps)'); }
  if (recentMessages.length) {
    const mine = recentMessages.filter((m) => m.sender_id && m.body);
    const same = mine.filter((m) => String(m.body).trim() === text.trim());
    if (same.length >= 2) { score += 0.5; reasons.push('same message repeated'); }
  }
  return { score: Math.min(1, score), reasons };
}

/* ------------------------------------------------------------------ */
/* the classifier                                                     */
/* ------------------------------------------------------------------ */

/**
 * @param {string} text message body
 * @param {Array} recentMessages last few messages in the chat
 * ({sender_id, body}) for spam/repetition context.
 * @returns null (safe) or { category, severity, confidence, reason }
 */
function classifyText(text, recentMessages = []) {
  const body = String(text || '');
  if (!body.trim()) return null;

  const ctx = contextMultiplier(body);
  let best = null;

  for (const rule of RULES) {
    let hits = 0;
    for (const re of rule.patterns) if (re.test(body)) hits += 1;
    if (!hits) continue;
    const confidence = Math.min(0.97, 0.55 + rule.w * 0.4 * (hits > 1 ? 1.1 : 1)) * ctx;
    const candidate = {
      category: rule.category,
      severity: rule.base,
      confidence,
      reason: rule.reason,
    };
    if (!best
      || SEVERITY_RANK[candidate.severity] > SEVERITY_RANK[best.severity]
      || (candidate.severity === best.severity && candidate.confidence > best.confidence)) {
      best = candidate;
    }
  }

  // Spam is context-driven, independent of word rules.
  const spam = spamScore(body, recentMessages);
  if (spam.score >= 0.5) {
    const sev = spam.score >= 0.9 ? 'MEDIUM' : 'LOW';
    if (!best || SEVERITY_RANK[sev] > SEVERITY_RANK[best.severity]) {
      best = { category: 'spam', severity: sev, confidence: spam.score, reason: `Spam behaviour: ${spam.reasons.join(', ')}` };
    }
  }

  if (!best) return null;

  // Context knocked a HIGH down to noise? Keep it, but demote honestly —
  // the case still exists for review with the adjusted confidence.
  if (best.confidence < 0.45) best.severity = best.severity === 'CRITICAL' ? 'HIGH' : (SEVERITY_RANK[best.severity] >= 3 ? 'MEDIUM' : best.severity);
  return best;
}

/* ------------------------------------------------------------------ */
/* case management                                                    */
/* ------------------------------------------------------------------ */

const SNAPSHOT_LIMIT = 280;

function snapshotOf(text) {
  const body = String(text || '').replace(/\s+/g, ' ').trim();
  return body.length > SNAPSHOT_LIMIT ? `${body.slice(0, SNAPSHOT_LIMIT)}…` : body;
}

function severityFloorFromSettings(settings) {
  return SEVERITY_RANK[settings.caseLevel] ?? 1;
}

/** Admin ids with the admin role (for realtime + push fan-out). */
function adminIds() {
  return db.prepare("SELECT id FROM users WHERE role = 'admin'").all().map((r) => r.id);
}

function isAdmin(userId) {
  return !!db.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'admin'").get(userId);
}

/**
 * Record an automated detection for a stored message. Deduplicates:
 * - same (message, category) → bump signals/severity
 * - LOW events → one case per (user, category) inside the aggregation window
 * Never throws into the message pipeline.
 */
function recordAutoDetection({ userId, chatId, messageId, text, recentMessages = [] }, io) {
  try {
    const result = classifyText(text, recentMessages);
    if (!result) return null;
    const settings = getModerationSettings();

    const rank = SEVERITY_RANK[result.severity];
    if (rank < severityFloorFromSettings(settings)) return null;
    if (rank <= 1) {
      // LOW/INFO: aggregate silently, never alert.
      const windowStart = now() - settings.lowAggregationMinutes * 60000;
      const existing = db
        .prepare(
          `SELECT * FROM moderation_cases
           WHERE user_id = ? AND category = ? AND severity IN ('LOW','INFO') AND status = 'OPEN' AND updated_at > ?`
        )
        .get(userId, result.category, windowStart);
      if (existing) {
        db.prepare('UPDATE moderation_cases SET signals = signals + 1, updated_at = ? WHERE id = ?').run(now(), existing.id);
        return { caseId: existing.id, aggregated: true, severity: result.severity };
      }
    }

    const existingForMessage = db
      .prepare("SELECT * FROM moderation_cases WHERE message_id = ? AND category = ? AND status IN ('OPEN','UNDER_REVIEW')")
      .get(messageId, result.category);
    if (existingForMessage) {
      db.prepare('UPDATE moderation_cases SET signals = signals + 1, updated_at = ? WHERE id = ?').run(now(), existingForMessage.id);
      return { caseId: existingForMessage.id, aggregated: true, severity: result.severity };
    }

    const t = now();
    const info = db.prepare(
      `INSERT INTO moderation_cases (user_id, chat_id, message_id, category, severity, confidence, source, signals, reason, snapshot, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?, 'OPEN', ?, ?)`
    ).run(
      userId, chatId, messageId, result.category, result.severity,
      Math.round(result.confidence * 100) / 100, 'auto', 1, result.reason, snapshotOf(text), t, t
    );
    const caseId = info.lastInsertRowid;
    notifyAdmins({ caseId, severity: result.severity, category: result.category, source: 'auto' }, io);
    return { caseId, aggregated: false, severity: result.severity };
  } catch (e) {
    console.warn('[moderation] detection failed:', e?.message);
    return null;
  }
}

/**
 * A user report on a message. Creates or merges into a case:
 * auto + user report on the same message → source 'mixed', signals++.
 */
function recordUserReport({ reporterId, messageRow, reason, note }, io) {
  const t = now();
  const existing = messageRow
    ? db.prepare("SELECT * FROM moderation_cases WHERE message_id = ? AND status IN ('OPEN','UNDER_REVIEW')").get(messageRow.id)
    : null;

  let caseId;
  let source;
  if (existing) {
    caseId = existing.id;
    source = 'mixed';
    db.prepare('UPDATE moderation_cases SET signals = signals + 1, source = ?, updated_at = ? WHERE id = ?').run(source, t, caseId);
  } else {
    // One report = MEDIUM baseline (human said so — never auto-HIGH).
    source = 'user';
    const info = db.prepare(
      `INSERT INTO moderation_cases (user_id, chat_id, message_id, category, severity, confidence, source, signals, reason, snapshot, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?, 'OPEN', ?, ?)`
    ).run(
      messageRow.sender_id, messageRow.chat_id, messageRow.id, reason,
      'MEDIUM', 0.6, source, 1,
      `User report: ${REPORT_REASONS[reason] || reason}`,
      snapshotOf(messageRow.body), t, t
    );
    caseId = info.lastInsertRowid;
  }

  db.prepare('INSERT INTO moderation_reports (case_id, reporter_id, message_id, chat_id, reason, note, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(caseId, reporterId, messageRow.id, messageRow.chat_id, reason, String(note || '').slice(0, 500) || null, t);

  notifyAdmins({ caseId, severity: existing ? existing.severity : 'MEDIUM', category: reason, source }, io);
  return { caseId };
}

/** Realtime + push fan-out to admins. Push only above the alert level —
 *  ordinary MEDIUM/LOW never buzzes anyone. */
function notifyAdmins({ caseId, severity, category, source }, io) {
  const settings = getModerationSettings();
  const payload = { caseId, severity, category, source, at: now() };
  adminIds().forEach((adminId) => {
    try { io?.emitToUser?.(adminId, 'moderation:update', payload); } catch {}
  });
  if (SEVERITY_RANK[severity] >= SEVERITY_RANK[settings.alertPushLevel] && settings.alertPushLevel !== 'NONE') {
    adminIds().forEach((adminId) => {
      try {
        io?.pushAdminSafety?.(adminId, {
          severity,
          category,
          source,
          caseId,
        });
      } catch {}
    });
  }
}

/* ------------------------------------------------------------------ */
/* enforcement helpers                                                */
/* ------------------------------------------------------------------ */

/**
 * Gate for messaging-type actions. Returns { blocked, error }.
 * banned → hard block; suspended → block until lifted/expired;
 * restricted → can read but not post.
 */
function moderationGate(userId) {
  const u = db.prepare('SELECT moderation, suspended_until FROM users WHERE id = ?').get(userId);
  if (!u) return { blocked: true, error: 'Account not found' };
  if (u.moderation === 'banned') return { blocked: true, error: 'This account has been banned for safety violations.' };
  if (u.moderation === 'suspended') {
    if (u.suspended_until && u.suspended_until < now()) {
      db.prepare("UPDATE users SET moderation = 'active', suspended_until = NULL WHERE id = ?").run(userId);
      return { blocked: false };
    }
    return { blocked: true, error: 'This account is temporarily suspended.' };
  }
  if (u.moderation === 'restricted') return { blocked: true, error: 'Your messaging is currently restricted pending safety review.' };
  return { blocked: false };
}

const USER_ACTIONS = ['warn', 'restrict', 'unrestrict', 'suspend', 'unsuspend', 'ban', 'unban', 'no_action'];

/** Apply an enforcement action. Returns { ok, state } or throws. */
function applyUserAction({ adminId, targetId, action, reason, days, caseId, io }) {
  const t = now();
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
  if (!target) throw new Error('User not found');
  if (target.role === 'admin' && ['restrict', 'suspend', 'ban'].includes(action)) {
    throw new Error('Admins cannot be restricted by moderation actions');
  }

  let state = target.moderation || 'active';
  switch (action) {
    case 'warn':
      state = target.moderation === 'active' ? 'warned' : target.moderation;
      break;
    case 'restrict': state = 'restricted'; break;
    case 'unrestrict': state = 'active'; break;
    case 'suspend':
      state = 'suspended';
      db.prepare('UPDATE users SET suspended_until = ? WHERE id = ?').run(t + (Number(days) || 7) * 86400000, targetId);
      break;
    case 'unsuspend':
      state = 'active';
      db.prepare('UPDATE users SET suspended_until = NULL WHERE id = ?').run(targetId);
      break;
    case 'ban': state = 'banned'; break;
    case 'unban':
      state = 'active';
      db.prepare('UPDATE users SET suspended_until = NULL WHERE id = ?').run(targetId);
      break;
    case 'no_action': break;
    default: throw new Error('Unknown action');
  }
  db.prepare('UPDATE users SET moderation = ? WHERE id = ?').run(state, targetId);

  db.prepare('INSERT INTO moderation_actions (case_id, admin_id, action, target_user_id, reason, created_at) VALUES (?,?,?,?,?,?)')
    .run(caseId || null, adminId, action, targetId, String(reason || '').slice(0, 500) || null, t);

  // Warnings reach the user through the normal (private) push path — never
  // through the moderation tables.
  if (action === 'warn') {
    io?.pushSafetyWarning?.(targetId, String(reason || '').slice(0, 120));
  }

  return { ok: true, state };
}

function writeAudit({ adminId, adminName, action, target, caseId, detail }) {
  db.prepare('INSERT INTO moderation_audit_log (admin_id, admin_name, action, target, case_id, detail, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(adminId, adminName || null, action, target || null, caseId || null, String(detail || '').slice(0, 500) || null, now());
}

/* ------------------------------------------------------------------ */
/* report rate limiting (in-memory, per process)                       */
/* ------------------------------------------------------------------ */

const reportTimestamps = new Map(); // userId -> [ts]
const MAX_REPORTS_PER_MINUTE = 5;
const MAX_REPORTS_PER_HOUR = 25;

function checkReportRate(userId) {
  const t = now();
  const list = (reportTimestamps.get(userId) || []).filter((x) => t - x < 3600000);
  if (list.filter((x) => t - x < 60000).length >= MAX_REPORTS_PER_MINUTE) return { allowed: false, retryAfter: 60 };
  if (list.length >= MAX_REPORTS_PER_HOUR) return { allowed: false, retryAfter: 3600 };
  list.push(t);
  reportTimestamps.set(userId, list);
  return { allowed: true };
}

/* ------------------------------------------------------------------ */
/* retention sweep                                                     */
/* ------------------------------------------------------------------ */

function retentionSweep() {
  try {
    const settings = getModerationSettings();
    const days = Math.max(30, Number(settings.retentionDays) || 180);
    const cutoff = now() - days * 86400000;
    db.prepare(
      "DELETE FROM moderation_cases WHERE updated_at < ? AND status IN ('CLOSED','FALSE_POSITIVE')"
    ).run(cutoff);
    db.prepare('DELETE FROM moderation_reports WHERE created_at < ?').run(cutoff);
    db.prepare('DELETE FROM moderation_audit_log WHERE created_at < ?').run(now() - days * 2 * 86400000);
  } catch (e) {
    console.warn('[moderation] retention sweep failed:', e?.message);
  }
}

module.exports = {
  CATEGORIES, SEVERITIES, SEVERITY_RANK, CASE_STATUSES, REPORT_REASONS,
  DEFAULT_SETTINGS,
  classifyText, contextMultiplier,
  getModerationSettings, setModerationSetting,
  isAdmin, adminIds,
  recordAutoDetection, recordUserReport, notifyAdmins,
  moderationGate, applyUserAction, USER_ACTIONS,
  writeAudit, checkReportRate, retentionSweep,
};
