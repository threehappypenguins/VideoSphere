import { after } from 'next/server';
import {
  distributeCreatePlatformUploadInput,
  runDistributionInBackground,
} from '@/lib/api/distribute';
import { buildMetadataForPlatform } from '@/lib/draft-upload-metadata';
import { getDraftById } from '@/lib/repositories/drafts';
import { ensurePlatformUploadsForJobTargets } from '@/lib/repositories/platform-uploads';
import { getUploadJobById, updateUploadJobStatus } from '@/lib/repositories/upload-jobs';
import type { ConnectedAccountPlatform } from '@/types';

/**
 * Thrown when an upload job row disappears between finalize steps.
 */
export class UploadJobFinalizeNotFoundError extends Error {
  constructor() {
    super('Upload job no longer exists and could not be finalized');
    this.name = 'UploadJobFinalizeNotFoundError';
  }
}

/**
 * Thrown when distribution is requested but the upload job has no staged R2 object key.
 */
export class UploadJobMissingR2KeyError extends Error {
  /**
   * @param jobId - Upload job id missing an R2 key.
   */
  constructor(jobId: string) {
    super(`Upload job ${jobId} has no R2 object key and cannot be distributed`);
    this.name = 'UploadJobMissingR2KeyError';
  }
}

/**
 * Finalizes an UploadJob whose R2 object is already fully present and
 * verified, transitioning it to the distributing/completed state and
 * kicking off distribution to the draft's target platforms.
 * @param jobId - UploadJob id, already confirmed to exist and be owned
 *   by the caller.
 * @param userId - Owning user id, for downstream authorization checks.
 * @returns Whether distribution was actually started (mirrors the
 *   existing `distributing` field in the complete route's response).
 */
export async function finalizeUploadJobAndDistribute(
  jobId: string,
  userId: string
): Promise<{ distributing: boolean }> {
  const job = await getUploadJobById(jobId);
  if (!job) {
    throw new UploadJobFinalizeNotFoundError();
  }

  // --- Auto-distribute to the draft's target platforms ---
  if (!job.draftId) {
    // No draft linked — just mark as uploading (manual distribute later).
    await updateUploadJobStatus(jobId, 'uploading');
    return { distributing: false };
  }

  const draft = await getDraftById(job.draftId);
  if (!draft || draft.targets.length === 0) {
    // Draft missing or has no targets — advance to uploading only.
    await updateUploadJobStatus(jobId, 'uploading');
    return { distributing: false };
  }

  const targetPlatforms = [...new Set(draft.targets)] as ConnectedAccountPlatform[];
  const r2Key = job.r2Key?.trim();
  if (!r2Key) {
    throw new UploadJobMissingR2KeyError(jobId);
  }

  // Create platform_upload rows before advancing to distributing so a failure
  // here leaves the job in pending (retryable), not stuck in distributing.
  const platformUploads = await ensurePlatformUploadsForJobTargets(
    targetPlatforms.map((platform) => distributeCreatePlatformUploadInput(jobId, draft, platform))
  );

  const updated = await updateUploadJobStatus(jobId, 'distributing', null);
  if (!updated) {
    throw new UploadJobFinalizeNotFoundError();
  }

  const metadataByPlatformId = new Map<string, ReturnType<typeof buildMetadataForPlatform>>();
  for (const pu of platformUploads) {
    metadataByPlatformId.set(pu.id, buildMetadataForPlatform(draft, pu.platform));
  }

  // Schedule background distribution (runs after the response is sent).
  after(() =>
    runDistributionInBackground(jobId, userId, r2Key, platformUploads, metadataByPlatformId)
  );

  return { distributing: true };
}
