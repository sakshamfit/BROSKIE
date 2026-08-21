import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, Modal, Platform, Animated, Easing,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, RadialGradient, Stop, Rect, Ellipse } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { setAudioModeAsync } from 'expo-audio';
import Icon from '../icons/Icon';
import Emoji from '../icons/Emoji';
import { useAuth } from '../store/AuthContext';
import { useTheme } from '../store/ThemeContext';
import useResponsive from '../hooks/useResponsive';
import { api } from '../api';
import AIGreeterModel from './AIGreeterModel';
import { Avatar } from './common';
import { type } from '../theme';
import { routeFromNotification } from '../push/routing';

const EMPTY_SUMMARY = {
  unreadMessages: 0, unreadChats: 0, messageRequests: 0,
  colleagueRequests: 0, communityRequests: 0, total: 0,
  placesPostersToday: 0, aroundNow: 0,
};

/** Local midnight in ms — "today" follows the viewer's day, not UTC's. */
function localMidnight() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const periodFor = (hour) => hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : hour < 22 ? 'Good evening' : 'Good night';

function conditionFor(code, temperature) {
  let condition = 'clear';
  if ([1, 2].includes(code)) condition = 'partly cloudy';
  else if (code === 3) condition = 'cloudy';
  else if ([45, 48].includes(code)) condition = 'foggy';
  else if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) condition = 'rainy';
  else if ((code >= 71 && code <= 77) || [85, 86].includes(code)) condition = 'snowy';
  else if (code >= 95) condition = 'stormy';
  const feel = temperature >= 32 ? 'hot' : temperature <= 14 ? 'cold' : temperature >= 26 ? 'warm' : 'mild';
  return { condition, feel };
}

function notificationSentence(summary) {
  const parts = [];
  if (summary.unreadMessages) parts.push(`${summary.unreadMessages} unread message${summary.unreadMessages === 1 ? '' : 's'}`);
  if (summary.messageRequests) parts.push(`${summary.messageRequests} message request${summary.messageRequests === 1 ? '' : 's'}`);
  if (summary.colleagueRequests) parts.push(`${summary.colleagueRequests} colleague request${summary.colleagueRequests === 1 ? '' : 's'}`);
  if (summary.communityRequests) parts.push(`${summary.communityRequests} community request${summary.communityRequests === 1 ? '' : 's'}`);
  if (!parts.length) return "You're all caught up. There are no new notifications.";
  if (parts.length === 1) return `You have ${parts[0]}.`;
  return `You have ${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}.`;
}

/** Phase 2: the campus loop line — "2 people from your college posted
 *  today, and 1 person is around now." Empty string when there's nothing
 *  place-related to say. */
function campusSentence(summary, affiliations) {
  const places = affiliations || [];
  const where = places.length === 1 ? places[0].name : 'your places';
  const bits = [];
  const n = summary.placesPostersToday || 0;
  if (n > 0) bits.push(`${n} ${n === 1 ? 'person' : 'people'} from ${where} posted today`);
  const a = summary.aroundNow || 0;
  if (a > 0) bits.push(`${a} ${a === 1 ? 'person is' : 'people are'} around now`);
  return bits.length ? `${bits.join(', and ')}.` : '';
}

function GreeterBackdrop() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id="companion-glow" cx="50%" cy="42%" rx="58%" ry="48%">
            <Stop offset="0%" stopColor="#5f5f5b" stopOpacity="0.36" />
            <Stop offset="44%" stopColor="#2a2a29" stopOpacity="0.24" />
            <Stop offset="100%" stopColor="#101010" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="ground-glow" cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0%" stopColor="#000000" stopOpacity="0.48" />
            <Stop offset="100%" stopColor="#000000" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="#131313" />
        <Rect width="100%" height="100%" fill="url(#companion-glow)" />
        <Ellipse cx="50%" cy="86%" rx="24%" ry="3.8%" fill="url(#ground-glow)" />
      </Svg>
    </View>
  );
}

