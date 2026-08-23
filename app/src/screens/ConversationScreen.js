import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View, Text, FlatList, TextInput, Pressable, StyleSheet, KeyboardAvoidingView,
  Platform, Modal, Image, ActivityIndicator, Alert, Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../icons/Icon';
import Emoji, { EmojiText } from '../icons/Emoji';
import {
  RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync,
  useAudioRecorder, useAudioRecorderState,
} from 'expo-audio';
import { useChat } from '../store/ChatContext';
import { useAuth } from '../store/AuthContext';
import { useTheme } from '../store/ThemeContext';
import { useChatTheme, ChatThemeScope } from '../store/ChatThemeContext';
import useResponsive from '../hooks/useResponsive';
import {
  Avatar, formatDayLabel, lastSeenText, InkField, InkIconButton, Rule, rippleFor,
  FrostedBackdrop, GoldTick, hasGoldTick, PaperCard, isGroupChat,
} from '../components/common';
import MessageBubble, { DISAPPEAR_OPTIONS } from '../components/MessageBubble';
import ReplyBar from '../components/ReplyBar';
import ChatBackground from '../components/ChatBackground';
import { ThemeRegistry, alpha } from '../chatThemes';
import { FadeSlide, TypingDots, FloatLoop, SheetSpringIn, SpringPressable, IconSwap, Pop, haptic, motion } from '../motion';
import { api, mediaUrl } from '../api';
import { setViewedChat } from '../push/notifications';
import { radius, type, inkBox, marker, dashedRule, stroke, raised } from '../theme';
import { throttle } from '../rateLimit';
import ImageLightbox from '../components/ImageLightbox';
import { lazyComponent } from '../lazy';
import { editorConfigFor } from '../imageEditor/config';

const EmojiPicker = lazyComponent(() => import('../components/EmojiPicker'));
const UniversalImageEditor = lazyComponent(() => import('../components/UniversalImageEditor'));
const ForwardSheet = lazyComponent(() => import('../components/ForwardSheet'));
const PollComposer = lazyComponent(() => import('../components/PollComposer'));
const ThemePickerSheet = lazyComponent(() => import('../components/ThemePickerSheet'));
const CollabDocumentView = lazyComponent(() => import('../components/CollabDocumentView'));

