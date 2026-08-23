import React, { createContext, useContext, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { AppState } from 'react-native';
import { io } from 'socket.io-client';
import { SOCKET_URL, api } from '../api';
import { useAuth } from './AuthContext';
import { createMessagingEngine, createMessageId } from '../messaging';
import { GCLocalStore } from '../messaging/GCStore';
import * as RTC from '../webrtc/rtc';
import TextOperation from '../ot/TextOperation';
import { OTManager } from '../ot/OTManager';
import { INBOX_FILTERS, isInboxFilter } from '../chatInbox';

// Keep the historical `useChat()` API for compatibility, but publish focused
// contexts as well. A socket typing event or a call timer must not re-render
// the Network feed, and a post update must not re-render 400 chat bubbles.
const ChatContext = createContext(null);
const ChatListStateContext = createContext(null);
const ChatMessageStateContext = createContext(null);
const ChatGCStateContext = createContext(null);
const ChatRealtimeContext = createContext(null);
const ChatCallContext = createContext(null);
const ChatActionsContext = createContext(null);

export const useChat = () => useContext(ChatContext);
export const useChatListState = () => useContext(ChatListStateContext);
export const useChatMessageState = () => useContext(ChatMessageStateContext);
export const useChatGCState = () => useContext(ChatGCStateContext);
export const useChatRealtime = () => useContext(ChatRealtimeContext);
export const useChatCall = () => useContext(ChatCallContext);
export const useChatActions = () => useContext(ChatActionsContext);

/** Best-effort refresh of the activity badge count (used by socket events). */
const refreshActivityUnread = async (setActivityUnread) => {
  try {
    const r = await api.activity();
    setActivityUnread(r.unread || 0);
  } catch {}
};

// Pinned chats float to the top; within each group, latest activity first.
const sortChats = (list) =>
  [...list].sort((a, b) =>
    ((b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)) ||
    ((b.lastMessage?.createdAt || b.lastMessage?.clientCreatedAt || b.updatedAt || 0)
      - (a.lastMessage?.createdAt || a.lastMessage?.clientCreatedAt || a.updatedAt || 0))
  );

// WebRTC media comes from the platform adapter in src/webrtc: the browser's
// native API on web, react-native-webrtc on Android/iOS (added in Phase 3 —
// ringing/accept/decline/history were always real; now the actual
// peer-to-peer audio/video works on every platform).
const RTC_SUPPORTED = RTC.supported;

// Keep TURN credentials out of source control. EXPO_PUBLIC_ICE_SERVERS may be
// a JSON array, while the individual variables make local setup convenient.
const configuredIceServers = (() => {
  try {
    const raw = typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_ICE_SERVERS : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch {}
  const turnUrl = typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_TURN_URL : null;
  const turnUser = typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_TURN_USERNAME : null;
  const turnCredential = typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_TURN_CREDENTIAL : null;
  return turnUrl && turnUser && turnCredential
    ? [{ urls: turnUrl, username: turnUser, credential: turnCredential }]
    : [];
})();
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }, ...configuredIceServers];

