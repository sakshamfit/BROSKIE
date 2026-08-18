import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from './icons/Icon';

import { useAuth } from './store/AuthContext';
import { useTheme } from './store/ThemeContext';
import { useChat } from './store/ChatContext';
import useResponsive from './hooks/useResponsive';
import { Loading, CountBead } from './components/common';
import { type, marker, stroke } from './theme';
import SplitLayout from './DesktopLayout';

import AuthScreen from './screens/AuthScreen';
import ChatListScreen from './screens/ChatListScreen';
import ConversationScreen from './screens/ConversationScreen';
import NewChatScreen from './screens/NewChatScreen';
import StatusScreen from './screens/StatusScreen';
import NetworkScreen from './screens/NetworkScreen';
import SettingsScreen from './screens/SettingsScreen';
import ChatInfoScreen from './screens/ChatInfoScreen';
import PersonalInfoScreen from './screens/PersonalInfoScreen';
import SecurityScreen from './screens/SecurityScreen';
import AppearanceScreen from './screens/AppearanceScreen';
import NotificationsScreen from './screens/NotificationsScreen';
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
  const [tab, setTab] = useState('chats');
  const unread = chats.reduce((n, c) => n + (c.archived ? 0 : c.unread), 0);
  const s = makeStyles(theme);

  const TABS = [
    { key: 'chats', label: 'Chats', icon: 'chatbubble', badge: unread },
    { key: 'status', label: 'See', icon: 'eye' },
    { key: 'network', label: 'Network', icon: 'people' },
    { key: 'calls', label: 'Calls', icon: 'call' },
    { key: 'settings', label: 'Settings', icon: 'settings' },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.bg }}>
        {tab === 'chats' && <ChatListScreen navigation={navigation} />}
        {tab === 'network' && (
          <NetworkScreen
            navigation={navigation}
            onOpenChat={(chatId) => { setTab('chats'); navigation.navigate('Conversation', { chatId }); }}
          />
        )}
        {tab === 'status' && <StatusScreen navigation={navigation} />}
        {tab === 'calls' && <CallsScreen navigation={navigation} />}
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
              <Pressable
                key={t.key}
                onPress={() => (t.key === 'settings' ? navigation.navigate('Settings') : setTab(t.key))}
                hitSlop={6}
                android_ripple={{ color: theme.ripple, borderless: false, radius: 42 }}
                style={({ pressed }) => [
                  s.tabItem,
                  active ? [s.tabActive, { backgroundColor: theme.tabActiveBg, borderColor: theme.ink }] : null,
                  Platform.OS === 'ios' && pressed && !active ? marker(theme, 1) : null,
                ]}
              >
                <View>
                  <Icon
                    name={active ? t.icon : `${t.icon}-outline`}
                    size={20}
                    color={active ? theme.ink : theme.muted}
                  />
                  {!!t.badge && t.badge > 0 && (
                    <View style={s.tabBadge}>
                      <CountBead label={t.badge > 9 ? '9+' : String(t.badge)} small />
                    </View>
                  )}
                </View>
                <Text style={[type.labelXs, { color: active ? theme.ink : theme.muted }]}>
                  {t.label.toUpperCase()}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </SafeAreaView>
    </View>
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
            <Stack.Screen name="Conversation" component={ConversationScreen} />
            <Stack.Screen name="NewChat" component={NewChatScreen} />
            <Stack.Screen name="ChatInfo" component={ChatInfoScreen} />
            <Stack.Screen name="Starred" component={StarredMessagesScreen} />
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
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 10, paddingHorizontal: 12,
  },
  tabItem: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 5,
    paddingVertical: 8, marginHorizontal: 5, minHeight: 44, borderRadius: 999,
  },
  tabActive: { borderWidth: 1, borderRadius: 999 },
  tabBadge: { position: 'absolute', right: -11, top: -7 },
});