function ConversationContent({ route, navigation, embedded = false, themePicker = null }) {
  const { chatId, initialChat = null } = route.params || {};
  const {
    chats, messages, messagesLoaded, messagesLoading, messageErrors,
    typing, refreshChats, loadMessages, loadOlderMessages, sendMessage, markRead, setTypingState,
    react, deleteMessage, removeMessageLocal, editMessage, createPoll, votePoll, startCall, call, setMessages,
    socketRef,
  } = useChat();
  const socket = socketRef?.current || null;
  const { user } = useAuth();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useResponsive();
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const audioRecorderState = useAudioRecorderState(audioRecorder, 100);

  // `initialChat` is passed by NewChat so Android never waits on an async
  // Context render before it can draw the conversation shell.
  const chat = chats.find((c) => c.id === chatId) || initialChat;
  const list = messages[chatId] || [];
  const messageHistoryLoaded = !!messagesLoaded[chatId];
  const messageHistoryLoading = !!messagesLoading[chatId];
  const messageHistoryError = messageErrors[chatId] || null;
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  // reply-quote navigation: which message to briefly highlight after
  // scrolling to it, plus the "original unavailable" note when it's missing
  const [replyHighlightId, setReplyHighlightId] = useState(null);
  const [replyMissing, setReplyMissing] = useState(false);
  const replyHighlightTimer = useRef(null);
  const replyMissingTimer = useRef(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  // Safety: report a message to the moderation center.
  const [reportMsg, setReportMsg] = useState(null);
  const [reportReason, setReportReason] = useState('');
  const [reportNote, setReportNote] = useState('');
  const [reportBusy, setReportBusy] = useState(false);

  const openReport = (message) => {
    setReportReason('');
    setReportNote('');
    setReportMsg(message);
  };

  const submitReport = async () => {
    if (!reportReason || reportBusy) return;
    setReportBusy(true);
    try {
      const r = await api.reportMessage(reportMsg.id, reportReason, reportNote.trim() || undefined);
      setReportMsg(null);
      Alert.alert(
        'Report submitted',
        r?.duplicate
          ? 'You already reported this message — our safety team has it.'
          : 'Thank you. Our safety team will review this privately.'
      );
    } catch (e) {
      Alert.alert('Could not report', e.message || 'Please try again in a moment.');
    } finally {
      setReportBusy(false);
    }
  };
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [imageEditor, setImageEditor] = useState(false);
  // Hold-to-record gesture state on the send button: when this press started
  // (0 = not held) and whether THIS press owns the current recording.
  const holdStartedAt = useRef(0);
  const pressOwnsRecording = useRef(false);
  // startRecording is async (permission + recorder prep). If the user
  // releases before it finishes, the stop is parked here and applied the
  // moment the recorder is actually live — a fast hold can never leave an
  // orphaned recording running.
  const recordingStarting = useRef(false);
  const stopWhileStarting = useRef(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const recordingStartedAt = useRef(0);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const typingTimer = useRef(null);
  // Socket "typing: true" emits are throttled (see onChangeText) so a fast
  // typist doesn't fire one packet per keystroke.
  const typingThrottle = useRef(null);
  // Reply focus / quote-tap must not trigger the composer's usual
  // scroll-to-bottom jump — keep the user on the message they swiped.
  const suppressFocusScroll = useRef(false);
  const suppressScrollToEnd = useRef(false);
  const recSecs = Math.max(0, Math.floor((audioRecorderState.durationMillis || 0) / 1000));

  // forward + timer + poll + docs modals
  const [forwardMsg, setForwardMsg] = useState(null);
  const [timerMsg, setTimerMsg] = useState(null);
  const [pollOpen, setPollOpen] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  const [otEditingVersion, setOtEditingVersion] = useState({});
  const loadingOlderRef = useRef(false);

  // ⋯ overflow menu (Theme lives here, per the familiar chat-menu flow)
  const [overflowOpen, setOverflowOpen] = useState(false);

  // Android uses `resize` mode (app.json), so the window shrinks when the IME
  // opens and the composer rises on its own. A few OEM builds (Realme/ColorOS)
  // still use pan/overlay keyboards that do NOT resize the window — the
  // keyboardHeight inset below covers those. iOS is handled by
  // KeyboardAvoidingView; Android and mobile web get the explicit bottom inset
  // because their keyboards may not resize the chat list for us.
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const keyboardScrollTimer = useRef(null);
  const scrollToLatest = useCallback((delay = 0) => {
    clearTimeout(keyboardScrollTimer.current);
    keyboardScrollTimer.current = setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: delay > 0 });
    }, delay);
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return undefined;

    const keyboardHeightFrom = (event) => {
      const eventHeight = Number(event?.endCoordinates?.height) || 0;
      const top = Number(event?.endCoordinates?.screenY);
      // `resize` mode (our Android default) already shrinks the window by the
      // keyboard height, so the composer rises on its own — any extra pad here
      // would push it up twice as far and leave a gap under the IME. `pan` /
      // overlay keyboards on some OEM builds (Realme/ColorOS) do NOT resize
      // the window; there the overlap between the keyboard top and the
      // still-full-height window is the true inset we must pad by.
      const overlapHeight = Number.isFinite(top) && top > 0 && windowHeight > 0
        ? Math.max(0, windowHeight - top)
        : 0;
      // When the OS reports the keyboard top we trust it fully: overlap > 0
      // means "window did not resize" (pad by the overlap), overlap == 0 means
      // "window already resized" (no pad needed). Only when the top is missing
      // do we fall back to the raw event height (rare older devices).
      const height = overlapHeight > 0 ? overlapHeight : (top > 0 ? 0 : eventHeight);
      if (height > 0) setKeyboardHeight(height);
      if (!suppressFocusScroll.current) scrollToLatest(120);
    };
    const onHide = () => {
      clearTimeout(keyboardScrollTimer.current);
      setKeyboardHeight(0);
    };

    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, keyboardHeightFrom);
    const hideSub = Keyboard.addListener(hideEvent, onHide);
    // Keyboard height can change when the suggestion row or navigation bar
    // appears. Do not register a second keyboardDidShow listener: doing so on
    // some ColorOS versions caused two competing layout updates.
    const frameSub = Platform.OS === 'android'
      ? Keyboard.addListener('keyboardDidChangeFrame', keyboardHeightFrom)
      : null;

    return () => {
      showSub.remove();
      hideSub.remove();
      frameSub?.remove();
      clearTimeout(keyboardScrollTimer.current);
    };
  }, [scrollToLatest, windowHeight]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.visualViewport) return undefined;

    const viewport = window.visualViewport;
    const updateWebKeyboardInset = () => {
      const layoutHeight = Number(window.innerHeight) || 0;
      const visualHeight = Number(viewport.height) || layoutHeight;
      const offsetTop = Number(viewport.offsetTop) || 0;
      const inset = Math.max(0, layoutHeight - visualHeight - offsetTop);
      setKeyboardHeight(inset);
      if (inset > 0 && !suppressFocusScroll.current) scrollToLatest(80);
    };

    updateWebKeyboardInset();
    viewport.addEventListener('resize', updateWebKeyboardInset);
    viewport.addEventListener('scroll', updateWebKeyboardInset);
    return () => {
      viewport.removeEventListener('resize', updateWebKeyboardInset);
      viewport.removeEventListener('scroll', updateWebKeyboardInset);
    };
  }, [scrollToLatest]);

  const s = makeStyles(theme);

  useEffect(() => {
    if (chatId) loadMessages(chatId).catch(() => {});
  }, [chatId, loadMessages]);
  useEffect(() => {
    if (chatId && !chat) refreshChats().catch(() => {});
  }, [chatId, chat, refreshChats]);
  useEffect(() => { if (chatId && list.length) markRead(chatId); }, [chatId, list.length, markRead]);

  // Tell the push layer this conversation is on screen: a message arriving
  // for THIS chat never banners (it renders live above), while every other
  // chat still notifies — foreground included.
  useEffect(() => {
    if (!chatId) return undefined;
    setViewedChat(chatId);
    return () => setViewedChat(null);
  }, [chatId]);

  useEffect(() => () => {
    try {
      if (audioRecorder.getStatus()?.isRecording) audioRecorder.stop().catch(() => {});
    } catch {}
    setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    typingThrottle.current?.cancel();
  }, [audioRecorder]);

  const typers = Object.values(typing[chatId] || {});

  const onChangeText = (v) => {
    setText(v);
    // Throttle the "typing: true" socket emit to one packet per 2s while the
    // user keeps typing. Trailing is off, so the debounced "typing: false"
    // below always lands after the last true — the indicator can't get stuck.
    if (!typingThrottle.current) {
      typingThrottle.current = throttle(
        (id) => setTypingState(id, true),
        2000,
        { leading: true, trailing: false },
      );
    }
    typingThrottle.current(chatId);
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setTypingState(chatId, false), 1600);
  };

  const nameFor = useCallback((id) => {
    if (id === user.id) return 'You';
    const m = chat?.members?.find((x) => x.id === id);
    return m ? m.name : 'Unknown';
  }, [chat, user]);

  // Same payload used by swipe, hover, menu, and keyboard reply — always
  // the existing `reply_to` / replyToMessage relationship, never a new table.
  const replyPayload = (msg = replyTo) => (msg ? {
    replyTo: msg.id,
    replyToMessage: {
      id: msg.id,
      senderId: msg.senderId,
      senderName: nameFor(msg.senderId),
      type: msg.type,
      body: msg.body,
    },
  } : {});

  // Reply entry point (swipe, hover button, long-press menu, or R). Sets the
  // reply and auto-focuses the composer (opens the keyboard on mobile) while
  // preserving scroll position — the focus→jump-to-bottom is suppressed
  // through the keyboard animation, not just the first onFocus tick.
  const handleReply = useCallback((message) => {
    if (!message || message.deleted) return;
    setReplyTo(message);
    setShowEmoji(false);
    suppressFocusScroll.current = true;
    setTimeout(() => inputRef.current?.focus(), 180);
    setTimeout(() => { suppressFocusScroll.current = false; }, 700);
  }, []);

  const send = () => {
    const body = text.trim();
    if (!body) return;
    haptic('impact');
    if (editing) {
      const baseVersion = otEditingVersion[editing.id] || editing.otVersion || 0;
      editMessage(editing.id, body, { baseVersion })
        .then(() => {})
        .catch((e) => console.warn('edit failed', e.message));
      setEditing(null);
      setText('');
      setTypingState(chatId, false);
      return;
    }
    sendMessage(chatId, {
      type: 'text',
      body,
      ...replyPayload(),
    });
    setText(''); setReplyTo(null); setShowEmoji(false); setTypingState(chatId, false);
  };

  const pickImage = () => {
    setImageEditor(true);
  };

  const sendEditedImage = (processed) => {
    setImageEditor(false);
    // The processed file is already cropped, rotated and compressed locally —
    // OutboxManager uploads it (never the original) and generates a thumbnail.
    sendMessage(chatId, {
      type: 'image',
      mediaUrl: processed.uri,
      localMediaUri: processed.uri,
      mimeType: processed.mimeType || 'image/jpeg',
      body: '',
      ...replyPayload(),
    });
    setReplyTo(null);
  };

  const restorePlaybackAudioMode = () => setAudioModeAsync({
    allowsRecording: false,
    playsInSilentMode: true,
    interruptionMode: 'duckOthers',
    shouldPlayInBackground: false,
    shouldRouteThroughEarpiece: false,
  }).catch(() => {});

  const startRecording = async () => {
    if (recording || voiceBusy || recordingStarting.current) return;
    recordingStarting.current = true;
    stopWhileStarting.current = null;
    setVoiceBusy(true);
    let becameLive = false;
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Microphone permission needed', 'Allow microphone access in your device settings to record voice notes.');
        return;
      }
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        interruptionMode: 'doNotMix',
        shouldPlayInBackground: false,
        shouldRouteThroughEarpiece: false,
      });
      await audioRecorder.prepareToRecordAsync();
      recordingStartedAt.current = Date.now();
      audioRecorder.record();
      becameLive = true;
      setRecording(true);
      setShowEmoji(false);
    } catch (error) {
      console.warn('voice recording failed to start', error?.message);
      Alert.alert('Could not record', error?.message || 'The microphone could not be started.');
      await restorePlaybackAudioMode();
    } finally {
      recordingStarting.current = false;
      setVoiceBusy(false);
      // The button was released while the recorder was still spinning up —
      // apply that stop now.
      if (becameLive && stopWhileStarting.current !== null) {
        const shouldSend = stopWhileStarting.current;
        stopWhileStarting.current = null;
        stopRecording(shouldSend);
      }
    }
  };

  const stopRecording = async (shouldSend = true) => {
    if (recordingStarting.current) {
      // Recorder not live yet — park the intent; startRecording applies it.
      stopWhileStarting.current = shouldSend;
      return;
    }
    if (!recording || voiceBusy) return;
    const elapsedMs = Math.max(
      audioRecorderState.durationMillis || 0,
      recordingStartedAt.current ? Date.now() - recordingStartedAt.current : 0
    );
    setVoiceBusy(true);
    try {
      await audioRecorder.stop();
      const uri = audioRecorder.uri || audioRecorder.getStatus()?.url;
      setRecording(false);
      await restorePlaybackAudioMode();

      if (!shouldSend) return;
      if (elapsedMs < 600) {
        Alert.alert('Voice note too short', 'Record for at least one second.');
        return;
      }
      if (!uri) throw new Error('The recording file was not created');

      const web = Platform.OS === 'web';
      const fileName = `voice-${Date.now()}.${web ? 'webm' : 'm4a'}`;
      const mimeType = web ? 'audio/webm' : 'audio/m4a';
      const { url } = await api.uploadFile(uri, fileName, mimeType);
      sendMessage(chatId, {
        type: 'voice',
        mediaUrl: url,
        duration: Math.max(1, Math.round(elapsedMs / 1000)),
        body: '',
        ...replyPayload(),
      });
      setReplyTo(null);
    } catch (error) {
      console.warn('voice note failed', error?.message);
      setRecording(false);
      await restorePlaybackAudioMode();
      Alert.alert('Voice note failed', error?.message || 'The recording could not be sent.');
    } finally {
      recordingStartedAt.current = 0;
      setVoiceBusy(false);
    }
  };

  const cancelRecording = () => stopRecording(false);

  // "Delete for me" hides a single message only on this user's devices.
  // The socket 'message:hidden' reply removes it from local state; we also
  // drop it immediately for instant feedback.
  const handleDeleteForMe = useCallback((message) => {
    if (!message) return;
    removeMessageLocal(chatId, message.id);
    deleteMessage(message.id, 'me');
  }, [chatId, deleteMessage, removeMessageLocal]);

  const rows = useMemo(() => {
    const out = [];
    let lastDay = null;
    list.forEach((m) => {
      const ts = m.clientCreatedAt || m.createdAt;
      const day = new Date(ts).toDateString();
      if (day !== lastDay) { out.push({ _type: 'day', id: 'day_' + day, label: formatDayLabel(ts) }); lastDay = day; }
      out.push({ _type: 'msg', ...m });
    });
    return out;
  }, [list]);

  // Tapping a reply quote scrolls to the original (animated) and briefly
  // highlights it with a theme-highlighter wash; missing originals show a
  // non-blocking "Original message unavailable" note.
  const openReply = useCallback((messageId) => {
    const idx = rows.findIndex((r) => r._type === 'msg' && r.id === messageId);
    if (idx === -1) {
      setReplyMissing(true);
      clearTimeout(replyMissingTimer.current);
      replyMissingTimer.current = setTimeout(() => setReplyMissing(false), 2000);
      return;
    }
    suppressScrollToEnd.current = true;
    listRef.current?.scrollToIndex({ index: idx, viewPosition: 0.4, animated: true });
    setReplyHighlightId(messageId);
    clearTimeout(replyHighlightTimer.current);
    replyHighlightTimer.current = setTimeout(() => {
      setReplyHighlightId(null);
      suppressScrollToEnd.current = false;
    }, 1600);
  }, [rows]);

  useEffect(() => () => {
    clearTimeout(replyHighlightTimer.current);
    clearTimeout(replyMissingTimer.current);
  }, []);

  // Desktop: Escape cancels reply mode without clearing typed text.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || !replyTo) return;
      setReplyTo(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [replyTo]);

  const startEdit = (message) => {
    setEditing(message);
    setText(message.body || '');
    setShowEmoji(false);
    if (message.otVersion != null) {
      setOtEditingVersion(prev => ({ ...prev, [message.id]: message.otVersion }));
    } else {
      api.getMessageEditHistory(message.id).then(r => {
        setOtEditingVersion(prev => ({ ...prev, [message.id]: r.version || 0 }));
      }).catch(() => {
        setOtEditingVersion(prev => ({ ...prev, [message.id]: 0 }));
      });
    }
  };

  const toggleStar = async (message) => {
    try {
      const { starred } = message.starred
        ? await api.unstarMessage(message.id)
        : await api.starMessage(message.id);
      setMessagesLocalStar(message.id, starred);
    } catch (e) { console.warn('star failed', e.message); }
  };

  // small local patch helper: keep message list in sync with star/timer changes
  // without waiting for the socket round-trip (the server also broadcasts
  // message:updated so other clients stay in sync).
  const setMessagesLocalStar = (id, starred) => {
    setMessages((prev) => {
      const entry = Object.entries(prev).find(([, list]) => list.some((m) => m.id === id));
      if (!entry) return prev;
      const [cid, list] = entry;
      return { ...prev, [cid]: list.map((m) => (m.id === id ? { ...m, starred } : m)) };
    });
  };

  const setMessageTimer = async (message, seconds) => {
    try {
      const { expiresAt } = await api.setMessageTimer(message.id, seconds);
      setMessages((prev) => {
        const entry = Object.entries(prev).find(([, list]) => list.some((m) => m.id === message.id));
        if (!entry) return prev;
        const [cid, list] = entry;
        return { ...prev, [cid]: list.map((m) => (m.id === message.id ? { ...m, expiresAt } : m)) };
      });
    } catch (e) { console.warn('timer failed', e.message); }
  };

  const onVote = async (messageId, pollId, optionIndex) => {
    try { await votePoll(messageId, pollId, optionIndex); } catch (e) { console.warn('vote failed', e.message); }
  };

  if (!chat) {
    return (
      <View style={[s.center, { backgroundColor: theme.bg, padding: 28 }]}>
        <ActivityIndicator color={theme.primary} />
        <Text style={[type.labelSm, { color: theme.muted, marginTop: 14 }]}>OPENING CHAT…</Text>
        <Pressable onPress={() => refreshChats().catch(() => {})} style={[inkBox(theme, 'thin'), { marginTop: 18, paddingHorizontal: 16, paddingVertical: 9 }]}>
          <Text style={[type.labelSm, { color: theme.ink }]}>RETRY</Text>
        </Pressable>
        {!embedded && (
          <Pressable onPress={() => navigation.goBack()} style={{ marginTop: 12, padding: 8 }}>
            <Text style={[type.labelSm, { color: theme.subtext }]}>BACK TO CHATS</Text>
          </Pressable>
        )}
      </View>
    );
  }

  // Typing state is rendered separately with animated dots; this is the
  // static "who's here / last seen" line used when nobody is typing.
  const subtitle = isGroupChat(chat)
    ? (chat.members || [])
        .map((m) => (m?.id === user.id ? 'You' : String(m?.name || 'Unknown').split(' ')[0]))
        .join(', ')
    : lastSeenText(chat.isOnline, chat.lastSeen);

  // Keyboard pad: keep only the bottom controls above the keyboard.
  // Padding the outer container made pan-mode Android devices move the whole
  // conversation and still leave the TextInput behind the IME. Moving the
  // bottom controls preserves the message viewport and works in both the
  // phone stack and the embedded tablet split.
  const keyboardPad = Platform.OS === 'android' || Platform.OS === 'web' ? keyboardHeight : 0;
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.chatBg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
      enabled={Platform.OS === 'ios'}
    >
      {/* per-conversation chat theme backdrop — animated gradient, crossfades
          between themes in ~280ms (subtle, premium; no full-app rebuild) */}
      <ChatBackground theme={theme} />

      <View style={s.content}>
      {/* header — floating clay bar; own top inset only when not embedded
          in the desktop/tablet split (that shell already pads for the notch).
          Slides in once per conversation, like the chat is "opening". */}
      <FadeSlide key={`hdr-${chatId}`} from="down" distance={8} duration={260}>
      <View style={[s.headerWrap, !embedded && { paddingTop: 18 + insets.top }]}>
        <View style={s.header}>
          {!embedded && (
            <SpringPressable
              accessibilityRole="button"
              accessibilityLabel="Back"
              onPress={() => navigation.goBack()}
              hitSlop={8}
              scaleTo={motion.scale.icon}
              haptic="selection"
              style={s.backBtn}
            >
              <Icon name="arrow-back" size={22} color={theme.primary} />
            </SpringPressable>
          )}
          <Pressable style={s.headerInfo} onPress={() => navigation.navigate('ChatInfo', { chatId })}>
            <Avatar uri={chat.avatar} name={chat.name} id={chat.otherUserId || chat.id} group={isGroupChat(chat)} size={42} profileId={isGroupChat(chat) ? null : chat.otherUserId} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <EmojiText style={[type.headlineSm, { color: theme.text, flexShrink: 1 }]} numberOfLines={1}>{chat.name}</EmojiText>
                {hasGoldTick(chat) && <GoldTick size={16} />}
              </View>
              {typers.length ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <TypingDots color={theme.primary} size={4} />
                  <Text style={[type.bodySm, { fontSize: 12.5, color: theme.primary }]} numberOfLines={1}>
                    {isGroupChat(chat) ? `${typers[0]} is typing` : 'typing'}
                  </Text>
                </View>
              ) : (
                <Text style={[type.bodySm, { fontSize: 12.5, color: theme.subtext }]} numberOfLines={1}>
                  {subtitle}
                </Text>
              )}
            </View>
          </Pressable>
          <InkIconButton
            name="document-text-outline"
            size={36}
            iconSize={17}
            onPress={() => setDocsOpen(true)}
          />
          {isGroupChat(chat) && (
            <InkIconButton
              name="bar-chart-outline"
              size={36}
              iconSize={17}
              onPress={() => setPollOpen(true)}
            />
          )}
          {chat.type === 'direct' && (
            <>
              <InkIconButton
                name="call"
                size={36}
                iconSize={16}
                disabled={!!call}
                onPress={() => startCall(chatId, chat.otherUserId, 'audio')}
              />
              <InkIconButton
                name="videocam"
                size={36}
                iconSize={16}
                disabled={!!call}
                onPress={() => startCall(chatId, chat.otherUserId, 'video')}
              />
            </>
          )}
          <InkIconButton
            name="ellipsis-horizontal"
            size={36}
            iconSize={16}
            onPress={() => setOverflowOpen(true)}
          />
        </View>
        <Rule style={{ marginHorizontal: 20, marginTop: 10, marginBottom: 0 }} />
      </View>
      </FadeSlide>

      {!!messageHistoryError && list.length > 0 && (
        <View style={[s.historyError, { backgroundColor: theme.dangerContainer, borderColor: theme.danger }]}>
          <Icon name="alert-circle-outline" size={16} color={theme.danger} />
          <Text style={[type.bodySm, { color: theme.text, flex: 1 }]}>Showing saved messages. Refresh failed.</Text>
          <Pressable onPress={() => loadMessages(chatId).catch(() => {})} hitSlop={7}>
            <Text style={[type.labelXs, { color: theme.danger }]}>RETRY</Text>
          </Pressable>
        </View>
      )}

      <FlatList
        ref={listRef}
        style={s.messagesList}
        data={rows}
        keyExtractor={(i) => i.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={{ paddingVertical: 14, flexGrow: 1, justifyContent: 'flex-end', paddingBottom: 8 }}
        maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
        onScroll={(event) => {
          const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
          if (contentSize.height <= layoutMeasurement.height + 48) return;
          if (contentOffset.y > 90) return;
          if (loadingOlderRef.current || !loadOlderMessages) return;
          loadingOlderRef.current = true;
          suppressScrollToEnd.current = true;
          Promise.resolve(loadOlderMessages(chatId)).finally(() => {
            setTimeout(() => {
              suppressScrollToEnd.current = false;
              loadingOlderRef.current = false;
            }, 400);
          });
        }}
        scrollEventThrottle={80}
        onContentSizeChange={() => {
          if (suppressScrollToEnd.current || suppressFocusScroll.current) return;
          listRef.current?.scrollToEnd({ animated: false });
        }}
        onScrollToIndexFailed={(info) => {
          // Rows vary in height; fall back to an estimated offset, then retry.
          setTimeout(() => {
            listRef.current?.scrollToOffset({ offset: Math.max(0, info.averageItemLength * info.index - 200), animated: false });
          }, 60);
        }}
        renderItem={({ item }) =>
          item._type === 'day' ? (
            <View style={s.dayWrap}>
              <View style={[dashedRule(theme), { flex: 1 }]} />
              <View style={[s.tapeStrip, { backgroundColor: theme.cardAlt, borderColor: theme.graphiteLine }]}>
                <Text style={[type.labelXs, { color: theme.graphite }]}>{String(item.label || '').toUpperCase()}</Text>
              </View>
              <View style={[dashedRule(theme), { flex: 1 }]} />
            </View>
          ) : (
            <MessageBubble
              message={item}
              animateIn={!!item._new}
              isMine={item.senderId === user.id}
              isGroup={isGroupChat(chat)}
              senderName={nameFor(item.senderId)}
              senderUser={chat?.members?.find((m) => m.id === item.senderId)}
              onReply={handleReply}
              onOpenReply={openReply}
              highlighted={replyHighlightId === item.id}
              onReact={react}
              onDelete={deleteMessage}
              onDeleteForMe={handleDeleteForMe}
              onImagePress={setLightbox}
              onEdit={startEdit}
              onForward={setForwardMsg}
              onStar={toggleStar}
              onSetTimer={setTimerMsg}
              onVotePoll={onVote}
              onReport={openReport}
            />
          )
        }
        ListEmptyComponent={
          !messageHistoryLoaded || messageHistoryLoading ? (
            <View style={s.emptyChat}>
              <ActivityIndicator color={theme.primary} />
              <Text style={[type.labelSm, { color: theme.muted, marginTop: 12 }]}>LOADING MESSAGES…</Text>
            </View>
          ) : messageHistoryError ? (
            <View style={s.emptyChat}>
              <Icon name="alert-circle-outline" size={26} color={theme.danger} />
              <Text style={[type.bodyStrong, { color: theme.text, marginTop: 10 }]}>Unable to load messages</Text>
              <Text style={[type.bodySm, { color: theme.muted, marginTop: 4, textAlign: 'center' }]}>Your conversation was not erased.</Text>
              <SpringPressable
                onPress={() => loadMessages(chatId).catch(() => {})}
                style={({ pressed }) => [s.historyRetry, inkBox(theme, 'thin'), pressed && marker(theme, 1)]}
                scaleTo={motion.scale.row}
                haptic="selection"
              >
                <Icon name="refresh" size={15} color={theme.ink} />
                <Text style={[type.labelSm, { color: theme.ink }]}>RETRY</Text>
              </SpringPressable>
            </View>
          ) : (
            <View style={s.emptyChat}>
              {/* Only a successful empty response can show a true beginning. */}
              <FloatLoop amplitude={4} duration={3600}>
                <View style={{ alignItems: 'center', gap: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                    <Emoji char="✒️" size={15} />
                    <Text style={[type.bodySm, { color: theme.muted }]}>This is the beginning of your conversation.</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                    <Text style={[type.bodySm, { color: theme.muted }]}>Say hello</Text>
                    <Emoji char="👋" size={16} />
                  </View>
                </View>
              </FloatLoop>
            </View>
          )
        }
      />

      {/* bottom stack (reply bar → composer) slides up once per conversation,
          synchronized with the header — the chat "opens" as one gesture. */}
      <FadeSlide key={`cmp-${chatId}`} from="up" distance={10} duration={260} delay={40}>
      <View style={keyboardPad > 0 ? { marginBottom: keyboardPad } : null}>
        <ReplyBar
          replyTo={replyTo}
          senderName={replyTo ? nameFor(replyTo.senderId) : null}
          onClose={() => setReplyTo(null)}
        />

        {replyMissing && (
          <Pop from={0.5}>
            <View style={[s.missingToast, { backgroundColor: theme.cardAlt, borderColor: theme.ink }]}>
              <Icon name="alert-circle-outline" size={15} color={theme.muted} />
              <Text style={[type.bodySm, { color: theme.text }]}>Original message unavailable</Text>
            </View>
          </Pop>
        )}

      {editing && (
        <View style={[s.editBar, { borderColor: theme.ink, backgroundColor: theme.cardAlt }]}>
          <Icon name="create-outline" size={15} color={theme.ink} />
          <Text style={[type.labelXs, { color: theme.ink, flex: 1 }]} numberOfLines={1}>
            EDITING — {editing.body}
          </Text>
          <Pressable onPress={() => { setEditing(null); setText(''); }} hitSlop={8}>
            <Icon name="close" size={18} color={theme.muted} />
          </Pressable>
        </View>
      )}

      <EmojiPicker visible={showEmoji} onSelect={(e) => setText((v) => v + e)} />

      <UniversalImageEditor
        visible={imageEditor}
        pickOnOpen
        config={editorConfigFor('chat')}
        onCancel={() => setImageEditor(false)}
        onDone={sendEditedImage}
      />

      {/* composer — bottom safe-area (home indicator / gesture bar) only
          applies full-screen; the desktop/tablet split already handles it. */}
      <View style={[s.composerWrap, keyboardPad > 0
        ? { paddingBottom: 8 }
        : !embedded ? { paddingBottom: Math.max(insets.bottom, 12) } : null
      ]}>
        {recording ? (
          <InkField style={s.inputBar}>
            <View style={[s.recDot, { backgroundColor: theme.danger }]} />
            <Text style={[type.bodyLg, { flex: 1, color: theme.text }]}>
              Recording… {Math.floor(recSecs / 60)}:{String(recSecs % 60).padStart(2, '0')}
            </Text>
            <Pressable accessibilityLabel="Cancel voice recording" onPress={cancelRecording} disabled={voiceBusy} hitSlop={8}>
              <Text style={[type.labelSm, { color: theme.danger, opacity: voiceBusy ? 0.45 : 1 }]}>CANCEL</Text>
            </Pressable>
          </InkField>
        ) : (
          <InkField style={s.inputBar}>
            <SpringPressable
              accessibilityRole="button"
              accessibilityLabel={showEmoji ? 'Show keyboard' : 'Show emoji'}
              onPress={() => setShowEmoji((v) => !v)}
              hitSlop={6}
              scaleTo={motion.scale.icon}
              haptic="selection"
            >
              <IconSwap
                active={showEmoji}
                size={23}
                spin={30}
                on={<Icon name="keypad-outline" size={23} color={theme.muted} />}
                off={<Icon name="happy-outline" size={23} color={theme.muted} />}
              />
            </SpringPressable>
            <TextInput
              ref={inputRef}
              style={s.input}
              placeholder={editing ? 'Edit message…' : 'Message'}
              placeholderTextColor={theme.muted}
              value={text}
              onChangeText={onChangeText}
              onFocus={() => {
                // replying focuses the composer without jumping to the bottom
                if (suppressFocusScroll.current) return;
                scrollToLatest(120);
              }}
              multiline
              disableFullscreenUI
              onSubmitEditing={send}
              blurOnSubmit={false}
              onKeyPress={(e) => {
                if (Platform.OS === 'web' && e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) {
                  e.preventDefault?.();
                  send();
                }
              }}
            />
            {!editing && (
              <SpringPressable accessibilityRole="button" accessibilityLabel="Attach a photo" onPress={pickImage} hitSlop={6} disabled={uploading} scaleTo={motion.scale.icon} haptic="selection">
                {uploading
                  ? <ActivityIndicator size="small" color={theme.muted} />
                  : <Icon name="attach" size={22} color={theme.muted} style={{ transform: [{ rotate: '45deg' }] }} />}
              </SpringPressable>
            )}
            {!editing && !text.trim() && (
              <SpringPressable accessibilityRole="button" accessibilityLabel="Take a photo" onPress={pickImage} hitSlop={6} scaleTo={motion.scale.icon} haptic="selection">
                <Icon name="camera-outline" size={22} color={theme.muted} />
              </SpringPressable>
            )}
          </InkField>
        )}

        <SpringPressable
          accessibilityRole="button"
          accessibilityLabel={voiceBusy ? 'Sending voice note' : recording ? 'Send voice note' : text.trim() ? 'Send message' : 'Hold to record a voice note'}
          // WhatsApp-style: HOLD the mic to record — release to send. A quick
          // tap still toggles recording (accessibility / old habit), and the
          // existing cancel control keeps working either way.
          delayLongPress={250}
          onPressIn={() => {
            holdStartedAt.current = Date.now();
            if (!text.trim() && !editing && !recording && !voiceBusy) {
              pressOwnsRecording.current = true;
              startRecording();
            }
          }}
          onPressOut={() => {
            const startedAt = holdStartedAt.current;
            holdStartedAt.current = 0;
            if (!pressOwnsRecording.current) return;
            pressOwnsRecording.current = false;
            const heldMs = startedAt ? Date.now() - startedAt : 0;
            // A real hold sends on release; a quick tap is treated as an
            // accidental touch and cancels — nothing half-second-long ever
            // gets sent. startRecording is async, so stopRecording handles
            // "still starting" gracefully (it is a no-op until a file lands).
            stopRecording(heldMs >= 500);
          }}
          onPress={() => {
            if (text.trim()) send();
            else if (editing) { setEditing(null); setText(''); }
            // Recording is fully driven by press-in/release above.
          }}
          disabled={voiceBusy}
          android_ripple={rippleFor(theme, { color: alpha(theme.onSendButton, 0.3) })}
          style={({ pressed }) => [
            s.sendBtn,
            inkBox(theme, 'bold'),
            { backgroundColor: pressed && Platform.OS !== 'android' ? theme.highlighter : theme.sendButton },
            voiceBusy && { opacity: 0.55 },
          ]}
        >
          {voiceBusy ? (
            <ActivityIndicator size="small" color={theme.onSendButton} />
          ) : (
            // The composer's icon changes meaning as you type (mic → send).
            // A pop on every change makes the button feel like it *became*
            // something else, instead of silently swapping glyphs.
            <Pop trigger={editing ? 'checkmark' : text.trim() ? 'send' : recording ? 'checkmark' : 'mic'} firstStatic from={0.7}>
              <Icon
                name={editing ? 'checkmark' : text.trim() ? 'send' : recording ? 'checkmark' : 'mic'}
                size={18}
                color={theme.onSendButton}
              />
            </Pop>
          )}
        </SpringPressable>
        </View>
      </View>
      </FadeSlide>

      {/* -------- safety: report a message -------- */}
      <Modal visible={!!reportMsg} transparent animationType="fade" onRequestClose={() => setReportMsg(null)}>
        {reportMsg && (
          <Pressable style={s.dimOverlay} onPress={() => setReportMsg(null)}>
            <Pressable style={[s.reportSheet, inkBox(theme, 'ink'), { backgroundColor: theme.bg }]} onPress={() => {}}>
              <Text style={[type.headlineSm, { color: theme.text }]}>Report this message</Text>
              <Text style={[type.bodySm, { color: theme.muted, marginTop: 4 }]}>
                Your report goes to the +one safety team privately. The sender is not told.
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
                {[
                  ['harassment', 'Harassment'], ['threat', 'Threat'], ['hate', 'Hate'], ['violence', 'Violence'],
                  ['spam', 'Spam'], ['scam', 'Scam'], ['sexual_exploitation', 'Sexual content'],
                  ['child_safety', 'Child safety'], ['extremism', 'Terrorism'], ['other', 'Other'],
                ].map(([k, label]) => (
                  <Pressable
                    key={k}
                    onPress={() => setReportReason(k)}
                    style={[s.reportChip, reportReason === k && { backgroundColor: theme.ink, borderColor: theme.ink }]}
                  >
                    <Text style={[type.labelXs, { color: reportReason === k ? theme.onPrimary : theme.ink }]}>{label.toUpperCase()}</Text>
                  </Pressable>
                ))}
              </View>
              <InkField style={{ marginTop: 12 }} focused={!!reportNote}>
                <TextInput
                  value={reportNote} onChangeText={setReportNote}
                  placeholder="Anything that helps review (optional)"
                  placeholderTextColor={theme.muted}
                  style={{ flex: 1, fontFamily: 'Karla_400Regular', fontSize: 14, color: theme.text, paddingVertical: 6 }}
                  maxLength={500}
                />
              </InkField>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                <Pressable onPress={() => setReportMsg(null)} style={[s.reportBtn, { borderColor: theme.ink }]}>
                  <Text style={[type.labelSm, { color: theme.ink }]}>CANCEL</Text>
                </Pressable>
                <Pressable
                  onPress={submitReport}
                  disabled={!reportReason || reportBusy}
                  style={[s.reportBtn, { borderColor: theme.danger, opacity: !reportReason || reportBusy ? 0.4 : 1 }]}
                >
                  <Text style={[type.labelSm, { color: theme.danger }]}>{reportBusy ? 'SENDING…' : 'REPORT'}</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        )}
      </Modal>

      {/* shared viewer: springs open, drag it away in any vertical
          direction, backdrop fades with the finger */}
      <ImageLightbox uri={lightbox} onClose={() => setLightbox(null)} />

      {/* forward picker */}
      <ForwardSheet visible={!!forwardMsg} message={forwardMsg} onClose={() => setForwardMsg(null)} />

      {/* per-message disappearing timer */}
      <Modal visible={!!timerMsg} transparent animationType="fade" onRequestClose={() => setTimerMsg(null)}>
        <Pressable style={[s.overlay, { backgroundColor: 'transparent' }]} onPress={() => setTimerMsg(null)}>
          <FrostedBackdrop />
          <SheetSpringIn style={{ width: '100%', maxWidth: 360 }}>
          <Pressable style={[s.timerSheet, raised(theme, 2), { backgroundColor: theme.bg, borderColor: theme.ink }]}>
            <Text style={[type.headlineSm, { color: theme.text }]}>Disappear in…</Text>
            <Text style={[type.bodySm, { color: theme.subtext, marginTop: 4, marginBottom: 12 }]}>
              The message self-destructs after the timer.
            </Text>
            <View style={{ gap: 8 }}>
              {(() => {
                // Modal children render even while `visible` is false. Keep the
                // initial null timer selection safe so opening any chat cannot
                // crash to a blank screen.
                const remaining = timerMsg?.expiresAt ? Math.round((timerMsg.expiresAt - Date.now()) / 1000) : 0;
                const isActive = (sec) => (sec === 0 ? remaining === 0 : Math.abs(remaining - sec) < Math.max(2, sec * 0.05));
                return (
                  <>
                    <SpringPressable
                      style={({ pressed }) => [s.timerOpt, inkBox(theme, 'thin'), pressed ? marker(theme, 1) : null]}
                      onPress={() => { setMessageTimer(timerMsg, 0); setTimerMsg(null); }}
                      scaleTo={motion.scale.row}
                      haptic="selection"
                    >
                      <Icon name="time-outline" size={18} color={theme.ink} />
                      <Text style={[type.bodyMd, { color: theme.text, flex: 1 }]}>Off — keep forever</Text>
                      {isActive(0) && <Icon name="checkmark" size={18} color={theme.ink} />}
                    </SpringPressable>
                    {DISAPPEAR_OPTIONS.map((o) => (
                      <SpringPressable
                        key={o.seconds}
                        style={({ pressed }) => [s.timerOpt, inkBox(theme, 'thin'), pressed ? marker(theme, 1) : null]}
                        onPress={() => { setMessageTimer(timerMsg, o.seconds); setTimerMsg(null); }}
                        scaleTo={motion.scale.row}
                        haptic="selection"
                      >
                        <Icon name="timer-outline" size={18} color={theme.ink} />
                        <Text style={[type.bodyMd, { color: theme.text, flex: 1 }]}>{o.label}</Text>
                        {isActive(o.seconds) && <Icon name="checkmark" size={18} color={theme.ink} />}
                      </SpringPressable>
                    ))}
                  </>
                );
              })()}
            </View>
          </Pressable>
          </SheetSpringIn>
        </Pressable>
      </Modal>

      {/* group poll composer */}
      <PollComposer
        visible={pollOpen}
        onClose={() => setPollOpen(false)}
        onCreate={async (question, options) => {
          await createPoll(chatId, question, options);
        }}
      />

      {/* OT collaborative documents */}
      <Modal visible={docsOpen} animationType="slide" onRequestClose={() => setDocsOpen(false)}>
        <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: 20 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 2, borderBottomColor: theme.ink }}>
            <Text style={[type.headlineSm, { color: theme.text }]}>COLLABORATIVE NOTES</Text>
            <Pressable onPress={() => setDocsOpen(false)} style={[inkBox(theme, 'thin'), { paddingHorizontal: 12, paddingVertical: 8 }]}>
              <Text style={[type.labelSm, { color: theme.ink }]}>CLOSE</Text>
            </Pressable>
          </View>
          <CollabDocumentView chatId={chatId} socket={socket} embedded />
        </View>
      </Modal>

      {/* ⋯ overflow menu — Theme sits here, clearly visible, not dominant */}
      <Modal visible={overflowOpen} transparent animationType="fade" onRequestClose={() => setOverflowOpen(false)}>
        <Pressable style={[s.overlay, { backgroundColor: 'transparent' }]} onPress={() => setOverflowOpen(false)}>
          <FrostedBackdrop />
          <PaperCard weight="ink" style={s.overflowMenu}>
            <SpringPressable
              style={({ pressed }) => [s.menuRow, pressed ? marker(theme, 1) : null]}
              onPress={() => { setOverflowOpen(false); themePicker?.setPickerOpen(true); }}
              scaleTo={motion.scale.row}
              haptic="selection"
            >
              <View style={[s.menuIcon, { backgroundColor: alpha(theme.accent, 0.16) }]}>
                <Icon name="color-palette-outline" size={18} color={theme.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[type.bodyMd, { color: theme.text }]}>Chat theme</Text>
                <Text style={[type.labelXs, { color: theme.muted, marginTop: 2 }]}>
                  {ThemeRegistry.get(theme.chatThemeId || 'graphite').name}
                </Text>
              </View>
            </SpringPressable>
            <Rule style={{ marginVertical: 6 }} />
            <SpringPressable
              style={({ pressed }) => [s.menuRow, pressed ? marker(theme, 1) : null]}
              onPress={() => { setOverflowOpen(false); navigation.navigate('ChatInfo', { chatId }); }}
              scaleTo={motion.scale.row}
              haptic="selection"
            >
              <Icon name="information-circle-outline" size={18} color={theme.ink} style={{ width: 26 }} />
              <Text style={[type.bodyMd, { color: theme.text }]}>Chat info</Text>
            </SpringPressable>
            <SpringPressable
              style={({ pressed }) => [s.menuRow, pressed ? marker(theme, 1) : null]}
              onPress={() => { setOverflowOpen(false); navigation.navigate('ChatInfo', { chatId }); }}
              scaleTo={motion.scale.row}
              haptic="selection"
            >
              <Icon name="timer-outline" size={18} color={theme.ink} style={{ width: 26 }} />
              <Text style={[type.bodyMd, { color: theme.text }]}>Disappearing messages</Text>
            </SpringPressable>
            {!embedded && (
              <SpringPressable
                style={({ pressed }) => [s.menuRow, pressed ? marker(theme, 1) : null]}
                onPress={() => { setOverflowOpen(false); navigation.navigate('Starred'); }}
                scaleTo={motion.scale.row}
                haptic="selection"
              >
                <Icon name="star-outline" size={18} color={theme.ink} style={{ width: 26 }} />
                <Text style={[type.bodyMd, { color: theme.text }]}>Starred messages</Text>
              </SpringPressable>
            )}
          </PaperCard>
        </Pressable>
      </Modal>

      {/* per-conversation chat theme picker — live preview, Apply to save */}
      {themePicker && (
        <ThemePickerSheet
          visible={themePicker.pickerOpen}
          savedThemeId={themePicker.savedThemeId}
          previewThemeId={themePicker.previewThemeId}
          onPreview={themePicker.setPreviewThemeId}
          onApply={themePicker.handleApply}
          applying={themePicker.applying}
          globalTheme={themePicker.globalTheme}
          onClose={() => { themePicker.setPreviewThemeId(null); themePicker.setPickerOpen(false); }}
        />
      )}

      {/* small non-blocking theme feedback: success ✓ pop or calm error */}
      {themePicker?.themeToast && (
        <View pointerEvents="none" style={[s.toastWrap, { top: (embedded ? 10 : 10 + insets.top) + 84 }]}>
          <Pop trigger={themePicker.themeToast} from={0.5}>
            <View
              style={[
                s.toast,
                raised(theme, 2),
                { backgroundColor: theme.card, borderColor: themePicker.themeToast === 'success' ? theme.accent : theme.danger },
              ]}
            >
              {themePicker.themeToast === 'success' ? (
                <>
                  <Icon name="checkmark-circle" size={16} color={theme.accent} />
                  <Text style={[type.bodySm, { color: theme.text, flex: 1 }]}>Theme applied.</Text>
                </>
              ) : (
                <>
                  <Icon name="alert-circle-outline" size={15} color={theme.danger} />
                  <Text style={[type.bodySm, { color: theme.text, flex: 1 }]}>
                    Couldn't save the theme. Check your connection and try again.
                  </Text>
                </>
              )}
            </View>
          </Pop>
        </View>
      )}
      </View>
    </KeyboardAvoidingView>
  );
}

