import React, { useEffect, useState } from 'react';
import { View, Pressable, StyleSheet, ActivityIndicator, Platform } from 'react-native';

import Icon from '../icons/Icon';
import { useTheme } from '../store/ThemeContext';
import { type, inkBox, dashedRule } from '../theme';
import { InkButton, HandDrawnToggle } from './common';
import { SpringPressable, motion } from '../motion';
import {
  useAppUpdates,
  checkForUpdate,
  updateNow,
  applyUpdate,
  setAutoInstall,
  hydrateUpdatePrefs,
  describeInstalled,
  describeLastChecked,
} from '../updates';
import { Text } from './Text';

/**
 * "App Updates" settings section.
 *
 * One button does the whole job: look for a new release, download it, and
 * restart into it. On native that's an EAS/OTA bundle swap; on web it purges
 * service-worker + browser caches and hard-reloads the newly deployed build.
 * A toggle keeps the silent background updates opt-out-able.
 */
export default function UpdateSection() {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const update = useAppUpdates();
  const [note, setNote] = useState('');

  useEffect(() => { hydrateUpdatePrefs(); }, []);

  const { status, busy, applying, pending, error, lastCheckedAt, autoInstall } = update;
  const unsupported = status === 'unsupported';
  const working = busy || applying;

  const tone = (() => {
    if (error || status === 'error') return { color: theme.danger, icon: 'alert-circle-outline' };
    if (pending || status === 'ready') return { color: theme.ink, icon: 'sparkles-outline' };
    if (status === 'current') return { color: theme.ink, icon: 'checkmark-circle' };
    return { color: theme.graphite, icon: 'cloud-download-outline' };
  })();

  const headline = (() => {
    if (unsupported) return 'Updates unavailable in this build';
    if (applying) return Platform.OS === 'web' ? 'Reloading the new build…' : 'Restarting into the update…';
    if (status === 'checking') return 'Checking for updates…';
    if (status === 'downloading') return 'Downloading update…';
    if (status === 'error') return 'Update check failed';
    if (pending || status === 'ready') return 'A new version is ready';
    if (status === 'current') return "You're on the latest version";
    return 'Tap update to get the newest version';
  })();

  const detail = (() => {
    if (unsupported) return 'THIS DEVELOPMENT BUILD INSTALLS UPDATES FROM YOUR COMPUTER';
    if (error) return error.toUpperCase();
    if (note) return note.toUpperCase();
    return describeLastChecked(lastCheckedAt);
  })();

  const buttonLabel = (() => {
    if (applying) return Platform.OS === 'web' ? 'Reloading…' : 'Restarting…';
    if (status === 'downloading') return 'Downloading…';
    if (status === 'checking') return 'Checking…';
    if (pending || status === 'ready') return Platform.OS === 'web' ? 'Install & reload' : 'Install & restart';
    return 'Update now';
  })();

  const runUpdate = async () => {
    setNote('');
    if (pending) {
      await applyUpdate();
      return;
    }
    const result = await updateNow();
    if (result === 'current') setNote('Already up to date');
    if (result === 'error') setNote('');
  };

  const runCheck = async () => {
    setNote('');
    try {
      const found = await checkForUpdate({ download: true, silent: false });
      setNote(found ? 'Update ready — tap install to apply' : 'Already up to date');
    } catch {
      /* the error is already reflected in shared state */
    }
  };

  return (
    <View style={s.group}>
      <View style={[s.card, inkBox(theme, 'thin')]}>
        <View style={s.head}>
          <View style={[s.badge, inkBox(theme, 'thin'), { backgroundColor: theme.cardAlt }]}>
            {working ? (
              <ActivityIndicator size="small" color={theme.ink} />
            ) : (
              <Icon name={tone.icon} size={20} color={tone.color} />
            )}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[type.bodyLg, { color: theme.text }]}>{headline}</Text>
            <Text style={[type.labelXs, { color: error ? theme.danger : theme.graphite, marginTop: 3 }]}>
              {detail}
            </Text>
          </View>
        </View>

        <View style={[s.rule, dashedRule(theme)]} />

        <Text style={[type.labelXs, { color: theme.muted }]}>{describeInstalled()}</Text>

        {!unsupported && (
          <View style={s.actions}>
            {/* InkButton renders inside an Animated.View wrapper, so the flex
                has to live on a container for the button to fill the row. */}
            <View style={{ flex: 1 }}>
              <InkButton
                label={buttonLabel}
                icon={pending ? 'rocket-outline' : 'cloud-download-outline'}
                onPress={runUpdate}
                busy={working}
                disabled={working}
                filled={pending}
              />
            </View>
            <SpringPressable
              onPress={runCheck}
              disabled={working}
              hitSlop={6}
              style={({ pressed, hovered }) => [
                s.checkBtn,
                inkBox(theme, 'thin'),
                (pressed || hovered) && { backgroundColor: theme.cardAlt },
                working && { opacity: 0.45 },
              ]}
              scaleTo={motion.scale.row}
              haptic="selection"
            >
              <Text style={[type.labelSm, { color: theme.subtext }]}>CHECK</Text>
            </SpringPressable>
          </View>
        )}
      </View>

      {!unsupported && (
        <View style={[s.autoRow, inkBox(theme, 'thin')]}>
          <Icon name="sparkles-outline" size={19} color={theme.graphite} style={{ width: 26 }} />
          <View style={{ flex: 1 }}>
            <Text style={[type.bodyLg, { color: theme.text }]}>Auto-install updates</Text>
            <Text style={[type.labelXs, { color: theme.graphite, marginTop: 3 }]}>
              {autoInstall
                ? 'NEW VERSIONS INSTALL WHEN YOU REOPEN +ONE'
                : 'OFF · UPDATE MANUALLY FROM THIS SCREEN'}
            </Text>
          </View>
          <HandDrawnToggle value={autoInstall} onToggle={() => setAutoInstall(!autoInstall)} />
        </View>
      )}
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  group: { gap: 10 },
  card: { paddingHorizontal: 14, paddingVertical: 14, gap: 12, backgroundColor: 'transparent' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  badge: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 999 },
  rule: { height: 1 },
  actions: { flexDirection: 'row', alignItems: 'stretch', gap: 10, marginTop: 2 },
  checkBtn: { minWidth: 74, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  autoRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 14, paddingVertical: 12, backgroundColor: 'transparent',
  },
});
