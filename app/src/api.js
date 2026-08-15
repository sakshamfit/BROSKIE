import { Platform } from 'react-native';

/**
 * Resolve the backend URL.
 * - Web preview (e2b): same host, port 4000 -> https://4000-<sandbox>.e2b.app
 * - Local web dev:     http://localhost:4000
 * - Device / emulator: set EXPO_PUBLIC_API_URL in app/.env
 */
function resolveBase() {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL.replace(/\/$/, '');

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const { protocol, hostname, host } = window.location;
    const m = host.match(/^(\d+)-(.+\.e2b\.app)$/);
    if (m) return `${protocol}//4000-${m[2]}`;
    return `${protocol}//${hostname}:4000`;
  }
  return 'http://localhost:4000';
}

export const API_URL = resolveBase();

export function mediaUrl(u) {
  if (!u) return null;
  if (/^https?:|^data:|^file:/.test(u)) return u;
  return API_URL + u;
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
  me: () => request('/api/me'),
  updateMe: (payload) => request('/api/me', { method: 'PATCH', body: payload }),
  users: (q = '') => request(`/api/users?q=${encodeURIComponent(q)}`),

  chats: () => request('/api/chats'),
  directChat: (userId) => request('/api/chats/direct', { method: 'POST', body: { userId } }),
  groupChat: (payload) => request('/api/chats/group', { method: 'POST', body: payload }),
  messages: (chatId) => request(`/api/chats/${chatId}/messages`),
  archive: (chatId, archived) => request(`/api/chats/${chatId}/archive`, { method: 'POST', body: { archived } }),
  mute: (chatId, muted) => request(`/api/chats/${chatId}/mute`, { method: 'POST', body: { muted } }),
  search: (q) => request(`/api/search?q=${encodeURIComponent(q)}`),

  statuses: () => request('/api/status'),
  postStatus: (payload) => request('/api/status', { method: 'POST', body: payload }),
  viewStatus: (id) => request(`/api/status/${id}/view`, { method: 'POST' }),

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
