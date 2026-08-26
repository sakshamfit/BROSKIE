import { Platform } from 'react-native';

// Railway remains the persistent realtime/socket origin. The public app
// domain proxies HTTP API and upload requests there through Vercel.
const DEFAULT_SERVER_URL = 'https://broskie-h.up.railway.app';
const PUBLIC_WEB_URL = 'https://plusoneco.in';
const DEFAULT_MOBILE_API_URL = PUBLIC_WEB_URL;

const isPublicStaticHost = (hostname) => (
  hostname === 'plusoneco.in'
  || hostname === 'www.plusoneco.in'
  || hostname.endsWith('.vercel.app')
);

/**
 * Resolve the backend URL.
 *
 * - Explicit override:  EXPO_PUBLIC_API_URL (useful for local/LAN development)
 * - Single-host deploy: the Express server serves this bundle and API together
 *                       -> '' (relative URLs)
 * - Web preview (e2b):  same host, port 4000 -> https://4000-<sandbox>.e2b.app
 * - Local web dev:      http://localhost:4000
 * - Native fallback:    stable Vercel HTTP proxy -> Railway
 */
function resolveBase() {
  // Prefer the same-origin Vercel proxy even if an old project-level
  // EXPO_PUBLIC_API_URL still points directly at Railway. This makes a
  // redeployed website pick up the transport fix without a second env edit.
  if (Platform.OS === 'web' && typeof window !== 'undefined' && isPublicStaticHost(window.location.hostname)) {
    return '';
  }

  if (process.env.EXPO_PUBLIC_API_URL) {
    const configured = process.env.EXPO_PUBLIC_API_URL.trim().replace(/\/$/, '');
    const isDevelopment = typeof __DEV__ !== 'undefined' && __DEV__;
    // A release APK must never be pointed at cleartext/local development
    // traffic. Fall back to the stable HTTPS proxy if a bad build-time value
    // was accidentally baked into the binary.
    if (Platform.OS !== 'web') {
      if (!isDevelopment && !configured.startsWith('https://')) return DEFAULT_MOBILE_API_URL;
      // Older release builds and some Expo Go environments commonly bake the
      // Railway origin into this variable. Route that exact production value
      // through the Vercel HTTPS proxy too, so the transport fix also applies
      // while __DEV__ is true. Local/LAN URLs remain available for development.
      if (configured === DEFAULT_SERVER_URL) return DEFAULT_MOBILE_API_URL;
    }
    return configured;
  }

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const { protocol, hostname, host, port } = window.location;

    // e2b sandbox preview: app on 8081, api on 4000
    const m = host.match(/^(\d+)-(.+\.e2b\.app)$/);
    if (m) return `${protocol}//4000-${m[2]}`;

    // Metro dev server ports -> API is a separate process on 4000
    if (port === '8081' || port === '19006' || port === '3000') {
      return `${protocol}//${hostname}:4000`;
    }

    // Vercel proxies HTTP API/media requests to Railway. Keep the browser
    // request same-origin so the proxy also removes CORS/TLS differences.
    if (isPublicStaticHost(hostname)) return '';

    // Anything else (production single-host): same origin, use relative paths.
    return '';
  }
  // Native HTTP goes through Vercel; realtime sockets still connect directly
  // to Railway because Vercel does not host a persistent Socket.IO process.
  return DEFAULT_MOBILE_API_URL;
}

export const API_URL = resolveBase();

/** Socket.IO target: Vercel and native HTTP proxy clients still use the
 * persistent Railway origin for realtime events. */
const runningOnStaticHost = Platform.OS === 'web'
  && typeof window !== 'undefined'
  && isPublicStaticHost(window.location.hostname);
export const SOCKET_URL = runningOnStaticHost || API_URL === DEFAULT_MOBILE_API_URL
  ? DEFAULT_SERVER_URL
  : API_URL;

/** Canonical public web origin used for shareable community and profile links.
 * Browser requests themselves stay on their current origin, so www aliases
 * continue to work while links consistently use the primary domain. */
export const WEB_APP_URL = PUBLIC_WEB_URL;

export function mediaUrl(u) {
  if (!u) return null;
  if (/^https?:|^data:|^file:/.test(u)) return u;
  return API_URL + u; // API_URL may be '' -> relative, same-origin
}

