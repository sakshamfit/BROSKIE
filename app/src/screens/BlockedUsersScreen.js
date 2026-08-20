import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../icons/Icon';
import { EmojiText } from '../icons/Emoji';
import { api } from '../api';
import { useTheme } from '../store/ThemeContext';
import useResponsive from '../hooks/useResponsive';
import { Avatar, EmptyState, handleFor, GoldTick, hasGoldTick } from '../components/common';
import { confirm } from '../hooks/confirm';
import { type, dashedRule } from '../theme';

/** Dedicated list of everyone you've blocked, with a one-tap unblock. */
export default function BlockedUsersScreen({ navigation, embedded = false }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { isTablet } = useResponsive();
  const s = makeStyles(theme);

  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try { setList((await api.blockedUsers()).users); } catch {} finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const unblock = async (u) => {
    const ok = await confirm(`Unblock ${u.name}? They'll be able to message you and see your public posts again.`, {
      title: 'Unblock', confirmLabel: 'Unblock',
    });
    if (!ok) return;
    setBusyId(u.id);
    try {
      await api.unblockUser(u.id);
      setList((prev) => prev.filter((x) => x.id !== u.id));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={[s.header, !embedded && { paddingTop: 20 + insets.top }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={{ padding: 6 }}>
          <Icon name="arrow-back" size={22} color={theme.ink} />
        </Pressable>
        <Text style={[type.headlineMd, { color: theme.text }]}>Blocked Contacts</Text>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={theme.ink} />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(u) => u.id}
          contentContainerStyle={[s.list, isTablet && s.listWide, !list.length && { flexGrow: 1 }]}
          ItemSeparatorComponent={() => <View style={[dashedRule(theme), { marginHorizontal: 20 }]} />}
          ListEmptyComponent={
            <EmptyState icon="ban-outline" title="No blocked contacts" subtitle="Anyone you block will show up here." />
          }
          renderItem={({ item }) => (
            <View style={s.row}>
              <Avatar uri={item.avatar} name={item.name} id={item.id} size={46} />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <EmojiText style={[type.bodyMd, { color: theme.text, flexShrink: 1 }]}>{item.name}</EmojiText>
                  {hasGoldTick(item) && <GoldTick size={14} />}
                </View>
                <Text style={[type.labelXs, { color: theme.graphite, marginTop: 2 }]}>{handleFor(item)}</Text>
              </View>
              <Pressable onPress={() => unblock(item)} disabled={busyId === item.id} style={s.unblockBtn}>
                <Text style={[type.labelSm, { color: theme.ink }]}>{busyId === item.id ? '…' : 'UNBLOCK'}</Text>
              </Pressable>
            </View>
          )}
        />
      )}
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 14 },
  list: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 40 },
  listWide: { maxWidth: 560, width: '100%', alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13 },
  unblockBtn: { paddingHorizontal: 12, paddingVertical: 8 },
});
