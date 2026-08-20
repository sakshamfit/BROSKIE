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
import { FadeSlide, haptic, motion, usePressScale } from './motion';
import SplitLayout from './DesktopLayout';

import AuthScreen from './screens/AuthScreen';
import ChatListScreen from './screens/ChatListScreen';
import ConversationScreen from './screens/ConversationScreen';
import NewChatScreen from './screens/NewChatScreen';
import StatusScreen from './screens/StatusScreen';
import NetworkScreen from './screens/NetworkScreen';
import ColleaguesScreen from './screens/ColleaguesScreen';
import SettingsScreen from './screens/SettingsScreen';
import ChatInfoScreen from './screens/ChatInfoScreen';
import PersonalInfoScreen from './screens/PersonalInfoScreen';
import SecurityScreen from './screens/SecurityScreen';
import AppearanceScreen from './screens/AppearanceScreen';
import NotificationsScreen from './screens/NotificationsScreen';
import ActivityScreen from './screens/ActivityScreen';
import PrivacyScreen from './screens/PrivacyScreen';
import BlockedUsersScreen from './screens/BlockedUsersScreen';
import HelpScreen from './screens/HelpScreen';
import CallsScreen from './screens/CallsScreen';
import StarredMessagesScreen from './screens/StarredMessagesScreen';

const Stack = createNativeStackNavigator();

/** Floating tab bar — bottom nav for phones (and tablets in portrait narrower than split). */
function HomeTabs({ navigation }) {
  const { theme } = useTheme();
  const { chats } = useChat();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState('network');
  const unread = chats.reduce((n, c) => n + (c.archived ? 0 : c.unread), 0);
  const s = makeStyles(theme);

  // Feed first, chat in the centre: Network → See → Chats → Colleagues → Settings.
  const TABS = [
    { key: 'network', label: 'Network', icon: 'people' },
    { key: 'status', label: 'See', icon: 'eye' },
    { key: 'chats', label: 'Chats', icon: 'chatbubble', badge: unread },
    { key: 'colleagues', label: 'Colleagues', icon: 'school-outline', outlineOnly: true },
    { key: 'settings', label: 'Settings', icon: 'settings' },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.bg }}>
        {/* Each section enters with a soft fade + drift, so switching tabs
            feels like moving through one continuous app, not separate pages.
            Keyed by tab: only the active section mounts, so no re-animation
            churn. Direction hints come from the tab's position. */}
        {tab === 'chats' && (
          <FadeSlide key="tab-chats" from="up" distance={10} duration={motion.normal} style={{ flex: 1 }}>
            <ChatListScreen navigation={navigation} />
          </FadeSlide>
        )}
        {tab === 'network' && (
          <FadeSlide key="tab-network" from="left" distance={14} duration={motion.normal} style={{ flex: 1 }}>
            <NetworkScreen
              navigation={navigation}
              onOpenChat={(chatId) => { setTab('chats'); navigation.navigate('Conversation', { chatId }); }}
            />
          </FadeSlide>
        )}
        {tab === 'colleagues' && (
          <FadeSlide key="tab-colleagues" from="right" distance={14} duration={motion.normal} style={{ flex: 1 }}>
            <ColleaguesScreen
              onOpenChat={(chatId) => { setTab('chats'); navigation.navigate('Conversation', { chatId }); }}
            />
          </FadeSlide>
        )}
        {tab === 'status' && (
          <FadeSlide key="tab-status" from="right" distance={14} duration={motion.normal} style={{ flex: 1 }}>
            <StatusScreen navigation={navigation} />
          </FadeSlide>
        )}
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
 */
function TabButton({ label, active, onPress, icon, color, badge, theme }) {
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
      <Animated.View style={{ transform: [{ scale }, { scale: activePop }] }}>
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
    <NavigationContainer theme={navTheme}>
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
