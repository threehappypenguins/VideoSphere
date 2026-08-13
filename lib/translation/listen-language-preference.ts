// =============================================================================
// Persist public listen language preference (per channel slug)
// =============================================================================
// Stored in localStorage for client reads and mirrored to a non-HttpOnly cookie
// so the listen Server Component can render the chosen language on first paint
// (avoids the “Select a language…” flash on refresh).

const STORAGE_PREFIX = 'videosphere.translation.listenLanguage:';
const COOKIE_PREFIX = 'vs_listen_lang_';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * Builds the localStorage key for a public listen page language preference.
 * @param slug - Public channel slug.
 * @returns Storage key.
 */
function storageKey(slug: string): string {
  return `${STORAGE_PREFIX}${slug.trim()}`;
}

/**
 * Builds the cookie name for a public listen page language preference.
 * Cookie names are restricted to the normalized slug charset (`a-z0-9-`).
 * @param slug - Public channel slug.
 * @returns Cookie name for that slug.
 */
export function listenLanguageCookieName(slug: string): string {
  return `${COOKIE_PREFIX}${slug.trim()}`;
}

/**
 * Normalizes a raw cookie/localStorage language value.
 * @param raw - Raw stored value.
 * @returns Lowercased language code, or null when empty/missing.
 */
export function normalizeListenLanguagePreferenceValue(
  raw: string | null | undefined
): string | null {
  const code = raw?.trim().toLowerCase() ?? '';
  return code || null;
}

/**
 * Writes the listen-language cookie so the next document request can SSR it.
 * @param slug - Public channel slug.
 * @param languageCode - ISO language code to persist.
 */
function writeListenLanguageCookie(slug: string, languageCode: string): void {
  if (typeof document === 'undefined' || !slug.trim()) return;
  const name = listenLanguageCookieName(slug);
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${name}=${encodeURIComponent(languageCode)}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

/**
 * Clears the listen-language cookie for a slug.
 * @param slug - Public channel slug.
 */
function clearListenLanguageCookie(slug: string): void {
  if (typeof document === 'undefined' || !slug.trim()) return;
  const name = listenLanguageCookieName(slug);
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}

/**
 * Reads the last language the listener chose for a public translation page.
 * Uses localStorage so the choice survives refresh and later visits on the same device.
 * @param slug - Public channel slug.
 * @returns Saved language code, or null when missing/unavailable.
 */
export function readListenLanguagePreference(slug: string): string | null {
  if (typeof window === 'undefined' || !slug.trim()) return null;
  try {
    return normalizeListenLanguagePreferenceValue(window.localStorage.getItem(storageKey(slug)));
  } catch {
    return null;
  }
}

/**
 * Saves the listener’s chosen language for a public translation page.
 * Writes localStorage and a SameSite cookie (for SSR on the next load).
 * No-ops when `languageCode` is null/empty (e.g. picker not chosen yet).
 * @param slug - Public channel slug.
 * @param languageCode - ISO 639-1 language code to persist, or null to skip.
 */
export function writeListenLanguagePreference(
  slug: string,
  languageCode: string | null | undefined
): void {
  if (typeof window === 'undefined' || !slug.trim()) return;
  const code = normalizeListenLanguagePreferenceValue(languageCode);
  if (!code) return;
  try {
    window.localStorage.setItem(storageKey(slug), code);
  } catch {
    // Quota / private mode — preference is best-effort.
  }
  try {
    writeListenLanguageCookie(slug, code);
  } catch {
    // Cookie write is best-effort (blocked storage / privacy mode).
  }
}

/**
 * Clears a stored listen language preference for a public channel slug.
 * @param slug - Public channel slug.
 */
export function clearListenLanguagePreference(slug: string): void {
  if (typeof window === 'undefined' || !slug.trim()) return;
  try {
    window.localStorage.removeItem(storageKey(slug));
  } catch {
    // Ignore storage failures (private mode / blocked storage).
  }
  try {
    clearListenLanguageCookie(slug);
  } catch {
    // Ignore cookie failures.
  }
}
