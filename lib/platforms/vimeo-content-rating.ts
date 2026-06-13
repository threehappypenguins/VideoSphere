/** Vimeo API code for the All Audiences upload choice. */
export const VIMEO_CONTENT_RATING_SAFE = 'safe';

/** Vimeo API code for the Not Yet Rated state (not offered in the upload UI dropdown). */
export const VIMEO_CONTENT_RATING_UNRATED = 'unrated';

/** Select value for the Mature primary dropdown option (not a Vimeo API code). */
export const VIMEO_CONTENT_RATING_TIER_MATURE = '__vimeo_tier_mature__';

/** Primary audience tier codes from `GET /contentratings` — excluded from mature checkboxes. */
export const VIMEO_PRIMARY_TIER_CODES = new Set([
  VIMEO_CONTENT_RATING_SAFE,
  VIMEO_CONTENT_RATING_UNRATED,
]);

/**
 * Primary audience tier shown in the Vimeo content rating dropdown.
 * Matches the Vimeo upload UI: All audiences or Mature (with detail flags).
 */
export type VimeoContentRatingTier = 'all_audiences' | 'mature';

/**
 * One content rating row from `GET /contentratings`.
 * @property code - Vimeo API code.
 * @property name - Human-readable label from the Vimeo API.
 */
export interface VimeoContentRatingOption {
  code: string;
  name: string;
}

/**
 * One primary dropdown option derived from fetched Vimeo content rating rows.
 * @property tier - Audience tier represented by the option.
 * @property value - Select control value.
 * @property label - Display label (from the API for `safe`; fixed for Mature).
 */
export interface VimeoPrimaryContentRatingOption {
  tier: VimeoContentRatingTier;
  value: string;
  label: string;
}

/**
 * Returns whether a content rating code is a mature-detail flag (not All audiences or Not Yet Rated).
 * @param code - Content rating code from the Vimeo API.
 * @returns True when the code belongs in the Mature detail multi-select.
 */
export function isVimeoMatureDetailCode(code: string): boolean {
  return !VIMEO_PRIMARY_TIER_CODES.has(code);
}

/**
 * Keeps mature-detail options from `GET /contentratings` for the secondary multi-select.
 * Excludes primary audience tiers (`safe`, `unrated`) only — all other API rows are shown.
 * @param items - Raw content rating rows from the Vimeo API.
 * @returns Rows suitable for the Mature detail checkboxes.
 */
export function filterVimeoMatureDetailOptions(
  items: VimeoContentRatingOption[]
): VimeoContentRatingOption[] {
  return items.filter((item) => isVimeoMatureDetailCode(item.code));
}

/**
 * Builds primary dropdown options from raw Vimeo content rating rows.
 * Only includes tiers present in the API response: `safe` → All audiences, and Mature
 * when at least one mature-detail row is available. Vimeo's upload UI does not expose
 * `unrated` as a selectable rating — that code represents the absence of a rating.
 * @param items - Raw content rating rows from the Vimeo API.
 * @returns Primary audience options for the upload dropdown.
 */
export function buildVimeoPrimaryTierOptions(
  items: VimeoContentRatingOption[]
): VimeoPrimaryContentRatingOption[] {
  const byCode = new Map(items.map((item) => [item.code, item]));
  const options: VimeoPrimaryContentRatingOption[] = [];

  const safe = byCode.get(VIMEO_CONTENT_RATING_SAFE);
  if (safe) {
    options.push({
      tier: 'all_audiences',
      value: VIMEO_CONTENT_RATING_SAFE,
      label: safe.name,
    });
  }

  if (filterVimeoMatureDetailOptions(items).length > 0) {
    options.push({
      tier: 'mature',
      value: VIMEO_CONTENT_RATING_TIER_MATURE,
      label: 'Mature',
    });
  }

  return options;
}

/**
 * Maps stored draft or account-default codes to the primary tier and selected mature flags.
 * @param codes - Stored `contentRating` codes.
 * @returns Parsed tier and mature-detail selections.
 */
export function parseVimeoContentRatingTier(codes: string[] | undefined): {
  tier: VimeoContentRatingTier | undefined;
  matureDetails: string[];
} {
  if (codes === undefined) {
    return { tier: undefined, matureDetails: [] };
  }

  if (codes.length === 0) {
    return { tier: 'mature', matureDetails: [] };
  }

  const normalized = [...new Set(codes.map((code) => code.trim()).filter(Boolean))];

  const matureDetails = normalized.filter(isVimeoMatureDetailCode);
  if (matureDetails.length > 0) {
    return { tier: 'mature', matureDetails };
  }

  if (normalized.includes(VIMEO_CONTENT_RATING_SAFE)) {
    return { tier: 'all_audiences', matureDetails: [] };
  }

  return { tier: undefined, matureDetails: [] };
}

