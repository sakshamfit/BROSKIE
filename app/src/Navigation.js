import React, { useState, useRef, useEffect } from 'react';
import { View, Pressable, StyleSheet, Platform, Animated } from 'react-native';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from './icons/Icon';

import { useAuth } from './store/AuthContext';
import { useTheme } from './store/ThemeContext';
import { useChat } from './store/ChatContext';
import useResponsive from './hooks/useResponsive';
import { Loading, CountBead } from './components/common';
import { marker, stroke } from './theme';
import { haptic, usePressScale } from './motion';
import { lazyScreen, lazyComponent, idlePreload } from './lazy';
import PageSwipePager from './components/PageSwipePager';
import { navigationRef, onHomeTabRequest, flushPendingRoute } from './push/routing';
import { setupDeepLinks } from './push/links';

const SplitLayout = lazyComponent(() => import('./DesktopLayout'), { label: 'Desktop' });

const AuthScreen = lazyScreen(() => import('./screens/AuthScreen'), { label: 'Sign In' });
const ChatListScreen = lazyScreen(() => import('./screens/ChatListScreen'), { label: 'Chats' });
const ConversationScreen = lazyScreen(() => import('./screens/ConversationScreen'), { label: 'Conversation' });
const NewChatScreen = lazyScreen(() => import('./screens/NewChatScreen'), { label: 'New Chat' });
const StatusScreen = lazyScreen(() => import('./screens/StatusScreen'), { label: 'See' });
const NetworkScreen = lazyScreen(() => import('./screens/NetworkScreen'), { label: 'Network' });
const ColleaguesScreen = lazyScreen(() => import('./screens/ColleaguesScreen'), { label: 'Colleagues' });
const SettingsScreen = lazyScreen(() => import('./screens/SettingsScreen'), { label: 'Settings' });
const ChatInfoScreen = lazyScreen(() => import('./screens/ChatInfoScreen'), { label: 'Chat Info' });
const PersonalInfoScreen = lazyScreen(() => import('./screens/PersonalInfoScreen'), { label: 'Personal Info' });
const SecurityScreen = lazyScreen(() => import('./screens/SecurityScreen'), { label: 'Security' });
const AppearanceScreen = lazyScreen(() => import('./screens/AppearanceScreen'), { label: 'Appearance' });
const NotificationsScreen = lazyScreen(() => import('./screens/NotificationsScreen'), { label: 'Notifications' });
const ActivityScreen = lazyScreen(() => import('./screens/ActivityScreen'), { label: 'Activity' });
const PrivacyScreen = lazyScreen(() => import('./screens/PrivacyScreen'), { label: 'Privacy' });
const BlockedUsersScreen = lazyScreen(() => import('./screens/BlockedUsersScreen'), { label: 'Blocked Contacts' });
const HelpScreen = lazyScreen(() => import('./screens/HelpScreen'), { label: 'Help' });
const CallsScreen = lazyScreen(() => import('./screens/CallsScreen'), { label: 'Calls' });
const StarredMessagesScreen = lazyScreen(() => import('./screens/StarredMessagesScreen'), { label: 'Starred' });
const AdminSafetyScreen = lazyScreen(() => import('./screens/AdminSafetyScreen'), { label: 'Safety & Reports' });
const UserProfileScreen = lazyScreen(() => import('./screens/UserProfileScreen'), { label: 'User Profile' });
const PostDetailScreen = lazyScreen(() => import('./screens/PostDetailScreen'), { label: 'Post Detail' });

const Stack = createNativeStackNavigator();