let authToken = null;
export const setToken = (t) => { authToken = t; };
export const getToken = () => authToken;

const DEFAULT_TIMEOUT_MS = 25000; // increased for Realme / slow 5G where Railway cold-start + 5G DNS can exceed 18s
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'API_ERROR', technicalMessage = '' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.technicalMessage = technicalMessage;
  }
}

function logTechnicalFailure(path, error) {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.warn(`[API ${path}]`, error?.technicalMessage || error?.message || error);
  }
}

function networkFailure(error, timedOut) {
  const technicalMessage = String(error?.message || error || 'Unknown network error');
  const lower = technicalMessage.toLowerCase();
  // Realme / low-end devices often hit TLS trust or date-time drift → surface actionable hint
  if (lower.includes('certificate') || lower.includes('ssl') || lower.includes('tls') || lower.includes('trust anchor') || lower.includes('unable to find valid certification')) {
    return new ApiError('Secure connection failed. Please check your device date & time is correct and try again.', {
      code: 'CERT_ERROR', technicalMessage,
    });
  }
  if (timedOut || error?.name === 'AbortError' || lower.includes('abort') || lower.includes('timeout')) {
    return new ApiError('The request took too long. Check your connection and try again.', {
      code: 'TIMEOUT', technicalMessage,
    });
  }
  return new ApiError('Unable to connect. Check your internet connection and try again.', {
    code: 'NETWORK_ERROR', technicalMessage,
  });
}

/**
 * Shared production HTTP layer. GETs retry once by default; auth POSTs (login/register)
 * retry once with fallback base to survive single-edge failures on Realme / low-end
 * devices (Vercel ↔ Railway). The fallback ensures a transient 5G DNS/TLS hiccup on
 * one edge does not become “Unable to connect” — the second base is tried before
 * surfacing an error. Registration retry is safe: a duplicate hits 409 and maps to
 * “That username is already taken” rather than a silent duplicate.
 */
// Build ordered list of bases to try: native tries Vercel proxy first, then direct Railway fallback (and vice versa)
// This makes Realme 11x 5G resilient when one edge is blocked/slow but the other works — no extra user action needed.
function candidateBases(path) {
  if (Platform.OS === 'web') return [API_URL];
  const primary = API_URL;
  const secondary = primary === DEFAULT_MOBILE_API_URL ? DEFAULT_SERVER_URL : primary === DEFAULT_SERVER_URL ? DEFAULT_MOBILE_API_URL : null;
  return secondary && secondary !== primary ? [primary, secondary] : [primary];
}

