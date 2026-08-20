import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { Platform } from 'react-native';
import { io } from 'socket.io-client';
import { SOCKET_URL, api } from '../api';
import { useAuth } from './AuthContext';

const ChatContext = createContext(null);
export const useChat = () => useContext(ChatContext);

// WebRTC needs a real device's camera/mic. On web this is the browser's
// native RTCPeerConnection/getUserMedia — fully working. On native
// (iOS/Android) actual audio/video capture needs `react-native-webrtc`,
// which requires a custom dev build (not available in the managed/Expo Go
// workflow this app runs under) — the same category of limitation already
// noted for voice-note recording in README.md. The signaling (ringing,
// accept/decline, call history) is real and works everywhere either way;
// only the peer media connection itself is web-only for now.
const RTC_SUPPORTED = Platform.OS === 'web' && typeof window !== 'undefined' && !!window.RTCPeerConnection;

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

export function ChatProvider({ children }) {
  const { token, user, logout, applySettings } = useAuth();
  const [chats, setChats] = useState([]);
  const [chatsLoaded, setChatsLoaded] = useState(false); // first fetch done (drives skeleton UI)
  const [messages, setMessages] = useState({});   // chatId -> message[]
  const [typing, setTyping] = useState({});       // chatId -> { userId: name }
  const [connected, setConnected] = useState(false);
  const [activityUnread, setActivityUnread] = useState(0);
  const socketRef = useRef(null);
  const postListeners = useRef(new Set());
  const statusListeners = useRef(new Set());
  const communityListeners = useRef(new Set());
  const colleagueListeners = useRef(new Set());
  const chatRequestListeners = useRef(new Set());
  const chatThemeListeners = useRef(new Set());

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

  // Pinned chats float to the top; within each group, recency order.
  const sortChats = (list) =>
    [...list].sort((a, b) =>
      ((b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)) ||
      ((b.lastMessage?.createdAt || b.updatedAt) - (a.lastMessage?.createdAt || a.updatedAt))
    );

  const upsertChat = useCallback((chat) => {
    setChats((prev) => {
      const idx = prev.findIndex((c) => c.id === chat.id);
      if (idx === -1) return sortChats([chat, ...prev]);
      const next = [...prev];
      next[idx] = chat;
      return sortChats(next);
    });
  }, []);

  /* ---------------- socket lifecycle ---------------- */
  useEffect(() => {
    if (!token) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setChats([]); setMessages({}); setConnected(false); setActivityUnread(0); setChatsLoaded(false);
      return;
    }

    // REST may use the Vercel proxy, but Socket.IO must use the persistent
    // Railway origin. An empty target is still valid for a true single-host
    // deploy; socket.io then connects to the page origin.
    const socket = io(SOCKET_URL || undefined, { auth: { token }, transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));
    socket.on('account:deleted', () => logout());
    socket.on('settings:updated', ({ settings }) => applySettings(settings));

    socket.on('message:new', ({ message, tempId }) => {
      setMessages((prev) => {
        const list = prev[message.chatId] || [];
        // replace optimistic copy if present
        const replaced = tempId ? list.find((m) => m.id === tempId) : null;
        const withoutTemp = replaced ? list.filter((m) => m.id !== tempId) : list;
        if (withoutTemp.some((m) => m.id === message.id)) return prev;
        // `_new` marks genuinely new arrivals so the bubble can animate in
        // once. A real message replacing our optimistic copy is NOT new (the
        // optimistic bubble already animated) — no double animation.
        return { ...prev, [message.chatId]: [...withoutTemp, { ...message, _new: !replaced }] };
      });
    });

    socket.on('message:updated', (message) => {
      setMessages((prev) => {
        const list = prev[message.chatId];
        if (!list) return prev;
        return { ...prev, [message.chatId]: list.map((m) => (m.id === message.id ? message : m)) };
      });
    });

    // Disappearing messages: the server hard-deletes expired rows and tells
    // everyone which ids vanished from which chat.
    socket.on('message:expired', ({ chatId, messageIds }) => {
      setMessages((prev) => {
        const list = prev[chatId];
        if (!list) return prev;
        const ids = new Set(messageIds);
        const next = list.filter((m) => !ids.has(m.id));
        return next.length === list.length ? prev : { ...prev, [chatId]: next };
      });
    });

    // Left/removed from a chat (group leave, admin removal, community exit).
    socket.on('chat:removed', ({ chatId }) => {
      setChats((prev) => prev.filter((c) => c.id !== chatId));
      setMessages((prev) => {
        if (!(chatId in prev)) return prev;
        const next = { ...prev };
        delete next[chatId];
        return next;
      });
    });

    socket.on('chat:updated', upsertChat);
    socket.on('chat:new', upsertChat);

    // Per-conversation chat theme changed (this device or another
    // participant). Patch the chat summary immediately and notify any
    // subscribed screen (the chat-theme store) so open chats re-theme
    // without waiting for the full chat:updated round-trip.
    socket.on('chat:theme', (payload) => {
      setChats((prev) => prev.map((c) => (c.id === payload.chatId
        ? { ...c, themeId: payload.themeId, themeUpdatedBy: payload.themeUpdatedBy, themeUpdatedAt: payload.themeUpdatedAt }
        : c)));
      chatThemeListeners.current.forEach((fn) => fn('chat:theme', payload));
    });

    socket.on('chat:request', (payload) => {
      chatRequestListeners.current.forEach((fn) => fn('chat:request', payload));
      api.activity().then((r) => setActivityUnread(r.unread || 0)).catch(() => {});
    });
    socket.on('chat:request:resolved', (payload) => {
      if (payload?.action === 'accept' && payload?.chat) upsertChat(payload.chat);
      chatRequestListeners.current.forEach((fn) => fn('chat:request:resolved', payload));
      api.activity().then((r) => setActivityUnread(r.unread || 0)).catch(() => {});
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
          api.activity().then((r) => setActivityUnread(r.unread || 0)).catch(() => {});
        }
      });
    });

    ['colleague:updated', 'affiliation:updated'].forEach((ev) => {
      socket.on(ev, (payload) => {
        colleagueListeners.current.forEach((fn) => fn(ev, payload));
        api.activity().then((r) => setActivityUnread(r.unread || 0)).catch(() => {});
      });
    });

    socket.on('presence', ({ userId, isOnline, lastSeen }) => {
      setChats((prev) => prev.map((c) => (c.otherUserId === userId ? { ...c, isOnline, lastSeen } : c)));
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
      api.activity().then((r) => setActivityUnread(r.unread || 0)).catch(() => {});
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
      await pc.setRemoteDescription(new window.RTCSessionDescription(sdp));
      flushPendingCandidates(pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('call:answer', { callId, sdp: answer });
      setCall((prev) => (prev ? { ...prev, status: 'ongoing' } : prev));
    });

    socket.on('call:answer', async ({ sdp }) => {
      const pc = pcRef.current;
      if (!pc) return;
      await pc.setRemoteDescription(new window.RTCSessionDescription(sdp));
      flushPendingCandidates(pc);
      setCall((prev) => (prev ? { ...prev, status: 'ongoing' } : prev));
    });

    socket.on('call:ice-candidate', async ({ candidate }) => {
      const pc = pcRef.current;
      if (!candidate) return;
      if (pc && pc.remoteDescription && pc.remoteDescription.type) {
        try { await pc.addIceCandidate(new window.RTCIceCandidate(candidate)); } catch {}
      } else {
        pendingCandidates.current.push(candidate);
      }
    });

    socket.on('call:ended', (payload) => {
      stopRingtone();
      teardownWebRTC();
      setCall((prev) => (prev && prev.id === payload.id ? { ...prev, status: 'ended', endedReason: payload.endedReason } : prev));
      setTimeout(() => setCall((prev) => (prev && prev.status === 'ended' ? null : prev)), 2500);
      api.activity().then((r) => setActivityUnread(r.unread || 0)).catch(() => {});
    });

    api.chats().then(({ chats }) => { setChats(sortChats(chats)); setChatsLoaded(true); })
      // Even a failed first fetch ends the skeleton state so the list never
      // shimmers forever (pull-to-refresh remains available).
      .catch(() => setChatsLoaded(true));
    api.activity().then((r) => setActivityUnread(r.unread || 0)).catch(() => {});

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
    pendingCandidates.current.forEach((c) => pc.addIceCandidate(new window.RTCIceCandidate(c)).catch(() => {}));
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
    if (!RTC_SUPPORTED) throw new Error('Calling needs a browser with WebRTC support');

    const stream = await window.navigator.mediaDevices.getUserMedia({
      audio: true,
      video: type === 'video',
    });
    setLocalStream(stream);
    setMicOn(true);
    setCamOn(type === 'video');

    const pc = new window.RTCPeerConnection({ iceServers: ICE_SERVERS });
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
      setCall({ id: 'unsupported', chatId, type, direction: 'outgoing', status: 'ended', endedReason: 'failed', error: 'Calling needs a desktop/laptop browser (WebRTC is not available on this platform yet).' });
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
    socketRef.current?.emit('call:accept', { callId: call.id }, (res) => {
      if (res?.error) { setCall(null); return; }
      callTypeRef.current = call.type;
      setCall((prev) => (prev ? { ...prev, status: 'connecting' } : prev));
      // Callee waits for the caller's offer (see socket.on('call:offer') above)
      // but still needs its own media/peer connection ready to receive it.
      ensurePeerConnection(call.id, call.type).catch((e) => {
        socketRef.current?.emit('call:hangup', { callId: call.id });
        setCall((prev) => (prev ? { ...prev, status: 'ended', endedReason: 'failed', error: e.message } : prev));
      });
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
    const { chats } = await api.chats();
    setChats(sortChats(chats));
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
    const { messages: list } = await api.messages(chatId);
    setMessages((prev) => ({ ...prev, [chatId]: list }));
  }, []);

  const sendMessage = useCallback((chatId, payload) => {
    const socket = socketRef.current;
    if (!socket) return;
    const tempId = 'tmp_' + Math.random().toString(36).slice(2);

    const optimistic = {
      id: tempId,
      chatId,
      senderId: user.id,
      type: payload.type || 'text',
      body: payload.body || '',
      mediaUrl: payload.mediaUrl || null,
      duration: payload.duration || 0,
      createdAt: Date.now(),
      status: 'sending',
      reactions: [],
      replyTo: payload.replyToMessage || null,
      pending: true,
      _new: true, // optimistic bubble animates in like any new message
    };
    setMessages((prev) => ({ ...prev, [chatId]: [...(prev[chatId] || []), optimistic] }));

    socket.emit('message:send', { ...payload, chatId, tempId }, (res) => {
      if (res?.error) {
        setMessages((prev) => ({
          ...prev,
          [chatId]: (prev[chatId] || []).map((m) => (m.id === tempId ? { ...m, status: 'failed' } : m)),
        }));
      }
    });
  }, [user]);

  const markRead = useCallback((chatId) => {
    socketRef.current?.emit('message:read', { chatId });
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
        chats, chatsLoaded, messages, typing, connected, activityUnread,
        refreshChats, refreshActivity, loadMessages, sendMessage, markRead,
        setTypingState, react, deleteMessage, editMessage, createPoll, votePoll,
        upsertChat, onPostEvent, onStatusEvent, onCommunityEvent, onColleagueEvent, onChatRequestEvent,
        onChatThemeEvent,
        // exposed for lightweight local patches (e.g. optimistic star/timer state)
        setMessages,
        // Calls
        call, localStream, remoteStream, micOn, camOn, callSupported: RTC_SUPPORTED,
        startCall, acceptCall, declineCall, hangUp, toggleMic, toggleCam,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}
