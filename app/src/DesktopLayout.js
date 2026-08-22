import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, BackHandler, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from './icons/Icon';
import SideNav from './components/SideNav';
import { useTheme } from './store/ThemeContext';
import { useAuth } from './store/AuthContext';
import { useChat } from './store/ChatContext';
import useResponsive from './hooks/useResponsive';
import { FrostedBackdrop } from './components/common';
import { type, inkBox, stroke, raised } from './theme';
import { lazyScreen, lazyComponent, idlePreload } from './lazy';
import { onOpenProfileRequest, onOpenPostRequest } from './push/routing';

const ChatListScreen = lazyScreen(() => import('./screens/ChatListScreen'), { label: 'Chats' });
const ConversationScreen = lazyScreen(() => import('./screens/ConversationScreen'), { label: 'Conversation' });
const NewChatScreen = lazyScreen(() => import('./screens/NewChatScreen'), { label: 'New Chat' });
const SettingsScreen = lazyScreen(() => import('./screens/SettingsScreen'), { label: 'Settings' });
const ChatInfoScreen = lazyScreen(() => import('./screens/ChatInfoScreen'), { label: 'Chat Info' });
const NetworkScreen = lazyScreen(() => import('./screens/NetworkScreen'), { label: 'Network' });
const ColleaguesScreen = lazyScreen(() => import('./screens/ColleaguesScreen'), { label: 'Colleagues' });
const StatusScreen = lazyScreen(() => import('./screens/StatusScreen'), { label: 'See' });
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

/**
 * Split shell for wide viewports — desktop web AND real tablets/foldables
 * (iPad, Android tablets, unfolded foldables) once there's enough width in
 * either orientation: persistent sidebar + Inbox column + chat canvas,
 * matching the "Graphite & Pulp" web mockup. Screens are unchanged; they're
 * driven by a tiny navigation shim so the exact same components work
 * full-screen on phones and split-pane here.
 */