async function requestUncached(path, {
  method = 'GET', body, isForm = false, timeoutMs = DEFAULT_TIMEOUT_MS,
  retries = method === 'GET' ? 1 : 0,
} = {}) {
  const bases = candidateBases(path);
  let lastError = null;
  for (let baseIdx = 0; baseIdx < bases.length; baseIdx += 1) {
    const base = bases[baseIdx];
    const url = base + path;
    const headers = { Accept: 'application/json' };
    if (!isForm) headers['Content-Type'] = 'application/json';
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const serializedBody = isForm ? body : body !== undefined ? JSON.stringify(body) : undefined;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      let timedOut = false;
      let timeoutId;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          timedOut = true;
          controller?.abort();
          reject(new Error('REQUEST_TIMEOUT'));
        }, timeoutMs);
      });

      let response;
      try {
        const fetchPromise = fetch(url, {
          method,
          headers,
          body: serializedBody,
          signal: controller?.signal,
          redirect: 'follow',
          cache: method === 'GET' ? 'no-store' : 'default',
        });
        response = await Promise.race([fetchPromise, timeoutPromise]);
      } catch (error) {
        clearTimeout(timeoutId);
        const failure = networkFailure(error, timedOut || error?.message === 'REQUEST_TIMEOUT');
        // On network/timeout, try next base before retrying same base if this is the first attempt and we have fallback
        if ((failure.code === 'NETWORK_ERROR' || failure.code === 'TIMEOUT' || failure.code === 'CERT_ERROR') && baseIdx + 1 < bases.length && attempt === 0) {
          lastError = failure;
          break; // break attempt loop, try next base
        }
        if (attempt < retries) {
          await wait(450 * (attempt + 1));
          continue;
        }
        logTechnicalFailure(path, failure);
        if (baseIdx + 1 < bases.length) {
          lastError = failure;
          break;
        }
        throw failure;
      }

      let text = '';
      try {
        text = await Promise.race([response.text(), timeoutPromise]);
        clearTimeout(timeoutId);
      } catch (error) {
        clearTimeout(timeoutId);
        const failure = networkFailure(error, timedOut || error?.message === 'REQUEST_TIMEOUT');
        if ((failure.code === 'NETWORK_ERROR' || failure.code === 'TIMEOUT') && baseIdx + 1 < bases.length && attempt === 0) {
          lastError = failure;
          break;
        }
        if (attempt < retries) {
          await wait(450 * (attempt + 1));
          continue;
        }
        logTechnicalFailure(path, failure);
        if (baseIdx + 1 < bases.length) {
          lastError = failure;
          break;
        }
        throw failure;
      }

      let data = {};
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          if (response.ok) {
            const failure = new ApiError('The service returned an unreadable response. Please try again.', {
              status: response.status,
              code: 'INVALID_RESPONSE',
              technicalMessage: text.slice(0, 300),
            });
            logTechnicalFailure(path, failure);
            throw failure;
          }
        }
      }

      if (!response.ok) {
        if (attempt < retries && RETRYABLE_STATUS.has(response.status)) {
          await wait(450 * (attempt + 1));
          continue;
        }
        const isServerFailure = response.status >= 500;
        const failure = new ApiError(
          isServerFailure
            ? 'Service is temporarily unavailable. Please try again shortly.'
            : (typeof data?.error === 'string' && data.error.trim()) || `Request failed (${response.status})`,
          {
            status: response.status,
            code: isServerFailure ? 'SERVICE_UNAVAILABLE' : 'HTTP_ERROR',
            technicalMessage: typeof data?.error === 'string' ? data.error : text.slice(0, 300),
          }
        );
        logTechnicalFailure(path, failure);
        if (isServerFailure && baseIdx + 1 < bases.length) {
          lastError = failure;
          break;
        }
        throw failure;
      }

      return data;
    }
    // continue to next base if we broke due to network error
    if (lastError && baseIdx + 1 < bases.length) continue;
    if (lastError) throw lastError;
  }
  if (lastError) throw lastError;
  throw new ApiError('Unable to connect. Check your internet connection and try again.', { code: 'NETWORK_ERROR' });
}

// Effects from two mounted surfaces can ask for the same GET during the same
// tick (for example the chat cache and a notification badge). Share only the
// in-flight promise; completed GETs are never cached, so privacy/settings data
// cannot become stale and mutations keep their existing behaviour.
const inFlightGets = new Map();
function request(path, options = {}) {
  const method = options.method || 'GET';
  if (method !== 'GET' || options.isForm) return requestUncached(path, options);
  const key = `${authToken || ''}|${path}|${options.timeoutMs || DEFAULT_TIMEOUT_MS}|${options.retries ?? 1}`;
  const existing = inFlightGets.get(key);
  if (existing) return existing;
  const promise = requestUncached(path, options).finally(() => {
    if (inFlightGets.get(key) === promise) inFlightGets.delete(key);
  });
  inFlightGets.set(key, promise);
  return promise;
}

// Exported for focused network diagnostics/tests; application code uses `api` below.
export const requestJson = request;

function checkedAuthPayload(data) {
  if (!data?.token || !data?.user?.id) {
    throw new ApiError('The service returned an incomplete response. Please try again.', {
      code: 'INVALID_RESPONSE', technicalMessage: 'Missing token or user in authentication response',
    });
  }
  return data;
}