/** Never let one malformed legacy message turn the whole route into a white
 * screen. The exact error is logged while the user keeps a working Back/Retry
 * surface. A new boundary mounts for every chat id. */
class ConversationErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('[conversation render]', error, info); }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { theme, navigation, embedded } = this.props;
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: theme.bg }}>
        <Icon name="alert-circle-outline" size={34} color={theme.danger} />
        <Text style={[type.headlineSm, { color: theme.text, marginTop: 14 }]}>Chat hit a snag</Text>
        <Text style={[type.bodySm, { color: theme.subtext, textAlign: 'center', marginTop: 7, maxWidth: 320 }]}>
          The conversation could not render. Retry, or return to Chats without losing your messages.
        </Text>
        <Pressable
          onPress={() => this.setState({ error: null })}
          style={[inkBox(theme, 'ink'), { marginTop: 18, paddingHorizontal: 18, paddingVertical: 10 }]}
        >
          <Text style={[type.labelSm, { color: theme.ink }]}>TRY AGAIN</Text>
        </Pressable>
        {!embedded && (
          <Pressable onPress={() => navigation.goBack()} style={{ marginTop: 10, padding: 9 }}>
            <Text style={[type.labelSm, { color: theme.subtext }]}>BACK TO CHATS</Text>
          </Pressable>
        )}
      </View>
    );
  }
}

