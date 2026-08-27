import React from 'react';
import { Platform, StyleSheet, TextInput, View, Pressable } from 'react-native';
import { Text, MAX_FONT_SCALE } from './Text';
import { useTheme } from '../store/ThemeContext';
import { contentMaxWidth, inkBox, type } from '../theme';

/**
 * ChatInput — the ONE message/comment input in the app.
 *
 * WHY THIS COMPONENT EXISTS
 * -------------------------
 * The composer's width has now been "fixed" three times. The first two
 * attempts patched the style block of one screen at a time, which could not
 * hold: there were four separate, near-duplicate input surfaces —
 *
 *   1. ConversationScreen  (1:1 chat)     — InkField + s.inputBar
 *   2. GCChatScreen        (group chat)   — a byte-for-byte copy of #1
 *   3. NetworkScreen       (comment sheet) — a bare TextInput, no box at all
 *   4. PostDetailScreen    (comment bar)   — a bare TextInput, no box at all
 *
 * A fix applied to #1 left #2/#3/#4 wrong, and the next edit to any one of
 * them silently reintroduced the drift. Consolidating them into this single
 * component makes that class of bug structurally impossible: there is now
 * exactly one place that decides how wide the field is, how tall it grows,
 * how much padding it has and what its box looks like.
 *
 * SHAPE
 * -----
 * A clearly bounded rectangular box — 2px ink outline from the app's own
 * `inkBox()` (the same stroke and the same asymmetric 4/8/4/6 corner radii
 * used by InkButton, InkIconButton and PaperCard, so no new radius value is
 * invented) over a subtle `inputBackground` fill — not an edge-to-edge
 * borderless strip. 14dp horizontal padding, a compact single-line height
 * that grows with multi-line text up to a hard cap so the send button can
 * never be pushed off screen.
 *
 * The row ([box] + [send button]) is capped at `contentMaxWidth` and centred,
 * so the field keeps a sensible width next to the mic/attach icons on
 * tablets, in landscape and on desktop web instead of stretching.
 *
 * Two sizes, one implementation:
 *   size="message" — chat composer (emoji / attach / camera slots, 48dp tall)
 *   size="comment" — post + comment-sheet input (44dp tall, send-only)
 */

/** Hard ceiling on composer growth. Past this the field scrolls internally
 *  rather than pushing the send button off the bottom of the screen. */
const MESSAGE_MAX_HEIGHT = 110;
const COMMENT_MAX_HEIGHT = 90;

export default function ChatInput({
  value,
  onChangeText,
  inputRef,
  placeholder,
  placeholderTextColor,
  onSubmit,
  onFocus,
  onBlur,
  onSelectionChange,
  maxLength,

  /** Accessory controls drawn inside the box, either side of the field. */
  leading,
  trailing,

  /** The send / mic button, drawn to the right of the box (never inside it). */
  send,

  /** Voice-recording state — replaces the field with the recording strip. */
  recording = false,
  recordingSeconds = 0,
  onCancelRecording,
  cancelDisabled = false,

  size = 'message',
  maxWidth = contentMaxWidth,
  style,
  boxStyle,
  textStyle,
  editable = true,
}) {
  const { theme } = useTheme();
  const isComment = size === 'comment';

  const onKeyPress = (e) => {
    // Web has no IME: Enter sends, Shift+Enter is a newline. Every input
    // surface in the app behaved this way already — it just repeated the
    // same four-line handler in four places.
    if (Platform.OS === 'web' && e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) {
      e.preventDefault?.();
      onSubmit?.();
    }
  };

  return (
    <View style={[styles.row, isComment && styles.rowComment, maxWidth != null && { maxWidth }, style]}>
      <View
        style={[
          styles.box,
          isComment && styles.boxComment,
          // The chat themes carry their own composer wash; the base app
          // themes (used by the post/comment surfaces) do not, so fall back
          // to the paper card tint instead of painting nothing.
          inkBox(theme, 'ink'),
          { backgroundColor: theme.inputBackground || theme.cardAlt },
          boxStyle,
        ]}
      >
        {recording ? (
          <>
            <View style={[styles.recDot, { backgroundColor: theme.danger }]} />
            <Text style={[type.bodyLg, { flex: 1, color: theme.text }]} numberOfLines={1}>
              Recording… {Math.floor(recordingSeconds / 60)}:
              {String(recordingSeconds % 60).padStart(2, '0')}
            </Text>
            <Pressable
              accessibilityLabel="Cancel voice recording"
              onPress={onCancelRecording}
              disabled={cancelDisabled}
              hitSlop={8}
              style={styles.cancel}
            >
              <Text style={[type.labelSm, { color: theme.danger, opacity: cancelDisabled ? 0.45 : 1 }]}>
                CANCEL
              </Text>
            </Pressable>
          </>
        ) : (
          <>
            {leading}
            <TextInput
              ref={inputRef}
              style={[
                styles.input,
                isComment ? type.bodyMd : type.bodyLg,
                {
                  color: theme.text,
                  maxHeight: isComment ? COMMENT_MAX_HEIGHT : MESSAGE_MAX_HEIGHT,
                },
                textStyle,
              ]}
              placeholder={placeholder}
              placeholderTextColor={placeholderTextColor ?? theme.muted}
              value={value}
              onChangeText={onChangeText}
              onFocus={onFocus}
              onBlur={onBlur}
              onSelectionChange={onSelectionChange}
              maxLength={maxLength}
              editable={editable}
              multiline
              disableFullscreenUI
              onSubmitEditing={onSubmit}
              blurOnSubmit={false}
              onKeyPress={onKeyPress}
              // Same ceiling as every <Text> in the app, so the composer
              // geometry cannot be reflowed by the OS text-size setting.
              maxFontSizeMultiplier={MAX_FONT_SCALE}
            />
            {trailing}
          </>
        )}
      </View>
      {send}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
    width: '100%',
    alignSelf: 'center',
  },
  rowComment: { gap: 10 },
  box: {
    // Fills whatever the row leaves after the send button; the row itself is
    // what carries the width cap, so this can never be wider than the column.
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 14,
  },
  boxComment: { minHeight: 44, gap: 10, paddingVertical: 4 },
  input: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 11,
    // react-native-web draws a focus ring on inputs; the box already shows
    // the field boundary, so the ring is redundant chrome.
    outlineStyle: 'none',
  },
  recDot: { width: 9, height: 9, borderRadius: 999 },
  cancel: { paddingVertical: 6, paddingHorizontal: 2 },
});