/** Translate technical/API failures into the small set of safe auth messages. */
export function authErrorMessage(error, mode = 'login') {
  if (error?.code === 'CERT_ERROR') return error.message;
  if (error?.code === 'NETWORK_ERROR' || error?.code === 'TIMEOUT') return error.message;
  if (error?.code === 'SERVICE_UNAVAILABLE' || error?.code === 'INVALID_RESPONSE' || error?.status >= 500) {
    return 'Service is temporarily unavailable. Please try again shortly.';
  }
  if (error?.status === 401) return 'Incorrect username or password.';
  if (error?.status === 409 && /username/i.test(error.message || '')) return 'That username is already taken.';
  if (/password must be at least 8/i.test(error?.message || '')) return 'Password must be at least 8 characters.';
  if (/username is required/i.test(error?.message || '')) return 'Username is required.';
  if (/username must be .*characters or fewer/i.test(error?.message || '')) return error.message;
  if (/phone number is already registered/i.test(error?.message || '')) return 'That phone number is already registered.';
  return mode === 'register'
    ? 'Unable to create your account. Please check your details and try again.'
    : 'Unable to sign in. Please try again.';
}

export const api = {
  register: async (payload) => checkedAuthPayload(await request('/api/auth/register', {
    method: 'POST', body: payload, timeoutMs: 30000, retries: 1,
  })),
  login: async (payload) => checkedAuthPayload(await request('/api/auth/login', {
    method: 'POST', body: payload, timeoutMs: 30000, retries: 1,
  })),
  forgotPassword: (phone) => request('/api/auth/forgot-password', {
    method: 'POST', body: { phone }, timeoutMs: 20000, retries: 1,
  }),
  verifyOtp: (phone, otp) => request('/api/auth/verify-otp', {
    method: 'POST', body: { phone, otp }, timeoutMs: 20000, retries: 1,
  }),
  resetPassword: (resetToken, newPassword) => request('/api/auth/reset-password', {
    method: 'POST', body: { resetToken, newPassword }, timeoutMs: 20000, retries: 1,
  }),
  usernameAvailable: (username) => request(`/api/auth/username-available?username=${encodeURIComponent(username)}`, {
    timeoutMs: 10000, retries: 1,
  }),
  me: () => request('/api/me'),
  // Startup must never hold a low-end phone on a blank/loading screen for
  // multiple full retry windows. A normal refresh can still use `me()`.
  restoreSession: () => request('/api/me', { timeoutMs: 8000, retries: 0 }),
  greetingSummary: (since) => request(`/api/greeting-summary${since ? `?since=${Math.floor(since)}` : ''}`),
  deleteAccount: (password) => request('/api/me', { method: 'DELETE', body: { password } }),
  updateMe: (payload) => request('/api/me', { method: 'PATCH', body: payload }),
  updateSettings: (payload) => request('/api/me/settings', { method: 'PATCH', body: payload }),
  // Push notifications: register this device's Expo token / remove it on logout.
  registerPushToken: (payload) =>
    request('/api/push/token', { method: 'POST', body: payload, timeoutMs: 10000, retries: 1 }),
  unregisterPushToken: (token) =>
    request('/api/push/token', { method: 'DELETE', body: { token }, timeoutMs: 10000, retries: 0 }),
  pushInfo: () => request('/api/push/info', { timeoutMs: 10000, retries: 1 }),
  // Web push (browser Push API, VAPID-signed by the server).
  webPushConfig: () => request('/api/push/web-config', { timeoutMs: 10000, retries: 1 }),
  registerWebPushSubscription: (subscription) =>
    request('/api/push/web-subscription', { method: 'POST', body: { subscription }, timeoutMs: 10000, retries: 1 }),
  unregisterWebPushSubscription: (endpoint) =>
    request('/api/push/web-subscription', { method: 'DELETE', body: { endpoint }, timeoutMs: 10000, retries: 0 }),
  changePassword: (payload) => request('/api/me/password', { method: 'POST', body: payload }),

  // Admin Safety Center (server re-verifies the admin role on every call).
  // Admin reads fail fast instead of retrying for ~24s: the Safety Center
  // shows a clear loading/error state and the admin can retry from the UI.
  adminModerationOverview: () => request('/api/admin/moderation/overview', { timeoutMs: 10000, retries: 0 }),
  adminModerationCases: (params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, v); });
    return request(`/api/admin/moderation/cases?${q.toString()}`, { timeoutMs: 10000, retries: 0 });
  },
  adminModerationCase: (id) => request(`/api/admin/moderation/cases/${id}`, { timeoutMs: 10000, retries: 0 }),
  adminModerationReview: (id, action, reason) =>
    request(`/api/admin/moderation/cases/${id}/review`, { method: 'POST', body: { action, reason } }),
  adminModerationRemoveContent: (id, reason) =>
    request(`/api/admin/moderation/cases/${id}/remove-content`, { method: 'POST', body: { reason } }),
  adminModerationUsers: (q) => request(`/api/admin/moderation/users?q=${encodeURIComponent(q)}`, { timeoutMs: 10000, retries: 0 }),
  adminModerationUser: (id) => request(`/api/admin/moderation/users/${id}`, { timeoutMs: 10000, retries: 0 }),
  adminModerationGoldTick: (id, enabled) =>
    request(`/api/admin/moderation/users/${id}/gold-tick`, { method: 'PUT', body: { enabled } }),
  adminModerationUserAction: (id, body) =>
    request(`/api/admin/moderation/users/${id}/action`, { method: 'POST', body }),
  adminModerationAudit: (before) =>
    request(`/api/admin/moderation/audit${before ? `?before=${Math.floor(before)}` : ''}`, { timeoutMs: 10000, retries: 0 }),
  adminModerationSettings: () => request('/api/admin/moderation/settings', { timeoutMs: 10000, retries: 0 }),
  adminModerationUpdateSettings: (patch) =>
    request('/api/admin/moderation/settings', { method: 'PUT', body: patch }),
  users: (q = '', { contactsOnly = false } = {}) =>
    request(`/api/users?q=${encodeURIComponent(q)}${contactsOnly ? '&contacts=1' : ''}`),

  // Colleagues — shared colleges/institutions, organizations and workplaces
  affiliations: ({ q, type, mine } = {}) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (type) params.set('type', type);
    if (mine) params.set('mine', '1');
    return request(`/api/affiliations?${params.toString()}`);
  },
  createAffiliation: (payload) => request('/api/affiliations', { method: 'POST', body: payload }),
  joinAffiliation: (id, title = '') => request(`/api/affiliations/${id}/join`, { method: 'POST', body: { title } }),
  leaveAffiliation: (id) => request(`/api/affiliations/${id}/leave`, { method: 'DELETE' }),
  colleagues: ({ q, type, affiliationId } = {}) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (type) params.set('type', type);
    if (affiliationId) params.set('affiliationId', affiliationId);
    return request(`/api/colleagues?${params.toString()}`);
  },
  colleagueRequests: () => request('/api/colleagues/requests'),
  requestColleague: (userId) => request(`/api/colleagues/${userId}/request`, { method: 'POST', body: {} }),
  respondColleagueRequest: (requestId, action) =>
    request(`/api/colleagues/requests/${requestId}/respond`, { method: 'POST', body: { action } }),
  cancelColleagueRequest: (requestId) => request(`/api/colleagues/requests/${requestId}`, { method: 'DELETE' }),
  removeColleague: (userId) => request(`/api/colleagues/${userId}`, { method: 'DELETE' }),

  // Blocking — real, server-enforced
  blockedUsers: () => request('/api/blocked'),
  blockUser: (userId) => request(`/api/blocked/${userId}`, { method: 'POST', body: {} }),
  unblockUser: (userId) => request(`/api/blocked/${userId}`, { method: 'DELETE' }),

  chats: () => request('/api/chats'),
  deleteChat: (chatId) => request(`/api/chats/${chatId}`, { method: 'DELETE' }),
  chatRequests: () => request('/api/chat-requests'),
  activity: () => request('/api/activity'),
  respondChatRequest: (chatId, action) =>
    request(`/api/chat-requests/${chatId}/respond`, { method: 'POST', body: { action } }),
  connectUser: (userId) => request(`/api/connect/${userId}`, { method: 'POST', body: {} }),
  directChat: (userId) => request('/api/chats/direct', { method: 'POST', body: { userId } }),
  groupChat: (payload) => request('/api/chats/group', { method: 'POST', body: payload }),
  updateChat: (chatId, payload) => request(`/api/chats/${chatId}`, { method: 'PATCH', body: payload }),
  messages: (chatId, { after, afterId, before, beforeId, limit } = {}) => {
    const q = new URLSearchParams();
    if (after != null && after !== '') q.set('after', String(after));
    if (afterId) q.set('afterId', afterId);
    if (before != null && before !== '') q.set('before', String(before));
    if (beforeId) q.set('beforeId', beforeId);
    if (limit) q.set('limit', String(limit));
    const qs = q.toString();
    return request(`/api/chats/${chatId}/messages${qs ? `?${qs}` : ''}`);
  },
  sendChatMessage: (chatId, payload) => request(`/api/chats/${chatId}/messages`, {
    method: 'POST', body: payload, timeoutMs: 20000, retries: 1,
  }),
  syncMessages: ({ after, limit } = {}) => {
    const q = new URLSearchParams();
    if (after) q.set('after', String(after));
    if (limit) q.set('limit', String(limit));
    const qs = q.toString();
    return request(`/api/sync/messages${qs ? `?${qs}` : ''}`);
  },
  archive: (chatId, archived) => request(`/api/chats/${chatId}/archive`, { method: 'POST', body: { archived } }),
  mute: (chatId, muted) => request(`/api/chats/${chatId}/mute`, { method: 'POST', body: { muted } }),
  pin: (chatId, pinned) => request(`/api/chats/${chatId}/pin`, { method: 'POST', body: { pinned } }),
  setDisappear: (chatId, seconds) => request(`/api/chats/${chatId}/disappear`, { method: 'POST', body: { seconds } }),
  // Per-conversation chat theme (validated against the server allow-list).
  setChatTheme: (chatId, themeId) => request(`/api/chats/${chatId}/theme`, { method: 'POST', body: { themeId } }),
  search: (q, chatId) =>
    request(`/api/search?q=${encodeURIComponent(q)}${chatId ? `&chatId=${encodeURIComponent(chatId)}` : ''}`),

  // Group admin controls
  setGroupMemberRole: (chatId, userId, role) =>
    request(`/api/chats/${chatId}/group/members/${userId}/role`, { method: 'POST', body: { role } }),
  removeGroupMember: (chatId, userId) =>
    request(`/api/chats/${chatId}/group/members/${userId}`, { method: 'DELETE' }),
  leaveGroup: (chatId) => request(`/api/chats/${chatId}/group/leave`, { method: 'POST', body: {} }),

  // GCs — Instagram-style group chats (own section, never in the Chats inbox)
  gcs: () => request('/api/gc'),
  gcDiscover: () => request('/api/gc/discover'),
  gcCreate: (payload) => request('/api/gc', { method: 'POST', body: payload }),
  gcDetail: (chatId) => request(`/api/gc/${chatId}`),
  gcSettings: (chatId, payload) => request(`/api/gc/${chatId}/settings`, { method: 'PATCH', body: payload }),
  gcJoin: (chatId) => request(`/api/gc/${chatId}/join`, { method: 'POST', body: {} }),
  gcCancelJoin: (chatId) => request(`/api/gc/${chatId}/join`, { method: 'DELETE' }),
  gcRequests: (chatId) => request(`/api/gc/${chatId}/requests`),
  gcRespondRequest: (chatId, userId, action) =>
    request(`/api/gc/${chatId}/requests/${userId}`, { method: 'POST', body: { action } }),
  // GC messages: a dedicated, membership-enforced API. GC message traffic
  // never uses the direct-chat endpoints, so a GC can never masquerade as
  // (or overwrite) a direct conversation.
  gcMessages: (gcId, { after, afterId, before, beforeId, limit } = {}) => {
    const q = new URLSearchParams();
    if (after != null && after !== '') q.set('after', String(after));
    if (afterId) q.set('afterId', afterId);
    if (before != null && before !== '') q.set('before', String(before));
    if (beforeId) q.set('beforeId', beforeId);
    if (limit) q.set('limit', String(limit));
    const qs = q.toString();
    return request(`/api/gc/${gcId}/messages${qs ? `?${qs}` : ''}`);
  },
  sendGCMessage: (gcId, payload) => request(`/api/gc/${gcId}/messages`, {
    method: 'POST', body: payload, timeoutMs: 20000, retries: 1,
  }),

  // Starred messages
  starred: () => request('/api/starred'),
  starMessage: (messageId) => request(`/api/messages/${messageId}/star`, { method: 'POST', body: {} }),
  unstarMessage: (messageId) => request(`/api/messages/${messageId}/star`, { method: 'DELETE' }),
  setMessageTimer: (messageId, seconds) =>
    request(`/api/messages/${messageId}/disappear`, { method: 'POST', body: { seconds } }),

  // Forwarding
  forwardMessage: (messageId, chatIds) =>
    request('/api/messages/forward', { method: 'POST', body: { messageId, chatIds } }),

  // The Network — public posts. `filter`: worldwide (default) | places (people
  // sharing my college/workplace) | following (people I follow).
  posts: ({ before, limit = 20, tag, userId, filter } = {}) => {
    const q = new URLSearchParams();
    if (before) q.set('before', before);
    if (limit) q.set('limit', limit);
    if (tag) q.set('tag', tag);
    if (userId) q.set('userId', userId);
    if (filter && filter !== 'worldwide') q.set('filter', filter);
    return request(`/api/posts?${q.toString()}`);
  },
  createPost: (payload) => request('/api/posts', { method: 'POST', body: payload }),
  post: (id) => request(`/api/posts/${id}`),
  deletePost: (id) => request(`/api/posts/${id}`, { method: 'DELETE' }),
  likePost: (id) => request(`/api/posts/${id}/like`, { method: 'POST', body: {} }),
  comments: (id) => request(`/api/posts/${id}/comments`),
  addComment: (id, body) => request(`/api/posts/${id}/comments`, { method: 'POST', body: { body } }),
  postTags: () => request('/api/posts-tags'),

  // Public profile — what opens when you tap someone's avatar anywhere.
  userProfile: (id) => request(`/api/users/${id}/profile`),

  // Phase 2 — the daily campus loop.
  follow: (userId) => request(`/api/users/${userId}/follow`, { method: 'POST', body: {} }),
  unfollow: (userId) => request(`/api/users/${userId}/follow`, { method: 'DELETE' }),
  setAround: (around = true) => request('/api/me/around', { method: 'POST', body: { around } }),
  today: (since) => {
    const q = since ? `?since=${Math.floor(since)}` : '';
    return request(`/api/today${q}`, { timeoutMs: 15000, retries: 1 });
  },
  // Safety & moderation — user reports (admin API below).
  reportMessage: (messageId, reason, note) =>
    request('/api/moderation/report', { method: 'POST', body: { messageId, reason, note: note || undefined }, timeoutMs: 12000, retries: 0 }),

  // Community invite links.
  joinCommunityByCode: (code) => request('/api/communities/join-by-code', { method: 'POST', body: { code } }),
  rotateInviteCode: (communityId) => request(`/api/communities/${communityId}/invite/rotate`, { method: 'POST', body: {} }),

  statuses: () => request('/api/status'),
  postStatus: (payload) => request('/api/status', { method: 'POST', body: payload }),
  viewStatus: (id) => request(`/api/status/${id}/view`, { method: 'POST' }),
  replyToStatus: (id, body) => request(`/api/status/${id}/reply`, { method: 'POST', body: { body } }),
  searchSongs: (q) => request(`/api/songs/search?q=${encodeURIComponent(q)}`),
  browseSongs: () => request('/api/songs/browse'),
  songTaste: () => request('/api/songs/taste'),
  saveSongTaste: (favoriteArtists) => request('/api/songs/taste', { method: 'PUT', body: { favoriteArtists } }),
  recordSongHistory: (song) => request('/api/songs/history', { method: 'POST', body: { song } }),

  // Communities — purpose-based groups (club night, house party, trip planning, running, chai chat...)
  communities: ({ category, mine } = {}) => {
    const q = new URLSearchParams();
    if (category) q.set('category', category);
    if (mine) q.set('mine', '1');
    return request(`/api/communities?${q.toString()}`);
  },
  communityCategories: () => request('/api/communities/categories'),
  community: (id) => request(`/api/communities/${id}`),
  createCommunity: (payload) => request('/api/communities', { method: 'POST', body: payload }),
  updateCommunity: (id, payload) => request(`/api/communities/${id}`, { method: 'PATCH', body: payload }),
  deleteCommunity: (id) => request(`/api/communities/${id}`, { method: 'DELETE' }),
  joinCommunity: (id) => request(`/api/communities/${id}/join`, { method: 'POST', body: {} }),
  leaveCommunity: (id) => request(`/api/communities/${id}/leave`, { method: 'POST', body: {} }),
  communityRequests: (id) => request(`/api/communities/${id}/requests`),
  respondCommunityRequest: (id, userId, action) =>
    request(`/api/communities/${id}/requests/${userId}`, { method: 'POST', body: { action } }),
  addCommunityMember: (id, userId) => request(`/api/communities/${id}/members`, { method: 'POST', body: { userId } }),
  setCommunityMemberRole: (id, userId, role) =>
    request(`/api/communities/${id}/members/${userId}`, { method: 'PATCH', body: { role } }),
  removeCommunityMember: (id, userId) => request(`/api/communities/${id}/members/${userId}`, { method: 'DELETE' }),

  // Operational Transformation — collaborative documents
  getChatDocuments: (chatId) => request(`/api/chats/${chatId}/documents`),
  getDocument: (docId) => request(`/api/documents/${docId}`),
  createChatDocument: (chatId, payload) => request(`/api/chats/${chatId}/documents`, { method: 'POST', body: payload }),
  updateDocument: (docId, payload) => request(`/api/documents/${docId}`, { method: 'PATCH', body: payload }),
  deleteDocument: (docId) => request(`/api/documents/${docId}`, { method: 'DELETE' }),
  submitDocOperation: (docId, operation, baseVersion) => request(`/api/documents/${docId}/operation`, { method: 'POST', body: { operation, baseVersion } }),
  getMessageEditHistory: (messageId) => request(`/api/messages/${messageId}/edits`),

  // Calls — history; the live call itself is signalled over the socket (see ChatContext)
  calls: (limit) => request(`/api/calls${limit ? `?limit=${limit}` : ''}`),
  deleteCall: (id) => request(`/api/calls/${id}`, { method: 'DELETE' }),

  async uploadFile(uri, name = 'upload.jpg', type = 'image/jpeg') {
    return api.uploadFileWithProgress(uri, name, type);
  },

  async uploadFileWithProgress(uri, name = 'upload.jpg', type = 'image/jpeg', onProgress) {
    const form = new FormData();
    if (Platform.OS === 'web') {
      const blob = await (await fetch(uri)).blob();
      form.append('file', blob, name);
    } else {
      form.append('file', { uri, name, type });
    }

    const bases = candidateBases('/api/upload');
    let lastError = null;
    for (let baseIdx = 0; baseIdx < bases.length; baseIdx += 1) {
      const url = bases[baseIdx] + '/api/upload';
      try {
        return await uploadForm(url, form, onProgress);
      } catch (error) {
        lastError = error;
        if (baseIdx + 1 < bases.length) continue;
        throw error;
      }
    }
    throw lastError || new ApiError('Unable to connect. Check your internet connection and try again.', { code: 'NETWORK_ERROR' });
  },
};

