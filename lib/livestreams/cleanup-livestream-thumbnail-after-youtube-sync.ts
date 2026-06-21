import { deleteObject, isLivestreamThumbnailFinalKeyForUser } from '@/lib/r2';
import { updateLivestream } from '@/lib/repositories/livestreams';

/**
 * Clears a livestream's R2 thumbnail after it was uploaded to YouTube and stores the YouTube URL.
 * Updates the document first so a failed DB write leaves the R2 object intact for retry.
 * @param userId - Owner user id (R2 key prefix validation).
 * @param livestreamId - Livestream row id.
 * @param thumbnailR2Key - Final R2 key that was uploaded to YouTube.
 * @param youtubeThumbnailUrl - Best available thumbnail URL returned by YouTube.
 * @param thumbnailUpdatedAt - ISO timestamp recorded when the thumbnail was uploaded.
 * @returns `null` on success, or an error message when persistence failed.
 */
export async function cleanupLivestreamThumbnailAfterYouTubeSync(
  userId: string,
  livestreamId: string,
  thumbnailR2Key: string,
  youtubeThumbnailUrl: string,
  thumbnailUpdatedAt: string
): Promise<string | null> {
  const trimmedUrl = youtubeThumbnailUrl.trim();
  const trimmedUpdatedAt = thumbnailUpdatedAt.trim();
  if (!trimmedUrl) {
    return 'YouTube thumbnail URL was empty after upload.';
  }
  if (!trimmedUpdatedAt) {
    return 'YouTube thumbnail update timestamp was empty after upload.';
  }

  try {
    const updated = await updateLivestream(livestreamId, {
      thumbnailR2Key: null,
      thumbnailContentType: null,
      platformsPatch: {
        youtube: { thumbnailUrl: trimmedUrl, thumbnailUpdatedAt: trimmedUpdatedAt },
      },
    });
    if (!updated) {
      return 'Livestream not found after YouTube thumbnail upload.';
    }
  } catch (err) {
    console.error(
      `[cleanupLivestreamThumbnailAfterYouTubeSync] Failed to clear R2 thumbnail for livestream ${livestreamId}`,
      err
    );
    return 'Failed to persist YouTube thumbnail URL after upload.';
  }

  if (isLivestreamThumbnailFinalKeyForUser(thumbnailR2Key, userId, livestreamId)) {
    await deleteObject(thumbnailR2Key).catch((err) => {
      console.error(
        `[cleanupLivestreamThumbnailAfterYouTubeSync] Failed to delete R2 thumbnail ${thumbnailR2Key} for livestream ${livestreamId}`,
        err
      );
    });
  } else {
    console.warn(
      `[cleanupLivestreamThumbnailAfterYouTubeSync] Skipped R2 delete for unexpected key "${thumbnailR2Key}" (livestream ${livestreamId})`
    );
  }

  return null;
}
