import React from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { Text } from './components/Text';

export default function ReanimatedTest() {
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.5);

  React.useEffect(() => {
    opacity.value = withSpring(1, { damping: 12, stiffness: 200 });
    scale.value = withSpring(1, { damping: 12, stiffness: 300 });
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Reanimated Native Thread Test</Text>
      <Animated.View style={[styles.box, animatedStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  label: { fontSize: 16, marginBottom: 20, color: '#1c1b1b' },
  box: { width: 100, height: 100, backgroundColor: '#FFE24D', borderRadius: 12, borderWidth: 2, borderColor: '#1c1b1b' },
});