export function ChatProvider({ children }) {
  const { token, user, logout, applySettings } = useAuth();
  const [chats, setChats] = useState([]);
  const [chatsLoaded, setChatsLoaded] = useState(false); // cache checked / first request settled
  const [chatsError, setChatsError] = useState(null);
  // Inbox filter is session + user scoped. Switching it NEVER archives,
  // unarchives, or otherwise mutates chat rows — it only changes the view.
  const [inboxFilter, setInboxFilterState] = useState(INBOX_FILTERS.recent);
  const [chatRequests, setChatRequests] = useState([]);
  const [chatRequestsLoaded, setChatRequestsLoaded] = useState(false);
  const [chatRequestsError, setChatRequestsError] = useState(null);
  const [messages, setMessages] = useState({});   // chatId -> message[]
  const [messagesLoaded, setMessagesLoaded] = useState({}); // chatId -> cache/server checked
  const [messagesLoading, setMessagesLoading] = useState({});
  const [messageErrors, setMessageErrors] = useState({});
  // Refs let stable callbacks read current collections without making the
  // actions context change on every incoming message/chat update.
  const chatsRef = useRef(chats);
  chatsRef.current = chats;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const [typing, setTyping] = useState({});       // chatId -> { userId: name }
  const [connected, setConnected] = useState(false);
  const [activityUnread, setActivityUnread] = useState(0);
  const socketRef = useRef(null);
  const engineRef = useRef(null);
  const otManagerRef = useRef(null);
  const postListeners = useRef(new Set());
  const statusListeners = useRef(new Set());
  const communityListeners = useRef(new Set());
  const colleagueListeners = useRef(new Set());
  const chatRequestListeners = useRef(new Set());
  const chatThemeListeners = useRef(new Set());
  const moderationListeners = useRef(new Set());
  const docListeners = useRef(new Set());
  const [documents, setDocuments] = useState({}); // chatId -> docs[]
  const [otReady, setOtReady] = useState(false);

  /* ---------------- GC environment (fully separate from direct chats) --
     GC chats/messages/typing/unread live in their own state namespace and
     their own cache (GCLocalStore → plusone.gc.v1.<userId>). Nothing in the
     direct-chat store ever receives a GC row or GC message: incoming socket
     events are routed by `conversationType`/chat type, so opening, joining,
     messaging, or leaving a GC can NEVER move, archive, hide, delete,
     reorder, or replace a normal direct chat. */
  const [gcChats, setGcChats] = useState([]);
  const [gcMessages, setGcMessages] = useState({});         // gcId -> message[]
  const [gcMessagesLoaded, setGcMessagesLoaded] = useState({});
  const [gcMessagesLoading, setGcMessagesLoading] = useState({});
  const [gcMessageErrors, setGcMessageErrors] = useState({});
  const [gcTyping, setGcTyping] = useState({});             // gcId -> {userId: name}
  const [gcCursors, setGcCursors] = useState({});           // gcId -> cursor
  const gcStoreRef = useRef(null);
  const gcIdsRef = useRef(new Set());                       // fast GC-id routing
  const gcRoomsRef = useRef(new Set());                     // joined gc:{id} rooms
  const gcPendingRoomsRef = useRef(new Set());              // rooms to join on reconnect
  const gcPullsRef = useRef(new Set());                     // in-flight older-page pulls

  /* ---------------- calls (WebRTC, signalled over the same socket) ---------------- */
  // call: null | { id, chatId, type, direction:'incoming'|'outgoing', status:'ringing'|'connecting'|'ongoing'|'ended', with, startedAt, endedReason }
  const [call, setCall] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [speakerOn, setSpeakerOn] = useState(true);
  const pcRef = useRef(null);
  const pendingCandidates = useRef([]);
  const ringtoneRef = useRef(null);

  /** Subscribe to post:* socket events. Returns an unsubscribe fn. */
  const onPostEvent = useCallback((fn) => {
    postListeners.current.add(fn);
    return () => postListeners.current.delete(fn);
  }, []);

  /** Subscribe to status:* socket events. Returns an unsubscribe fn. */
  const onStatusEvent = useCallback((fn) => {
    statusListeners.current.add(fn);
    return () => statusListeners.current.delete(fn);
  }, []);

  /** Subscribe to gc:* socket events (join requests, approvals). */
  const gcListeners = useRef(new Set());
  const onGCEvent = useCallback((fn) => {
    gcListeners.current.add(fn);
    return () => gcListeners.current.delete(fn);
  }, []);

  /** Subscribe to community:* socket events. Returns an unsubscribe fn. */
  const onCommunityEvent = useCallback((fn) => {
    communityListeners.current.add(fn);
    return () => communityListeners.current.delete(fn);
  }, []);

  /** Subscribe to colleague / affiliation changes. Returns an unsubscribe fn. */
  const onColleagueEvent = useCallback((fn) => {
    colleagueListeners.current.add(fn);
    return () => colleagueListeners.current.delete(fn);
  }, []);

  /** Subscribe to incoming message-request changes. */
  const onChatRequestEvent = useCallback((fn) => {
    chatRequestListeners.current.add(fn);
    return () => chatRequestListeners.current.delete(fn);
  }, []);

  /** Subscribe to per-conversation chat-theme changes. Returns an unsubscribe fn. */
  const onChatThemeEvent = useCallback((fn) => {
    chatThemeListeners.current.add(fn);
    return () => chatThemeListeners.current.delete(fn);
  }, []);

  /** Subscribe to Safety Center case updates. */
  const onModerationEvent = useCallback((fn) => {
    moderationListeners.current.add(fn);
    return () => moderationListeners.current.delete(fn);
  }, []);

  /** Subscribe to OT document events. */
  const onDocEvent = useCallback((fn) => {
    docListeners.current.add(fn);
    return () => docListeners.current.delete(fn);
  }, []);

  const setInboxFilter = useCallback((next) => {
    if (isInboxFilter(next)) setInboxFilterState(next);
  }, []);

  const upsertChat = useCallback((chat) => {
    const engine = engineRef.current;
    if (engine) {
      engine.store.upsertChat(chat);
      return;
    }
    setChats((prev) => {
      const idx = prev.findIndex((c) => c.id === chat.id);
      if (idx === -1) return sortChats([chat, ...prev]);
      const next = [...prev];
      next[idx] = chat;
      return sortChats(next);
    });
  }, []);

  const publishStore = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    setChats(engine.store.getChats());
    setMessages(engine.store.getAllMessagesCopy());
    setMessagesLoaded(engine.store.getLoaded());
  }, []);

  /** Mirror the GC-only store into React state (direct store untouched). */
  const publishGCStore = useCallback(() => {
    const store = gcStoreRef.current;
    if (!store) return;
    setGcChats(store.getChats());
    setGcMessages(store.getAllMessagesCopy());
    setGcMessagesLoaded(store.getLoaded());
    setGcCursors({
      ...Object.fromEntries(Object.keys(store.messages).map((id) => [id, store.getCursor(id)])),
    });
    gcIdsRef.current = new Set(store.getChats().map((c) => c.id));
  }, []);

  /* ---------------- local-first store + outbox ---------------- */
  useEffect(() => {
    const userId = user?.id;
    if (!token || !userId) {
      engineRef.current?.dispose();
      engineRef.current = null;
      setChats([]);
      setMessages({});
      setChatsLoaded(false);
      setChatsError(null);
      setInboxFilterState(INBOX_FILTERS.recent);
      setChatRequests([]);
      setChatRequestsLoaded(false);
      setChatRequestsError(null);
      setMessagesLoaded({});
      setMessagesLoading({});
      setMessageErrors({});
      return undefined;
    }

    let disposed = false;
    setChats([]);
    setMessages({});
    setChatsLoaded(false);
    setChatsError(null);
    setInboxFilterState(INBOX_FILTERS.recent);
    setChatRequests([]);
    setChatRequestsLoaded(false);
    setChatRequestsError(null);
    setMessagesLoaded({});
    setMessagesLoading({});
    setMessageErrors({});

    const engine = createMessagingEngine({
      userId,
      getSocket: () => socketRef.current,
    });
    engineRef.current = engine;

    // OT Manager for collaborative editing
    const otManager = new OTManager({
      getSocket: () => socketRef.current,
      onDocumentUpdate: (docId, content, operation, isRemote) => {
        docListeners.current.forEach(fn => fn('doc:content', { documentId: docId, content, operation, isRemote }));
      },
      onMessageEdit: (messageId, body, version) => {
        // Update message via engine if available
        if (engineRef.current) {
          const allMessages = engineRef.current.store.getAllMessagesCopy();
          Object.entries(allMessages).forEach(([chatId, list]) => {
            const idx = list.findIndex(m => m.id === messageId);
            if (idx !== -1) {
              engineRef.current.store.upsertMessage(chatId, { ...list[idx], body, edited: true, otVersion: version });
            }
          });
        }
      }
    });
    otManagerRef.current = otManager;
    setOtReady(true);

    const unsub = engine.store.subscribe(() => {
      if (!disposed) publishStore();
    });

    (async () => {
      await engine.store.hydrate();
      if (disposed) return;
      // Migration/isolation: the direct-chat store must NEVER hold GC rows.
      // Older clients merged GCs into this same cache — once, here, we evict
      // them (their real home is the GC store, distinct cache key).
      const engineChats = engine.store.getChats();
      const staleGCs = engineChats.filter((c) => c?.type === 'gc');
      if (staleGCs.length) {
        engine.store.setChats(engineChats.filter((c) => c?.type !== 'gc'));
        staleGCs.forEach((gc) => engine.store.removeChat(gc.id));
      }
      publishStore();
      if (engine.store.getChats().length) setChatsLoaded(true);
      engine.outbox.drain();

      // These requests are independent. Starting them together removes one
      // full round-trip from the first signed-in frame while each surface keeps
      // its own loading/error state.
      const loadChats = (async () => {
        try {
          const result = await api.chats();
          if (!Array.isArray(result?.chats)) throw new Error('Invalid conversations response');
          if (!disposed) {
            // /api/chats never returns GC rows (server-side filter), and we
            // defensively drop any that somehow arrive — GCs belong to the GC
            // environment only.
            engine.store.setChats(result.chats.filter((c) => c?.type !== 'gc'), { fromServer: true });
            setChatsError(null);
          }
        } catch {
          if (!disposed) setChatsError('Unable to load conversations. Your saved history is still available.');
        } finally {
          if (!disposed) setChatsLoaded(true);
        }
      })();

      const loadRequests = (async () => {
        try {
          const pending = await api.chatRequests();
          if (!disposed && Array.isArray(pending?.requests)) {
            setChatRequests(pending.requests);
            setChatRequestsError(null);
          }
        } catch {
          if (!disposed) setChatRequestsError('Unable to load chat requests.');
        } finally {
          if (!disposed) setChatRequestsLoaded(true);
        }
      })();
      await Promise.all([loadChats, loadRequests]);
    })();

    const appSub = AppState.addEventListener('change', (next) => {
      if (next === 'active' && engineRef.current === engine) {
        (async () => {
          try {
            await engine.connectivity.probe();
          } catch {
            // offline probe failed — still drain the outbox and resync below
          } finally {
            engine.outbox.drain();
            engine.sync.reconnect().catch(() => {});
          }
        })();
      }
    });

    return () => {
      disposed = true;
      appSub.remove();
      unsub();
      engine.dispose();
      otManager.dispose();
      if (engineRef.current === engine) engineRef.current = null;
      if (otManagerRef.current === otManager) otManagerRef.current = null;
      setOtReady(false);
    };
  }, [token, user?.id, publishStore]);

  /* ---------------- GC-only store lifecycle (isolated cache) ---------------- */
  useEffect(() => {
    const userId = user?.id;
    if (!token || !userId) {
      gcStoreRef.current?.dispose();
      gcStoreRef.current = null;
      setGcChats([]);
      setGcMessages({});
      setGcMessagesLoaded({});
      setGcMessagesLoading({});
      setGcMessageErrors({});
      setGcTyping({});
      setGcCursors({});
      gcIdsRef.current = new Set();
      return undefined;
    }

    let disposed = false;
    setGcChats([]);
    setGcMessages({});
    setGcMessagesLoaded({});
    setGcMessagesLoading({});
    setGcMessageErrors({});
    setGcTyping({});
    setGcCursors({});

    const store = new GCLocalStore(userId);
    gcStoreRef.current = store;
    const unsub = store.subscribe(() => {
      if (!disposed) publishGCStore();
    });

    (async () => {
      await store.hydrate();
      if (disposed) return;
      publishGCStore();
      try {
        const result = await api.gcs();
        if (!disposed && Array.isArray(result?.chats)) {
          store.setChats(result.chats, { fromServer: true });
        }
      } catch { /* keep the cached GC list; the refresh button retries */ }
    })();

    return () => {
      disposed = true;
      unsub();
      store.dispose();
      if (gcStoreRef.current === store) gcStoreRef.current = null;
    };
  }, [token, user?.id, publishGCStore]);

  /** GC-only incoming-message path. `tempId` replaces the optimistic row. */
  const applyIncomingGCMessage = useCallback((message, tempId = null) => {
    if (!message?.chatId) return;
    const store = gcStoreRef.current;
    if (store) {
      store.upsertMessage(message.chatId, { ...message, _new: !tempId }, { replaceId: tempId });
      store.markLoaded(message.chatId);
    }
    setGcMessagesLoaded((prev) => ({ ...prev, [message.chatId]: true }));
    setGcMessageErrors((prev) => {
      if (!prev[message.chatId]) return prev;
      const next = { ...prev };
      delete next[message.chatId];
      return next;
    });
  }, []);

  const joinGCRoom = useCallback((gcId) => {
    if (!gcId || gcRoomsRef.current.has(gcId) || gcPendingRoomsRef.current.has(gcId)) return;
    const socket = socketRef.current;
    if (!socket?.connected) {
      gcPendingRoomsRef.current.add(gcId);
      return;
    }
    gcRoomsRef.current.add(gcId);
    socket.emit('gc:join', { gcId }, (res) => {
      if (res?.error) gcRoomsRef.current.delete(gcId);
      else if (res?.chat) gcStoreRef.current?.upsertChat(res.chat);
    });
  }, []);

  const leaveGCRoom = useCallback((gcId) => {
    if (!gcId) return;
    gcPendingRoomsRef.current.delete(gcId);
    if (!gcRoomsRef.current.has(gcId)) return;
    gcRoomsRef.current.delete(gcId);
    socketRef.current?.emit('gc:leave', { gcId });
  }, []);

  /* ---------------- socket lifecycle ---------------- */
  useEffect(() => {
    if (!token) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setConnected(false); setActivityUnread(0);
      return;
    }

    // REST may use the Vercel proxy, but Socket.IO must use the persistent
    // Railway origin. An empty target is still valid for a true single-host
    // deploy; socket.io then connects to the page origin.
    const socket = io(SOCKET_URL || undefined, { auth: { token }, transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      const engine = engineRef.current;
      if (engine) {
        engine.connectivity.setSocketConnected(true);
        engine.outbox.drain();
        engine.sync.reconnect().catch(() => {});
      }
      otManagerRef.current?.drainOfflineQueue();
      // Re-join any GC rooms that were waiting for a connection (no dupes:
      // joinGCRoom is idempotent per gcId).
      const pending = [...gcPendingRoomsRef.current];
      gcPendingRoomsRef.current.clear();
      pending.forEach((gcId) => {
        gcRoomsRef.current.delete(gcId);
        joinGCRoom(gcId);
      });
    });
    socket.on('disconnect', () => {
      setConnected(false);
      engineRef.current?.connectivity.setSocketConnected(false);
    });
    socket.on('connect_error', () => {
      setConnected(false);
      engineRef.current?.connectivity.setSocketConnected(false);
    });

    // OT Document events
    socket.on('doc:operation', (payload) => {
      otManagerRef.current?.handleRemoteOperation(payload);
      docListeners.current.forEach(fn => fn('doc:operation', payload));
      // Update documents preview in chat
      if (payload.documentId) {
        const docRow = { id: payload.documentId, content: null, version: payload.version };
        // We don't have full content here, but notify listeners
      }
    });
    socket.on('doc:created', (payload) => {
      docListeners.current.forEach(fn => fn('doc:created', payload));
      if (payload.chatId) {
        setDocuments(prev => ({
          ...prev,
          [payload.chatId]: [...(prev[payload.chatId] || []).filter(d => d.id !== payload.document.id), payload.document]
        }));
      }
    });
    socket.on('doc:deleted', (payload) => {
      docListeners.current.forEach(fn => fn('doc:deleted', payload));
      if (payload.chatId) {
        setDocuments(prev => ({
          ...prev,
          [payload.chatId]: (prev[payload.chatId] || []).filter(d => d.id !== payload.documentId)
        }));
      }
    });
    socket.on('doc:updated', (payload) => {
      docListeners.current.forEach(fn => fn('doc:updated', payload));
    });
    socket.on('doc:selection', (payload) => {
      docListeners.current.forEach(fn => fn('doc:selection', payload));
    });
    socket.on('doc:user:joined', (payload) => {
      docListeners.current.forEach(fn => fn('doc:user:joined', payload));
    });
    socket.on('doc:user:left', (payload) => {
      docListeners.current.forEach(fn => fn('doc:user:left', payload));
    });

    // OT Message edit events
    socket.on('message:edit:ot', (payload) => {
      const engine = engineRef.current;
      if (engine) {
        try {
          const allMessages = engine.store.getAllMessagesCopy();
          Object.entries(allMessages).forEach(([chatId, list]) => {
            const idx = list.findIndex(m => m.id === payload.messageId);
            if (idx !== -1) {
              const op = TextOperation.fromJSON(payload.operation);
              const newBody = op.apply(list[idx].body || '');
              engine.store.upsertMessage(chatId, { ...list[idx], body: newBody, edited: true, otVersion: payload.version });
            }
          });
        } catch {}
      } else {
        setMessages(prev => {
          const next = { ...prev };
          Object.keys(next).forEach(chatId => {
            next[chatId] = next[chatId].map(m => {
              if (m.id === payload.messageId) {
                try {
                  const op = TextOperation.fromJSON(payload.operation);
                  return { ...m, body: op.apply(m.body || ''), edited: true, otVersion: payload.version };
                } catch {
                  return { ...m, body: payload.body || m.body, edited: true, otVersion: payload.version };
                }
              }
              return m;
            });
          });
          return next;
        });
      }
    });
    socket.on('account:deleted', () => logout());
    socket.on('settings:updated', ({ settings }) => applySettings(settings));

    socket.on('message:new', ({ message, tempId }) => {
      // Route by explicit conversation type: GC messages land in the GC
      // store ONLY — they never touch direct chat state.
      if (message?.conversationType === 'gc' || gcIdsRef.current.has(message?.chatId)) {
        applyIncomingGCMessage(message, tempId);
        return;
      }
      const engine = engineRef.current;
      if (engine) engine.repository.applyIncoming(message, tempId);
      else {
        setMessages((prev) => {
          const list = prev[message.chatId] || [];
          const replaced = tempId ? list.find((m) => m.id === tempId) : null;
          const withoutTemp = replaced ? list.filter((m) => m.id !== tempId) : list;
          if (withoutTemp.some((m) => m.id === message.id)) return prev;
          return { ...prev, [message.chatId]: [...withoutTemp, { ...message, _new: !replaced }] };
        });
      }
      setMessagesLoaded((prev) => ({ ...prev, [message.chatId]: true }));
      setMessageErrors((prev) => {
        if (!prev[message.chatId]) return prev;
        const next = { ...prev };
        delete next[message.chatId];
        return next;
      });
    });

    // Dedicated GC realtime event (server also sends message:new for older
    // clients; dedupe by message id is harmless).
    socket.on('gc:message', ({ message, tempId }) => {
      if (message) applyIncomingGCMessage(message, tempId);
    });

    socket.on('message:updated', (message) => {
      if (message?.conversationType === 'gc' || gcIdsRef.current.has(message?.chatId)) {
        gcStoreRef.current?.upsertMessage(message.chatId, message);
        return;
      }
      const engine = engineRef.current;
      if (engine) {
        engine.repository.applyUpdated(message);
        return;
      }
      setMessages((prev) => {
        const list = prev[message.chatId];
        if (!list) return prev;
        return { ...prev, [message.chatId]: list.map((m) => (m.id === message.id ? message : m)) };
      });
    });

    socket.on('message:expired', ({ chatId, messageIds }) => {
      if (gcIdsRef.current.has(chatId)) {
        gcStoreRef.current?.removeMessages(chatId, messageIds);
        return;
      }
      const engine = engineRef.current;
      if (engine) {
        engine.repository.applyExpired(chatId, messageIds);
        return;
      }
      setMessages((prev) => {
        const list = prev[chatId];
        if (!list) return prev;
        const ids = new Set(messageIds);
        const next = list.filter((m) => !ids.has(m.id));
        return next.length === list.length ? prev : { ...prev, [chatId]: next };
      });
    });

    // "Delete for me" — the server hid a single message only for this user,
    // so drop it locally with no tombstone.
    socket.on('message:hidden', ({ chatId, messageId }) => {
      if (gcIdsRef.current.has(chatId)) {
        gcStoreRef.current?.removeMessages(chatId, [messageId]);
        return;
      }
      const engine = engineRef.current;
      if (engine) {
        engine.store.removeMessages(chatId, [messageId]);
        return;
      }
      setMessages((prev) => {
        const list = prev[chatId];
        if (!list) return prev;
        const next = list.filter((m) => m.id !== messageId && m.clientId !== messageId);
        return next.length === list.length ? prev : { ...prev, [chatId]: next };
      });
    });

    socket.on('chat:removed', ({ chatId }) => {
      if (chatId) {
        setChatRequests((prev) => prev.filter((row) => row.chatId !== chatId));
      }
      if (gcIdsRef.current.has(chatId)) {
        gcStoreRef.current?.removeChat(chatId);
        leaveGCRoom(chatId);
        return;
      }
      const engine = engineRef.current;
      if (engine) engine.store.removeChat(chatId);
      else setChats((prev) => prev.filter((c) => c.id !== chatId));
      setMessages((prev) => {
        if (!(chatId in prev)) return prev;
        const next = { ...prev };
        delete next[chatId];
        return next;
      });
      [setMessagesLoaded, setMessagesLoading, setMessageErrors].forEach((setState) => {
        setState((prev) => {
          if (!(chatId in prev)) return prev;
          const next = { ...prev };
          delete next[chatId];
          return next;
        });
      });
    });

    // Route every incoming chat summary: GC rows go to the GC store, all
    // other rows (direct/group/community) stay in the direct-chat store.
    const routeIncomingChat = (chat) => {
      if (chat?.type === 'gc') {
        gcStoreRef.current?.upsertChat(chat);
        return;
      }
      upsertChat(chat);
      // An accepted conversation leaving Request Chat is a display update
      // only — the request row is dropped once the chat is in the inbox.
      if (chat?.id) {
        setChatRequests((prev) => (prev.some((row) => row.chatId === chat.id)
          ? prev.filter((row) => row.chatId !== chat.id)
          : prev));
      }
    };
    socket.on('chat:updated', routeIncomingChat);
    socket.on('chat:new', routeIncomingChat);

    // GC-only list updates (same chat summary shape, GC namespaced).
    socket.on('gc:updated', ({ chat }) => {
      if (chat?.type === 'gc') gcStoreRef.current?.upsertChat(chat);
    });
    // A GC was removed/left — tear the GC environment down, leave its room.
    socket.on('gc:removed', ({ chatId }) => {
      gcStoreRef.current?.removeChat(chatId);
      setGcMessages((prev) => {
        if (!(chatId in prev)) return prev;
        const next = { ...prev };
        delete next[chatId];
        return next;
      });
      [setGcMessagesLoaded, setGcMessagesLoading, setGcMessageErrors].forEach((setState) => {
        setState((prev) => {
          if (!(chatId in prev)) return prev;
          const next = { ...prev };
          delete next[chatId];
          return next;
        });
      });
      setGcTyping((prev) => {
        if (!(chatId in prev)) return prev;
        const next = { ...prev };
        delete next[chatId];
        return next;
      });
      leaveGCRoom(chatId);
    });

    // Per-conversation chat theme changed (this device or another
    // participant). Patch the chat summary immediately and notify any
    // subscribed screen (the chat-theme store) so open chats re-theme
    // without waiting for the full chat:updated round-trip.
    socket.on('chat:theme', (payload) => {
      const patch = (c) => (c.id === payload.chatId
        ? { ...c, themeId: payload.themeId, themeUpdatedBy: payload.themeUpdatedBy, themeUpdatedAt: payload.themeUpdatedAt }
        : c);
      const engine = engineRef.current;
      if (engine) engine.store.setChats(engine.store.getChats().map(patch));
      else setChats((prev) => prev.map(patch));
      chatThemeListeners.current.forEach((fn) => fn('chat:theme', payload));
    });

    socket.on('chat:request', (payload) => {
      if (payload?.chatId) {
        setChatRequests((prev) => {
          const idx = prev.findIndex((row) => row.chatId === payload.chatId);
          if (idx === -1) return [payload, ...prev];
          const next = [...prev];
          next[idx] = payload;
          return next;
        });
        setChatRequestsLoaded(true);
        setChatRequestsError(null);
      }
      chatRequestListeners.current.forEach((fn) => fn('chat:request', payload));
      refreshActivityUnread(setActivityUnread);
    });
    socket.on('chat:request:resolved', (payload) => {
      if (payload?.chatId) {
        setChatRequests((prev) => prev.filter((row) => row.chatId !== payload.chatId));
      }
      if (payload?.action === 'accept' && payload?.chat) upsertChat(payload.chat);
      chatRequestListeners.current.forEach((fn) => fn('chat:request:resolved', payload));
      refreshActivityUnread(setActivityUnread);
    });

    // The Network — re-broadcast post events to any subscribed screen
    ['post:new', 'post:deleted', 'post:likes', 'post:comments'].forEach((ev) => {
      socket.on(ev, (payload) => {
        postListeners.current.forEach((fn) => fn(ev, payload));
      });
    });

    socket.on('status:new', (payload) => {
      statusListeners.current.forEach((fn) => fn('status:new', payload));
    });

    // GCs — a join request landed on a GC I admin, or my own request was
    // answered. The GC section refreshes its badges / discover cards.
    socket.on('gc:request', (payload) => {
      gcListeners.current.forEach((fn) => fn('gc:request', payload));
    });
    socket.on('gc:requestUpdate', (payload) => {
      gcListeners.current.forEach((fn) => fn('gc:requestUpdate', payload));
    });

    // Communities — re-broadcast to any subscribed screen
    ['community:updated', 'community:deleted', 'community:request', 'community:approved',
     'community:declined', 'community:added', 'community:removed', 'community:left'].forEach((ev) => {
      socket.on(ev, (payload) => {
        communityListeners.current.forEach((fn) => fn(ev, payload));
        if (ev === 'community:request' || ev === 'community:approved' || ev === 'community:declined') {
          refreshActivityUnread(setActivityUnread);
        }
      });
    });

    socket.on('moderation:update', (payload) => {
      moderationListeners.current.forEach((fn) => fn(payload));
    });

    ['colleague:updated', 'affiliation:updated'].forEach((ev) => {
      socket.on(ev, (payload) => {
        colleagueListeners.current.forEach((fn) => fn(ev, payload));
        refreshActivityUnread(setActivityUnread);
      });
    });

    socket.on('presence', ({ userId, isOnline, lastSeen }) => {
      const patch = (c) => (c.otherUserId === userId ? { ...c, isOnline, lastSeen } : c);
      const engine = engineRef.current;
      if (engine) engine.store.setChats(engine.store.getChats().map(patch));
      else setChats((prev) => prev.map(patch));
      // Keep GC member presence fresh too (separate store, same event).
      const gcStore = gcStoreRef.current;
      if (gcStore) {
        gcStore.setChats(gcStore.getChats().map((c) => ({
          ...c,
          members: c.members?.map((m) => (m.id === userId ? { ...m, isOnline, lastSeen } : m)),
        })), { fromServer: false });
      }
    });

    socket.on('typing', ({ chatId, userId, name, isTyping }) => {
      if (gcIdsRef.current.has(chatId)) {
        setGcTyping((prev) => {
          const forGC = { ...(prev[chatId] || {}) };
          if (isTyping) forGC[userId] = name; else delete forGC[userId];
          return { ...prev, [chatId]: forGC };
        });
        return;
      }
      setTyping((prev) => {
        const forChat = { ...(prev[chatId] || {}) };
        if (isTyping) forChat[userId] = name; else delete forChat[userId];
        return { ...prev, [chatId]: forChat };
      });
    });

    // Dedicated GC typing events (GC chat uses gc:typing; typing is kept as
    // a fallback for parity with older servers).
    socket.on('gc:typing', ({ gcId, userId, name, isTyping }) => {
      setGcTyping((prev) => {
        const forGC = { ...(prev[gcId] || {}) };
        if (isTyping) forGC[userId] = name; else delete forGC[userId];
        return { ...prev, [gcId]: forGC };
      });
    });

    /* ---------------- calls ---------------- */

    socket.on('call:incoming', (payload) => {
      // Never replace an active session with a stale/duplicate invite.
      if (callRef.current) {
        socket.emit('call:decline', { callId: payload.id });
        return;
      }
      setCall({
        id: payload.id, chatId: payload.chatId, type: payload.type,
        direction: 'incoming', status: 'ringing', with: payload.caller, startedAt: payload.startedAt,
      });
      playRingtone();
      refreshActivityUnread(setActivityUnread);
    });

    socket.on('call:accepted', (payload) => {
      stopRingtone();
      setCall((prev) => (prev && prev.id === payload.id ? { ...prev, status: 'connecting' } : prev));
      // Caller side: now that the callee accepted, start the WebRTC offer.
      startWebRTC(payload.id, true, callTypeRef.current);
    });

    socket.on('call:offer', async ({ callId, sdp }) => {
      try {
        // Callee side: caller's offer arrives once we've accepted and the
        // caller has our accept — create our own peer connection and answer.
        const pc = await ensurePeerConnection(callId, callRef.current?.type || 'audio');
        await pc.setRemoteDescription(RTC.SessionDescription(sdp));
        flushPendingCandidates(pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('call:answer', { callId, sdp: answer });
        setCall((prev) => (prev ? { ...prev, status: 'ongoing' } : prev));
      } catch (e) {
        console.error('[WebRTC] Error in call:offer:', e);
        socket.emit('call:hangup', { callId });
        teardownWebRTC();
        setCall((prev) => (prev && prev.id === callId ? { ...prev, status: 'ended', endedReason: 'failed', error: e.message } : prev));
      }
    });

    socket.on('call:answer', async ({ callId, sdp }) => {
      try {
        const pc = pcRef.current;
        if (!pc || callRef.current?.id !== callId) return;
        await pc.setRemoteDescription(RTC.SessionDescription(sdp));
        flushPendingCandidates(pc);
        setCall((prev) => (prev ? { ...prev, status: 'ongoing' } : prev));
      } catch (e) {
        console.error('[WebRTC] Error in call:answer:', e);
        socket.emit('call:hangup', { callId });
        teardownWebRTC();
        setCall((prev) => (prev && prev.id === callId ? { ...prev, status: 'ended', endedReason: 'failed', error: e.message } : prev));
      }
    });

    socket.on('call:ice-candidate', async ({ callId, candidate }) => {
      const pc = pcRef.current;
      if (!candidate || callRef.current?.id !== callId) return;
      if (pc && pc.remoteDescription && pc.remoteDescription.type) {
        try { await pc.addIceCandidate(RTC.IceCandidate(candidate)); } catch {}
      } else {
        pendingCandidates.current.push(candidate);
      }
    });

    socket.on('call:ended', (payload) => {
      stopRingtone();
      teardownWebRTC();
      setCall((prev) => (prev && prev.id === payload.id ? { ...prev, status: 'ended', endedReason: payload.endedReason } : prev));
      setTimeout(() => setCall((prev) => (prev && prev.status === 'ended' ? null : prev)), 2500);
      refreshActivityUnread(setActivityUnread);
    });

    // Conversation startup hydration/refresh is handled by the durable-cache
    // effect above. Keep activity independent so either request can fail
    // without making the chat history appear empty.
    refreshActivityUnread(setActivityUnread);

    return () => {
      stopRingtone();
      teardownWebRTC();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token, upsertChat, logout, applySettings, applyIncomingGCMessage, joinGCRoom, leaveGCRoom]);

  /* ---------------- calls: WebRTC plumbing ---------------- */

  // Kept as refs (not state) so socket event handlers registered once in
  // the effect above always see the latest call/type without re-binding.
  const callRef = useRef(null);
  const callTypeRef = useRef('audio');
  useEffect(() => { callRef.current = call; }, [call]);

  const flushPendingCandidates = (pc) => {
    pendingCandidates.current.forEach((c) => pc.addIceCandidate(RTC.IceCandidate(c)).catch(() => {}));
    pendingCandidates.current = [];
  };

  const playRingtone = () => {
    if (!RTC_SUPPORTED) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 440;
      gain.gain.value = 0.05;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      ringtoneRef.current = { ctx, osc };
    } catch {}
  };
  const stopRingtone = () => {
    if (ringtoneRef.current) {
      try { ringtoneRef.current.osc.stop(); ringtoneRef.current.ctx.close(); } catch {}
      ringtoneRef.current = null;
    }
  };

  const ensurePeerConnection = useCallback(async (callId, type) => {
    if (pcRef.current) return pcRef.current;
    if (!RTC_SUPPORTED) throw new Error('Calling is not supported on this device');

    const stream = await RTC.getUserMedia({
      audio: true,
      video: type === 'video',
    });
    setLocalStream(stream);
    setMicOn(true);
    setCamOn(type === 'video');
    setSpeakerOn(true);

    const pc = RTC.createPeerConnection({ iceServers: ICE_SERVERS });
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    pc.onicecandidate = (e) => {
      if (e.candidate) socketRef.current?.emit('call:ice-candidate', { callId, candidate: e.candidate });
    };
    pc.ontrack = (e) => {
      if (e.streams && e.streams[0]) {
        setRemoteStream(e.streams[0]);
      } else {
        const rStream = typeof window !== 'undefined' && window.MediaStream
          ? new window.MediaStream([e.track])
          : (e.track ? { id: 'remote', getTracks: () => [e.track] } : null);
        setRemoteStream(rStream);
      }
    };
    pc.onconnectionstatechange = () => {
      setCall((prev) => {
        if (prev && prev.id === callId) {
          return { ...prev, connectionState: pc.connectionState };
        }
        return prev;
      });
    };
    pc.oniceconnectionstatechange = () => {
      setCall((prev) => {
        if (prev && prev.id === callId) {
          return { ...prev, iceConnectionState: pc.iceConnectionState };
        }
        return prev;
      });
    };

    pcRef.current = pc;
    return pc;
  }, []);

  const startWebRTC = useCallback(async (callId, isCaller, type) => {
    try {
      const pc = await ensurePeerConnection(callId, type);
      if (isCaller) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socketRef.current?.emit('call:offer', { callId, sdp: offer });
      }
    } catch (e) {
      console.error('[WebRTC] startWebRTC failed:', e);
      socketRef.current?.emit('call:hangup', { callId });
      teardownWebRTC();
      setCall((prev) => (prev ? { ...prev, status: 'ended', endedReason: 'failed', error: e.message } : prev));
    }
  }, [ensurePeerConnection]);

  const teardownWebRTC = useCallback(() => {
    stopRingtone();
    if (pcRef.current) {
      try {
        pcRef.current.onicecandidate = null;
        pcRef.current.ontrack = null;
        pcRef.current.onconnectionstatechange = null;
        pcRef.current.oniceconnectionstatechange = null;
        pcRef.current.close();
      } catch (err) {
        console.warn('[WebRTC] teardown error:', err);
      }
      pcRef.current = null;
    }
    setLocalStream((prev) => {
      if (prev) {
        prev.getTracks().forEach((t) => {
          try { t.stop(); } catch {}
        });
      }
      return null;
    });
    setRemoteStream(null);
    pendingCandidates.current = [];
  }, []);

  /** Start an outgoing call to `calleeId` in `chatId`. */
  const startCall = useCallback((chatId, calleeId, type = 'audio') => {
    if (!RTC_SUPPORTED) {
      setCall({ id: 'unsupported', chatId, type, direction: 'outgoing', status: 'ended', endedReason: 'failed', error: 'Calling is not available on this device yet.' });
      setTimeout(() => setCall(null), 3500);
      return;
    }
    teardownWebRTC();
    callTypeRef.current = type;

    // Pre-populate recipient name and avatar from our loaded chats for immediate response
    const chat = chatsRef.current.find((c) => c.id === chatId);
    const callee = chat
      ? { id: calleeId, name: chat.name, avatar: chat.avatar }
      : { id: calleeId, name: 'Calling...' };

    setCall({
      id: 'initiating',
      chatId,
      type,
      direction: 'outgoing',
      status: 'calling',
      with: callee,
      startedAt: Date.now(),
    });

    socketRef.current?.emit('call:invite', { chatId, calleeId, type }, (res) => {
      if (res?.error) {
        setCall({ id: 'error', chatId, type, direction: 'outgoing', status: 'ended', endedReason: res.busy ? 'busy' : 'failed', error: res.error });
        setTimeout(() => setCall(null), 3500);
        return;
      }
      setCall({ id: res.call.id, chatId, type, direction: 'outgoing', status: 'ringing', with: res.call.with, startedAt: res.call.startedAt });
    });
  }, [teardownWebRTC]);

  const acceptCall = useCallback(() => {
    if (!call) return;
    stopRingtone();
    teardownWebRTC();
    socketRef.current?.emit('call:accept', { callId: call.id }, async (res) => {
      if (res?.error) { setCall(null); return; }
      callTypeRef.current = call.type;
      setCall((prev) => (prev ? { ...prev, status: 'connecting' } : prev));
      // Callee waits for the caller's offer (see socket.on('call:offer') above)
      // but still needs its own media/peer connection ready to receive it.
      try {
        await ensurePeerConnection(call.id, call.type);
      } catch (e) {
        socketRef.current?.emit('call:hangup', { callId: call.id });
        teardownWebRTC();
        setCall((prev) => (prev ? { ...prev, status: 'ended', endedReason: 'failed', error: e.message } : prev));
      }
    });
  }, [call, ensurePeerConnection, teardownWebRTC]);

  const declineCall = useCallback(() => {
    if (!call) return;
    stopRingtone();
    if (call.id !== 'initiating' && call.id !== 'error' && call.id !== 'unsupported') {
      socketRef.current?.emit('call:decline', { callId: call.id });
    }
    setCall(null);
  }, [call]);

  const hangUp = useCallback(() => {
    if (!call) return;
    stopRingtone();
    if (call.id !== 'initiating' && call.id !== 'error' && call.id !== 'unsupported') {
      socketRef.current?.emit('call:hangup', { callId: call.id });
    }
    teardownWebRTC();
    setCall(null);
  }, [call, teardownWebRTC]);

  const toggleMic = useCallback(() => {
    setMicOn((prev) => {
      const next = !prev;
      localStream?.getAudioTracks().forEach((t) => { t.enabled = next; });
      return next;
    });
  }, [localStream]);

  const toggleCam = useCallback(() => {
    setCamOn((prev) => {
      const next = !prev;
      localStream?.getVideoTracks().forEach((t) => { t.enabled = next; });
      return next;
    });
  }, [localStream]);

  const toggleSpeaker = useCallback(() => {
    setSpeakerOn((prev) => !prev);
  }, []);

  const switchCamera = useCallback(async () => {
    if (!localStream) return;
    const videoTracks = localStream.getVideoTracks();
    if (videoTracks.length === 0) return;
    for (const track of videoTracks) {
      if (typeof track._switchCamera === 'function') {
        track._switchCamera();
      } else if (typeof track.applyConstraints === 'function') {
        const currentFacing = track.getSettings()?.facingMode;
        const nextFacing = currentFacing === 'user' ? 'environment' : 'user';
        try {
          await track.applyConstraints({ facingMode: nextFacing });
        } catch (e) {
          console.warn('[WebRTC] switch camera constraint error:', e);
        }
      }
    }
  }, [localStream]);

  /* ---------------- GC actions (isolated: never touch direct state) ---------------- */

  /** Refresh My GCs from the GC-only API into the GC store. */
  const refreshGCs = useCallback(async () => {
    try {
      const result = await api.gcs();
      if (!Array.isArray(result?.chats)) throw new Error('Invalid conversations response');
      const store = gcStoreRef.current;
      if (store) store.setChats(result.chats, { fromServer: true });
      return result.chats;
    } catch (error) {
      throw error;
    }
  }, []);

  /** Load the latest page of one GC's messages (membership enforced server
   *  side). Joins the GC room first so live gc:message events flow. */
  const loadGCMessages = useCallback(async (gcId) => {
    const store = gcStoreRef.current;
    if (!gcId) return [];
    joinGCRoom(gcId);
    if (store) {
      if (store.getMessages(gcId).length) store.markLoaded(gcId);
    }
    setGcMessagesLoading((prev) => ({ ...prev, [gcId]: true }));
    setGcMessageErrors((prev) => {
      if (!prev[gcId]) return prev;
      const next = { ...prev };
      delete next[gcId];
      return next;
    });
    try {
      const cursor = store?.getCursor(gcId) || null;
      let page;
      if (cursor?.after) {
        page = await api.gcMessages(gcId, { after: cursor.after, afterId: cursor.afterId, limit: 50 });
        if (store) {
          if (page?.messages?.length) store.mergeMessages(gcId, page.messages);
          else store.markLoaded(gcId);
        }
      } else {
        page = await api.gcMessages(gcId, { limit: 50 });
        if (store) store.mergeMessages(gcId, page?.messages || []);
      }
      if (store && page) {
        store.setCursor(gcId, {
          hasMore: !!page.hasMore,
          after: page.cursor?.after || cursor?.after || null,
          afterId: page.cursor?.afterId || cursor?.afterId || null,
          before: page.cursor?.before || cursor?.before || null,
          beforeId: page.cursor?.beforeId || cursor?.beforeId || null,
        });
        store.markLoaded(gcId);
      }
      return store ? store.getMessages(gcId) : [];
    } catch (error) {
      store?.markLoaded(gcId);
      setGcMessageErrors((prev) => ({ ...prev, [gcId]: 'Unable to load GC messages. Check your connection and retry.' }));
      throw error;
    } finally {
      setGcMessagesLoading((prev) => ({ ...prev, [gcId]: false }));
    }
  }, [joinGCRoom]);

  /** Page older messages for a GC (one in-flight pull per GC). */
  const loadOlderGCMessages = useCallback(async (gcId) => {
    const store = gcStoreRef.current;
    if (!store || gcPullsRef.current.has(gcId)) return;
    const cursor = store.getCursor(gcId);
    if (cursor?.hasMore === false) return;
    const oldest = store.getMessages(gcId)[0];
    if (!oldest) return loadGCMessages(gcId);
    gcPullsRef.current.add(gcId);
    try {
      const page = await api.gcMessages(gcId, {
        before: oldest.createdAt || oldest.clientCreatedAt,
        beforeId: oldest.id,
        limit: 50,
      });
      if (page?.messages?.length) store.mergeMessages(gcId, page.messages);
      store.setCursor(gcId, { hasMore: !!page?.hasMore });
    } catch {
      // Keep the visible page; next scroll retries.
    } finally {
      gcPullsRef.current.delete(gcId);
    }
  }, [gcPullsRef, loadGCMessages]);

  /**
   * Optimistic GC send: a pending bubble appears in the GC's own message
   * list immediately; the server (idempotent on clientId) replaces it.
   * Failed sends keep a retry affordance — the direct chats are never
   * touched by any of this.
   */
  const sendGCMessage = useCallback((gcId, payload = {}) => {
    const store = gcStoreRef.current;
    const senderId = user?.id;
    if (!store || !senderId || !gcId) return null;
    const clientId = payload.clientId || createMessageId();
    const nowTs = payload.clientCreatedAt || Date.now();
    const localMedia = payload.mediaUrl && !/^https?:|^\/uploads\//.test(payload.mediaUrl) ? payload.mediaUrl : null;
    const optimistic = {
      id: clientId,
      clientId,
      chatId: gcId,
      conversationType: 'gc',
      gcId,
      senderId,
      type: payload.type || 'text',
      body: payload.body || '',
      mediaUrl: payload.mediaUrl || null,
      mediaThumbUrl: payload.mediaThumbUrl || null,
      duration: payload.duration || 0,
      createdAt: nowTs,
      clientCreatedAt: nowTs,
      status: 'sending',
      pending: true,
      _new: true,
      reactions: [],
      replyTo: payload.replyToMessage || null,
      localMediaUri: localMedia,
      uploadProgress: localMedia ? 0 : null,
    };
    store.upsertMessage(gcId, optimistic);
    (async () => {
      let sendPayload = { ...payload };
      try {
        // Local image first uploads (same flow as the direct-chat outbox),
        // then the server stores the remote URL — never a file:// URI.
        if (localMedia) {
          const web = typeof document !== 'undefined';
          const type = payload.mimeType || (web ? 'image/png' : 'image/jpeg');
          const name = `gc-${Date.now()}.${web ? 'png' : 'jpg'}`;
          const { url } = await api.uploadFile(localMedia, name, type);
          sendPayload = {
            ...sendPayload,
            mediaUrl: url,
            mediaThumbUrl: payload.mediaThumbUrl || null,
            localMediaUri: null,
          };
          store.upsertMessage(gcId, { ...optimistic, uploadProgress: 100, localMediaUri: null, mediaUrl: url });
        }
        const r = await api.sendGCMessage(gcId, { ...sendPayload, clientId });
        if (r?.message) store.upsertMessage(gcId, r.message, { replaceId: clientId });
      } catch (e) {
        store.upsertMessage(gcId, { ...optimistic, status: 'failed', pending: false, error: e.message || 'Could not send' });
      }
    })();
    return clientId;
  }, [user?.id]);

  /** Edit one of my own GC text messages (same server OT path as direct
   *  chats; the message is looked up in the GC-only store). */
  const editGCMessage = useCallback((messageId, body, options = {}) => {
    return new Promise((resolve, reject) => {
      const store = gcStoreRef.current;
      let found = null;
      if (store) {
        for (const list of Object.values(store.getAllMessagesCopy())) {
          const m = list.find((x) => x.id === messageId);
          if (m) { found = m; break; }
        }
      }
      const baseVersion = options.baseVersion ?? found?.otVersion ?? 0;
      const socket = socketRef.current;
      if (!socket?.connected) return reject(new Error('Not connected'));
      socket.emit('message:edit', { messageId, body, baseVersion }, (res) => {
        if (res?.error) reject(new Error(res.error));
        else resolve(res.message);
      });
    });
  }, []);

  /** Retry a failed GC message. */
  const retryGCMessage = useCallback((gcId, messageId) => {
    const store = gcStoreRef.current;
    if (!store || !gcId || !messageId) return;
    const message = store.getMessages(gcId).find((m) => m.id === messageId || m.clientId === messageId);
    if (!message) return;
    store.upsertMessage(gcId, { ...message, status: 'sending', pending: true, error: null });
    (async () => {
      try {
        let mediaUrl = message.mediaUrl;
        let localMediaUri = message.localMediaUri || null;
        // Re-upload a local image that never made it to the first attempt.
        if (message.type === 'image' && localMediaUri) {
          const web = typeof document !== 'undefined';
          const type = message.mimeType || (web ? 'image/png' : 'image/jpeg');
          const name = `gc-${Date.now()}.${web ? 'png' : 'jpg'}`;
          const { url } = await api.uploadFile(localMediaUri, name, type);
          mediaUrl = url;
          localMediaUri = null;
          store.upsertMessage(gcId, { ...message, mediaUrl: url, localMediaUri: null, uploadProgress: 100 });
        }
        const r = await api.sendGCMessage(gcId, {
          type: message.type,
          body: message.body,
          mediaUrl,
          mediaThumbUrl: message.mediaThumbUrl,
          duration: message.duration,
          clientId: message.clientId || message.id,
          clientCreatedAt: message.clientCreatedAt,
          replyTo: message.replyTo?.id || null,
          replyToMessage: message.replyTo || null,
        });
        if (r?.message) store.upsertMessage(gcId, r.message, { replaceId: message.clientId || message.id });
      } catch (e) {
        store.upsertMessage(gcId, { ...message, status: 'failed', pending: false, error: e.message || 'Could not send' });
      }
    })();
  }, []);

  /** Clear a GC's unread badge (server read receipts by chatId are shared
   *  machinery; the badge itself lives only in GC state). */
  const markGCRead = useCallback((gcId) => {
    socketRef.current?.emit('message:read', { chatId: gcId });
    const store = gcStoreRef.current;
    if (store) {
      store.setChats(store.getChats().map((c) => (c.id === gcId ? { ...c, unread: 0 } : c)), { fromServer: false });
    }
  }, []);

  const setGCTypingState = useCallback((gcId, isTyping) => {
    socketRef.current?.emit('gc:typing', { gcId, isTyping });
  }, []);

  /* ---------------- actions ---------------- */

  const refreshChatRequests = useCallback(async () => {
    setChatRequestsError(null);
    try {
      const pending = await api.chatRequests();
      if (!Array.isArray(pending?.requests)) throw new Error('Invalid chat requests response');
      setChatRequests(pending.requests);
      setChatRequestsLoaded(true);
      return pending.requests;
    } catch (error) {
      setChatRequestsError('Unable to load chat requests.');
      setChatRequestsLoaded(true);
      throw error;
    }
  }, []);

  const refreshChats = useCallback(async ({ includeGCs = true } = {}) => {
    setChatsError(null);
    try {
      const engine = engineRef.current;
      if (engine) {
        await engine.sync.refreshChatsFromServer();
        // Chat-list pull-to-refresh can skip GCs so Recent/Archived never
        // reload the separate GC environment.
        const gcs = includeGCs ? await refreshGCs().catch(() => []) : [];
        setChatsLoaded(true);
        return gcs;
      }
      const result = await api.chats();
      if (!Array.isArray(result?.chats)) throw new Error('Invalid conversations response');
      setChats(sortChats(result.chats.filter((c) => c?.type !== 'gc')));
      if (includeGCs) await refreshGCs().catch(() => {});
      setChatsLoaded(true);
      return result.chats;
    } catch (error) {
      // Never replace cached/live rows with [] on a transport/backend failure.
      setChatsError('Unable to load conversations. Your saved history is still available.');
      setChatsLoaded(true);
      throw error;
    }
  }, [refreshGCs]);

  const refreshActivity = useCallback(async () => {
    try {
      const result = await api.activity();
      setActivityUnread(result.unread || 0);
    } catch {
      // Keep the rest of the app usable if an older backend is still redeploying.
    }
  }, []);

  const loadMessages = useCallback(async (chatId) => {
    const engine = engineRef.current;
    if (engine?.store.getMessages(chatId).length) {
      engine.store.markLoaded(chatId);
    }
    setMessagesLoading((prev) => ({ ...prev, [chatId]: true }));
    setMessageErrors((prev) => {
      if (!prev[chatId]) return prev;
      const next = { ...prev };
      delete next[chatId];
      return next;
    });
    try {
      if (engine) {
        const list = await engine.sync.pullChat(chatId);
        setMessagesLoaded((prev) => ({ ...prev, [chatId]: true }));
        return list;
      }
      const result = await api.messages(chatId, { limit: 50 });
      if (!Array.isArray(result?.messages)) throw new Error('Invalid messages response');
      setMessages((prev) => ({ ...prev, [chatId]: result.messages }));
      setMessagesLoaded((prev) => ({ ...prev, [chatId]: true }));
      return result.messages;
    } catch (error) {
      // Preserve any cached/already-loaded messages and expose a real error
      // state instead of rendering "the beginning of your conversation".
      setMessagesLoaded((prev) => ({ ...prev, [chatId]: true }));
      setMessageErrors((prev) => ({ ...prev, [chatId]: 'Unable to load messages. Check your connection and retry.' }));
      throw error;
    } finally {
      setMessagesLoading((prev) => ({ ...prev, [chatId]: false }));
    }
  }, []);

  const loadOlderMessages = useCallback(async (chatId) => {
    const engine = engineRef.current;
    if (!engine) return;
    try {
      await engine.sync.pullOlder(chatId);
    } catch {
      // Keep the already-visible page; the next scroll/retry will try again.
    }
  }, []);

  const sendMessage = useCallback((chatId, payload) => {
    const engine = engineRef.current;
    if (engine && user?.id) {
      engine.repository.queueSend(chatId, payload, user);
      return;
    }
    // Engine still booting — keep the bubble local and retry via REST.
    if (!user?.id) return;
    const tempId = payload.clientId || ('tmp_' + Math.random().toString(36).slice(2));
    const optimistic = {
      id: tempId,
      chatId,
      senderId: user.id,
      type: payload.type || 'text',
      body: payload.body || '',
      mediaUrl: payload.mediaUrl || null,
      duration: payload.duration || 0,
      createdAt: Date.now(),
      clientCreatedAt: Date.now(),
      status: 'sending',
      reactions: [],
      replyTo: payload.replyToMessage || null,
      pending: true,
      _new: true,
    };
    setMessages((prev) => ({ ...prev, [chatId]: [...(prev[chatId] || []), optimistic] }));
  }, [user]);

  const markRead = useCallback((chatId) => {
    socketRef.current?.emit('message:read', { chatId });
    const engine = engineRef.current;
    if (engine) {
      engine.store.setChats(engine.store.getChats().map((c) => (c.id === chatId ? { ...c, unread: 0 } : c)));
      return;
    }
    setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, unread: 0 } : c)));
  }, []);

  const setTypingState = useCallback((chatId, isTyping) => {
    socketRef.current?.emit('typing', { chatId, isTyping });
  }, []);

  const react = useCallback((messageId, emoji) => {
    socketRef.current?.emit('message:react', { messageId, emoji });
  }, []);

  // scope: 'everyone' (default) removes the sender's message for all;
  //        'me' hides it only on this user's devices (row stays for others).
  // Resolves with the server acknowledgement ({ ok } | { error }).
  const deleteMessage = useCallback((messageId, scope = 'everyone') => {
    return new Promise((resolve) => {
      const socket = socketRef.current;
      if (!socket) return resolve({ error: 'Not connected' });
      socket.emit('message:delete', { messageId, scope }, (res) => resolve(res || { ok: true }));
    });
  }, []);

  // Remove a message from local state entirely (used by "Delete for me" —
  // no tombstone, unlike the global delete which shows "message deleted").
  const removeMessageLocal = useCallback((chatId, messageId) => {
    const engine = engineRef.current;
    if (engine) {
      engine.store.removeMessages(chatId, [messageId]);
      return;
    }
    setMessages((prev) => {
      const list = prev[chatId];
      if (!list) return prev;
      return { ...prev, [chatId]: list.filter((m) => m.id !== messageId && m.clientId !== messageId) };
    });
  }, []);

  /** Edit one of my own text messages with OT. Resolves with the updated message. */
  const editMessage = useCallback((messageId, body, options = {}) => {
    return new Promise((resolve, reject) => {
      const engine = engineRef.current;
      let oldBody = '';
      let baseVersion = options.baseVersion;

      if (engine) {
        const all = engine.store.getAllMessagesCopy();
        for (const list of Object.values(all)) {
          const found = list.find(m => m.id === messageId);
          if (found) {
            oldBody = found.body || '';
            if (baseVersion == null) baseVersion = found.otVersion || 0;
            break;
          }
        }
      } else {
        // Fallback search in state
        for (const list of Object.values(messagesRef.current)) {
          const found = list.find(m => m.id === messageId);
          if (found) {
            oldBody = found.body || '';
            if (baseVersion == null) baseVersion = found.otVersion || 0;
            break;
          }
        }
      }

      // Use OT if we have oldBody and it's different
      if (oldBody && oldBody !== body) {
        try {
          const operation = TextOperation.fromDiff(oldBody, body);
          if (!operation.isNoop()) {
            socketRef.current?.emit('message:edit', { messageId, operation: operation.toJSON(), baseVersion, body }, (res) => {
              if (res?.error) reject(new Error(res.error)); else resolve(res.message);
            });
            return;
          }
        } catch {}
      }

      // Fallback legacy
      socketRef.current?.emit('message:edit', { messageId, body, baseVersion }, (res) => {
        if (res?.error) reject(new Error(res.error)); else resolve(res.message);
      });
    });
  }, []);

  const editMessageOT = useCallback((messageId, operation, baseVersion) => {
    return new Promise((resolve, reject) => {
      socketRef.current?.emit('message:edit:ot', { messageId, operation, baseVersion }, (res) => {
        if (res?.error) reject(new Error(res.error)); else resolve(res);
      });
    });
  }, []);

  /** Create a poll inside a group chat. Resolves with the poll message. */
  const createPoll = useCallback((chatId, question, options) => {
    return new Promise((resolve, reject) => {
      socketRef.current?.emit('poll:create', { chatId, question, options }, (res) => {
        if (res?.error) reject(new Error(res.error)); else resolve(res.message);
      });
    });
  }, []);

  /** Vote (or change my vote) on a poll. Resolves with the updated message. */
  const votePoll = useCallback((messageId, pollId, optionIndex) => {
    return new Promise((resolve, reject) => {
      socketRef.current?.emit('poll:vote', { messageId, pollId, optionIndex }, (res) => {
        if (res?.error) reject(new Error(res.error)); else resolve(res.message);
      });
    });
  }, []);

  const refreshDocuments = useCallback(async (chatId) => {
    if (!chatId) return [];
    try {
      const res = await api.getChatDocuments(chatId);
      setDocuments(prev => ({ ...prev, [chatId]: res.documents || [] }));
      return res.documents || [];
    } catch {
      return [];
    }
  }, []);

  const createDocument = useCallback(async (chatId, payload) => {
    const res = await api.createChatDocument(chatId, payload);
    setDocuments(prev => ({ ...prev, [chatId]: [res.document, ...(prev[chatId] || [])] }));
    return res.document;
  }, []);

  const setGcMessagesLocal = useCallback((updater) => {
    const store = gcStoreRef.current;
    if (!store) return;
    const prev = store.getAllMessagesCopy();
    const next = typeof updater === 'function' ? updater(prev) : updater;
    store.replaceMessagesMap(next);
  }, []);

  // These setters are part of the public action surface. Keeping them stable
  // is important: otherwise every keystroke/message would invalidate the
  // action context even when its consumers only need a callback.
  const setMessagesLocal = useCallback((updater) => {
    const engine = engineRef.current;
    if (engine) {
      const prev = engine.store.getAllMessagesCopy();
      const next = typeof updater === 'function' ? updater(prev) : updater;
      engine.store.replaceMessagesMap(next);
      return;
    }
    setMessages(updater);
  }, []);

  const listStateValue = useMemo(() => ({
    chats, chatsLoaded, chatsError, inboxFilter, chatRequests, chatRequestsLoaded, chatRequestsError,
  }), [chats, chatsLoaded, chatsError, inboxFilter, chatRequests, chatRequestsLoaded, chatRequestsError]);
  const messageStateValue = useMemo(() => ({
    messages, messagesLoaded, messagesLoading, messageErrors, documents, otReady,
  }), [messages, messagesLoaded, messagesLoading, messageErrors, documents, otReady]);
  const gcStateValue = useMemo(() => ({
    gcChats, gcMessages, gcMessagesLoaded, gcMessagesLoading, gcMessageErrors,
    gcTyping, gcCursors, gcConnected: connected,
  }), [gcChats, gcMessages, gcMessagesLoaded, gcMessagesLoading, gcMessageErrors, gcTyping, gcCursors, connected]);
  const realtimeValue = useMemo(() => ({ typing, connected, activityUnread }), [typing, connected, activityUnread]);
  const callStateValue = useMemo(() => ({
    call, localStream, remoteStream, micOn, camOn, speakerOn, callSupported: RTC_SUPPORTED,
  }), [call, localStream, remoteStream, micOn, camOn, speakerOn]);
  const actionsValue = useMemo(() => ({
    setInboxFilter, refreshChatRequests, refreshChats, refreshActivity, loadMessages, loadOlderMessages,
    sendMessage, markRead, setTypingState, react, deleteMessage, removeMessageLocal, editMessage,
    editMessageOT, createPoll, votePoll, upsertChat, onPostEvent, onStatusEvent, onGCEvent,
    onCommunityEvent, onColleagueEvent, onChatRequestEvent, onChatThemeEvent, onDocEvent,
    refreshDocuments, createDocument, socketRef,
    refreshGCs, loadGCMessages, loadOlderGCMessages, sendGCMessage, retryGCMessage, editGCMessage,
    markGCRead, setGCTypingState, joinGCRoom, leaveGCRoom, setGcMessages: setGcMessagesLocal,
    setMessages: setMessagesLocal, otManager: otManagerRef.current,
    startCall, acceptCall, declineCall, hangUp, toggleMic, toggleCam, toggleSpeaker, switchCamera,
  }), [
    setInboxFilter, refreshChatRequests, refreshChats, refreshActivity, loadMessages, loadOlderMessages,
    sendMessage, markRead, setTypingState, react, deleteMessage, removeMessageLocal, editMessage,
    editMessageOT, createPoll, votePoll, upsertChat, onPostEvent, onStatusEvent, onGCEvent,
    onCommunityEvent, onColleagueEvent, onChatRequestEvent, onChatThemeEvent, onDocEvent,
    refreshDocuments, createDocument, refreshGCs, loadGCMessages, loadOlderGCMessages, sendGCMessage,
    retryGCMessage, editGCMessage, markGCRead, setGCTypingState, joinGCRoom, leaveGCRoom,
    setGcMessagesLocal, setMessagesLocal, otReady, startCall, acceptCall, declineCall, hangUp,
    toggleMic, toggleCam, toggleSpeaker, switchCamera,
  ]);
  // Legacy consumers still receive the same shape. New consumers below use a
  // focused context so unrelated high-frequency updates stay isolated.
  const legacyValue = useMemo(() => ({
    ...listStateValue, ...messageStateValue, ...realtimeValue, ...gcStateValue,
    ...callStateValue, ...actionsValue,
  }), [listStateValue, messageStateValue, realtimeValue, gcStateValue, callStateValue, actionsValue]);

  return (
    <ChatContext.Provider value={legacyValue}>
      <ChatListStateContext.Provider value={listStateValue}>
        <ChatMessageStateContext.Provider value={messageStateValue}>
          <ChatGCStateContext.Provider value={gcStateValue}>
            <ChatRealtimeContext.Provider value={realtimeValue}>
              <ChatCallContext.Provider value={callStateValue}>
                <ChatActionsContext.Provider value={actionsValue}>
                  {children}
                </ChatActionsContext.Provider>
              </ChatCallContext.Provider>
            </ChatRealtimeContext.Provider>
          </ChatGCStateContext.Provider>
        </ChatMessageStateContext.Provider>
      </ChatListStateContext.Provider>
    </ChatContext.Provider>
  );
}