/**
 * Wraps the conversation in the per-chat theme scope. The active ChatTheme is
 * resolved here (saved theme + optional live picker preview) and re-provided
 * as the app ThemeContext, so every widget inside the chat consumes it.
 * Apply is optimistic with rollback — a failed save restores the previous
 * persisted theme and shows a small non-blocking toast instead of breaking
 * messaging.
 */
function ThemedConversation(props) {
  const chatId = props.route?.params?.chatId || null;
  const { theme: globalTheme } = useTheme();
  const chatThemeApi = useChatTheme();
  const {
    themeIdFor = () => 'graphite',
    applyTheme = async () => false,
    applyState = {},
    clearApplyError = () => {},
  } = chatThemeApi || {};
  const [previewThemeId, setPreviewThemeId] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [themeToast, setThemeToast] = useState(null); // null | 'error' | 'success'
  const toastTimer = useRef(null);

  const savedThemeId = chatId ? themeIdFor(chatId) : 'graphite';

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const handleApply = async (id) => {
    const ok = await applyTheme(chatId, id);
    setPreviewThemeId(null);
    setPickerOpen(false);
    // Small non-blocking feedback either way — success pops a ✓ briefly,
    // failure shows the calm error toast and the theme rolls back.
    setThemeToast(ok ? 'success' : 'error');
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setThemeToast(null), ok ? 1600 : 4200);
    clearApplyError(chatId);
  };

  const themePicker = {
    savedThemeId,
    previewThemeId,
    setPreviewThemeId,
    pickerOpen,
    setPickerOpen,
    handleApply,
    applying: !!applyState[chatId]?.saving,
    themeToast,
    globalTheme,
  };

  return (
    <ChatThemeScope chatId={chatId} overrideThemeId={previewThemeId || undefined}>
      <ConversationContent {...props} themePicker={themePicker} />
    </ChatThemeScope>
  );
}

