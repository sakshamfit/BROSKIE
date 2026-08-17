import { Platform } from 'react-native';

/**
 * Resolve the backend URL.
 *
 * - Explicit override:  EXPO_PUBLIC_API_URL (required for phones / split hosting)
 * - Single-host deploy: the Express server also serves this bundle, so the API
 *                       lives at the SAME origin -> '' (relative URLs)
 * - Web preview (e2b):  same host, port 4000 -> https://4000-<sandbox>.e2b.app
 * - Local web dev:      http://localhost:4000
 * - Native fallback:    http://localhost:4000
 */
function resolveBase() {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL.replace(/\/$/, '');

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const { protocol, hostname, host, port } = window.location;

    // e2b sandbox preview: app on 8081, api on 4000
    const m = host.match(/^(\d+)-(.+\.e2b\.app)$/);
    if (m) return `${protocol}//4000-${m[2]}`;

    // Metro dev server ports -> API is a separate process on 4000
    if (port === '8081' || port === '19006' || port === '3000') {
      return `${protocol}//${hostname}:4000`;
    }

    // Anything else (production single-host): same origin, use relative paths.
    return '';
  }
  return 'http://localhost:4000';
}

export const API_URL = resolveBase();

/** Socket.IO target: '' (same origin) is fine for the browser client. */
export const SOCKET_URL = API_URL;

export function mediaUrl(u) {
  if (!u) return null;
  if (/^https?:|^data:|^file:/.test(u)) return u;
  return API_URL + u; // API_URL may be '' -> relative, same-origin
}

let authToken = null;
export const setToken = (t) => { authToken = t; };
export const getToken = () => authToken;

async function request(path, { method = 'GET', body, isForm } = {}) {
  const headers = {};
  if (!isForm) headers['Content-Type'] = 'application/json';
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  const res = await fetch(API_URL + path, {
    method,
    headers,
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  register: (payload) => request('/api/auth/register', { method: 'POST', body: payload }),
  login: (payload) => request('/api/auth/login', { method: 'POST', body: payload }),
  usernameAvailable: (username) => request(`/api/auth/username-available?username=${encodeURIComponent(username)}`),
  me: () => request('/api/me'),
  updateMe: (payload) => request('/api/me', { method: 'PATCH', body: payload }),
  updateSettings: (payload) => request('/api/me/settings', { method: 'PATCH', body: payload }),
  changePassword: (payload) => request('/api/me/password', { method: 'POST', body: payload }),
  users: (q = '') => request(`/api/users?q=${encodeURIComponent(q)}`),

  // Blocking — real, server-enforced
  blockedUsers: () => request('/api/blocked'),
  blockUser: (userId) => request(`/api/blocked/${userId}`, { method: 'POST', body: {} }),
  unblockUser: (userId) => request(`/api/blocked/${userId}`, { method: 'DELETE' }),

  chats: () => request('/api/chats'),
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
