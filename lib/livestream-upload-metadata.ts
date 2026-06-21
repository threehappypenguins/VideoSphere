// =============================================================================
// Livestream upload metadata — request-body parsing and platform normalization
// =============================================================================
// Shared field parsing (tags, visibility) reuses draft-upload-metadata helpers.
// Livestream-only shapes (YouTubeLivestreamFields, LIVESTREAM_PLATFORMS targets)
// are normalized here.
// =============================================================================

import {
  isPlatformUploadVisibility,
  MAX_DRAFT_TITLE_LENGTH,
  parseTagsFromRequestBody,
} from '@/lib/draft-upload-metadata';
import { uniqueTrimmedPlaylistTitles } from '@/lib/platforms/youtube';
import type {
  ConnectedAccountPlatform,
  LivestreamPlatforms,
  LivestreamStatus,
  YouTubeLivestreamFields,
} from '@/types';
import { LIVESTREAM_PLATFORMS } from '@/types';

export { isPlatformUploadVisibility, MAX_DRAFT_TITLE_LENGTH, parseTagsFromRequestBody };

/**
 * Validates optional `scheduledStartTime` from POST/PATCH JSON.
 * `null` or empty string clears the stored value; omitted fields are handled by callers.
 * @param value - Raw `scheduledStartTime` from a request body.
 * @returns Normalized ISO timestamp, `null` to clear, or a validation error message.
 */
export function parseScheduledStartTimeFromRequestBody(
  value: unknown
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === null || value === undefined || value === '') {
    return { ok: true, value: null };
  }
  if (typeof value !== 'string') {
    return { ok: false, error: 'scheduledStartTime must be a string or null' };
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return { ok: true, value: null };
  }
  const parsedMs = Date.parse(trimmed);
  if (Number.isNaN(parsedMs)) {
    return { ok: false, error: 'scheduledStartTime must be a parseable ISO datetime' };
  }
  return { ok: true, value: new Date(parsedMs).toISOString() };
}

/**
 * Validates optional `scheduledStartTimeZone` from POST/PATCH JSON.
 * `null` or empty string clears the stored value; omitted fields are handled by callers.
 * @param value - Raw `scheduledStartTimeZone` from a request body.
 * @returns Normalized IANA timezone, `null` to clear, or a validation error message.
 */
