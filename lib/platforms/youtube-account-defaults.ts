import type { YouTubeDraftFields, YouTubeUserDefaults } from '@/types';

/** Upload metadata defaults read from the connected YouTube account. */
export interface YouTubeAccountDefaults {
  /** BCP-47 audio language from the channel or most recent upload (`snippet.defaultAudioLanguage`). */
  defaultAudioLanguage?: string;
  /** From channel `status.selfDeclaredMadeForKids` or `status.madeForKids`. */
  madeForKids?: boolean;
  /** From the nearest upcoming live broadcast video, then saved profile defaults. */
  categoryId?: string;
  /** From the most recent upload's `status.license`. */
  license?: 'youtube' | 'creativeCommon';
  /** From the most recent upload's `status.embeddable`. */
  embeddable?: boolean;
}

/** Platform YouTube fields that account defaults may seed when still unset. */
export type YouTubeAccountDefaultsSeedTarget = Pick<
  YouTubeDraftFields,
  'madeForKids' | 'defaultAudioLanguage' | 'license' | 'embeddable' | 'categoryId'
>;

/**
 * Builds a partial YouTube platform patch from account defaults for fields not already set.
 * @param platformFields - Current `platforms.youtube` values on the draft or livestream.
 * @param defaults - Account defaults from YouTube Data API.
 * @returns Patch to merge onto the row, or an empty object when nothing to seed.
 */
export function buildYouTubeAccountDefaultsSeedPatch(
  platformFields: YouTubeAccountDefaultsSeedTarget | undefined,
  defaults: YouTubeAccountDefaults
): Partial<YouTubeAccountDefaultsSeedTarget> {
  const yt = platformFields ?? {};
  const patch: Partial<YouTubeAccountDefaultsSeedTarget> = {};

  if (yt.madeForKids === undefined && defaults.madeForKids !== undefined) {
    patch.madeForKids = defaults.madeForKids;
  }
  if (!('defaultAudioLanguage' in yt) && defaults.defaultAudioLanguage !== undefined) {
    patch.defaultAudioLanguage = defaults.defaultAudioLanguage;
  }
  if (yt.license === undefined && defaults.license !== undefined) {
    patch.license = defaults.license;
  }
  if (yt.embeddable === undefined && defaults.embeddable !== undefined) {
    patch.embeddable = defaults.embeddable;
  }
  if (yt.categoryId === undefined && defaults.categoryId !== undefined) {
    patch.categoryId = defaults.categoryId;
  }

  return patch;
}

/**
 * Normalizes an optional string for YouTube field display.
 * @param value - Raw string or nullish value.
 * @returns Trimmed non-empty string, or `undefined` when unset/cleared.
 */
function normalizeYouTubeOptionalString(value: string | null | undefined): string | undefined {
  if (value == null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Resolves an optional YouTube string field for UI display.
 * Account defaults apply only when the field is absent from stored platform JSON;
 * an explicit `null` (user chose None) shows as unset without falling back.
 * @param platformFields - Current `platforms.youtube` values.
 * @param field - Field key to resolve.
 * @param accountDefault - Fallback from YouTube account defaults.
 * @returns Trimmed string for the control, or `undefined` when unset/cleared.
 */
export function resolveYouTubeOptionalFieldValue(
  platformFields: YouTubeAccountDefaultsSeedTarget | undefined,
  field: 'defaultAudioLanguage' | 'categoryId',
  accountDefault: string | undefined
): string | undefined {
  if (platformFields != null && field in platformFields) {
    return normalizeYouTubeOptionalString(platformFields[field]);
  }
  return normalizeYouTubeOptionalString(accountDefault);
}

/**
 * Applies saved profile defaults on top of values read from YouTube.
 * Profile fields win when present so user-configured defaults override channel/upload inference.
 * @param fromYouTube - Defaults inferred from the YouTube Data API.
 * @param profileDefaults - Optional `platformDefaults.youtube` from the user profile.
 * @returns Merged defaults for seeding new drafts and livestreams.
 */
export function mergeYouTubeAccountDefaults(
  fromYouTube: YouTubeAccountDefaults,
  profileDefaults: YouTubeUserDefaults | undefined
): YouTubeAccountDefaults {
  if (!profileDefaults) {
    return fromYouTube;
  }

  return {
    ...fromYouTube,
    ...(profileDefaults.defaultAudioLanguage !== undefined
      ? { defaultAudioLanguage: profileDefaults.defaultAudioLanguage }
      : {}),
    ...(profileDefaults.madeForKids !== undefined
      ? { madeForKids: profileDefaults.madeForKids }
      : {}),
    ...(profileDefaults.categoryId !== undefined ? { categoryId: profileDefaults.categoryId } : {}),
    ...(profileDefaults.license !== undefined ? { license: profileDefaults.license } : {}),
    ...(profileDefaults.embeddable !== undefined ? { embeddable: profileDefaults.embeddable } : {}),
  };
}
