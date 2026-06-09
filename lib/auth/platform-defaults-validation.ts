import type { PlatformDefaults, YouTubeUserDefaults } from '@/types';

const YOUTUBE_USER_DEFAULT_KEYS = new Set<string>([
  'madeForKids',
  'ageRestricted',
  'defaultLanguage',
  'titleDescriptionLanguage',
  'license',
  'embeddable',
  'categoryId',
  'commentsVisibility',
  'commentSortOrder',
  'publicStatsViewable',
  'captionCertification',
]);

const LICENSE_VALUES = new Set(['youtube', 'creativeCommon']);
const COMMENTS_VISIBILITY_VALUES = new Set([
  'allowAll',
  'holdForReview',
  'holdAllForReview',
  'disable',
]);
const COMMENT_SORT_ORDER_VALUES = new Set(['topComments', 'newestFirst']);

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

  if (value.ageRestricted !== undefined) {
    if (typeof value.ageRestricted !== 'boolean') {
      return { ok: false, error: 'platformDefaults.youtube.ageRestricted must be a boolean.' };
    }
    out.ageRestricted = value.ageRestricted;
  }

  if (value.embeddable !== undefined) {
    if (typeof value.embeddable !== 'boolean') {
      return { ok: false, error: 'platformDefaults.youtube.embeddable must be a boolean.' };
    }
    out.embeddable = value.embeddable;
  }

  if (value.publicStatsViewable !== undefined) {
    if (typeof value.publicStatsViewable !== 'boolean') {
      return {
        ok: false,
        error: 'platformDefaults.youtube.publicStatsViewable must be a boolean.',
      };
    }
    out.publicStatsViewable = value.publicStatsViewable;
  }

  if (value.defaultLanguage !== undefined) {
    if (typeof value.defaultLanguage !== 'string') {
      return { ok: false, error: 'platformDefaults.youtube.defaultLanguage must be a string.' };
    }
    out.defaultLanguage = value.defaultLanguage;
  }

  if (value.titleDescriptionLanguage !== undefined) {
    if (typeof value.titleDescriptionLanguage !== 'string') {
      return {
        ok: false,
        error: 'platformDefaults.youtube.titleDescriptionLanguage must be a string.',
      };
    }
    out.titleDescriptionLanguage = value.titleDescriptionLanguage;
  }

  if (value.categoryId !== undefined) {
    if (typeof value.categoryId !== 'string') {
      return { ok: false, error: 'platformDefaults.youtube.categoryId must be a string.' };
    }
    out.categoryId = value.categoryId;
  }

  if (value.captionCertification !== undefined) {
    if (typeof value.captionCertification !== 'string') {
      return {
        ok: false,
        error: 'platformDefaults.youtube.captionCertification must be a string.',
      };
    }
    out.captionCertification = value.captionCertification;
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

  if (value.commentsVisibility !== undefined) {
    if (
      typeof value.commentsVisibility !== 'string' ||
      !COMMENTS_VISIBILITY_VALUES.has(value.commentsVisibility)
    ) {
      return {
        ok: false,
        error:
          'platformDefaults.youtube.commentsVisibility must be "allowAll", "holdForReview", "holdAllForReview", or "disable".',
      };
    }
    out.commentsVisibility = value.commentsVisibility as YouTubeUserDefaults['commentsVisibility'];
  }

  if (value.commentSortOrder !== undefined) {
    if (
      typeof value.commentSortOrder !== 'string' ||
      !COMMENT_SORT_ORDER_VALUES.has(value.commentSortOrder)
    ) {
      return {
        ok: false,
        error: 'platformDefaults.youtube.commentSortOrder must be "topComments" or "newestFirst".',
      };
    }
    out.commentSortOrder = value.commentSortOrder as YouTubeUserDefaults['commentSortOrder'];
  }

  return { ok: true, value: out };
}

/**
 * Normalizes a stored `platformDefaults` document for API responses.
 * @param value - Raw Mongo sub-document.
 * @returns Typed platform defaults when present; otherwise undefined.
 */
export function normalizeStoredPlatformDefaults(value: unknown): PlatformDefaults | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  return value as PlatformDefaults;
}
