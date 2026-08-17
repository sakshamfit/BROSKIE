/**
 * Median browser status-bar bridge (web only).
 *
 * "Median" is a third-party Android browser that exposes a JS bridge
 * (`window.median.statusbar`) letting web apps style the system status bar
 * like a native app does. This module detects the bridge and keeps the
 * status bar in lockstep with the app theme — paper background, matching
 * icon color, and overlay mode so the app draws edge-to-edge underneath
 * the status bar (content is padded via safe-area insets, so nothing is
 * hidden). It's a no-op everywhere else (regular browsers, iOS, native).
 *
 * Bridge API (per Median docs):
 *   median.statusbar.set({
 *     style:   'light' | 'dark' | 'auto'   // light = dark icons (light bg)
 *     color:   'RRGGBB' or 'AARRGGBB' hex, '00000000' = transparent
 *     overlay: boolean                     // true = content under the bar
 *     blur:    boolean                     // iOS only
 *   });
 *   window.median_library_ready()          // called by Median when ready
 *   median_match_statusbar_to_body_background_color()
 */

let bridge = null;
let current = { mode: 'light', bg: '#fdf8f8' };

/** 'RRGGBB' → 'AARRGGBB' (fully opaque). Handles '#' prefix. */
function toARGB(hex) {
  const h = String(hex || '').replace('#', '');
  return h.length === 6 ? `ff${h}` : h;
}

function detectBridge() {
  if (typeof window === 'undefined') return false;
  if (bridge) return true;
  try {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
    if (ua.toLowerCase().includes('median') && window.median && typeof window.median.statusbar?.set === 'function') {
      bridge = window.median;
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** Push the current app theme onto the Median status bar. */
export function applyMedianStatusBar(mode, bg) {
  if (!detectBridge()) return;
  try {
    bridge.statusbar.set({
      // Median's convention: 'light' = black icons (for light backgrounds),
      // 'dark' = white icons (for dark backgrounds) — opposite of Expo's
      // StatusBar, so map the resolved theme mode to Median's naming.
      style: mode === 'dark' ? 'dark' : 'light',
      color: toARGB(bg),
      overlay: true, // app draws under the status bar; safe-area insets pad content
      blur: false,
    });
  } catch {
    /* non-fatal — the bridge may not be ready yet */
  }
}

/** Remember the latest theme so the Median ready-hook can replay it. */
export function setMedianTheme(mode, bg) {
  current = { mode, bg };
  applyMedianStatusBar(mode, bg);
}

/**
 * Register the `median_library_ready` hook once, then apply immediately if
 * the bridge is already present. Call again on theme changes via
 * setMedianTheme. Safe to call multiple times.
 */
export function setupMedianBridge() {
  if (typeof window === 'undefined') return;
  try {
    if (typeof window.median_library_ready !== 'function') {
      window.median_library_ready = function medianLibraryReady() {
        // Let Median auto-derive from the (already theme-matched) body bg…
        if (typeof window.median_match_statusbar_to_body_background_color === 'function') {
          try { window.median_match_statusbar_to_body_background_color(); } catch { /* ignore */ }
        }
        // …then make the explicit theme-driven call so light/dark always win.
        applyMedianStatusBar(current.mode, current.bg);
      };
    }
  } catch {
    /* ignore */
  }
  applyMedianStatusBar(current.mode, current.bg);
}
