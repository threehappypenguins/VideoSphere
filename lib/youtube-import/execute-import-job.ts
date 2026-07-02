import {
  claimPendingYoutubeImportJob,
  getYoutubeImportJobById,
} from '@/lib/repositories/youtube-import-jobs';
import { runYoutubeImportJob } from '@/lib/youtube-import/run-import-job';
import type { YoutubeImportJobStatus } from '@/types';

/**
 * Result of attempting to claim and run a YouTube import worker.
 */
export type YoutubeImportJobExecutionResult =
  | { outcome: 'ran' }
  | { outcome: 'already_running'; status: YoutubeImportJobStatus }
  | { outcome: 'not_found' };

/**
 * Atomically claims a pending import job and runs the download/trim/stage pipeline.
 * @param jobId - Import job id.
 * @param userId - When set, the pending row must belong to this user.
 * @returns Whether the worker ran, was already active, or the job was missing.
 */
export async function executeYoutubeImportJobWorker(
  jobId: string,
  userId?: string
): Promise<YoutubeImportJobExecutionResult> {
  const claimed = await claimPendingYoutubeImportJob(jobId, userId);
  if (!claimed) {
    const current = await getYoutubeImportJobById(jobId);
    if (!current) {
      return { outcome: 'not_found' };
    }
    return { outcome: 'already_running', status: current.status };
  }

  console.info(`[executeYoutubeImportJobWorker] Starting import worker for ${jobId}`);
  await runYoutubeImportJob(jobId);
  return { outcome: 'ran' };
}
