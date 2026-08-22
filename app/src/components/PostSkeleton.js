import React from 'react';
import { View } from 'react-native';
import { Skeleton } from '../motion';
import { useTheme } from '../store/ThemeContext';

/**
 * Content-shaped placeholder for a feed post.
 *
 * A spinner tells the user "something is happening"; this tells them *what
 * is about to appear*, in the same shape and rhythm as a real sticky note.
 * The layout is identical to PostCard's, so when real posts land nothing
 * jumps — the placeholders are simply replaced in place.
 */
export default function PostSkeleton({ index = 0 }) {
  const { theme } = useTheme();
  const tilt = index % 2 === 0 ? '-0.8deg' : '0.7deg';
  return (
    <View
      // Placeholders fade back as they go down the list: the eye is told
      // where the content starts without any extra motion.
      style={{
        padding: 18, marginBottom: 22, borderWidth: 1, borderColor: theme.graphiteLine,
        backgroundColor: index % 2 ? theme.cardAlt : theme.card,
        borderTopLeftRadius: 2, borderTopRightRadius: 5,
        borderBottomRightRadius: 2, borderBottomLeftRadius: 4,
        transform: [{ rotate: tilt }],
        opacity: 1 - Math.min(index, 3) * 0.22,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Skeleton width={38} height={38} radius={999} />
        <View style={{ flex: 1, gap: 6 }}>
          <Skeleton width="46%" height={10} />
          <Skeleton width="28%" height={8} />
        </View>
      </View>
      <View style={{ marginTop: 14, gap: 8 }}>
        <Skeleton width="82%" height={13} />
        <Skeleton width="94%" height={10} />
        <Skeleton width="61%" height={10} />
      </View>
      <View style={{ flexDirection: 'row', gap: 22, marginTop: 20 }}>
        <Skeleton width={44} height={14} />
        <Skeleton width={38} height={14} />
      </View>
    </View>
  );
}

/** A short run of placeholders — the shape of a feed that is still loading. */
export function PostSkeletonList({ count = 3, style }) {
  return (
    <View style={style} pointerEvents="none" accessibilityLabel="Loading posts">
      {Array.from({ length: count }, (_, i) => <PostSkeleton key={i} index={i} />)}
    </View>
  );
}
