import React from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { useTheme } from './store/ThemeContext';
import { type, stroke, radius } from './theme';

/**
 * Fallback displayed while loading content.
 */
export function ScreenFallback({ label = '' }) {
  let theme;
  try {
    const themeCtx = useTheme();
    theme = themeCtx?.theme;
  } catch {}

  const bg = theme?.bg || '#131313';
  const ink = theme?.ink || '#FFE24D';
  const muted = theme?.muted || '#888888';

  return (
    <View style={[styles.fallbackRoot, { backgroundColor: bg }]}>
      <ActivityIndicator size="large" color={ink} />
      {!!label && (
        <Text style={[type.labelSm, { color: muted, marginTop: 14, letterSpacing: 1 }]}>
          {label.toUpperCase()}
        </Text>
      )}
    </View>
  );
}

/**
 * Direct component wrapper without lazy loading or code splitting.
 */
export function lazyScreen(importerOrComponent, options = {}) {
  const label = options.label || '';

  const ScreenWrapper = React.forwardRef((props, ref) => {
    let Component = importerOrComponent;
    if (typeof Component === 'function' && !Component.prototype?.render && !Component.$$typeof) {
      try {
        const resolved = Component();
        if (resolved && typeof resolved.then === 'function') {
          // If a dynamic import function was passed, unwrap module
          Component = resolved.default || resolved;
        } else {
          Component = resolved;
        }
      } catch {}
    }
    const ActualComponent = Component?.default || Component;
    if (typeof ActualComponent === 'function' || (typeof ActualComponent === 'object' && ActualComponent !== null)) {
      return <ActualComponent ref={ref} {...props} />;
    }
    return null;
  });

  ScreenWrapper.preload = () => {};
  ScreenWrapper.displayName = `LazyScreen(${label || 'Component'})`;

  return ScreenWrapper;
}

/**
 * Direct component wrapper without lazy loading.
 */
export function lazyComponent(importerOrComponent, optionsOrFallback = {}) {
  const LazyComponentWrapper = React.forwardRef((props, ref) => {
    if (props && props.visible === false) {
      return null;
    }
    let Component = importerOrComponent;
    if (typeof Component === 'function' && !Component.prototype?.render && !Component.$$typeof) {
      try {
        const resolved = Component();
        if (resolved && typeof resolved.then === 'function') {
          Component = resolved.default || resolved;
        } else {
          Component = resolved;
        }
      } catch {}
    }
    const ActualComponent = Component?.default || Component;
    if (typeof ActualComponent === 'function' || (typeof ActualComponent === 'object' && ActualComponent !== null)) {
      return <ActualComponent ref={ref} {...props} />;
    }
    return null;
  });

  LazyComponentWrapper.preload = () => {};
  LazyComponentWrapper.displayName = `LazyComponent`;

  return LazyComponentWrapper;
}

/** No-op: Preload not needed without lazy loading. */
export function preloadComponent() {}

/** No-op: Preload not needed without lazy loading. */
export function idlePreload() {}

const styles = StyleSheet.create({
  fallbackRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
  },
  retryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: stroke.thin,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
