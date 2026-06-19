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
import type { UploadJobStatus } from '@/types';

/** Upload job row shape used by job-level discard control. */
export interface UploadHistoryJobDiscardJob {
  uploadJobId: string;
  status: UploadJobStatus;
}

/**
 * Props for {@link UploadHistoryJobDiscard}.
 */
export interface UploadHistoryJobDiscardProps {
  /** Upload job row from history APIs. */
  job: UploadHistoryJobDiscardJob;
  /** Called after a successful discard so parents can refresh history. */
  onChanged: () => void | Promise<void>;
  /** When true, disables the cancel button (e.g. a platform retry is in flight). */
  disabled?: boolean;
  /**
   * When true, raises the discard confirmation dialog above nested parent modals.
   * Use when this component is rendered inside another open dialog (e.g. upload progress).
   */
  elevatedConfirmDialog?: boolean;
}

/**
 * Job-level cancel control for failed uploads. Discards R2 artifacts and gives up on all retries.
 * @param props - Job row and refresh callback.
 * @returns Cancel button and confirmation dialog when the job has failed.
 */
export function UploadHistoryJobDiscard({
  job,
  onChanged,
  disabled = false,
  elevatedConfirmDialog = false,
}: UploadHistoryJobDiscardProps) {
  const [discardBusy, setDiscardBusy] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  if (job.status !== 'failed') {
    return null;
  }

  const discardJob = async () => {
    setDiscardBusy(true);
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
      setDiscardBusy(false);
      setShowDiscardConfirm(false);
    }
  };

  const isBusy = discardBusy || disabled;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setShowDiscardConfirm(true)}
          disabled={isBusy}
          className="rounded-md border border-red-200 bg-background px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
        >
          {discardBusy ? 'Cancelling...' : 'Cancel upload'}
        </button>
      </div>

      <AlertDialog open={showDiscardConfirm} onOpenChange={setShowDiscardConfirm}>
        <AlertDialogContent stackLayerClassName={elevatedConfirmDialog ? '!z-[70]' : undefined}>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this upload?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the video and any associated thumbnail stored in
              Cloudflare R2. You will not be able to retry failed platforms for this upload.
              Platforms that already succeeded will keep their uploaded copies.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={discardBusy}>Keep upload</AlertDialogCancel>
            <AlertDialogAction
              disabled={discardBusy}
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