function uploadForm(url, form, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Accept', 'application/json');
    if (authToken) xhr.setRequestHeader('Authorization', `Bearer ${authToken}`);
    xhr.timeout = 120000;
    if (xhr.upload && typeof onProgress === 'function') {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          onProgress(Math.max(1, Math.min(99, Math.round((event.loaded / event.total) * 100))));
        }
      };
    }
    xhr.onload = () => {
      let data = {};
      try { data = xhr.responseText ? JSON.parse(xhr.responseText) : {}; } catch {}
      if (xhr.status >= 200 && xhr.status < 300) {
        if (typeof onProgress === 'function') onProgress(100);
        resolve(data);
        return;
      }
      reject(new ApiError(
        xhr.status >= 500 ? 'Service is temporarily unavailable. Please try again shortly.' : (data.error || `Upload failed (${xhr.status})`),
        { status: xhr.status, code: xhr.status >= 500 ? 'SERVICE_UNAVAILABLE' : 'HTTP_ERROR' },
      ));
    };
    xhr.onerror = () => reject(new ApiError('Unable to connect. Check your internet connection and try again.', { code: 'NETWORK_ERROR' }));
    xhr.ontimeout = () => reject(new ApiError('The request took too long. Check your connection and try again.', { code: 'TIMEOUT' }));
    xhr.send(form);
  });
}