export default function SplitLayout() {
  const { theme } = useTheme();
  const { logout } = useAuth();
  const { chats } = useChat();
  const { insets, isWeb } = useResponsive();
  const [tab, setTab] = useState('network');
  const [selectedChatId, setSelectedChatId] = useState(null);
  const [overlay, setOverlay] = useState(null); // { name, params }

  // On native tablets the sidebar sits inside the device's safe area
  // (status bar / notch / home indicator); web ignores this (insets are 0).
  const s = makeStyles(theme, insets, isWeb);

  // Navigation stays icon-only at every desktop/tablet width: the destination
  // names remain available to screen readers via accessibility labels.

  const openOverlay = (name, params) => setOverlay({ name, params });
  const closeOverlay = () => setOverlay(null);

  // Tapping an avatar circle (or a "liked your post" activity row) anywhere
  // in the split shell opens the profile / post as an overlay panel — the
  // phone flow pushes real stack screens instead (see push/routing.js).
  useEffect(() => onOpenProfileRequest((userId) => setOverlay({ name: 'UserProfile', params: { userId } })), []);
  useEffect(() => onOpenPostRequest((postId) => setOverlay({ name: 'PostDetail', params: { postId } })), []);

  // Settings is a full-screen top-level section here (like Chats/See/
  // Network) — NOT a popup — with its own little navigation stack for the
  // Personal Information / Security / Privacy / Notifications / Appearance
  // / Blocked Contacts drill-downs.
  const SETTINGS_SUBSCREENS = ['PersonalInfo', 'Security', 'Privacy', 'Notifications', 'Appearance', 'BlockedUsers', 'Starred', 'AdminSafety'];
  const [settingsSub, setSettingsSub] = useState(null);

  const settingsNav = {
    navigate: (name) => {
      if (name === 'Help') { openOverlay('Help'); return; }
      if (SETTINGS_SUBSCREENS.includes(name)) setSettingsSub(name);
    },
    goBack: () => (settingsSub ? setSettingsSub(null) : setTab('network')),
    replace: () => {},
  };

  // Starred lives in Settings; tapping a starred message jumps straight to
  // the conversation in the main split pane.
  const starredNav = {
    navigate: (name, params) => {
      if (name === 'Conversation') { setSelectedChatId(params.chatId); setTab('chats'); setSettingsSub(null); }
    },
    goBack: () => setSettingsSub(null),
    replace: () => {},
  };

  // Privacy screen navigates one level deeper into Blocked Contacts; that
  // screen's own back button should return to Privacy, not to Settings.
  const privacyNav = {
    navigate: (name) => { if (name === 'BlockedUsers') setSettingsSub('BlockedUsers'); },
    goBack: () => setSettingsSub(null),
    replace: () => {},
  };
  const blockedUsersNav = {
    navigate: () => {},
    goBack: () => setSettingsSub('Privacy'),
    replace: () => {},
  };

  const listNav = {
    navigate: (name, params) => {
      if (name === 'Conversation') setSelectedChatId(params.chatId);
      else if (name === 'Settings') { setSettingsSub(null); setTab('settings'); }
      else if (name === 'NewChat') openOverlay('NewChat');
      else if (name === 'Activity') openOverlay('Activity');
    },
    goBack: () => {},
    replace(name, params) { this.navigate(name, params); },
  };

  const convNav = {
    navigate: (name, params) => {
      if (name === 'ChatInfo') openOverlay('ChatInfo', params);
    },
    goBack: () => setSelectedChatId(null),
    replace: () => {},
  };

  const overlayNav = {
    navigate: (name, params) => {
      if (name === 'Conversation') { setSelectedChatId(params.chatId); closeOverlay(); setTab('chats'); }
      else openOverlay(name, params);
    },
    goBack: closeOverlay,
    replace: (name, params) => {
      if (name === 'Conversation') { setSelectedChatId(params.chatId); closeOverlay(); setTab('chats'); }
    },
  };

  const selectedChat = chats.find((c) => c.id === selectedChatId);

  // Android hardware back: close whatever is on top instead of exiting the
  // app (matches how the native stack navigator behaves on phones).
  useEffect(() => {
    idlePreload(() => import('./screens/ConversationScreen'));
    idlePreload(() => import('./screens/SettingsScreen'));
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (overlay) {
        closeOverlay();
        return true;
      }
      if (tab === 'settings' && settingsSub === 'BlockedUsers') {
        setSettingsSub('Privacy');
        return true;
      }
      if (tab === 'settings' && settingsSub) {
        setSettingsSub(null);
        return true;
      }
      if (tab === 'settings') {
        setTab('network');
        return true;
      }
      if (selectedChatId) {
        setSelectedChatId(null);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [overlay, tab, settingsSub, selectedChatId]);

  return (
    <View style={[s.root, { backgroundColor: theme.bg }]}>
      <SideNav
        active={tab}
        railOnly={true}
        onNavigate={(key) => {
          if (key === 'activity') { openOverlay('Activity'); return; }
          setSettingsSub(null);
          setTab(key);
        }}
        onNewChat={() => openOverlay('NewChat')}
        onSettings={() => { setSettingsSub(null); setTab('settings'); }}
        onHelp={() => openOverlay('Help')}
        onOpenProfile={(userId) => userId && openOverlay('UserProfile', { userId })}
        onLogout={logout}
      />

      <View style={s.main}>
        {tab === 'chats' && (
          <>
            <View style={[s.listPane, { borderRightColor: theme.graphiteLine }]}>
              <ChatListScreen navigation={listNav} embedded />
            </View>
            <View style={s.detailPane}>
              {selectedChat ? (
                <ConversationScreen
                  navigation={convNav}
                  route={{ params: { chatId: selectedChatId } }}
                  embedded
                />
              ) : (
                <EmptyDetail />
              )}
            </View>
          </>
        )}

        {tab === 'status' && (
          <View style={s.fullPane}>
            <StatusScreen />
          </View>
        )}

        {tab === 'network' && (
          <View style={[s.fullPane, s.centeredPane]}>
            <NetworkScreen
              navigation={{
                navigate: (name) => { if (name === 'Activity') openOverlay('Activity'); },
                goBack: () => {},
              }}
              onOpenChat={(chatId) => { setTab('chats'); setSelectedChatId(chatId); }}
            />
          </View>
        )}

        {tab === 'colleagues' && (
          <View style={[s.fullPane, s.centeredPane]}>
            <ColleaguesScreen
              onOpenChat={(chatId) => { setTab('chats'); setSelectedChatId(chatId); }}
            />
          </View>
        )}

        {tab === 'calls' && (
          <View style={[s.fullPane, s.centeredPane]}>
            <CallsScreen embedded />
          </View>
        )}

        {/* Settings is a full-screen section, same as Chats/See/Network —
            not a centered popup — matching the mockup's own full-page layout. */}
        {tab === 'settings' && (
          <View style={s.fullPane}>
            {settingsSub === 'PersonalInfo' && <PersonalInfoScreen navigation={settingsNav} embedded />}
            {settingsSub === 'Security' && <SecurityScreen navigation={settingsNav} embedded />}
            {settingsSub === 'Privacy' && <PrivacyScreen navigation={privacyNav} embedded />}
            {settingsSub === 'BlockedUsers' && <BlockedUsersScreen navigation={blockedUsersNav} embedded />}
            {settingsSub === 'Notifications' && <NotificationsScreen navigation={settingsNav} embedded />}
            {settingsSub === 'Appearance' && <AppearanceScreen navigation={settingsNav} embedded />}
            {settingsSub === 'Starred' && <StarredMessagesScreen navigation={starredNav} embedded />}
            {settingsSub === 'AdminSafety' && <AdminSafetyScreen navigation={settingsNav} embedded />}
            {!settingsSub && <SettingsScreen navigation={settingsNav} embedded />}
          </View>
        )}
      </View>

      <OverlayPanel visible={overlay?.name === 'NewChat'} onClose={closeOverlay} width={480}>
        <NewChatScreen navigation={overlayNav} />
      </OverlayPanel>

      <OverlayPanel visible={overlay?.name === 'ChatInfo'} onClose={closeOverlay} width={440}>
        {overlay?.name === 'ChatInfo' && (
          <ChatInfoScreen navigation={overlayNav} route={{ params: overlay.params }} />
        )}
      </OverlayPanel>

      <OverlayPanel visible={overlay?.name === 'Starred'} onClose={closeOverlay} width={560}>
        {overlay?.name === 'Starred' && (
          <StarredMessagesScreen navigation={overlayNav} embedded />
        )}
      </OverlayPanel>

      {/* Full Help & Guide, same content as the phone's Help screen — shown
          as a large overlay panel rather than a tiny popup, since it now has
          real substance (expandable topics + FAQ) instead of one paragraph. */}
      <OverlayPanel visible={overlay?.name === 'Help'} onClose={closeOverlay} width={620}>
        <HelpScreen navigation={{ goBack: closeOverlay }} embedded />
      </OverlayPanel>

      <OverlayPanel visible={overlay?.name === 'Activity'} onClose={closeOverlay} width={520}>
        <ActivityScreen
          embedded
          navigation={{ goBack: closeOverlay }}
          onOpenChat={(chatId) => { closeOverlay(); setTab('chats'); setSelectedChatId(chatId); }}
        />
      </OverlayPanel>

      <OverlayPanel visible={overlay?.name === 'UserProfile'} onClose={closeOverlay} width={560}>
        {overlay?.name === 'UserProfile' && (
          <UserProfileScreen
            embedded
            route={{ params: overlay.params }}
            navigation={{
              goBack: closeOverlay,
              navigate: (name, params) => {
                if (name === 'Conversation') { closeOverlay(); setTab('chats'); setSelectedChatId(params.chatId); }
                else if (name === 'PersonalInfo') { closeOverlay(); setTab('settings'); setSettingsSub('PersonalInfo'); }
              },
            }}
            onOpenChat={(chatId) => { closeOverlay(); setTab('chats'); setSelectedChatId(chatId); }}
          />
        )}
      </OverlayPanel>

      <OverlayPanel visible={overlay?.name === 'PostDetail'} onClose={closeOverlay} width={600}>
        {overlay?.name === 'PostDetail' && (
          <PostDetailScreen
            embedded
            route={{ params: overlay.params }}
            navigation={{ goBack: closeOverlay }}
          />
        )}
      </OverlayPanel>
    </View>
  );
}

function EmptyDetail() {
  const { theme } = useTheme();
  return (
    <View style={styles.emptyWrap}>
      <View style={[styles.emptyBadge, inkBox(theme, 'ink')]}>
        <Icon name="chatbubbles-outline" size={34} color={theme.ink} />
      </View>
      <Text style={[type.headlineSm, { color: theme.text, marginTop: 18 }]}>Pick a page to open</Text>
      <Text style={[type.bodySm, { color: theme.subtext, marginTop: 8, textAlign: 'center', maxWidth: 280 }]}>
        Select a conversation from the inbox, or tap find +ones.
      </Text>
    </View>
  );
}

function OverlayPanel({ visible, onClose, width = 480, children }) {
  const { theme } = useTheme();
  if (!visible) return null;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.overlayBackdrop, { backgroundColor: 'transparent' }]}>
        <FrostedBackdrop />
        {/* Do not place a full-screen Pressable behind/around this panel.
            React Native Web promoted it above descendants and swallowed every
            contact-row click. Panels close through their own back/close UI. */}
        <View
          style={[
            styles.overlayPanel,
            raised(theme, 2),
            inkBox(theme, 'bold'),
            { width, maxWidth: '92%', backgroundColor: theme.bg },
          ]}
        >
          <View style={{ flex: 1 }}>{children}</View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (t, insets, isWeb) => StyleSheet.create({
  root: {
    flex: 1, flexDirection: 'row', height: '100%',
    // Native tablets: respect the notch/status bar/home-indicator; web ignores (0).
    paddingTop: isWeb ? 0 : insets.top,
    paddingBottom: isWeb ? 0 : insets.bottom,
  },
  // Every nested flex row needs an explicit bounded cross-axis on web.
  // Without minHeight: 0, a full-screen child can collapse to its header's
  // intrinsic height when it is swapped into the Settings pane.
  main: { flex: 1, flexDirection: 'row', height: '100%', minHeight: 0, minWidth: 0 },
  listPane: { width: 360, maxWidth: '42%', borderRightWidth: stroke.thin, borderStyle: 'dashed', height: '100%', minHeight: 0 },
  detailPane: { flex: 1, height: '100%', minHeight: 0, minWidth: 0 },
  fullPane: { flex: 1, height: '100%', minHeight: 0, minWidth: 0 },
  centeredPane: { alignItems: 'center' },
});

const styles = StyleSheet.create({
  overlayBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  overlayPanel: { position: 'relative', zIndex: 1, maxHeight: '88%', minHeight: 320, overflow: 'hidden' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyBadge: { width: 84, height: 84, alignItems: 'center', justifyContent: 'center' },
});
