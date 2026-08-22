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
    // Ask the wrapper for a FRESH lazy component before clearing the error.
    // React.lazy caches a rejected import forever, so without this the retry
    // button would re-render straight back into the same cached failure.
    this.props.onRetry?.();
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return <ChunkErrorFallback onRetry={this.retry} label={this.props.label} />;
    }
    return this.props.children;
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wraps a dynamic import so transient failures (flaky mobile data, a dropped
 * packet mid-download) retry automatically with a short backoff before the
 * error ever reaches the user. Slow networks get 3 shots at the chunk instead
 * of failing on the first hiccup.
 */
function retryingImporter(importer, { retries = 2, baseDelay = 700 } = {}) {
  return async () => {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await importer();
      } catch (error) {
        lastError = error;
        if (attempt < retries) await wait(baseDelay * (attempt + 1));
      }
    }
    throw lastError;
  };
}

/**
 * Holds the current React.lazy instance for an importer and can mint a fresh
 * one. React.lazy memoises a rejected promise permanently, so recovery after
 * a failed chunk download REQUIRES a brand new lazy component.
 */
function createLazySource(importer) {
  let current = lazy(retryingImporter(importer));
  return {
    get: () => current,
    refresh: () => {
      current = lazy(retryingImporter(importer));
      return current;
    },
  };
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
  const source = createLazySource(importer);
  const label = options.label || '';

  const LazyScreenWrapper = React.forwardRef((props, ref) => {
    const [, bump] = React.useReducer((n) => n + 1, 0);
    const LazyComponent = source.get();
    const handleRetry = React.useCallback(() => { source.refresh(); bump(); }, []);
    return (
      <ChunkErrorBoundary label={label} onRetry={handleRetry}>
        <Suspense fallback={options.fallback || <ScreenFallback label={label} />}>
          <LazyComponent ref={ref} {...props} />
        </Suspense>
      </ChunkErrorBoundary>
    );
  });

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
  const source = createLazySource(importer);
  const fallback = options.fallback !== undefined ? options.fallback : null;

  const LazyComponentWrapper = React.forwardRef((props, ref) => {
    const [, bump] = React.useReducer((n) => n + 1, 0);
    const handleRetry = React.useCallback(() => { source.refresh(); bump(); }, []);
    if (props && props.visible === false) {
      return null;
    }
    const LazyComponent = source.get();
    return (
      <ChunkErrorBoundary label={options.label} onRetry={handleRetry}>
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
