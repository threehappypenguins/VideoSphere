// =============================================================================
// Persist public listen language preference (per channel slug)
// =============================================================================

const STORAGE_PREFIX = 'videosphere.translation.listenLanguage:';

/**
 * Builds the localStorage key for a public listen page language preference.
 * @param slug - Public channel slug.
 * @returns Storage key.
 */
function storageKey(slug: string): string {
  return `${STORAGE_PREFIX}${slug.trim()}`;
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
    const raw = window.localStorage.getItem(storageKey(slug));
    const code = raw?.trim().toLowerCase() ?? '';
    return code || null;
  } catch {
    return null;
  }
}

/**
 * Saves the listener’s chosen language for a public translation page.
 * @param slug - Public channel slug.
 * @param languageCode - ISO 639-1 language code to persist.
 */
export function writeListenLanguagePreference(slug: string, languageCode: string): void {
  if (typeof window === 'undefined' || !slug.trim()) return;
  const code = languageCode.trim().toLowerCase();
  if (!code) return;
  try {
    window.localStorage.setItem(storageKey(slug), code);
  } catch {
    // Quota / private mode — preference is best-effort.
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
}