/** Floating tab bar — bottom nav for phones (and tablets in portrait narrower than split). */
function HomeTabs({ navigation }) {
  const { theme } = useTheme();
  const { chats } = useChat();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState('network');
  const unread = chats.reduce((n, c) => n + (c.archived ? 0 : c.unread), 0);
  const s = makeStyles(theme);

  // Feed first, chat in the centre: Network → See → Chats → Colleagues →
  // Settings. Page-swipe navigation follows THIS order — the existing tab
  // architecture — and covers the four in-tab sections. Settings stays a
  // pushed stack screen, so it is not part of the swipe strip.
  const TABS = [
    { key: 'network', label: 'Network', icon: 'people' },
    { key: 'status', label: 'See', icon: 'eye' },
    { key: 'chats', label: 'Chats', icon: 'chatbubble', badge: unread },
    { key: 'colleagues', label: 'Colleagues', icon: 'school-outline', outlineOnly: true },
    { key: 'settings', label: 'Settings', icon: 'settings' },
  ];
  const PAGES = TABS.slice(0, 4);
  const pageIndex = Math.max(0, PAGES.findIndex((p) => p.key === tab));

  // The pager feeds this value during a drag so the tab bar responds while
  // the finger moves (−1 → next page, +1 → previous). Animated only — the
  // tab bar updates at 60fps without re-rendering the page strip.
  const swipeProgress = useRef(new Animated.Value(0)).current;

  const openChat = (chatId) => { setTab('chats'); navigation.navigate('Conversation', { chatId }); };

  // Push deep links can target a Home page (e.g. a colleague request routes
  // to the Colleagues tab). Tab state lives here, not in navigation state,
  // so routing.js asks via this subscription.
  useEffect(() => onHomeTabRequest((requested) => {
    if (PAGES.some((p) => p.key === requested) && requested !== tab) setTab(requested);
  }), [tab]);

  useEffect(() => {
    idlePreload(() => import('./screens/ConversationScreen'));
    idlePreload(() => import('./screens/SettingsScreen'));
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.bg }}>
        {/* Finger-driven page navigation. The active section and its two
            neighbours stay mounted, so a swipe reveals the next page already
            rendered — the whole page tracks the finger, then settles with a
            spring (or returns) on release. The bottom tab bar below stays in
            sync: navigation state commits only when the gesture completes. */}
        <PageSwipePager
          pages={PAGES.map((p) => ({
            key: p.key,
            render: () => {
              if (p.key === 'chats') return <ChatListScreen navigation={navigation} />;
              if (p.key === 'network') return <NetworkScreen navigation={navigation} onOpenChat={openChat} />;
              if (p.key === 'colleagues') return <ColleaguesScreen onOpenChat={openChat} />;
              return <StatusScreen navigation={navigation} />;
            },
          }))}
          index={pageIndex}
          onIndexChange={(i) => setTab(PAGES[i].key)}
          progress={swipeProgress}
        />
      </SafeAreaView>

      {/* SafeAreaView only pads the notch/home-indicator; the bar itself owns its own padding
          so short-device landscape (home indicator on the SIDE) doesn't eat the bar's height. */}
      <SafeAreaView edges={['bottom', 'left', 'right']} style={{ backgroundColor: 'transparent' }}>
        <View
          style={[
            s.tabBar,
            {
              backgroundColor: theme.bg, borderTopWidth: stroke.ink, borderTopColor: theme.ink,
              paddingBottom: Math.max(insets.bottom > 0 ? 6 : 10, 6),
            },
          ]}
        >
          {TABS.map((t) => {
            const active = tab === t.key;
            // How far this tab sits from the current page (−1/0/+1). The
            // settings tab is a pushed screen, outside the swipe strip.
            const rel = t.key === 'settings' ? null : PAGES.findIndex((p) => p.key === t.key) - pageIndex;
            return (
              <TabButton
                key={t.key}
                label={t.label}
                active={active}
                onPress={() => {
                  if (t.key === 'settings') { haptic('selection'); navigation.navigate('Settings'); return; }
                  if (!active) haptic('selection'); // acknowledge the switch, not every tap
                  setTab(t.key);
                }}
                icon={t.outlineOnly ? t.icon : active ? t.icon : `${t.icon}-outline`}
                color={active ? theme.ink : theme.muted}
                badge={t.badge}
                theme={theme}
                progress={swipeProgress}
                rel={rel}
              />
            );
          })}
        </View>
      </SafeAreaView>
    </View>
  );
}

/**
 * Bottom-tab item with physical press feedback: the icon scales down while
 * pressed, springs back on release, and the icon pops (outline → filled)
 * only when the tab becomes active — leaving a tab never re-pops it.
 *
 * While a page swipe is in progress the tab bar responds to the finger:
 * the outgoing tab's icon eases down, the incoming tab's icon rises, driven
 * by the pager's shared Animated progress (no re-renders, 60fps).
 */
