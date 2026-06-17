import type { PlatformUploadVisibility } from '@/types';
import type { VimeoAccountDefaults } from '@/lib/platforms/vimeo-account-defaults';

/**
 * Vimeo `membership.type` values that may use API `privacy.view` `unlisted`.
 * @see https://developer.vimeo.com/api/guides/videos/interact — unlisted is only available
 *      for Vimeo Starter, Standard, or Advanced members.
 */
const VIMEO_MEMBERSHIP_TYPES_WITH_UNLISTED = new Set(['starter', 'standard', 'advanced']);

/** Maps `membership.display` labels to `membership.type` when labels differ. */
const MEMBERSHIP_DISPLAY_TO_TYPE: Record<string, string> = {
  'business live': 'live_business',
  'pro live': 'live_pro',
  'pro unlimited': 'pro_unlimited',
  'ott custom': 'ott_custom',
};

/**
 * Whether a Vimeo plan tier from `GET /me` supports unlisted upload privacy.
 * @param planTier - `membership.type` (or equivalent) from the Vimeo API.
 * @returns `true` only for Starter, Standard, and Advanced; `false` for all other known tiers.
 */
export function vimeoMembershipTypeSupportsUnlistedPrivacy(
  planTier: string | null | undefined
): boolean {
  if (typeof planTier !== 'string' || planTier.trim() === '') {
    return false;
  }
  return VIMEO_MEMBERSHIP_TYPES_WITH_UNLISTED.has(planTier.trim().toLowerCase());
}

/**
 * Normalizes a Vimeo `membership.display` label to a `membership.type` code.
 * @param display - Human-readable membership label from `GET /me`.
 * @returns Lowercase type code used by {@link vimeoMembershipTypeSupportsUnlistedPrivacy}.
 */
export function normalizeVimeoMembershipDisplayToType(display: string): string {
  const key = display.trim().toLowerCase();
  return MEMBERSHIP_DISPLAY_TO_TYPE[key] ?? key.replace(/\s+/g, '_');
}

/**
 * Reads the Vimeo plan tier from a parsed `GET /me` response body.
 * @see https://developer.vimeo.com/api/reference/response/membership
 * @param body - Parsed `/me` JSON body.
 * @returns Plan tier code, or `undefined` when absent.
 */
export function readMembershipTypeFromMeBody(body: Record<string, unknown>): string | undefined {
  const membership = body.membership;
  if (membership !== null && typeof membership === 'object' && !Array.isArray(membership)) {
    const record = membership as Record<string, unknown>;
    const type = record.type;
    if (typeof type === 'string') {
      const trimmed = type.trim();
      if (trimmed) return trimmed;
    }
    const display = record.display;
    if (typeof display === 'string' && display.trim()) {
      return normalizeVimeoMembershipDisplayToType(display);
    }
  }

  const account = body.account;
  if (typeof account === 'string') {
    const trimmed = account.trim();
    if (trimmed) return trimmed;
  }

  return undefined;
}

/**
 * Resolves Vimeo unlisted support for draft privacy UI from loaded account defaults.
 * @param params.vimeoTargetActive - Whether Vimeo is a selected publish target.
 * @param params.metadataLoaded - Whether Vimeo metadata has finished loading (success or failure).
 * @param params.accountDefaults - Account defaults from `/api/platforms/vimeo/metadata-options`.
 * @returns `true`/`false` when plan tier was resolved; `null` while loading or when tier is unknown.
 */
export function resolveVimeoSupportsUnlistedForPrivacyUi(params: {
  vimeoTargetActive: boolean;
  metadataLoaded: boolean;
  accountDefaults: VimeoAccountDefaults | undefined;
}): boolean | null {
  if (!params.vimeoTargetActive) {
    return true;
  }
  if (!params.metadataLoaded) {
    return null;
  }
  if (params.accountDefaults?.supportsUnlistedPrivacy !== undefined) {
    return params.accountDefaults.supportsUnlistedPrivacy;
  }
  return null;
}

/** Draft editor privacy select options (YouTube-compatible labels). */
export const DRAFT_VISIBILITY_OPTIONS: Array<{
  value: PlatformUploadVisibility;
  label: string;
}> = [
  { value: 'public', label: 'Public' },
  { value: 'unlisted', label: 'Unlisted' },
  { value: 'private', label: 'Private' },
];

/** Privacy select context in the draft metadata modal. */
export type DraftPrivacyUiScope = 'shared' | 'youtube' | 'vimeo';

/**
 * Whether the Unlisted option should appear for a privacy select in the draft editor.
 * @param params.scope - Shared privacy or a per-platform override row.
 * @param params.vimeoSupportsUnlisted - `false` when known unsupported; `true` or `null`/`undefined` when allowed or unknown.
 * @param params.selectedPrivacyPlatforms - Selected targets that expose privacy (YouTube and/or Vimeo).
 * @returns `true` when Unlisted should be listed in the dropdown.
 */
export function shouldIncludeUnlistedVisibilityOption(params: {
  scope: DraftPrivacyUiScope;
  vimeoSupportsUnlisted: boolean | null | undefined;
  selectedPrivacyPlatforms: readonly ('youtube' | 'vimeo')[];
}): boolean {
  if (params.scope === 'youtube') {
    return true;
  }
  if (params.scope === 'vimeo') {
    return params.vimeoSupportsUnlisted !== false;
  }
  if (params.selectedPrivacyPlatforms.includes('vimeo')) {
    return params.vimeoSupportsUnlisted !== false;
  }
  return true;
}

/**
 * Privacy options for a draft editor select, omitting Unlisted when the Vimeo account cannot use it.
 * @param params.scope - Shared privacy or a per-platform override row.
 * @param params.vimeoSupportsUnlisted - From {@link resolveVimeoSupportsUnlistedForPrivacyUi}.
 * @param params.selectedPrivacyPlatforms - Selected targets that expose privacy.
 * @returns Filtered visibility options for the select.
 */
export function visibilityOptionsForPrivacyUi(params: {
  scope: DraftPrivacyUiScope;
  vimeoSupportsUnlisted: boolean | null | undefined;
  selectedPrivacyPlatforms: readonly ('youtube' | 'vimeo')[];
}): Array<{ value: PlatformUploadVisibility; label: string }> {
  if (shouldIncludeUnlistedVisibilityOption(params)) {
    return DRAFT_VISIBILITY_OPTIONS;
  }
  return DRAFT_VISIBILITY_OPTIONS.filter((option) => option.value !== 'unlisted');
}

/**
 * Resolves a visibility value that is valid for the given privacy UI scope.
 * Maps unsupported `unlisted` to `public`.
 * @param visibility - Current visibility value.
 * @param params.scope - Shared privacy or a per-platform override row.
 * @param params.vimeoSupportsUnlisted - From {@link resolveVimeoSupportsUnlistedForPrivacyUi}.
 * @param params.selectedPrivacyPlatforms - Selected targets that expose privacy.
 * @returns A visibility value allowed in the select for this scope.
 */
export function clampVisibilityForPrivacyUi(
  visibility: PlatformUploadVisibility,
  params: {
    scope: DraftPrivacyUiScope;
    vimeoSupportsUnlisted: boolean | null | undefined;
    selectedPrivacyPlatforms: readonly ('youtube' | 'vimeo')[];
  }
): PlatformUploadVisibility {
  if (visibility !== 'unlisted') {
    return visibility;
  }
  if (shouldIncludeUnlistedVisibilityOption({ ...params, scope: params.scope })) {
    return visibility;
  }
  return 'public';
}