export function parseScheduledStartTimeZoneFromRequestBody(
  value: unknown
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === null || value === undefined || value === '') {
    return { ok: true, value: null };
  }
  if (typeof value !== 'string') {
    return { ok: false, error: 'scheduledStartTimeZone must be a string or null' };
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return { ok: true, value: null };
  }
  try {
    Intl.DateTimeFormat(undefined, { timeZone: trimmed });
    return { ok: true, value: trimmed };
  } catch {
    return { ok: false, error: 'scheduledStartTimeZone must be a valid IANA timezone name' };
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function trimStr(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
}

const YT_LICENSE = new Set<string>(['youtube', 'creativeCommon']);

/**
 * Normalizes a raw YouTube livestream platform object from API JSON.
 * @param y - Raw `platforms.youtube` object from a request body.
 * @returns Trimmed {@link YouTubeLivestreamFields} snapshot.
 */
function normalizeYouTubeLivestreamFields(y: Record<string, unknown>): YouTubeLivestreamFields {
  const categoryId = trimStr(y.categoryId);
  const madeForKids = typeof y.madeForKids === 'boolean' ? y.madeForKids : undefined;
  const defaultAudioLanguage = trimStr(y.defaultAudioLanguage);
  const embeddable = typeof y.embeddable === 'boolean' ? y.embeddable : undefined;
  const lic = trimStr(y.license);
  const license =
    lic && YT_LICENSE.has(lic) ? (lic as YouTubeLivestreamFields['license']) : undefined;
  const notifySubscribers =
    typeof y.notifySubscribers === 'boolean' ? y.notifySubscribers : undefined;

  let playlistIds: string[] | undefined;
  if (Array.isArray(y.playlistIds)) {
    playlistIds = y.playlistIds
      .filter((x): x is string => typeof x === 'string')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  let playlistTitles: string[] | undefined;
  if (Array.isArray(y.playlistTitles)) {
    const titles = y.playlistTitles
      .filter((x): x is string => typeof x === 'string')
      .map((s) => s.trim())
      .filter(Boolean);
    playlistTitles = titles.length > 0 ? uniqueTrimmedPlaylistTitles(titles) : undefined;
  }

  return {
    ...(categoryId !== undefined ? { categoryId } : {}),
    ...(madeForKids !== undefined ? { madeForKids } : {}),
    ...(defaultAudioLanguage !== undefined ? { defaultAudioLanguage } : {}),
    ...(embeddable !== undefined ? { embeddable } : {}),
    ...(license !== undefined ? { license } : {}),
    ...(notifySubscribers !== undefined ? { notifySubscribers } : {}),
    ...(playlistIds !== undefined ? { playlistIds } : {}),
    ...(playlistTitles !== undefined ? { playlistTitles } : {}),
  };
}

/**
 * Normalizes the full `platforms` object on livestream create bodies.
 * @param raw - Raw `platforms` value from a request body.
 * @returns Normalized {@link LivestreamPlatforms}.
 */
function normalizeLivestreamPlatforms(raw: unknown): LivestreamPlatforms {
  if (!isPlainObject(raw)) return {};
  const result: LivestreamPlatforms = {};
  if (isPlainObject(raw.youtube)) {
    result.youtube = normalizeYouTubeLivestreamFields(raw.youtube);
  }
  return result;
}

/**
 * Validate `targets` from POST/PATCH body: non-empty, livestream platforms only.
 * @param value - Raw `targets` array from a request body.
 * @returns Parsed targets or a validation error message.
 */
export function parseLivestreamTargetsFromRequestBody(
  value: unknown
): { ok: true; value: ConnectedAccountPlatform[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) {
    return { ok: false, error: 'targets must be a non-empty array of platform ids' };
  }

  const allowed = new Set<string>(LIVESTREAM_PLATFORMS);
  const platforms: ConnectedAccountPlatform[] = [];

  for (const entry of value) {
    if (typeof entry !== 'string' || !allowed.has(entry)) {
      return {
        ok: false,
        error: `targets must only include: ${LIVESTREAM_PLATFORMS.join(', ')}`,
      };
    }
    platforms.push(entry as ConnectedAccountPlatform);
  }

  const unique = [...new Set(platforms)];
  if (unique.length === 0) {
    return {
      ok: false,
      error: `targets must include at least one of: ${LIVESTREAM_PLATFORMS.join(', ')}`,
    };
  }

  return { ok: true, value: unique };
}

/**
 * Validates livestream `targets` when an empty selection is allowed (draft create/save before scheduling).
 * @param value - Raw `targets` array from a request body.
 * @returns Parsed targets or a validation error message.
 */
export function parseLivestreamTargetsAllowEmpty(
  value: unknown
): { ok: true; value: ConnectedAccountPlatform[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) {
    return { ok: false, error: 'targets must be an array of platform ids' };
  }

  const allowed = new Set<string>(LIVESTREAM_PLATFORMS);
  const platforms: ConnectedAccountPlatform[] = [];

  for (const entry of value) {
    if (typeof entry !== 'string' || !allowed.has(entry)) {
      return {
        ok: false,
        error: `targets must only include: ${LIVESTREAM_PLATFORMS.join(', ')}`,
      };
    }
    platforms.push(entry as ConnectedAccountPlatform);
  }

  return { ok: true, value: [...new Set(platforms)] };
}

/**
 * Validate optional `platforms` on **POST** bodies: trims strings, drops empties, full normalized snapshot.
 * @param value - Raw `platforms` value from a request body.
 * @returns Normalized platforms or a validation error message.
 */
export function parseLivestreamPlatformsFromRequestBody(
  value: unknown
): { ok: true; value: LivestreamPlatforms } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: {} };
  if (value === null) return { ok: true, value: {} };
  if (!isPlainObject(value)) {
    return { ok: false, error: 'platforms must be a JSON object' };
  }
  return { ok: true, value: normalizeLivestreamPlatforms(value) };
}

/**
 * YouTube fields managed by the server (thumbnail sync) that client PATCH bodies must not overwrite.
 */
const SERVER_MANAGED_YOUTUBE_LIVESTREAM_PATCH_KEYS = new Set([
  'thumbnailUrl',
  'thumbnailUpdatedAt',
]);

/**
 * Removes server-managed YouTube livestream fields from a client PATCH `platforms` object.
 * @param patch - Raw partial `platforms` object from a PATCH body.
 * @returns Sanitized patch safe to merge into stored platforms.
 */
export function stripServerManagedLivestreamPlatformsPatch(patch: unknown): unknown {
  if (!isPlainObject(patch) || !isPlainObject(patch.youtube)) {
    return patch;
  }

  const youtube = { ...patch.youtube };
  for (const key of SERVER_MANAGED_YOUTUBE_LIVESTREAM_PATCH_KEYS) {
    delete youtube[key];
  }

  return {
    ...patch,
    youtube,
  };
}

