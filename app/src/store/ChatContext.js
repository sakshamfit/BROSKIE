import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { Platform } from 'react-native';
import { io } from 'socket.io-client';
import { API_URL, api } from '../api';
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
  const { token, user } = useAuth();
  const [chats, setChats] = useState([]);
  const [messages, setMessages] = useState({});   // chatId -> message[]
  const [typing, setTyping] = useState({});       // chatId -> { userId: name }
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);
  const postListeners = useRef(new Set());
  const statusListeners = useRef(new Set());
  const communityListeners = useRef(new Set());

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

  const sortChats = (list) =>
    [...list].sort((a, b) => (b.lastMessage?.createdAt || b.updatedAt) - (a.lastMessage?.createdAt || a.updatedAt));

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
      setChats([]); setMessages({}); setConnected(false);
      return;
    }

    // API_URL === '' means same-origin (single-host deploy); socket.io handles
    // undefined by connecting to the page origin.
    const socket = io(API_URL || undefined, { auth: { token }, transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));

    socket.on('message:new', ({ message, tempId }) => {
      setMessages((prev) => {
        const list = prev[message.chatId] || [];
        // replace optimistic copy if present
        const withoutTemp = tempId ? list.filter((m) => m.id !== tempId) : list;
        if (withoutTemp.some((m) => m.id === message.id)) return prev;
        return { ...prev, [message.chatId]: [...withoutTemp, message] };
      });
    });

    socket.on('message:updated', (message) => {
      setMessages((prev) => {
        const list = prev[message.chatId];
        if (!list) return prev;
        return { ...prev, [message.chatId]: list.map((m) => (m.id === message.id ? message : m)) };
      });
    });

    socket.on('chat:updated', upsertChat);
    socket.on('chat:new', upsertChat);

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
    });

    api.chats().then(({ chats }) => setChats(sortChats(chats))).catch(() => {});

    return () => {
      stopRingtone();
      teardownWebRTC();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token, upsertChat]);

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

  return (
    <ChatContext.Provider
      value={{
        chats, messages, typing, connected,
        refreshChats, loadMessages, sendMessage, markRead,
        setTypingState, react, deleteMessage, upsertChat, onPostEvent, onStatusEvent, onCommunityEvent,
        // Calls
        call, localStream, remoteStream, micOn, camOn, callSupported: RTC_SUPPORTED,
        startCall, acceptCall, declineCall, hangUp, toggleMic, toggleCam,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}
