import { deleteObject, R2ObjectNotFoundError } from '@/lib/r2';
import { getDraftById } from '@/lib/repositories/drafts';
import {
  getYoutubeImportJobById,
  getYoutubeImportJobForDraftEditor,
  updateYoutubeImportJobStatus,
} from '@/lib/repositories/youtube-import-jobs';
import { getUploadJobById, updateUploadJobStatus } from '@/lib/repositories/upload-jobs';
import { isActiveYoutubeImportStatus } from '@/lib/youtube-import/import-job-ui';
import type { YoutubeImportJob } from '@/types';

/**
 * Cancels a staged upload job created by a YouTube import and deletes its R2 object.
 * @param uploadJobId - Linked upload job id.
 * @param userId - Owning user id.
 */
async function discardStagedYoutubeImportUploadJob(
  uploadJobId: string,
  userId: string
): Promise<void> {
  const uploadJob = await getUploadJobById(uploadJobId);
  if (!uploadJob || uploadJob.userId !== userId) {
    return;
  }

  if (uploadJob.status !== 'pending' && uploadJob.status !== 'uploading') {
    return;
  }

  await updateUploadJobStatus(uploadJobId, 'cancelled', null);

  if (uploadJob.r2Key) {
    await deleteObject(uploadJob.r2Key).catch((error) => {
      if (error instanceof R2ObjectNotFoundError) {
        return;
      }
      console.error(
        `[discardStagedYoutubeImportUploadJob] Failed to delete R2 object for upload job ${uploadJobId}:`,
        error
      );
    });
  }
}

/**
 * Clears a single YouTube import job so the draft can start over.
 * @param job - Import job to discard.
 * @param userId - Owning user id.
 */
export async function discardYoutubeImportJob(
  job: YoutubeImportJob,
  userId: string
): Promise<void> {
  if (job.userId !== userId) {
    throw new Error('You do not have access to this import job');
  }

  if (job.status === 'cancelled') {
    return;
  }

  if (isActiveYoutubeImportStatus(job.status)) {
    await updateYoutubeImportJobStatus(job.id, { status: 'cancelled', errorMessage: null });
    return;
  }

  if (job.status === 'completed' && job.uploadJobId) {
    await discardStagedYoutubeImportUploadJob(job.uploadJobId, userId);
  }

  await updateYoutubeImportJobStatus(job.id, {
    status: 'cancelled',
    errorMessage: null,
    distributeQueued: false,
  });
}

/**
 * Discards any import state on a draft that would block starting over.
 * @param draftId - Draft id.
 * @param userId - Owning user id.
 */
export async function discardBlockingDraftYoutubeImport(
  draftId: string,
  userId: string
): Promise<void> {
  const draft = await getDraftById(draftId);
  if (!draft) {
    throw new Error('Draft not found');
  }
  if (draft.userId !== userId) {
    throw new Error('You do not have access to this draft');
  }

  const blocking = await getYoutubeImportJobForDraftEditor(draftId);
  if (!blocking) {
    return;
  }

  await discardYoutubeImportJob(blocking, userId);
}

/**
 * Discards a YouTube import job by id after verifying ownership.
 * @param jobId - Import job id.
 * @param userId - Owning user id.
 * @returns The discarded job id.
 */
export async function discardYoutubeImportJobById(jobId: string, userId: string): Promise<string> {
  const job = await getYoutubeImportJobById(jobId);
  if (!job) {
    throw new Error('YouTube import job not found');
  }

  await discardYoutubeImportJob(job, userId);
  return jobId;
}
