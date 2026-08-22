import React, { Suspense, lazy } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { useTheme } from './store/ThemeContext';
import { type, inkBox, stroke, radius } from './theme';

/**
 * Themed fallback displayed while a lazy-loaded screen chunk is fetching.
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
 * Fallback shown if a chunk fails to download (e.g. network interruption).
 */
function ChunkErrorFallback({ onRetry, label }) {
  let theme;
  try {
    const themeCtx = useTheme();
    theme = themeCtx?.theme;
  } catch {}

  const bg = theme?.bg || '#131313';
  const text = theme?.text || '#f4f0ef';
  const subtext = theme?.subtext || '#bdb8b5';
  const ink = theme?.ink || '#FFE24D';

  return (
    <View style={[styles.fallbackRoot, { backgroundColor: bg, paddingHorizontal: 32 }]}>
      <Text style={[type.headlineSm, { color: text, textAlign: 'center', marginBottom: 8 }]}>
        {label ? `Could not load ${label}` : 'Failed to load content'}
      </Text>
      <Text style={[type.bodySm, { color: subtext, textAlign: 'center', maxWidth: 320, marginBottom: 20 }]}>
        Please check your connection and tap retry to reload this section.
      </Text>
      {onRetry && (
        <Pressable
          onPress={onRetry}
          style={[
            styles.retryBtn,
            { backgroundColor: ink, borderColor: theme?.ink || '#000' },
          ]}
        >
          <Text style={[type.labelSm, { color: '#131313', fontWeight: '800' }]}>RETRY</Text>
        </Pressable>
      )}
    </View>
  );
}

/**
 * Error boundary for dynamically imported chunks.
 */
class ChunkErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  retry = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return <ChunkErrorFallback onRetry={this.retry} label={this.props.label} />;
    }
    return this.props.children;
  }
}

/**
 * Creates a code-split, lazy-loaded screen with an automatic Suspense boundary
 * and error recovery.
 *
 * @param {() => Promise<{ default: React.ComponentType<any> }>} importer
 * @param {Object} [options]
 * @param {string} [options.label]
 * @param {React.ReactNode} [options.fallback]
 */
export function lazyScreen(importer, options = {}) {
  const LazyComponent = lazy(importer);
  const label = options.label || '';

  const LazyScreenWrapper = React.forwardRef((props, ref) => (
    <ChunkErrorBoundary label={label}>
      <Suspense fallback={options.fallback || <ScreenFallback label={label} />}>
        <LazyComponent ref={ref} {...props} />
      </Suspense>
    </ChunkErrorBoundary>
  ));

  LazyScreenWrapper.preload = importer;
  LazyScreenWrapper.displayName = `LazyScreen(${label || 'Component'})`;

  return LazyScreenWrapper;
}

/**
 * Creates a code-split, lazy-loaded component (modal, sheet, picker, etc.).
 * If `visible={false}`, the chunk load is deferred until the component becomes visible.
 *
 * @param {() => Promise<{ default: React.ComponentType<any> }>} importer
 * @param {Object|React.ReactNode} [optionsOrFallback]
 */
export function lazyComponent(importer, optionsOrFallback = {}) {
  const isFallbackNode = React.isValidElement(optionsOrFallback) || optionsOrFallback === null;
  const options = isFallbackNode ? { fallback: optionsOrFallback } : (optionsOrFallback || {});
  const LazyComponent = lazy(importer);
  const fallback = options.fallback !== undefined ? options.fallback : null;

  const LazyComponentWrapper = React.forwardRef((props, ref) => {
    if (props && props.visible === false) {
      return null;
    }
    return (
      <ChunkErrorBoundary label={options.label}>
        <Suspense fallback={fallback}>
          <LazyComponent ref={ref} {...props} />
        </Suspense>
      </ChunkErrorBoundary>
    );
  });

  LazyComponentWrapper.preload = importer;
  LazyComponentWrapper.displayName = `LazyComponent(${options.label || 'Component'})`;

  return LazyComponentWrapper;
}

/**
 * Preload a component chunk immediately or in idle time.
 */
export function preloadComponent(importerOrComponent) {
  try {
    if (typeof importerOrComponent === 'function') {
      importerOrComponent();
    } else if (importerOrComponent?.preload) {
      importerOrComponent.preload();
    }
  } catch {}
}

/**
 * Schedule a component chunk to preload when the browser/device is idle.
 */
export function idlePreload(importerOrComponent, timeout = 2000) {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(() => preloadComponent(importerOrComponent), { timeout });
  } else {
    setTimeout(() => preloadComponent(importerOrComponent), 300);
  }
}

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
