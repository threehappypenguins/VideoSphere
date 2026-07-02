import type { YoutubeImportJobStatus } from '@/types';

/**
 * Returns whether a YouTube import job is still in progress.
 * @param status - Import job status.
 * @returns `true` when the worker may still be running.
 */
export function isActiveYoutubeImportStatus(status: YoutubeImportJobStatus): boolean {
  return (
    status === 'pending' ||
    status === 'downloading' ||
    status === 'trimming' ||
    status === 'uploading'
  );
}

/**
 * Human-readable label for import progress UI.
 * @param status - Import job status.
 * @returns Short status text for the draft/import modals.
 */
export function formatYoutubeImportStatusLabel(status: YoutubeImportJobStatus): string {
  switch (status) {
    case 'pending':
      return 'Queued';
    case 'downloading':
      return 'Downloading';
    case 'trimming':
      return 'Trimming';
    case 'uploading':
      return 'Staging video';
    case 'completed':
      return 'Ready to upload';
    case 'failed':
      return 'Import failed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return status;
  }
}
