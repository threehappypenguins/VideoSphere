import type { PlatformUploadVisibility } from '@/types';

/**
 * Vimeo membership types that cannot use the API `privacy.view` value `unlisted`.
 * Unlisted requires Starter, Standard, Advanced, or higher (see Vimeo upload docs).
 */
const VIMEO_MEMBERSHIP_TYPES_WITHOUT_UNLISTED = new Set(['free', 'basic']);

/**
 * Whether a Vimeo `membership.type` from `GET /me` supports unlisted upload privacy.
 * @param membershipType - Raw `membership.type` string from the Vimeo API.
 * @returns `true` when unlisted uploads are supported for this membership.
 */
export function vimeoMembershipTypeSupportsUnlistedPrivacy(
  membershipType: string | null | undefined
): boolean {
  if (typeof membershipType !== 'string' || membershipType.trim() === '') {
    return false;
  }
  return !VIMEO_MEMBERSHIP_TYPES_WITHOUT_UNLISTED.has(membershipType.trim().toLowerCase());
}

/**
 * Reads `membership.type` from a parsed Vimeo `GET /me` response body.
 * @param body - Parsed `/me` JSON body.
 * @returns Trimmed membership type, or `undefined` when absent.
 */
export function readMembershipTypeFromMeBody(body: Record<string, unknown>): string | undefined {
  const membership = body.membership;
  if (membership === null || typeof membership !== 'object' || Array.isArray(membership)) {
    return undefined;
  }
  const type = (membership as Record<string, unknown>).type;
  if (typeof type !== 'string') {
    return undefined;
  }
  const trimmed = type.trim();
  return trimmed || undefined;
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
 * @param params.vimeoSupportsUnlisted - From connected Vimeo account metadata; `false` when known unsupported; `true` or unknown while loading when support is not confirmed unsupported.
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
 * @param params.vimeoSupportsUnlisted - From connected Vimeo account metadata.
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
 * @param params.vimeoSupportsUnlisted - From connected Vimeo account metadata.
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
