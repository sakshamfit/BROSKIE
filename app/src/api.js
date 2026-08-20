import { Platform } from 'react-native';

// Railway remains the realtime/socket origin. HTTP requests use the stable
// Vercel app origin by default, which proxies /api and /uploads to Railway.
// This avoids device-specific TLS/route failures when a phone can open the
// app but cannot complete an HTTPS request directly to the Railway hostname.
const DEFAULT_SERVER_URL = 'https://broskie-h.up.railway.app';
const DEFAULT_MOBILE_API_URL = 'https://plusoneeeee.vercel.app';

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
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location.hostname.endsWith('.vercel.app')) {
    return '';
  }

  if (process.env.EXPO_PUBLIC_API_URL) {
    const configured = process.env.EXPO_PUBLIC_API_URL.trim().replace(/\/$/, '');
    const isDevelopment = typeof __DEV__ !== 'undefined' && __DEV__;
    // A release APK must never be pointed at cleartext/local development
    // traffic. Fall back to the stable HTTPS proxy if a bad build-time value
    // was accidentally baked into the binary.
    if (Platform.OS !== 'web' && !isDevelopment) {
      if (!configured.startsWith('https://')) return DEFAULT_MOBILE_API_URL;
      // Older release builds commonly baked the Railway origin into this
      // variable. Route that exact production value through the Vercel HTTPS
      // proxy too, so upgrading the app fixes the device transport without
      // requiring another EAS environment change.
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
    if (hostname.endsWith('.vercel.app')) return '';

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
const runningOnVercel = Platform.OS === 'web'
  && typeof window !== 'undefined'
  && window.location.hostname.endsWith('.vercel.app');
export const SOCKET_URL = runningOnVercel || API_URL === DEFAULT_MOBILE_API_URL
  ? DEFAULT_SERVER_URL
  : API_URL;

export function mediaUrl(u) {
  if (!u) return null;
  if (/^https?:|^data:|^file:/.test(u)) return u;
  return API_URL + u; // API_URL may be '' -> relative, same-origin
}

let authToken = null;
export const setToken = (t) => { authToken = t; };
export const getToken = () => authToken;

const DEFAULT_TIMEOUT_MS = 18000;
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
  if (timedOut || error?.name === 'AbortError') {
    return new ApiError('The request took too long. Check your connection and try again.', {
      code: 'TIMEOUT', technicalMessage,
    });
  }
  return new ApiError('Unable to connect. Check your internet connection and try again.', {
    code: 'NETWORK_ERROR', technicalMessage,
  });
}

/**
 * Shared production HTTP layer. GETs retry once by default; callers may opt a
 * genuinely idempotent POST (login) into one retry. Registration and other
 * writes never auto-retry because a lost response could otherwise duplicate
 * an operation that already reached the server.
 */
async function request(path, {
  method = 'GET', body, isForm = false, timeoutMs = DEFAULT_TIMEOUT_MS,
  retries = method === 'GET' ? 1 : 0,
} = {}) {
  const url = API_URL + path;
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
      if (attempt < retries) {
        await wait(450 * (attempt + 1));
        continue;
      }
      logTechnicalFailure(path, failure);
      throw failure;
    }

    let text = '';
    try {
      text = await Promise.race([response.text(), timeoutPromise]);
      clearTimeout(timeoutId);
    } catch (error) {
      clearTimeout(timeoutId);
      const failure = networkFailure(error, timedOut || error?.message === 'REQUEST_TIMEOUT');
      if (attempt < retries) {
        await wait(450 * (attempt + 1));
        continue;
      }
      logTechnicalFailure(path, failure);
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
      throw failure;
    }

    return data;
  }

  throw new ApiError('Unable to connect. Check your internet connection and try again.', { code: 'NETWORK_ERROR' });
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
    method: 'POST', body: payload, timeoutMs: 22000, retries: 0,
  })),
  login: async (payload) => checkedAuthPayload(await request('/api/auth/login', {
    method: 'POST', body: payload, timeoutMs: 18000, retries: 1,
  })),
  usernameAvailable: (username) => request(`/api/auth/username-available?username=${encodeURIComponent(username)}`, {
    timeoutMs: 10000, retries: 1,
  }),
  me: () => request('/api/me'),
  // Startup must never hold a low-end phone on a blank/loading screen for
  // multiple full retry windows. A normal refresh can still use `me()`.
  restoreSession: () => request('/api/me', { timeoutMs: 8000, retries: 0 }),
  greetingSummary: () => request('/api/greeting-summary'),
  deleteAccount: (password) => request('/api/me', { method: 'DELETE', body: { password } }),
  updateMe: (payload) => request('/api/me', { method: 'PATCH', body: payload }),
  updateSettings: (payload) => request('/api/me/settings', { method: 'PATCH', body: payload }),
  changePassword: (payload) => request('/api/me/password', { method: 'POST', body: payload }),
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
  respondChatRequest: (chatId, action) =>
    request(`/api/chat-requests/${chatId}/respond`, { method: 'POST', body: { action } }),
  directChat: (userId) => request('/api/chats/direct', { method: 'POST', body: { userId } }),
  groupChat: (payload) => request('/api/chats/group', { method: 'POST', body: payload }),
  updateChat: (chatId, payload) => request(`/api/chats/${chatId}`, { method: 'PATCH', body: payload }),
  messages: (chatId) => request(`/api/chats/${chatId}/messages`),
  archive: (chatId, archived) => request(`/api/chats/${chatId}/archive`, { method: 'POST', body: { archived } }),
  mute: (chatId, muted) => request(`/api/chats/${chatId}/mute`, { method: 'POST', body: { muted } }),
  pin: (chatId, pinned) => request(`/api/chats/${chatId}/pin`, { method: 'POST', body: { pinned } }),
  setDisappear: (chatId, seconds) => request(`/api/chats/${chatId}/disappear`, { method: 'POST', body: { seconds } }),
  search: (q, chatId) =>
    request(`/api/search?q=${encodeURIComponent(q)}${chatId ? `&chatId=${encodeURIComponent(chatId)}` : ''}`),

  // Group admin controls
  setGroupMemberRole: (chatId, userId, role) =>
    request(`/api/chats/${chatId}/group/members/${userId}/role`, { method: 'POST', body: { role } }),
  removeGroupMember: (chatId, userId) =>
    request(`/api/chats/${chatId}/group/members/${userId}`, { method: 'DELETE' }),
  leaveGroup: (chatId) => request(`/api/chats/${chatId}/group/leave`, { method: 'POST', body: {} }),

  // Starred messages
  starred: () => request('/api/starred'),
  starMessage: (messageId) => request(`/api/messages/${messageId}/star`, { method: 'POST', body: {} }),
  unstarMessage: (messageId) => request(`/api/messages/${messageId}/star`, { method: 'DELETE' }),
  setMessageTimer: (messageId, seconds) =>
    request(`/api/messages/${messageId}/disappear`, { method: 'POST', body: { seconds } }),

  // Forwarding
  forwardMessage: (messageId, chatIds) =>
    request('/api/messages/forward', { method: 'POST', body: { messageId, chatIds } }),

  // The Network — public posts
  posts: ({ before, limit = 20, tag, userId } = {}) => {
    const q = new URLSearchParams();
    if (before) q.set('before', before);
    if (limit) q.set('limit', limit);
    if (tag) q.set('tag', tag);
    if (userId) q.set('userId', userId);
    return request(`/api/posts?${q.toString()}`);
  },
  createPost: (payload) => request('/api/posts', { method: 'POST', body: payload }),
  deletePost: (id) => request(`/api/posts/${id}`, { method: 'DELETE' }),
  likePost: (id) => request(`/api/posts/${id}/like`, { method: 'POST', body: {} }),
  comments: (id) => request(`/api/posts/${id}/comments`),
  addComment: (id, body) => request(`/api/posts/${id}/comments`, { method: 'POST', body: { body } }),
  postTags: () => request('/api/posts-tags'),

  statuses: () => request('/api/status'),
  postStatus: (payload) => request('/api/status', { method: 'POST', body: payload }),
  viewStatus: (id) => request(`/api/status/${id}/view`, { method: 'POST' }),
  searchSongs: (q) => request(`/api/songs/search?q=${encodeURIComponent(q)}`),

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

  // Calls — history; the live call itself is signalled over the socket (see ChatContext)
  calls: (limit) => request(`/api/calls${limit ? `?limit=${limit}` : ''}`),
  deleteCall: (id) => request(`/api/calls/${id}`, { method: 'DELETE' }),

  async uploadFile(uri, name = 'upload.jpg', type = 'image/jpeg') {
    const form = new FormData();
    if (Platform.OS === 'web') {
      const blob = await (await fetch(uri)).blob();
      form.append('file', blob, name);
    } else {
      form.append('file', { uri, name, type });
    }
    return request('/api/upload', { method: 'POST', body: form, isForm: true });
  },
};
