import type { PlatformDefaults, YouTubeUserDefaults } from '@/types';

const YOUTUBE_USER_DEFAULT_KEYS = new Set<string>([
  'madeForKids',
  'defaultAudioLanguage',
  'license',
  'embeddable',
  'categoryId',
]);

const LICENSE_VALUES = new Set(['youtube', 'creativeCommon']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Result of parsing a PATCH `platformDefaults` payload.
 */
export type PlatformDefaultsParseResult =
  | { ok: true; youtube?: Partial<YouTubeUserDefaults> }
  | { ok: false; error: string };

/**
 * Validates optional `platformDefaults` from a profile PATCH body.
 * @param value - Raw `platformDefaults` value from the request JSON.
 * @returns Parsed YouTube defaults for merge, or a validation error message.
 */
export function parsePlatformDefaultsPatch(value: unknown): PlatformDefaultsParseResult {
  if (value === undefined) {
    return { ok: true };
  }

  if (!isPlainObject(value)) {
    return { ok: false, error: 'platformDefaults must be an object.' };
  }

  const keys = Object.keys(value);
  if (keys.length === 0) {
    return { ok: true };
  }

  if (keys.some((key) => key !== 'youtube')) {
    return { ok: false, error: 'platformDefaults contains unsupported platform keys.' };
  }

  if (value.youtube === undefined) {
    return { ok: true };
  }

  const youtubeResult = parseYouTubeUserDefaults(value.youtube);
  if (!youtubeResult.ok) {
    return youtubeResult;
  }

  return { ok: true, youtube: youtubeResult.value };
}

/**
 * Validates a partial `YouTubeUserDefaults` object.
 * @param value - Raw `platformDefaults.youtube` value.
 * @returns Parsed defaults or a validation error message.
 */
export function parseYouTubeUserDefaults(
  value: unknown
): { ok: true; value: Partial<YouTubeUserDefaults> } | { ok: false; error: string } {
  if (!isPlainObject(value)) {
    return { ok: false, error: 'platformDefaults.youtube must be an object.' };
  }

  for (const key of Object.keys(value)) {
    if (!YOUTUBE_USER_DEFAULT_KEYS.has(key)) {
      return { ok: false, error: `platformDefaults.youtube.${key} is not a recognized field.` };
    }
  }

  const out: Partial<YouTubeUserDefaults> = {};

  if (value.madeForKids !== undefined) {
    if (typeof value.madeForKids !== 'boolean') {
      return { ok: false, error: 'platformDefaults.youtube.madeForKids must be a boolean.' };
    }
    out.madeForKids = value.madeForKids;
  }

  if (value.embeddable !== undefined) {
    if (typeof value.embeddable !== 'boolean') {
      return { ok: false, error: 'platformDefaults.youtube.embeddable must be a boolean.' };
    }
    out.embeddable = value.embeddable;
  }

  if (value.defaultAudioLanguage !== undefined) {
    if (typeof value.defaultAudioLanguage !== 'string') {
      return {
        ok: false,
        error: 'platformDefaults.youtube.defaultAudioLanguage must be a string.',
      };
    }
    const trimmed = value.defaultAudioLanguage.trim();
    if (trimmed === '') {
      return {
        ok: false,
        error: 'platformDefaults.youtube.defaultAudioLanguage cannot be empty.',
      };
    }
    out.defaultAudioLanguage = trimmed;
  }

  if (value.categoryId !== undefined) {
    if (typeof value.categoryId !== 'string') {
      return { ok: false, error: 'platformDefaults.youtube.categoryId must be a string.' };
    }
    const trimmed = value.categoryId.trim();
    if (trimmed === '') {
      return { ok: false, error: 'platformDefaults.youtube.categoryId cannot be empty.' };
    }
    out.categoryId = trimmed;
  }

  if (value.license !== undefined) {
    if (typeof value.license !== 'string' || !LICENSE_VALUES.has(value.license)) {
      return {
        ok: false,
        error: 'platformDefaults.youtube.license must be "youtube" or "creativeCommon".',
      };
    }
    out.license = value.license as YouTubeUserDefaults['license'];
  }

  return { ok: true, value: out };
}

/**
 * Picks recognized YouTube default fields with valid types from a stored sub-document.
 * Unknown keys and invalid values are dropped (legacy/tampered Mongo data).
 * @param value - Raw `platformDefaults.youtube` value from MongoDB.
 * @returns Sanitized defaults, or undefined when no valid fields remain.
 */
function normalizeStoredYouTubeUserDefaults(value: unknown): YouTubeUserDefaults | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const out: Partial<YouTubeUserDefaults> = {};

  if (typeof value.madeForKids === 'boolean') {
    out.madeForKids = value.madeForKids;
  }

  if (typeof value.embeddable === 'boolean') {
    out.embeddable = value.embeddable;
  }

  if (typeof value.defaultAudioLanguage === 'string') {
    const trimmed = value.defaultAudioLanguage.trim();
    if (trimmed !== '') {
      out.defaultAudioLanguage = trimmed;
    }
  }

  if (typeof value.categoryId === 'string') {
    const trimmed = value.categoryId.trim();
    if (trimmed !== '') {
      out.categoryId = trimmed;
    }
  }

  if (typeof value.license === 'string' && LICENSE_VALUES.has(value.license)) {
    out.license = value.license as YouTubeUserDefaults['license'];
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Normalizes a stored `platformDefaults` document for API responses.
 * @param value - Raw Mongo sub-document.
 * @returns Typed platform defaults when at least one valid field is present; otherwise undefined.
 */
export function normalizeStoredPlatformDefaults(value: unknown): PlatformDefaults | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const youtube =
    value.youtube !== undefined ? normalizeStoredYouTubeUserDefaults(value.youtube) : undefined;

  if (youtube === undefined) {
    return undefined;
  }

  return { youtube };
}
