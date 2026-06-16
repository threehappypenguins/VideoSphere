import { DRAFT_THUMBNAIL_PLATFORMS } from '@/lib/draft-thumbnail';
import { getObjectUrl, isDraftThumbnailFinalKeyForUser } from '@/lib/r2';
import type { DraftPlatforms } from '@/types';

/**
 * Adds ephemeral presigned `thumbnailPreviewUrlOverride` values for platforms that store
 * per-platform thumbnail overrides. Preview URLs are not persisted in draft document JSON.
 * @param platforms - Stored platform fields from the draft document.
 * @param userId - Authenticated owner of the draft.
 * @param draftId - Draft id used to validate thumbnail key prefixes.
 * @returns Platform fields with preview URLs merged in when presign succeeds.
 */
export async function draftPlatformsWithThumbnailPreviewOverrides(
  platforms: DraftPlatforms,
  userId: string,
  draftId: string
): Promise<DraftPlatforms> {
  let next: DraftPlatforms | null = null;

  for (const platform of DRAFT_THUMBNAIL_PLATFORMS) {
    const fields = platforms[platform];
    const key = fields?.thumbnailR2KeyOverride?.trim();
    if (!key || !isDraftThumbnailFinalKeyForUser(key, userId, draftId)) {
      continue;
    }

    let thumbnailPreviewUrlOverride: string | undefined;
    try {
      thumbnailPreviewUrlOverride = await getObjectUrl(key);
    } catch {
      thumbnailPreviewUrlOverride = undefined;
    }
    if (!thumbnailPreviewUrlOverride) {
      continue;
    }

    if (!next) {
      next = { ...platforms };
    }
    next = {
      ...next,
      [platform]: { ...fields, thumbnailPreviewUrlOverride },
    } as DraftPlatforms;
  }

  return next ?? platforms;
}
