/**
 * Client-safe draft title resolution (no server-only imports).
 * Used by the draft editor and by server persistence via re-export from draft-upload-metadata.
 */

import type { ConnectedAccountPlatform, DraftPlatforms } from '@/types';

/**
 * Platforms that may store `titleOverride`, in stable order for
 * {@link resolveDraftTitleForStorage} when the shared draft title is empty.
 */
export const DRAFT_TITLE_OVERRIDE_PLATFORM_ORDER = [
  'youtube',
  'vimeo',
  'sermon_audio',
  'facebook',
] as const satisfies readonly ConnectedAccountPlatform[];

/**
 * Draft fields used to resolve the document root `title` for storage and list labels.
 * @property title - Shared title at the document root.
 * @property targets - Selected publish targets.
 * @property platforms - Per-platform override fields.
 */
export interface ResolveDraftTitleInput {
  title: string;
  targets: readonly ConnectedAccountPlatform[];
  platforms: DraftPlatforms;
}

/**
 * Resolves the draft document root `title` for persistence and history labels.
 * When the shared title is empty, uses the first non-empty `titleOverride` among
 * selected targets in {@link DRAFT_TITLE_OVERRIDE_PLATFORM_ORDER}.
 * @param input - Shared title, targets, and platform overrides.
 * @returns Trimmed title to store on the draft document root.
 */
export function resolveDraftTitleForStorage(input: ResolveDraftTitleInput): string {
  const shared = input.title.trim();
  if (shared) return shared;

  for (const platform of DRAFT_TITLE_OVERRIDE_PLATFORM_ORDER) {
    if (!input.targets.includes(platform)) continue;
    const override = input.platforms[platform]?.titleOverride?.trim();
    if (override) return override;
  }
  return '';
}

/**
 * Whether a draft has a title that can be persisted (shared or first platform override).
 * @param input - Shared title, targets, and platform overrides.
 * @returns `true` when {@link resolveDraftTitleForStorage} would return a non-empty string.
 */
export function draftHasPersistableTitle(input: ResolveDraftTitleInput): boolean {
  return resolveDraftTitleForStorage(input) !== '';
}