/**
 * Removes playlist fields from a client PATCH when the livestream is no longer a draft.
 * Playlist is set at schedule time and must be changed in YouTube Studio afterward.
 * @param patch - Raw partial `platforms` object from a PATCH body.
 * @param status - Current livestream lifecycle status.
 * @returns Sanitized patch safe to merge into stored platforms.
 */
export function stripLockedLivestreamPlatformsPatchForStatus(
  patch: unknown,
  status: LivestreamStatus
): unknown {
  const sanitized = stripServerManagedLivestreamPlatformsPatch(patch);
  if (status === 'draft' || !isPlainObject(sanitized) || !isPlainObject(sanitized.youtube)) {
    return sanitized;
  }

  const youtube = { ...sanitized.youtube };
  delete youtube.playlistIds;
  delete youtube.playlistTitles;

  return {
    ...sanitized,
    youtube,
  };
}

/**
 * Validate `platforms` on **PATCH** bodies: must be a plain object or `null` (treated as `{}`).
 * Returns the raw value so merge semantics match {@link mergeLivestreamPlatformsPatch}.
 * @param value - Raw `platforms` value from a PATCH body.
 * @returns Raw patch object or a validation error message.
 */
export function parseLivestreamPlatformsPatchBody(
  value: unknown
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (value === null || value === undefined) {
    return { ok: true, value: {} };
  }
  if (!isPlainObject(value)) {
    return { ok: false, error: 'platforms must be a JSON object' };
  }
  return { ok: true, value: stripServerManagedLivestreamPlatformsPatch(value) };
}

/**
 * Merge a partial `platforms` object from PATCH JSON into the stored livestream shape.
 * Only keys present on the patch object update that field.
 * @param base - Current stored platforms snapshot.
 * @param patch - Raw partial `platforms` object from the PATCH body.
 * @returns Merged platforms snapshot.
 */
export function mergeLivestreamPlatformsPatch(
  base: LivestreamPlatforms,
  patch: unknown
): LivestreamPlatforms {
  if (!isPlainObject(patch)) return base;
  const next: LivestreamPlatforms = { ...base };

  if (isPlainObject(patch.youtube)) {
    const p = patch.youtube;
    const yb: YouTubeLivestreamFields = { ...base.youtube };

    if ('categoryId' in p) {
      const c = p.categoryId;
      yb.categoryId = typeof c === 'string' && c.trim() !== '' ? c.trim() : undefined;
    }
    if ('madeForKids' in p) {
      yb.madeForKids = typeof p.madeForKids === 'boolean' ? p.madeForKids : undefined;
    }
    if ('defaultAudioLanguage' in p) {
      const s = p.defaultAudioLanguage;
      yb.defaultAudioLanguage = typeof s === 'string' && s.trim() !== '' ? s.trim() : undefined;
    }
    if ('embeddable' in p) {
      yb.embeddable = typeof p.embeddable === 'boolean' ? p.embeddable : undefined;
    }
    if ('license' in p) {
      const lic = p.license;
      yb.license = lic === 'youtube' || lic === 'creativeCommon' ? lic : undefined;
    }
    if ('notifySubscribers' in p) {
      yb.notifySubscribers =
        typeof p.notifySubscribers === 'boolean' ? p.notifySubscribers : undefined;
    }
    if ('playlistIds' in p) {
      if (Array.isArray(p.playlistIds)) {
        yb.playlistIds = p.playlistIds
          .filter((x): x is string => typeof x === 'string')
          .map((s) => s.trim())
          .filter(Boolean);
      } else {
        yb.playlistIds = undefined;
      }
    }
    if ('playlistTitles' in p) {
      if (Array.isArray(p.playlistTitles)) {
        const titles = p.playlistTitles
          .filter((x): x is string => typeof x === 'string')
          .map((s) => s.trim())
          .filter(Boolean);
        yb.playlistTitles = titles.length > 0 ? uniqueTrimmedPlaylistTitles(titles) : undefined;
      } else {
        yb.playlistTitles = undefined;
      }
    }
    if ('thumbnailUrl' in p) {
      const url = p.thumbnailUrl;
      yb.thumbnailUrl = typeof url === 'string' && url.trim() !== '' ? url.trim() : undefined;
    }
    if ('thumbnailUpdatedAt' in p) {
      const updatedAt = p.thumbnailUpdatedAt;
      yb.thumbnailUpdatedAt =
        typeof updatedAt === 'string' && updatedAt.trim() !== '' ? updatedAt.trim() : undefined;
    }

    next.youtube = yb;
  }

  return next;
}
