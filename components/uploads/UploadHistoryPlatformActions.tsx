'use client';

import type { ConnectedAccountPlatform, PlatformUploadStatus, UploadJobStatus } from '@/types';

/** Platform row shape used by upload history platform actions. */
export interface UploadHistoryPlatformActionsPlatform {
  platform: ConnectedAccountPlatform;
  status: PlatformUploadStatus;
}

/** Upload job row shape used by upload history platform actions. */
export interface UploadHistoryPlatformActionsJob {
  uploadJobId: string;
  status: UploadJobStatus;
  r2FileAvailable: boolean | null;
}

/**
 * Props for {@link UploadHistoryPlatformActions}.
 */
export interface UploadHistoryPlatformActionsProps {
  /** Upload job row from history APIs. */
  job: UploadHistoryPlatformActionsJob;
  /** Platform row within the job. */
  platform: UploadHistoryPlatformActionsPlatform;
  /** Retries this platform only. */
  onRetry: () => void | Promise<void>;
  /** When true, the retry button shows a busy label. */
  retryBusy?: boolean;
  /** When true, disables the retry button (e.g. another platform is busy). */
  disabled?: boolean;
}

/**
 * Per-platform retry control for failed upload history rows.
 * @param props - Job/platform row and retry handler.
 * @returns Retry button for a failed platform when the job has failed and R2 source is available.
 */
export function UploadHistoryPlatformActions({
  job,
  platform,
  onRetry,
  retryBusy = false,
  disabled = false,
}: UploadHistoryPlatformActionsProps) {
  if (job.status !== 'failed' || platform.status !== 'failed' || job.r2FileAvailable === false) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={() => {
        void onRetry();
      }}
      disabled={disabled || retryBusy}
      className="mt-2 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground hover:bg-muted disabled:opacity-60"
    >
      {retryBusy ? 'Retrying...' : 'Retry'}
    </button>
  );
}
