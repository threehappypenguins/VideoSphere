import { after } from 'next/server';
import { executeYoutubeImportJobWorker } from '@/lib/youtube-import/execute-import-job';

/**
 * Schedules a YouTube import worker to run on the server after the current
 * HTTP response is sent. Safe to call multiple times; only one worker can
 * claim a pending job.
 * @param jobId - Import job id.
 * @param userId - Owning user id used for claim authorization.
 */
export function scheduleYoutubeImportJob(jobId: string, userId: string): void {
  after(async () => {
    try {
      await executeYoutubeImportJobWorker(jobId, userId);
    } catch (error) {
      console.error(`[scheduleYoutubeImportJob] Import worker failed for ${jobId}:`, error);
    }
  });
}