/**
 * Builds the `content_rating` array for a primary tier selection.
 * @param tier - Selected audience tier.
 * @param matureDetails - Selected mature-detail codes when tier is `mature`.
 * @returns API payload codes for the tier.
 */
export function buildVimeoContentRatingPayload(
  tier: VimeoContentRatingTier,
  matureDetails: string[]
): string[] {
  if (tier === 'all_audiences') {
    return [VIMEO_CONTENT_RATING_SAFE];
  }
  return matureDetails.filter(isVimeoMatureDetailCode);
}

/**
 * Normalizes draft or account-default `contentRating` values to API codes.
 * @param value - Raw draft or `/me` value.
 * @returns Canonical code list, or undefined when unset or invalid.
 */
export function normalizeVimeoContentRatingCodes(value: unknown): string[] | undefined {
  let codes: string[] | undefined;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    codes = trimmed !== '' ? [trimmed] : undefined;
  } else if (Array.isArray(value)) {
    if (value.length === 0) {
      return [];
    }
    codes = value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean);
  } else {
    return undefined;
  }

  if (!codes || codes.length === 0) {
    return undefined;
  }

  const unique = [...new Set(codes)];
  const matureDetails = unique.filter(isVimeoMatureDetailCode);
  if (matureDetails.length > 0) {
    return matureDetails;
  }
  if (unique.includes(VIMEO_CONTENT_RATING_SAFE)) {
    return [VIMEO_CONTENT_RATING_SAFE];
  }

  return undefined;
}

/**
 * Resolves the account content rating default from `/me` and fetched `/contentratings` rows.
 * Uses the user's upload default when configured; otherwise leaves the field unset so Vimeo
 * applies its implicit not-yet-rated state on create.
 * @param userCodes - Raw codes from `preferences.videos.rating` on `/me`, if any.
 * @param apiOptions - Content rating rows from `GET /contentratings`.
 * @returns Normalized default codes for seeding the draft UI, or undefined when unset.
 */
export function resolveVimeoAccountContentRatingDefault(
  userCodes: string[] | undefined,
  apiOptions: VimeoContentRatingOption[]
): string[] | undefined {
  const apiCodes = new Set(apiOptions.map((option) => option.code));

  if (userCodes && userCodes.length > 0) {
    const knownUserCodes = userCodes.filter((code) => apiCodes.has(code));
    if (knownUserCodes.length === 0) {
      return undefined;
    }
    return normalizeVimeoContentRatingCodes(knownUserCodes);
  }

  return undefined;
}

/**
 * Builds the `content_rating` array for Vimeo video create from stored draft codes.
 * @param codes - Stored draft `contentRating` codes.
 * @returns API payload array, or undefined to omit the field.
 */
export function vimeoContentRatingForUpload(codes: string[] | undefined): string[] | undefined {
  const normalized = normalizeVimeoContentRatingCodes(codes);
  if (normalized === undefined || normalized.length === 0) {
    return undefined;
  }

  const { tier, matureDetails } = parseVimeoContentRatingTier(normalized);
  if (tier === undefined) {
    return undefined;
  }
  if (tier === 'mature') {
    return matureDetails.length > 0 ? matureDetails : undefined;
  }

  return buildVimeoContentRatingPayload(tier, []);
}

/**
 * Reads default upload content rating codes from a Vimeo `GET /me` response.
 * Upload defaults live at `preferences.videos.rating` (Settings → Upload defaults).
 * Do not use `content_filter` — that field lists feed filter codes, not upload defaults.
 * @param body - Parsed `/me` JSON body.
 * @returns Raw content rating codes when present.
 */
export function readMeDefaultContentRatingCodes(
  body: Record<string, unknown>
): string[] | undefined {
  const preferences = isPlainObject(body.preferences) ? body.preferences : undefined;
  const prefVideos =
    preferences && isPlainObject(preferences.videos) ? preferences.videos : undefined;

  if (prefVideos && Array.isArray(prefVideos.rating)) {
    const codes = normalizeStringArray(prefVideos.rating);
    if (codes.length > 0) {
      return codes;
    }
  }

  const candidates: unknown[] = [];

  if (Array.isArray(body.content_rating)) {
    candidates.push(body.content_rating);
  }

  const videos = isPlainObject(body.videos) ? body.videos : undefined;
  if (videos && Array.isArray(videos.content_rating)) {
    candidates.push(videos.content_rating);
  }

  if (prefVideos && Array.isArray(prefVideos.content_rating)) {
    candidates.push(prefVideos.content_rating);
  }

  for (const raw of candidates) {
    const codes = normalizeStringArray(raw as unknown[]);
    if (codes.length > 0) {
      return codes;
    }
  }

  return undefined;
}

function normalizeStringArray(value: unknown[]): string[] {
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
