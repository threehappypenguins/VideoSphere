'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { ConnectedAccountPlatform, PlatformUploadStatus, UploadJobStatus } from '@/types';

/** Platform row shape used by upload history job actions. */
export interface UploadHistoryJobPlatformItem {
  platform: ConnectedAccountPlatform;
  status: PlatformUploadStatus;
  retryable: boolean;
}

/** Upload job row shape used by upload history job actions. */
export interface UploadHistoryJobActionsJob {
  uploadJobId: string;
  status: UploadJobStatus;
  r2FileAvailable: boolean | null;
  platforms: UploadHistoryJobPlatformItem[];
}

/**
 * Props for {@link UploadHistoryJobActions}.
 */
export interface UploadHistoryJobActionsProps {
  /** Upload job row from history APIs. */
  job: UploadHistoryJobActionsJob;
  /** Called after a successful retry or cancel so parents can refresh history. */
  onChanged: () => void | Promise<void>;
  /** When true, disables action buttons (e.g. another job is busy). */
  disabled?: boolean;
}

/**
 * Job-level retry and cancel controls for failed upload history rows.
 * @param props - Job row and refresh callback.
 * @returns Retry/cancel buttons and cancel confirmation dialog.
 */
export function UploadHistoryJobActions({
  job,
  onChanged,
  disabled = false,
}: UploadHistoryJobActionsProps) {
  const [busyAction, setBusyAction] = useState<'retry' | 'discard' | null>(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  const failedPlatforms = job.platforms.filter((platform) => platform.status === 'failed');
  const canRetryFailed =
    job.status === 'failed' && failedPlatforms.length > 0 && job.r2FileAvailable !== false;
  const canDiscard = job.status === 'failed';
  const isBusy = busyAction !== null || disabled;

  const retryFailedPlatforms = async () => {
    setBusyAction('retry');
    try {
      const response = await fetch(`/api/uploads/jobs/${job.uploadJobId}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? 'Retry failed');
      }
      toast.success('Retry started');
      await onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Retry failed');
    } finally {
      setBusyAction(null);
    }
  };

  const discardJob = async () => {
    setBusyAction('discard');
    try {
      const response = await fetch(`/api/uploads/jobs/${job.uploadJobId}/discard`, {
        method: 'POST',
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? 'Cancel failed');
      }
      toast.success('Upload cancelled and Cloudflare R2 files removed');
      await onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Cancel failed');
    } finally {
      setBusyAction(null);
      setShowDiscardConfirm(false);
    }
  };

  if (!canRetryFailed && !canDiscard) {
    return null;
  }

  return (
    <>
      <div className="mt-3 flex flex-wrap gap-2">
        {canRetryFailed ? (
          <button
            type="button"
            onClick={() => {
              void retryFailedPlatforms();
            }}
            disabled={isBusy}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground hover:bg-muted disabled:opacity-60"
          >
            {busyAction === 'retry' ? 'Retrying...' : 'Retry'}
          </button>
        ) : null}
        {canDiscard ? (
          <button
            type="button"
            onClick={() => setShowDiscardConfirm(true)}
            disabled={isBusy}
            className="rounded-md border border-red-200 bg-background px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
          >
            {busyAction === 'discard' ? 'Cancelling...' : 'Cancel'}
          </button>
        ) : null}
      </div>

      <AlertDialog open={showDiscardConfirm} onOpenChange={setShowDiscardConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this upload?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the video and any associated thumbnail stored in
              Cloudflare R2. You will not be able to retry failed platforms for this upload.
              Platforms that already succeeded will keep their uploaded copies.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyAction === 'discard'}>Keep upload</AlertDialogCancel>
            <AlertDialogAction
              disabled={busyAction === 'discard'}
              onClick={(event) => {
                event.preventDefault();
                void discardJob();
              }}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              Cancel and delete R2 files
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
