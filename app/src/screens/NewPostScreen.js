import React, { useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView, TextInput, ActivityIndicator,
  Image, KeyboardAvoidingView, Platform, Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../icons/Icon';
import { useTheme } from '../store/ThemeContext';
import { api } from '../api';
import useResponsive from '../hooks/useResponsive';
import SongCard from '../components/SongCard';
import { rippleFor } from '../components/common';
import { dashedRule, marker, radius, type, raised } from '../theme';
import { SpringPressable, motion } from '../motion';
import { lazyComponent } from '../lazy';
import { editorConfigFor } from '../imageEditor/config';

const AudiencePicker = lazyComponent(() => import('../components/AudiencePicker'));
const SongPicker = lazyComponent(() => import('../components/SongPicker'));
const UniversalImageEditor = lazyComponent(() => import('../components/UniversalImageEditor'));

/**
 * Full-screen "New Post" composer for The Network — a dedicated page
 * (close X, centered title, big sketch-bordered canvas, Photo/Song
 * actions, a 3-way visibility picker, and a fixed "Post" transmit bar)
 * matching the supplied mockup, replacing the old inline composer box
 * at the top of the feed. Presented as a full-screen Modal (like
 * SongPicker/CommentsSheet) so it works identically on phones and inside
 * the tablet/desktop split view, with no navigation-stack wiring needed.
 */
export default function NewPostScreen({ visible, onClose, onPosted }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { isTablet } = useResponsive();
  const s = makeStyles(theme);

  const [body, setBody] = useState('');
  const [image, setImage] = useState(null);
  const [cropPicker, setCropPicker] = useState(false);
  const [editUri, setEditUri] = useState(null);
  const [song, setSong] = useState(null);
  const [songPicker, setSongPicker] = useState(false);
  const [tag, setTag] = useState('');
  const [showTagInput, setShowTagInput] = useState(false);
  const [audience, setAudience] = useState('public');
  const [recipientIds, setRecipientIds] = useState([]);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setBody(''); setImage(null); setCropPicker(false); setEditUri(null); setSong(null); setTag(''); setShowTagInput(false);
    setAudience('public'); setRecipientIds([]); setError('');
  };

  const close = () => { reset(); onClose(); };

  const pickImage = () => {
    setError('');
    setEditUri(null);
    setCropPicker(true);
  };

  const reeditImage = () => {
    setError('');
    setEditUri(image?.uri || null);
    setCropPicker(true);
  };

  const submit = async () => {
    const text = body.trim();
    if (!text && !image && !song) { setError('Write something, or attach a photo or a song.'); return; }
    if (audience === 'selected' && !recipientIds.length) { setError('Pick at least one person.'); return; }
    setPosting(true);
    setError('');
    try {
      let mediaUrl = null;
      if (image) {
        const up = await api.uploadFile(image.uri, image.fileName || 'post.jpg', image.mimeType || 'image/jpeg');
        mediaUrl = up.url;
      }
      const { post } = await api.createPost({
        body: text, mediaUrl, mediaAspect: image?.displayAspect || null,
        song, tag: tag.trim() || null,
        audience, recipientIds: audience === 'selected' ? recipientIds : [],
      });
      onPosted?.(post);
      close();
    } catch (e) {
      setError(e.message);
    } finally {
      setPosting(false);
    }
  };

  const statusLine = audience === 'public'
    ? 'Status: Global post enabled.'
    : audience === 'places'
      ? 'Status: Only people from your college or workplace will see this.'
      : audience === 'contacts'
        ? 'Status: Only your friends will see this.'
        : recipientIds.length
          ? `Status: Targeted at ${recipientIds.length} ${recipientIds.length === 1 ? 'person' : 'people'}.`
          : 'Status: Pick who this reaches.';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
    <KeyboardAvoidingView
      style={[s.root, { backgroundColor: theme.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
    >
      <View style={[s.header, { paddingTop: 20 + insets.top, borderBottomColor: theme.graphiteLine }]}>
        <Pressable
          onPress={close}
          hitSlop={8}
          android_ripple={rippleFor(theme, { borderless: true, radius: 22 })}
          style={[s.closeBtn, { borderColor: theme.ink }]}
        >
          <Icon name="close" size={19} color={theme.ink} />
        </Pressable>
        <View style={s.headerTitleWrap}>
          <Text style={[type.headlineMd, { fontSize: 24, color: theme.text }]}>New Post</Text>
          <View style={[s.underline, { backgroundColor: theme.ink, transform: [{ rotate: '-1deg' }] }]} />
        </View>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        contentContainerStyle={[s.scroll, isTablet && s.scrollWide]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.canvasWrap}>
          <TextInput
            style={[s.canvas, raised(theme, 1), { borderColor: theme.ink, backgroundColor: theme.card, color: theme.text }]}
            placeholder="What's on your mind?"
            placeholderTextColor={theme.muted}
            value={body}
            onChangeText={(v) => { setBody(v); if (error) setError(''); }}
            multiline
            maxLength={2000}
            textAlignVertical="top"
          />
        </View>

        {!!image && (
          <View
            style={[
              s.imagePreviewWrap,
              {
                borderColor: theme.graphiteLine,
                aspectRatio: image.displayAspect || 1,
                width: (image.displayAspect || 1) < 0.7 ? '60%' : (image.displayAspect || 1) < 1 ? '78%' : '100%',
              },
            ]}
          >
            <Image source={{ uri: image.uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
            <Pressable onPress={() => setImage(null)} style={[s.imagePreviewX, { backgroundColor: theme.ink }]}>
              <Icon name="close" size={13} color={theme.onPrimary} />
            </Pressable>
            <Pressable onPress={reeditImage} style={[s.imageEdit, { backgroundColor: theme.ink }]}>
              <Icon name="create-outline" size={12} color={theme.onPrimary} />
              <Text style={[type.labelXs, { color: theme.onPrimary }]}>EDIT FRAME</Text>
            </Pressable>
          </View>
        )}

        {!!song && (
          <View style={[s.songPreviewWrap, { borderColor: theme.graphiteLine }]}>
            <SongCard song={song} />
            <Pressable onPress={() => setSong(null)} hitSlop={8} style={{ padding: 8 }}>
              <Icon name="close" size={16} color={theme.muted} />
            </Pressable>
          </View>
        )}

        {/* -------- action row: Photo / Song -------- */}
        <View style={s.actionRow}>
          <SpringPressable
            onPress={pickImage}
            style={({ pressed }) => [
              s.actionBtn, raised(theme, 1), { borderColor: theme.graphiteLine, backgroundColor: theme.card, transform: [{ rotate: '-1deg' }] },
              pressed ? marker(theme, 1) : null,
            ]}
            scaleTo={motion.scale.row}
            haptic="selection"
          >
            <Icon name="image-outline" size={18} color={theme.text} />
            <Text style={[type.labelSm, { color: theme.text }]}>PHOTO</Text>
          </SpringPressable>
          <SpringPressable
            onPress={() => setSongPicker(true)}
            style={({ pressed }) => [
              s.actionBtn, raised(theme, 1), { borderColor: theme.graphiteLine, backgroundColor: theme.card, transform: [{ rotate: '1deg' }] },
              pressed ? marker(theme, 1) : null,
            ]}
            scaleTo={motion.scale.row}
            haptic="selection"
          >
            <Icon name="musical-notes-outline" size={18} color={theme.text} />
            <Text style={[type.labelSm, { color: theme.text }]}>SONG</Text>
          </SpringPressable>
          <SpringPressable
            onPress={() => setShowTagInput((v) => !v)}
            style={({ pressed }) => [
              s.actionBtn, raised(theme, 1), { borderColor: theme.graphiteLine, backgroundColor: theme.card, transform: [{ rotate: '-0.6deg' }] },
              pressed ? marker(theme, 1) : null,
              showTagInput && { backgroundColor: theme.highlighterWash },
            ]}
            scaleTo={motion.scale.row}
            haptic="selection"
          >
            <Icon name="pricetag-outline" size={17} color={theme.text} />
            <Text style={[type.labelSm, { color: theme.text }]}>TAG</Text>
          </SpringPressable>
        </View>

        {showTagInput && (
          <View style={[s.tagInputWrap, { borderBottomColor: theme.ink }]}>
            <Text style={[type.labelSm, { color: theme.graphite }]}>#</Text>
            <TextInput
              style={[s.tagInput, { color: theme.text }]}
              placeholder="tag"
              placeholderTextColor={theme.muted}
              value={tag}
              onChangeText={setTag}
              autoCapitalize="none"
              maxLength={24}
            />
          </View>
        )}

        {/* -------- visibility -------- */}
        <View style={s.visibilitySection}>
          <Text style={[s.sketchLabel, { color: theme.graphite }]}>Visibility Protocol…</Text>
          <AudiencePicker
            audience={audience}
            onChange={(v) => { setAudience(v); setError(''); }}
            recipientIds={recipientIds}
            onChangeRecipients={setRecipientIds}
          />
          <Text style={[s.sketchStatus, { color: theme.subtext }]}>{statusLine}</Text>
        </View>

        {!!error && (
          <View style={s.errorRow}>
            <Icon name="alert-circle" size={14} color={theme.danger} />
            <Text style={[type.bodySm, { color: theme.danger }]}>{error}</Text>
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* -------- transmit footer -------- */}
      <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View style={isTablet ? s.footerInnerWide : s.footerInner}>
          <SpringPressable
            onPress={submit}
            disabled={posting}
            android_ripple={rippleFor(theme, { color: 'rgba(255,255,255,0.25)' })}
            style={({ pressed }) => [
              s.postBtn,
              { backgroundColor: theme.ink, borderColor: theme.ink },
              Platform.OS !== 'android' && pressed ? { opacity: 0.85 } : null,
              posting && { opacity: 0.6 },
            ]}
            scaleTo={motion.scale.row}
            haptic="selection"
          >
            {posting ? (
              <ActivityIndicator color={theme.onPrimary} />
            ) : (
              <>
                <Icon name="create-outline" size={19} color={theme.onPrimary} />
                <Text style={[type.headlineSm, { fontSize: 18, color: theme.onPrimary, textTransform: 'uppercase', letterSpacing: 1 }]}>
                  Post
                </Text>
              </>
            )}
          </SpringPressable>
        </View>
      </View>

      <UniversalImageEditor
        visible={cropPicker}
        source={editUri}
        pickOnOpen={!editUri}
        config={editorConfigFor('post')}
        onCancel={() => { setCropPicker(false); setEditUri(null); }}
        onDone={(result) => { setImage(result); setEditUri(null); setCropPicker(false); setError(''); }}
      />
      <SongPicker
        visible={songPicker}
        onClose={() => setSongPicker(false)}
        onSelect={(t) => { setSong(t); setSongPicker(false); }}
      />
    </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (t) => StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1, borderStyle: 'dashed',
  },
  closeBtn: {
    width: 38, height: 38, borderRadius: 4, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitleWrap: { alignItems: 'center' },
  underline: { height: 3, width: '110%', borderRadius: 3, marginTop: 2, opacity: 0.85 },

  scroll: { padding: 20, paddingTop: 24, gap: 24 },
  scrollWide: { maxWidth: 640, width: '100%', alignSelf: 'center' },

  canvasWrap: { width: '100%' },
  canvas: {
    width: '100%', minHeight: 220, borderWidth: 2, borderRadius: 6,
    padding: 20, ...type.bodyLg, outlineStyle: 'none',
  },

  imagePreviewWrap: { borderWidth: 1, overflow: 'hidden', position: 'relative', alignSelf: 'center' },
  imagePreviewX: { position: 'absolute', top: 8, right: 8, width: 26, height: 26, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  imageEdit: { position: 'absolute', left: 8, bottom: 8, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 3 },
  songPreviewWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 4 },

  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingVertical: 12,
    borderWidth: 1, borderRadius: 6,
  },
  tagInputWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, borderBottomWidth: 2, paddingBottom: 6, marginTop: -8 },
  tagInput: { flex: 1, ...type.bodyMd, paddingVertical: 4, outlineStyle: 'none' },

  visibilitySection: { gap: 14 },
  sketchLabel: { fontFamily: 'Caveat_700Bold', fontSize: 28, transform: [{ rotate: '-1deg' }] },
  sketchStatus: { fontFamily: 'Caveat_600SemiBold', fontSize: 22, opacity: 0.85 },

  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },

  footer: { paddingHorizontal: 20, paddingTop: 12 },
  footerInner: { width: '100%' },
  footerInnerWide: { maxWidth: 640, width: '100%', alignSelf: 'center' },
  postBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    paddingVertical: 16, borderWidth: 3, borderRadius: 8,
  },
});
