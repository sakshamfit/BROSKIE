import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { AppState } from 'react-native';
import { io } from 'socket.io-client';
import { SOCKET_URL, api } from '../api';
import { useAuth } from './AuthContext';
import { createMessagingEngine } from '../messaging';
import * as RTC from '../webrtc/rtc';

const ChatContext = createContext(null);
export const useChat = () => useContext(ChatContext);

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

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

export function ChatProvider({ children }) {
  const { token, user, logout, applySettings } = useAuth();
  const [chats, setChats] = useState([]);
  const [chatsLoaded, setChatsLoaded] = useState(false); // cache checked / first request settled
  const [chatsError, setChatsError] = useState(null);
  const [messages, setMessages] = useState({});   // chatId -> message[]
  const [messagesLoaded, setMessagesLoaded] = useState({}); // chatId -> cache/server checked
  const [messagesLoading, setMessagesLoading] = useState({});
  const [messageErrors, setMessageErrors] = useState({});
  const [typing, setTyping] = useState({});       // chatId -> { userId: name }
  const [connected, setConnected] = useState(false);
  const [activityUnread, setActivityUnread] = useState(0);
  const socketRef = useRef(null);
  const engineRef = useRef(null);
  const postListeners = useRef(new Set());
  const statusListeners = useRef(new Set());
  const communityListeners = useRef(new Set());
  const colleagueListeners = useRef(new Set());
  const chatRequestListeners = useRef(new Set());
  const chatThemeListeners = useRef(new Set());
  const moderationListeners = useRef(new Set());

  /* ---------------- calls (WebRTC, signalled over the same socket) ---------------- */
  // call: null | { id, chatId, type, direction:'incoming'|'outgoing', status:'ringing'|'connecting'|'ongoing'|'ended', with, startedAt, endedReason }
  const [call, setCall] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
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
    setMessagesLoaded({});
    setMessagesLoading({});
    setMessageErrors({});

    const engine = createMessagingEngine({
      userId,
      getSocket: () => socketRef.current,
    });
    engineRef.current = engine;
    const unsub = engine.store.subscribe(() => {
      if (!disposed) publishStore();
    });

    (async () => {
      await engine.store.hydrate();
      if (disposed) return;
      publishStore();
      if (engine.store.getChats().length) setChatsLoaded(true);
      engine.outbox.drain();

      try {
        const result = await api.chats();
        if (!Array.isArray(result?.chats)) throw new Error('Invalid conversations response');
        if (!disposed) {
          engine.store.setChats(result.chats, { fromServer: true });
          setChatsError(null);
        }
      } catch {
        if (!disposed) {
          setChatsError('Unable to load conversations. Your saved history is still available.');
        }
      } finally {
        if (!disposed) setChatsLoaded(true);
      }
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
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [token, user?.id, publishStore]);

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
    });
    socket.on('disconnect', () => {
      setConnected(false);
      engineRef.current?.connectivity.setSocketConnected(false);
    });
    socket.on('connect_error', () => {
      setConnected(false);
      engineRef.current?.connectivity.setSocketConnected(false);
    });
    socket.on('account:deleted', () => logout());
    socket.on('settings:updated', ({ settings }) => applySettings(settings));

    socket.on('message:new', ({ message, tempId }) => {
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

    socket.on('message:updated', (message) => {
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

    socket.on('chat:removed', ({ chatId }) => {
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

    socket.on('chat:updated', upsertChat);
    socket.on('chat:new', upsertChat);

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
      chatRequestListeners.current.forEach((fn) => fn('chat:request', payload));
      refreshActivityUnread(setActivityUnread);
    });
    socket.on('chat:request:resolved', (payload) => {
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
    });

    socket.on('typing', ({ chatId, userId, name, isTyping }) => {
      setTyping((prev) => {
        const forChat = { ...(prev[chatId] || {}) };
        if (isTyping) forChat[userId] = name; else delete forChat[userId];
        return { ...prev, [chatId]: forChat };
      });
    });

    /* ---------------- calls ---------------- */

    socket.on('call:incoming', (payload) => {
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
      // Callee side: caller's offer arrives once we've accepted and the
      // caller has our accept — create our own peer connection and answer.
      const pc = await ensurePeerConnection(callId, callRef.current?.type || 'audio');
      await pc.setRemoteDescription(RTC.SessionDescription(sdp));
      flushPendingCandidates(pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('call:answer', { callId, sdp: answer });
      setCall((prev) => (prev ? { ...prev, status: 'ongoing' } : prev));
    });

    socket.on('call:answer', async ({ sdp }) => {
      const pc = pcRef.current;
      if (!pc) return;
      await pc.setRemoteDescription(RTC.SessionDescription(sdp));
      flushPendingCandidates(pc);
      setCall((prev) => (prev ? { ...prev, status: 'ongoing' } : prev));
    });

    socket.on('call:ice-candidate', async ({ candidate }) => {
      const pc = pcRef.current;
      if (!candidate) return;
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
  }, [token, upsertChat, logout, applySettings]);

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

    const pc = RTC.createPeerConnection({ iceServers: ICE_SERVERS });
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    pc.onicecandidate = (e) => {
      if (e.candidate) socketRef.current?.emit('call:ice-candidate', { callId, candidate: e.candidate });
    };
    pc.ontrack = (e) => setRemoteStream(e.streams[0]);
    pc.onconnectionstatechange = () => {
      if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
        // let the explicit call:ended event (server-driven) be the source of
        // truth for ending the UI, so a transient ICE hiccup doesn't hang up
      }
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
      socketRef.current?.emit('call:hangup', { callId });
      setCall((prev) => (prev ? { ...prev, status: 'ended', endedReason: 'failed', error: e.message } : prev));
    }
  }, [ensurePeerConnection]);

  const teardownWebRTC = useCallback(() => {
    if (pcRef.current) { try { pcRef.current.close(); } catch {} pcRef.current = null; }
    setLocalStream((prev) => { prev?.getTracks().forEach((t) => t.stop()); return null; });
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
    callTypeRef.current = type;
    socketRef.current?.emit('call:invite', { chatId, calleeId, type }, (res) => {
      if (res?.error) {
        setCall({ id: 'error', chatId, type, direction: 'outgoing', status: 'ended', endedReason: res.busy ? 'busy' : 'failed', error: res.error });
        setTimeout(() => setCall(null), 3500);
        return;
      }
      setCall({ id: res.call.id, chatId, type, direction: 'outgoing', status: 'ringing', with: res.call.with, startedAt: res.call.startedAt });
    });
  }, []);

  const acceptCall = useCallback(() => {
    if (!call) return;
    stopRingtone();
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
        setCall((prev) => (prev ? { ...prev, status: 'ended', endedReason: 'failed', error: e.message } : prev));
      }
    });
  }, [call, ensurePeerConnection]);

  const declineCall = useCallback(() => {
    if (!call) return;
    stopRingtone();
    socketRef.current?.emit('call:decline', { callId: call.id });
    setCall(null);
  }, [call]);

  const hangUp = useCallback(() => {
    if (!call) return;
    stopRingtone();
    socketRef.current?.emit('call:hangup', { callId: call.id });
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

  /* ---------------- actions ---------------- */

  const refreshChats = useCallback(async () => {
    setChatsError(null);
    try {
      const engine = engineRef.current;
      if (engine) {
        const chatsResult = await engine.sync.refreshChatsFromServer();
        setChatsLoaded(true);
        return chatsResult;
      }
      const result = await api.chats();
      if (!Array.isArray(result?.chats)) throw new Error('Invalid conversations response');
      setChats(sortChats(result.chats));
      setChatsLoaded(true);
      return result.chats;
    } catch (error) {
      // Never replace cached/live rows with [] on a transport/backend failure.
      setChatsError('Unable to load conversations. Your saved history is still available.');
      setChatsLoaded(true);
      throw error;
    }
  }, []);

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

  const deleteMessage = useCallback((messageId) => {
    socketRef.current?.emit('message:delete', { messageId });
  }, []);

  /** Edit one of my own text messages. Resolves with the updated message. */
  const editMessage = useCallback((messageId, body) => {
    return new Promise((resolve, reject) => {
      socketRef.current?.emit('message:edit', { messageId, body }, (res) => {
        if (res?.error) reject(new Error(res.error)); else resolve(res.message);
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

  return (
    <ChatContext.Provider
      value={{
        chats, chatsLoaded, chatsError,
        messages, messagesLoaded, messagesLoading, messageErrors,
        typing, connected, activityUnread,
        refreshChats, refreshActivity, loadMessages, loadOlderMessages, sendMessage, markRead,
        setTypingState, react, deleteMessage, editMessage, createPoll, votePoll,
        upsertChat, onPostEvent, onStatusEvent, onCommunityEvent, onColleagueEvent, onChatRequestEvent,
        onChatThemeEvent,
        // exposed for lightweight local patches (e.g. optimistic star/timer state)
        setMessages: (updater) => {
          const engine = engineRef.current;
          if (engine) {
            const prev = engine.store.getAllMessagesCopy();
            const next = typeof updater === 'function' ? updater(prev) : updater;
            engine.store.replaceMessagesMap(next);
            return;
          }
          setMessages(updater);
        },
        // Calls
        call, localStream, remoteStream, micOn, camOn, callSupported: RTC_SUPPORTED,
        startCall, acceptCall, declineCall, hangUp, toggleMic, toggleCam,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}