function TabButton({ label, active, onPress, icon, color, badge, theme, progress, rel }) {
  const { scale, onPressIn, onPressOut } = usePressScale(0.9);
  const activePop = useRef(new Animated.Value(active ? 1 : 0)).current;
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) {
      wasActive.current = true;
      Animated.sequence([
        Animated.spring(activePop, { toValue: 1.18, friction: 4, tension: 200, useNativeDriver: true }),
        Animated.spring(activePop, { toValue: 1, friction: 6, tension: 180, useNativeDriver: true }),
      ]).start();
    } else if (!active) {
      wasActive.current = false;
      activePop.setValue(1);
    }
  }, [active, activePop]);
  // Swipe feedback, relative to this tab's position in the page strip.
  // rel = 0 (current): ease down as the finger pulls either way.
  // rel = ±1 (neighbours): ease up as the finger pulls toward them.
  const swipeScale = progress && rel !== null
    ? progress.interpolate({
        inputRange: [-1, 0, 1],
        outputRange: rel === 1 ? [1.1, 1, 1] : rel === -1 ? [1, 1, 1.1] : [0.9, 1, 0.9],
        extrapolate: 'clamp',
      })
    : 1;
  const swipeOpacity = progress && rel === 0
    ? progress.interpolate({
        inputRange: [-1, 0, 1],
        outputRange: [0.82, 1, 0.82],
        extrapolate: 'clamp',
      })
    : 1;
  const s = makeStyles(theme);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      hitSlop={6}
      android_ripple={{ color: theme.ripple, borderless: false, radius: 42 }}
      style={({ pressed }) => [
        s.tabItem,
        active ? [s.tabActive, { backgroundColor: theme.tabActiveBg, borderColor: theme.ink }] : null,
        Platform.OS === 'ios' && pressed && !active ? marker(theme, 1) : null,
      ]}
    >
      <Animated.View style={{ transform: [{ scale }, { scale: activePop }, { scale: swipeScale }], opacity: swipeOpacity }}>
        <View>
          <Icon name={icon} size={23} color={color} />
          {!!badge && badge > 0 && (
            <View style={s.tabBadge}>
              <CountBead label={badge > 9 ? '9+' : String(badge)} small />
            </View>
          )}
        </View>
      </Animated.View>
    </Pressable>
  );
}

export default function Navigation() {
  const { user, booting } = useAuth();
  const { theme, mode } = useTheme();
  const { isSplitCapable } = useResponsive();

  // Incoming links: plusone:// routes natively, and https://…/c/<code>
  // community invites on the web (they join first, then open the detail).
  useEffect(() => {
    if (!user) return undefined;
    return setupDeepLinks();
  }, [user?.id]);

  if (booting) return <Loading label="STARTING +ONE" />;

  // Wide web viewports AND tablets (in either orientation, once there's
  // enough width) get the persistent sidebar + master/detail split.
  // Phones — iOS and Android, portrait or landscape — always get the
  // bottom-tab flow below, matching native messaging-app conventions.
  if (user && isSplitCapable) {
    return <SplitLayout />;
  }

  const navTheme = {
    ...(mode === 'dark' || mode === 'kinetic' ? DarkTheme : DefaultTheme),
    colors: {
      ...(mode === 'dark' || mode === 'kinetic' ? DarkTheme : DefaultTheme).colors,
      background: theme.bg,
      card: theme.card,
      text: theme.text,
      border: 'transparent',
      primary: theme.primary,
    },
  };

  return (
    <NavigationContainer
      ref={navigationRef}
      onStateChange={flushPendingRoute}
      theme={navTheme}
    >
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          animation: Platform.OS === 'web' ? 'none' : 'default',
          contentStyle: { backgroundColor: theme.bg },
          // iOS: native swipe-back gesture; Android: system back button already works.
          gestureEnabled: Platform.OS === 'ios',
          fullScreenGestureEnabled: Platform.OS === 'ios',
        }}
      >
        {!user ? (
          <Stack.Screen name="Auth" component={AuthScreen} />
        ) : (
          <>
            <Stack.Screen name="Home" component={HomeTabs} />
            <Stack.Screen name="Activity" component={ActivityScreen} />
            <Stack.Screen name="UserProfile" component={UserProfileScreen} />
            <Stack.Screen name="PostDetail" component={PostDetailScreen} />
            <Stack.Screen name="Conversation" component={ConversationScreen} />
            <Stack.Screen name="NewChat" component={NewChatScreen} />
            <Stack.Screen name="ChatInfo" component={ChatInfoScreen} />
            <Stack.Screen name="Starred" component={StarredMessagesScreen} />
            <Stack.Screen name="Calls" component={CallsScreen} />
            <Stack.Screen name="Settings" component={SettingsScreen} />
            <Stack.Screen name="PersonalInfo" component={PersonalInfoScreen} />
            <Stack.Screen name="Security" component={SecurityScreen} />
            <Stack.Screen name="Appearance" component={AppearanceScreen} />
            <Stack.Screen name="Notifications" component={NotificationsScreen} />
            <Stack.Screen name="Privacy" component={PrivacyScreen} />
            <Stack.Screen name="BlockedUsers" component={BlockedUsersScreen} />
            <Stack.Screen name="Help" component={HelpScreen} />
            <Stack.Screen name="AdminSafety" component={AdminSafetyScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const makeStyles = (t) => StyleSheet.create({
  tabBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    paddingTop: 8, paddingHorizontal: 14,
  },
  tabItem: {
    flex: 1, minWidth: 0, maxWidth: 58, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 10, marginHorizontal: 3, minHeight: 46, borderRadius: 999,
  },
  tabActive: { borderWidth: 1, borderRadius: 999 },
  tabBadge: { position: 'absolute', right: -11, top: -7 },
});
