import { finalizeUploadJobAndDistribute } from '@/lib/api/finalize-upload-job';
import { markDraftUsedInUpload } from '@/lib/repositories/drafts';
import {
  getYoutubeImportJobById,
  updateYoutubeImportJobStatus,
} from '@/lib/repositories/youtube-import-jobs';
import { getUploadJobById } from '@/lib/repositories/upload-jobs';
import { isActiveYoutubeImportStatus } from '@/lib/youtube-import/import-job-ui';
import type { YoutubeImportJob } from '@/types';

/**
 * Starts platform distribution for a staged YouTube import upload job.
 * @param importJob - Completed import job linked to an upload job.
 * @param userId - Owning user id.
 * @returns Whether distribution was started.
 */
export async function distributeStagedYoutubeImportUpload(
  importJob: YoutubeImportJob,
  userId: string
): Promise<{ distributing: boolean }> {
  if (!importJob.uploadJobId) {
    throw new Error('Import job has no linked upload job');
  }

  const uploadJob = await getUploadJobById(importJob.uploadJobId);
  if (!uploadJob) {
    throw new Error('Linked upload job no longer exists');
  }

  if (uploadJob.status === 'distributing' || uploadJob.status === 'completed') {
    return { distributing: uploadJob.status === 'distributing' };
  }

  const result = await finalizeUploadJobAndDistribute(importJob.uploadJobId, userId);

  if (importJob.draftId) {
    await markDraftUsedInUpload(importJob.draftId, uploadJob.$createdAt).catch((error) => {
      console.error(
        `[distributeStagedYoutubeImportUpload] Failed to mark draft ${importJob.draftId} used:`,
        error
      );
    });
  }

  return result;
}

/**
 * Queues platform distribution for a YouTube import. If staging already finished,
 * distribution starts immediately.
 * @param jobId - Import job id.
 * @param userId - Authenticated user id; must own the job.
 * @returns Updated import job after queueing (and optional immediate distribute).
 */
export async function queueYoutubeImportDistribute(
  jobId: string,
  userId: string
): Promise<YoutubeImportJob> {
  const job = await getYoutubeImportJobById(jobId);
  if (!job) {
    throw new Error('YouTube import job not found');
  }
  if (job.userId !== userId) {
    throw new Error('You do not have access to this import job');
  }
  if (job.status === 'failed' || job.status === 'cancelled') {
    throw new Error('This import job can no longer be uploaded');
  }

  await updateYoutubeImportJobStatus(jobId, { distributeQueued: true });

  const refreshed = await getYoutubeImportJobById(jobId);
  if (!refreshed) {
    throw new Error('YouTube import job not found');
  }

  if (refreshed.status === 'completed' && refreshed.uploadJobId) {
    await distributeStagedYoutubeImportUpload(refreshed, userId);
    return refreshed;
  }

  if (isActiveYoutubeImportStatus(refreshed.status)) {
    return refreshed;
  }

  throw new Error('Import job is not ready to upload');
}
