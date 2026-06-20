import { listStaleUploadJobs, updateUploadJobStatus } from '@/lib/repositories/upload-jobs';
import {
  listStalePlatformUploads,
  updatePlatformUploadStatus,
} from '@/lib/repositories/platform-uploads';

/** Error message persisted on platform upload rows interrupted by a server restart. */
export const STALE_PLATFORM_UPLOAD_INTERRUPTED_MESSAGE =
  'Upload interrupted by a server restart; please retry.';

/** Error message persisted on upload job rows interrupted by a server restart. */
export const STALE_UPLOAD_JOB_INTERRUPTED_MESSAGE =
  'Upload interrupted by a server restart; please retry.';

const DEFAULT_UPLOAD_STALE_RECONCILE_MS = 30 * 60 * 1000;

/**
 * Resolves the staleness threshold for upload distribution reconciliation from
 * `UPLOAD_STALE_RECONCILE_MS`, falling back to 30 minutes when unset or invalid.
 * @returns Staleness threshold in milliseconds.
 */
export function resolveUploadStaleReconcileMs(): number {
  const raw = process.env.UPLOAD_STALE_RECONCILE_MS?.trim();
  if (!raw) {
    return DEFAULT_UPLOAD_STALE_RECONCILE_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(
      `[reconcile] Invalid UPLOAD_STALE_RECONCILE_MS value "${raw}"; using default ${DEFAULT_UPLOAD_STALE_RECONCILE_MS}ms.`
    );
    return DEFAULT_UPLOAD_STALE_RECONCILE_MS;
  }
  return parsed;
}

/**
 * Summary of rows updated by {@link reconcileStaleUploadDistribution}.
 * @property platformUploadsFailed - Count of stale platform upload rows marked failed.
 * @property uploadJobsFailed - Count of stale upload job rows marked failed.
 */
export interface ReconcileStaleUploadDistributionResult {
  platformUploadsFailed: number;
  uploadJobsFailed: number;
}

/**
 * Marks upload jobs and platform uploads left in non-terminal in-progress states after
 * a server restart so users can retry from the existing UI. Does not touch R2 objects
 * or resume uploads.
 * @param options - Optional clock and threshold overrides (for tests).
 * @returns Counts of rows marked failed during this run.
 */
export async function reconcileStaleUploadDistribution(options?: {
  now?: Date;
  staleThresholdMs?: number;
}): Promise<ReconcileStaleUploadDistributionResult> {
  const now = options?.now ?? new Date();
  const staleThresholdMs = options?.staleThresholdMs ?? resolveUploadStaleReconcileMs();
  const updatedBefore = new Date(now.getTime() - staleThresholdMs);

  const stalePlatformUploads = await listStalePlatformUploads(updatedBefore);
  let platformUploadsFailed = 0;

  for (const upload of stalePlatformUploads) {
    const updated = await updatePlatformUploadStatus(
      upload.id,
      'failed',
      undefined,
      undefined,
      STALE_PLATFORM_UPLOAD_INTERRUPTED_MESSAGE
    );
    if (updated) {
      platformUploadsFailed += 1;
    } else {
      console.warn(
        `[reconcile] Could not mark stale platform_upload ${upload.id} as failed (row missing).`
      );
    }
  }

  const staleUploadJobs = await listStaleUploadJobs(updatedBefore);
  let uploadJobsFailed = 0;

  for (const job of staleUploadJobs) {
    const updated = await updateUploadJobStatus(
      job.id,
      'failed',
      STALE_UPLOAD_JOB_INTERRUPTED_MESSAGE
    );
    if (updated) {
      uploadJobsFailed += 1;
    } else {
      console.warn(
        `[reconcile] Could not mark stale upload_job ${job.id} as failed (row missing).`
      );
    }
  }

  if (platformUploadsFailed > 0 || uploadJobsFailed > 0) {
    console.log(
      `[reconcile] Marked ${platformUploadsFailed} stale platform upload(s) and ${uploadJobsFailed} stale upload job(s) as failed.`
    );
  }

  return { platformUploadsFailed, uploadJobsFailed };
}