function SpeakingIndicator({ visible }) {
  const dots = useRef([new Animated.Value(0.28), new Animated.Value(0.28), new Animated.Value(0.28)]).current;
  useEffect(() => {
    if (!visible) {
      dots.forEach((dot) => dot.setValue(0.28));
      return undefined;
    }
    const loops = dots.map((dot, index) => Animated.loop(Animated.sequence([
      Animated.delay(index * 130),
      Animated.timing(dot, { toValue: 1, duration: 280, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(dot, { toValue: 0.28, duration: 360, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
      Animated.delay((2 - index) * 130),
    ])));
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [dots, visible]);
  if (!visible) return null;
  return (
    <View style={styles.speakingRow}>
      <View style={styles.dotRow}>
        {dots.map((opacity, index) => <Animated.View key={index} style={[styles.speakingDot, { opacity }]} />)}
      </View>
      <Text style={styles.speakingLabel}>AI IS SPEAKING</Text>
    </View>
  );
}

async function preferredFemaleVoice() {
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    const english = voices.filter((voice) => /^en([-_]|$)/i.test(voice.language || ''));
    const femaleHint = /(female|samantha|victoria|karen|moira|tessa|ava|aria|jenny|zira|susan|sangeeta|veena|en[-_]in[-_]x[-_](ena|end|ene)|en[-_]us[-_]x[-_](sfg|tpf|iob))/i;
    const maleHint = /(male|daniel|fred|rishi|en[-_]in[-_]x[-_]enc)/i;
    return english.find((voice) => femaleHint.test(`${voice.name || ''} ${voice.identifier || ''}`))
      || english.find((voice) => !maleHint.test(`${voice.name || ''} ${voice.identifier || ''}`))
      || english[0]
      || voices[0]
      || null;
  } catch {
    return null;
  }
}

class ModelBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { console.warn('[AI model]', error?.message); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View style={styles.modelFallback}>
        <Avatar name="+one AI" id="plus-one-ai" size={112} shape="sketch" weight="bold" />
        <Text style={[type.labelSm, { color: this.props.theme.muted, marginTop: 12 }]}>AI MODEL PLACEHOLDER</Text>
      </View>
    );
  }
}

/** Once-per-local-day spoken briefing shown after authentication. */
export default function DailyAIGreeting() {
  const { user } = useAuth();
  const { theme } = useTheme();
  const { width, height, isTablet } = useResponsive();
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);
  const [weather, setWeather] = useState(null);
  const [weatherState, setWeatherState] = useState('loading');
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  // Start true so the auto-speech effect cannot race ahead of weather/summary
  // loading and cancel its own scheduled utterance on the next render.
  const [loading, setLoading] = useState(true);
  const [talking, setTalking] = useState(false);
  const [spokenLine, setSpokenLine] = useState('Preparing your daily signal…');
  const [finished, setFinished] = useState(false);
  const started = useRef(false);
  const sequenceId = useRef(0);
  const timers = useRef(new Set());

  const now = new Date();
  const period = periodFor(now.getHours());
  const firstName = String(user?.name || user?.username || 'friend').trim().split(/\s+/)[0];
  const dayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  useEffect(() => {
    if (!user?.id) return undefined;
    let active = true;
    const key = `+one.ai-greeting.${user.id}.${dayKey}`;
    started.current = false;
    setSpokenLine('Preparing your daily signal…');
    AsyncStorage.getItem(key).then((seen) => {
      if (!active || seen) return;
      // Mark immediately so reconnects/re-renders cannot stack the same daily modal.
      AsyncStorage.setItem(key, 'shown').catch(() => {});
      setLoading(true);
      setVisible(true);
    }).catch(() => {
      if (active) {
        setLoading(true);
        setVisible(true);
      }
    });
    return () => {
      active = false;
      sequenceId.current += 1;
      timers.current.forEach(clearTimeout);
      timers.current.clear();
      Speech.stop();
    };
  }, [user?.id, dayKey]);

  useEffect(() => {
    if (!visible) return undefined;
    let active = true;
    setLoading(true);
    Promise.all([
      api.greetingSummary(localMidnight()).then((result) => result.summary || EMPTY_SUMMARY).catch(() => EMPTY_SUMMARY),
      (async () => {
        try {
          const permission = await Location.requestForegroundPermissionsAsync();
          if (permission.status !== 'granted') return { state: 'denied' };
          const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          const { latitude, longitude } = position.coords;
          const response = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,weather_code&timezone=auto`
          );
          if (!response.ok) throw new Error('Weather unavailable');
          const data = await response.json();
          const temperature = Number(data.current?.temperature_2m);
          const code = Number(data.current?.weather_code || 0);
          if (!Number.isFinite(temperature)) throw new Error('Weather unavailable');
          return { state: 'ready', temperature, apparent: Number(data.current?.apparent_temperature), code, ...conditionFor(code, temperature) };
        } catch {
          return { state: 'unavailable' };
        }
      })(),
    ]).then(([briefing, localWeather]) => {
      if (!active) return;
      setSummary(briefing);
      setWeatherState(localWeather.state);
      setWeather(localWeather.state === 'ready' ? localWeather : null);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [visible]);

  const weatherSentence = weather
    ? `It is ${weather.feel} and ${weather.condition} outside. The temperature is ${Math.round(weather.temperature)} degrees Celsius.`
    : weatherState === 'denied'
      ? 'Location is off, so I will skip the weather for today.'
      : 'I could not read the local weather right now.';
  const notices = notificationSentence(summary);
  const campus = campusSentence(summary, user?.affiliations);
  const hasCampus = !!(user?.affiliations?.length);
  const speechSegments = useMemo(() => [
    `${period}, ${firstName}.`,
    weatherSentence,
    notices,
    ...(campus ? [campus] : []),
    "Let's find the plus ones.",
  ], [period, firstName, weatherSentence, notices, campus]);

  const schedule = (fn, delay) => {
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      fn();
    }, delay);
    timers.current.add(timer);
    return timer;
  };

  const close = () => {
    sequenceId.current += 1;
    timers.current.forEach(clearTimeout);
    timers.current.clear();
    Speech.stop();
    setTalking(false);
    setFinished(false);
    setVisible(false);
  };

  /** Phase 2 handoff: after the last spoken line, jump straight to the
   *  Colleagues tab where "Today at your place" lives (who's around, today's
   *  place posts) — instead of dropping the user back wherever they were. */
  const seeToday = () => {
    close();
    routeFromNotification({ route: 'colleagues' });
  };

  const speakAutomatically = async () => {
    const run = ++sequenceId.current;
    Speech.stop();
    await setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: 'duckOthers',
      allowsRecording: false,
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false,
    }).catch(() => {});
    const voice = await Promise.race([
      preferredFemaleVoice(),
      new Promise((resolve) => setTimeout(() => resolve(null), 900)),
    ]);
    if (run !== sequenceId.current) return;
    let index = 0;

    const next = () => {
      if (run !== sequenceId.current) return;
      if (index >= speechSegments.length) {
        setTalking(false);
        // With places on the profile, the greeting now HOLDS on the last line
        // and offers the one-tap handoff into "Today at your place" instead
        // of auto-dismissing into nothing.
        if (hasCampus) setFinished(true);
        else schedule(close, 850);
        return;
      }

      const segment = speechSegments[index];
      setSpokenLine(segment);
      setTalking(true);
      let finished = false;
      let safetyTimer;
      const complete = () => {
        if (finished || run !== sequenceId.current) return;
        finished = true;
        if (safetyTimer) {
          clearTimeout(safetyTimer);
          timers.current.delete(safetyTimer);
        }
        index += 1;
        schedule(next, 130);
      };

      // Some web/device voices fail to fire onDone. Continue and close the
      // greeting automatically instead of leaving a frozen overlay.
      safetyTimer = schedule(() => {
        Speech.stop();
        complete();
      }, Math.max(2400, segment.length * 78));

      try {
        if (Platform.OS === 'web' && typeof window !== 'undefined' && window.speechSynthesis) {
          const utterance = new window.SpeechSynthesisUtterance(segment);
          const browserVoices = window.speechSynthesis.getVoices?.() || [];
          const selected = browserVoices.find((item) => item.voiceURI === voice?.identifier);
          if (selected) utterance.voice = selected;
          utterance.lang = voice?.language || 'en-IN';
          utterance.rate = 0.9;
          utterance.pitch = 1.12;
          utterance.onstart = () => { if (run === sequenceId.current) setTalking(true); };
          utterance.onend = complete;
          utterance.onerror = complete;
          window.speechSynthesis.speak(utterance);
        } else {
          Speech.speak(segment, {
            voice: voice?.identifier,
            language: voice?.language || 'en-IN',
            rate: 0.9,
            pitch: 1.16,
            onStart: () => { if (run === sequenceId.current) setTalking(true); },
            onDone: complete,
            onStopped: complete,
            onError: complete,
          });
        }
      } catch {
        complete();
      }
    };

    next();
  };

  useEffect(() => {
    if (!visible || loading || started.current) return undefined;
    started.current = true;
    const timer = schedule(speakAutomatically, 480);
    return () => {
      clearTimeout(timer);
      timers.current.delete(timer);
    };
  }, [visible, loading, speechSegments]);

  if (!user || !visible) return null;

  const stageTop = Math.max(insets.top + 112, height * 0.15);
  const stageBottom = Math.max(insets.bottom + 78, height * 0.09);
  const compactWeather = weather
    ? `${Math.round(weather.temperature)}°C · ${weather.condition}`
    : loading ? 'Reading local weather…' : 'Weather unavailable';
  const signalLabel = summary.total
    ? `${summary.total} new signal${summary.total === 1 ? '' : 's'}`
    : 'All caught up';

  return (
    <Modal visible animationType="fade" onRequestClose={close}>
      <View style={styles.root}>
        <GreeterBackdrop />

        {/* Original GLB animation stays isolated in its own stage. */}
        <View style={[styles.characterLayer, { top: stageTop, bottom: stageBottom }]}>
          <ModelBoundary theme={theme}>
            <AIGreeterModel horizontalOffset={0} style={styles.model} />
          </ModelBoundary>
        </View>

        {/* Foreground greeting layer — always above, never across face/arms. */}
        <View style={[styles.headerLayer, { paddingTop: Math.max(insets.top, 14) }]}>
          <Text style={styles.brand}>+ONE</Text>
          <Pressable accessibilityLabel="Skip greeting" onPress={close} hitSlop={8} style={[styles.closeButton, { top: Math.max(insets.top, 14) }]}>
            <Icon name="close" size={19} color="#f4f0ef" />
          </Pressable>
          <Text style={[styles.greeting, isTablet && styles.greetingWide]}>{period},</Text>
          <View style={styles.nameRow}>
            <Text style={[styles.name, isTablet && styles.nameWide]}>{firstName}</Text>
            <Emoji char="👋" size={isTablet ? 25 : 21} />
          </View>
        </View>

        {/* Compact glass-style speech surface near the bottom. */}
        <View style={[styles.speechLayer, { paddingBottom: Math.max(insets.bottom + 14, 20) }]}>
          <View style={[styles.speechCard, { width: Math.min(width - 28, 580) }]}>
            <Text style={styles.speechText}>{spokenLine}</Text>
            {/* One-tap handoff: appears once the greeting finishes speaking.
                Segment safety timers guarantee `finished` is reached even if
                TTS is unavailable, so the handoff can never be missed. */}
            {hasCampus && finished && (
              <Pressable accessibilityRole="button" accessibilityLabel="See today at your place" onPress={seeToday} style={({ pressed }) => [styles.handoffButton, pressed && { opacity: 0.7 }]}>
                <Icon name="albums-outline" size={15} color="#f4f0ef" />
                <Text style={styles.handoffText}>SEE TODAY AT YOUR COLLEGE</Text>
                <Icon name="arrow-forward" size={14} color="#f4f0ef" />
              </Pressable>
            )}
            <View style={styles.metaRow}>
              <View style={styles.metaItem}>
                <Icon name={weather ? 'sunny-outline' : 'compass-outline'} size={14} color="#c8c6c5" />
                <Text style={styles.metaText}>{compactWeather}</Text>
              </View>
              <View style={styles.metaDivider} />
              <View style={styles.metaItem}>
                <Icon name="notifications-outline" size={14} color="#c8c6c5" />
                <Text style={styles.metaText}>{signalLabel}</Text>
              </View>
            </View>
            <SpeakingIndicator visible={talking} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden', backgroundColor: '#131313' },
  characterLayer: {
    position: 'absolute', left: 0, right: 0, zIndex: 1,
    pointerEvents: 'none',
  },
  model: { width: '100%', height: '100%' },
  headerLayer: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
    alignItems: 'center', paddingHorizontal: 24,
  },
  brand: {
    ...type.labelSm, color: '#a8a5a4', letterSpacing: 3.2,
    marginTop: 4,
  },
  closeButton: {
    position: 'absolute', right: 18, top: 14,
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(244,240,239,0.08)',
    borderWidth: 1, borderColor: 'rgba(244,240,239,0.16)',
  },
  greeting: {
    ...type.headlineMd, color: '#f4f0ef', fontSize: 24,
    lineHeight: 28, marginTop: 17,
  },
  greetingWide: { fontSize: 28, lineHeight: 32 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 1 },
  name: {
    ...type.headlineLg, color: '#ffffff', fontSize: 31,
    lineHeight: 35, letterSpacing: -0.7,
  },
  nameWide: { fontSize: 38, lineHeight: 42 },
  speechLayer: {
    position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 20,
    alignItems: 'center', paddingHorizontal: 14,
  },
  speechCard: {
    borderRadius: 18, paddingHorizontal: 18, paddingVertical: 15,
    backgroundColor: 'rgba(31,31,30,0.88)',
    borderWidth: 1, borderColor: 'rgba(244,240,239,0.15)',
    shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 }, elevation: 7,
  },
  speechText: {
    ...type.bodyMd, color: '#f4f0ef', fontSize: 15,
    lineHeight: 21, textAlign: 'center',
  },
  handoffButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    alignSelf: 'center', marginTop: 14,
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999,
    backgroundColor: 'rgba(244,240,239,0.12)',
    borderWidth: 1, borderColor: 'rgba(244,240,239,0.34)',
  },
  handoffText: {
    ...type.labelSm, color: '#f4f0ef', letterSpacing: 1.1,
  },
  metaRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    flexWrap: 'wrap', gap: 9, marginTop: 10,
  },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { ...type.labelXs, color: '#a8a5a4', fontSize: 9 },
  metaDivider: { width: 1, height: 13, backgroundColor: 'rgba(244,240,239,0.16)' },
  speakingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 11 },
  dotRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  speakingDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#f4f0ef' },
  speakingLabel: { ...type.labelXs, color: '#c8c6c5', letterSpacing: 1.1 },
  modelFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