export default function ConversationScreen(props) {
  const { theme } = useTheme();
  const chatId = props.route?.params?.chatId || 'unknown';
  return (
    <ConversationErrorBoundary
      key={chatId}
      theme={theme}
      navigation={props.navigation}
      embedded={props.embedded}
    >
      <ThemedConversation {...props} />
    </ConversationErrorBoundary>
  );
}

const makeStyles = (t) => StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1, zIndex: 1 },
  headerWrap: { paddingTop: 18, paddingBottom: 4 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 10 },
  backBtn: { padding: 4 },
  headerInfo: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  dayWrap: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 16, paddingHorizontal: 24 },
  // Masking-tape date label: an intentionally slightly uneven paper strip.
  tapeStrip: {
    borderWidth: 1, borderStyle: 'dashed', paddingHorizontal: 10, paddingVertical: 5,
    borderTopLeftRadius: 5, borderTopRightRadius: 3, borderBottomRightRadius: 6, borderBottomLeftRadius: 4,
    transform: [{ rotate: '-1deg' }],
  },
  messagesList: { flex: 1, minHeight: 0 },
  emptyChat: { alignItems: 'center', justifyContent: 'center', padding: 40 },
  historyError: {
    flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1,
    marginHorizontal: 20, marginBottom: 8, paddingHorizontal: 11, paddingVertical: 8,
  },
  historyRetry: {
    minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: 14, paddingVertical: 8, marginTop: 14,
  },
  missingToast: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 20, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 9,
    borderWidth: 1, borderRadius: 8, justifyContent: 'center',
  },
  overflowMenu: { width: '100%', maxWidth: 320, padding: 14 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 6, paddingVertical: 11 },
  menuIcon: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 999 },
  toastWrap: { position: 'absolute', left: 20, right: 20, alignItems: 'center', zIndex: 50 },
  toast: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    maxWidth: 420, paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 2, borderRadius: 999,
  },
  editBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 20, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderStyle: 'dashed',
  },
  // The raised, irregular composer gives the bottom of the conversation a torn-paper feel.
  composerWrap: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 20, paddingBottom: 22, paddingTop: 12, gap: 12, borderTopWidth: 1, borderTopColor: t.graphiteLine, borderStyle: 'dashed' },
  inputBar: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 12, minHeight: 48, borderTopLeftRadius: 5, borderTopRightRadius: 3, borderBottomRightRadius: 6, borderBottomLeftRadius: 4, backgroundColor: t.inputBackground },
  input: { flex: 1, ...type.bodyLg, color: t.text, maxHeight: 110, paddingVertical: 11, outlineStyle: 'none' },
  sendBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  recDot: { width: 9, height: 9, borderRadius: radius.full },
  dimOverlay: { flex: 1, backgroundColor: 'rgba(28,27,27,0.95)', alignItems: 'center', justifyContent: 'center' },
  reportSheet: { width: '92%', maxWidth: 460, borderRadius: radius.md, padding: 18 },
  reportChip: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  reportBtn: { flex: 1, alignItems: 'center', borderWidth: 1.5, borderRadius: 999, paddingVertical: 10 },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  timerSheet: {
    width: '100%', maxWidth: 360, borderWidth: 3, padding: 20,
    borderTopLeftRadius: 6, borderTopRightRadius: 12,
    borderBottomRightRadius: 6, borderBottomLeftRadius: 10,
  },
  timerOpt: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 11 },
});
