/**
 * Android App Links — Digital Asset Links (/.well-known/assetlinks.json).
 *
 * True one-tap app links need three cooperating parts:
 *   1. app/app.json declares `android.intentFilters` with `autoVerify: true`
 *      for https://www.plusoneco.in (see docs/SEO_GEO_PLAYBOOK.md §6).
 *   2. https://www.plusoneco.in/.well-known/assetlinks.json returns the
 *      association JSON for the APK's signing certificate. The marketing
 *      site is served by Vercel, which rewrites that path here so the
 *      fingerprint can be pinned via Railway env WITHOUT touching the repo:
 *        ANDROID_PACKAGE_NAME    — e.g. ai.arena.tomodachi
 *        ANDROID_CERT_FINGERPRINT — SHA-256 of the release APK signing cert
 *   3. The installed APK's manifest carries the intent filters (rebuild after
 *      changing app.json — OTA updates cannot add them).
 *
 * This module is pure (no db/socket imports) so CI can test it standalone:
 *   node test-app-links.js
 */

const DEFAULT_PACKAGE = 'ai.arena.tomodachi';
const SHA256_HEX = /^[0-9a-fA-F]{64}$/;

/**
 * Normalize any common SHA-256 formatting (colon, space, dash or bare hex)
 * to the uppercase colon-separated form Android's Digital Asset Links uses.
 * Returns null when the value is missing or not a SHA-256, so a bad env
 * value fails loudly instead of silently shipping an unverifiable file.
 */
function normalizeFingerprint(value) {
  const v = String(value || '').trim();
  if (!v) return null;
  const hex = v.replace(/[^0-9a-fA-F]/g, '');
  if (!SHA256_HEX.test(hex)) return null;
  return hex.toUpperCase().match(/.{2}/g).join(':');
}

/**
 * Build the Digital Asset Links response.
 * @param {{packageName?: string, fingerprint?: string}} env
 * @returns {{packageName: string, fingerprint: string|null, payload: object|null}}
 *   payload is the array Digital Asset Links requires, or null when the
 *   certificate fingerprint is unset/invalid (caller answers 503).
 */
function assetLinksPayload({ packageName, fingerprint } = {}) {
  const pkg = String(packageName || DEFAULT_PACKAGE).trim() || DEFAULT_PACKAGE;
  const fp = normalizeFingerprint(fingerprint);
  return {
    packageName: pkg,
    fingerprint: fp,
    payload: fp ? [{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: pkg,
        sha256_cert_fingerprints: [fp],
      },
    }] : null,
  };
}

module.exports = { DEFAULT_PACKAGE, normalizeFingerprint, assetLinksPayload };
