// =============================================================================
// Live translation public slug helpers
// =============================================================================

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_MIN = 3;
const SLUG_MAX = 48;

/**
 * Normalizes a proposed public slug to lowercase trimmed form.
 * @param raw - Raw slug input from the client.
 * @returns Normalized slug candidate.
 */
export function normalizeTranslationSlug(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Validates a public translation slug.
 * @param slug - Normalized slug.
 * @returns Error message when invalid; otherwise null.
 */
export function getTranslationSlugValidationError(slug: string): string | null {
  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX) {
    return `Slug must be between ${SLUG_MIN} and ${SLUG_MAX} characters.`;
  }
  if (!SLUG_PATTERN.test(slug)) {
    return 'Slug may only contain lowercase letters, numbers, and hyphens.';
  }
  return null;
}

/**
 * Builds a slug suggestion from a seed string (e.g. display name).
 * @param seed - Optional human-readable seed.
 * @param disambiguator - Optional numeric suffix for uniqueness (e.g. 2 → `-2`).
 * @returns A slug-shaped suggestion (may still need uniqueness checks).
 */
export function suggestTranslationSlug(seed?: string, disambiguator?: number): string {
  const base = (seed ?? 'listen')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX);
  const core = base.length >= SLUG_MIN ? base : 'listen';
  if (disambiguator === undefined || disambiguator < 2) {
    return core.slice(0, SLUG_MAX);
  }
  const suffix = `-${disambiguator}`;
  return `${core.slice(0, Math.max(SLUG_MIN, SLUG_MAX - suffix.length))}${suffix}`;
}
