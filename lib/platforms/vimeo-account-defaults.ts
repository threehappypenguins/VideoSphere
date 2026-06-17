import type { VimeoDraftFields, VimeoVideoLicense } from '@/types';
import { isVimeoVideoLicenseCode } from '@/lib/platforms/vimeo-licenses';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseVimeoLicenseValue(value: unknown): VimeoVideoLicense | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return isVimeoVideoLicenseCode(trimmed) ? trimmed : undefined;
}

/**
 * Reads the user's default upload license from `preferences.videos.license` on `GET /me`.
 * Do not use top-level `license` on the user object — that is not the upload default.
 * @param body - Parsed `/me` JSON body.
 * @returns Parsed license code, `null` for no Creative Commons default, or `undefined` when unset.
 */
export function readMeDefaultLicense(
  body: Record<string, unknown>
): VimeoVideoLicense | null | undefined {
  const preferences = isPlainObject(body.preferences) ? body.preferences : undefined;
  const prefVideos =
    preferences && isPlainObject(preferences.videos) ? preferences.videos : undefined;

  if (!prefVideos || !('license' in prefVideos)) {
    return undefined;
  }

  return parseVimeoLicenseValue(prefVideos.license);
}

/** Upload metadata defaults read from the connected Vimeo account (`GET /me`). */
export interface VimeoAccountDefaults {
  /** Default upload content rating codes from `preferences.videos.rating` on `GET /me`. */
  contentRating?: string[];
  /**
   * Default upload license from `preferences.videos.license`, or `null` when the Vimeo
   * account default is “No Creative Commons License” (upload UI: “Select a license…”).
   */
  license?: VimeoVideoLicense | null;
  /**
   * Whether upload privacy `unlisted` is supported for this Vimeo account.
   * Derived from `membership.type`, `membership.display`, or top-level `account` on `GET /me`.
   * Omitted when no plan tier could be read.
   */
  supportsUnlistedPrivacy?: boolean;
  /** Resolved plan tier code from `GET /me` when present. */
  membershipType?: string;
}

/**
 * Builds a partial Vimeo draft patch from account defaults for fields not already set on the draft.
 * @param draftFields - Current `platforms.vimeo` values on the draft.
 * @param defaults - Account defaults from the Vimeo API.
 * @returns Patch to merge onto the draft, or an empty object when nothing to seed.
 */
export function buildVimeoAccountDefaultsSeedPatch(
  draftFields: VimeoDraftFields | undefined,
  defaults: VimeoAccountDefaults
): Partial<VimeoDraftFields> {
  const vm = draftFields ?? {};
  const patch: Partial<VimeoDraftFields> = {};

  if (vm.contentRating === undefined && defaults.contentRating !== undefined) {
    patch.contentRating = defaults.contentRating;
  }
  if (vm.license === undefined && defaults.license !== undefined) {
    patch.license = defaults.license;
  }

  return patch;
}
