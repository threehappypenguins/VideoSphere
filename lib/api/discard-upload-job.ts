import { cleanupDistributedDraftThumbnails } from '@/lib/api/distribute';
import { buildMetadataForPlatform } from '@/lib/draft-upload-metadata';
import { deleteObject, R2ObjectNotFoundError } from '@/lib/r2';
import { getDraftById } from '@/lib/repositories/drafts';
import { getPlatformUploadsByJob } from '@/lib/repositories/platform-uploads';
import { getUploadJobById, updateUploadJobStatus } from '@/lib/repositories/upload-jobs';
import type { PlatformUploadMetadata } from '@/lib/platforms/types';
import { latestPlatformUploadsPerPlatform } from '@/lib/utils/platform-uploads';

/** Result of attempting to discard a failed upload job and its R2 artifacts. */
export type DiscardFailedUploadJobResult =
  | { ok: true; jobId: string }
  | { ok: false; status: number; error: string };

/**
 * Marks a failed upload job as cancelled and deletes its temporary R2 video and draft thumbnails.
 * Used when the user gives up on retrying failed platform uploads.
 * @param jobId - Upload job identifier.
 * @param userId - Authenticated owner of the job.
 * @returns Success or an HTTP-style error payload.
 */
export async function discardFailedUploadJob(
  jobId: string,
  userId: string
): Promise<DiscardFailedUploadJobResult> {
  const job = await getUploadJobById(jobId);
  if (!job || job.userId !== userId) {
    return { ok: false, status: 404, error: 'Upload job not found' };
  }

  if (job.status === 'distributing') {
    return {
      ok: false,
      status: 409,
      error: 'Upload job is currently distributing. Please wait for it to finish.',
    };
  }

  if (job.status !== 'failed') {
    return {
      ok: false,
      status: 409,
      error: 'Only failed upload jobs can be cancelled from history.',
    };
  }

  const updated = await updateUploadJobStatus(jobId, 'cancelled', null);
  if (!updated) {
    return { ok: false, status: 404, error: 'Upload job not found' };
  }

  if (job.r2Key) {
    await deleteObject(job.r2Key).catch((error) => {
      if (error instanceof R2ObjectNotFoundError) {
        return;
      }
      console.error(
        `[discardFailedUploadJob] Failed to delete R2 video for cancelled job ${jobId}:`,
        error
      );
    });
  }

  if (job.draftId) {
    const draft = await getDraftById(job.draftId);
    if (draft && draft.userId === userId) {
      const allUploads = await getPlatformUploadsByJob(job.id);
      const latestByPlatform = latestPlatformUploadsPerPlatform(allUploads);
      if (latestByPlatform.length > 0) {
        const metadataByPlatformId = new Map<string, PlatformUploadMetadata>();
        for (const platformUpload of latestByPlatform) {
          metadataByPlatformId.set(
            platformUpload.id,
            buildMetadataForPlatform(draft, platformUpload.platform)
          );
        }
        await cleanupDistributedDraftThumbnails(
          job.id,
          userId,
          draft.id,
          latestByPlatform,
          metadataByPlatformId
        ).catch((error) => {
          console.error(
            `[discardFailedUploadJob] Draft thumbnail cleanup failed for job ${jobId} (non-fatal):`,
            error
          );
        });
      }
    }
  }

  return { ok: true, jobId };
}
