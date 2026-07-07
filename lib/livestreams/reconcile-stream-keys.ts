import { getConnectedAccountWithTokens } from '@/lib/repositories/connected-accounts';
import { listAllArmedYouTubeLivestreams, updateLivestream } from '@/lib/repositories/livestreams';
import { requireYouTubeStreamKeyForSlot } from '@/lib/livestreams/key-assignment';
import { localStatusForYouTubeLifecycle } from '@/lib/livestreams/youtube-lifecycle';
import { refreshTokenIfNeeded } from '@/lib/platforms/token-refresh';
import {
  ensureYouTubeBroadcastBoundToStreamKey,
  getYouTubeBroadcastLifecycleStatus,
} from '@/lib/platforms/youtube-livestream-api';

const DEFAULT_LIVESTREAM_RECONCILE_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Summary of work performed by {@link reconcileLivestreamKeysAndStatus}.
 * @property lifecycleUpdates - Livestream rows whose lifecycle or status changed.
 * @property promotions - Always zero; temp→main promotion runs on scheduled timers instead.
 * @property staleReleases - Always zero; stale main-slot release happens during scheduled promotion.
 * @property bindingRepairs - Scheduled broadcasts re-bound to match their assigned key slot.
 */
export interface ReconcileLivestreamKeysAndStatusResult {
  lifecycleUpdates: number;
  promotions: number;
  staleReleases: number;
  bindingRepairs: number;
}

/**
 * Resolves the livestream reconciliation interval from `LIVESTREAM_RECONCILE_INTERVAL_MS`,
 * falling back to 5 minutes when unset or invalid.
 * @returns Interval in milliseconds.
 */
export function resolveLivestreamReconcileIntervalMs(): number {
  const raw = process.env.LIVESTREAM_RECONCILE_INTERVAL_MS?.trim();
  if (!raw) {
    return DEFAULT_LIVESTREAM_RECONCILE_INTERVAL_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(
      `[reconcile] Invalid LIVESTREAM_RECONCILE_INTERVAL_MS value "${raw}"; using default ${DEFAULT_LIVESTREAM_RECONCILE_INTERVAL_MS}ms.`
    );
    return DEFAULT_LIVESTREAM_RECONCILE_INTERVAL_MS;
  }
  return parsed;
}

async function resolveYouTubeAccessTokenForUser(userId: string): Promise<string | null> {
  const account = await getConnectedAccountWithTokens(userId, 'youtube');
  if (!account) return null;
  try {
    const tokens = await refreshTokenIfNeeded(account);
    const accessToken = tokens.accessToken.trim();
    return accessToken.length > 0 ? accessToken : null;
  } catch (err) {
    console.error(`[reconcile] Failed to refresh YouTube token for user ${userId}`, err);
    return null;
  }
}

/**
 * Polls YouTube lifecycle status for armed livestreams and repairs broadcast→stream bindings.
 *
 * Temp→main key promotion is handled by {@link lib/livestreams/temp-to-main-promotion-scheduler!syncTempToMainPromotionSchedule} at the exact
 * configured lead time before start, not by this interval pass.
 *
 * Runs in-process on a timer started from {@link lib/mongodb!connectToDatabase}. It will not run reliably if
 * multiple app instances are deployed behind a load balancer without leader election.
 * @param options - Optional clock override for tests.
 * @returns Counts of lifecycle updates and binding repairs performed.
 */
export async function reconcileLivestreamKeysAndStatus(options?: {
  now?: Date;
}): Promise<ReconcileLivestreamKeysAndStatusResult> {
  const armedByUser = await listAllArmedYouTubeLivestreams();

  let lifecycleUpdates = 0;
  const promotions = 0;
  const staleReleases = 0;
  let bindingRepairs = 0;

  for (const [userId, armedLivestreams] of armedByUser) {
    const accessToken = await resolveYouTubeAccessTokenForUser(userId);
    if (!accessToken) {
      console.warn(
        `[reconcile] Skipping livestream reconciliation for user ${userId}: YouTube not connected or token refresh failed.`
      );
      continue;
    }

    const account = await getConnectedAccountWithTokens(userId, 'youtube');
    if (account) {
      for (const livestream of armedLivestreams) {
        if (livestream.status !== 'scheduled' || livestream.keySlot == null) {
          continue;
        }

        const broadcastId = livestream.youtubeBroadcastId?.trim();
        if (!broadcastId) {
          continue;
        }

        const streamKeyResult = requireYouTubeStreamKeyForSlot(account, livestream.keySlot);
        if (streamKeyResult.ok === false) {
          continue;
        }

        try {
          const ensureResult = await ensureYouTubeBroadcastBoundToStreamKey(
            accessToken,
            broadcastId,
            streamKeyResult.key,
            { preferredStreamId: livestream.youtubeBoundStreamId }
          );
          if (ensureResult.ok === false) {
            console.warn(
              `[reconcile] Failed to verify YouTube binding for livestream ${livestream.id}: ${ensureResult.details}`
            );
            continue;
          }

          if (
            ensureResult.rebound ||
            ensureResult.streamId !== livestream.youtubeBoundStreamId?.trim()
          ) {
            const repaired = await updateLivestream(livestream.id, {
              youtubeBoundStreamId: ensureResult.streamId,
            });
            if (repaired) {
              bindingRepairs += 1;
            }
          }
        } catch (err) {
          console.error(
            `[reconcile] Binding repair error for livestream ${livestream.id} (user ${userId})`,
            err
          );
        }
      }
    }

    for (const livestream of armedLivestreams) {
      const broadcastId = livestream.youtubeBroadcastId?.trim();
      if (!broadcastId) continue;

      try {
        const lifecycleResult = await getYouTubeBroadcastLifecycleStatus(accessToken, broadcastId);
        if (lifecycleResult.ok === false) {
          console.warn(
            `[reconcile] Lifecycle poll failed for livestream ${livestream.id}: ${lifecycleResult.details}`
          );
          continue;
        }

        const nextLifecycle = lifecycleResult.lifeCycleStatus;
        const nextStatus = localStatusForYouTubeLifecycle(nextLifecycle ?? null);
        const lifecycleChanged = nextLifecycle !== (livestream.youtubeLifecycleStatus ?? null);
        const statusChanged = nextStatus !== undefined && nextStatus !== livestream.status;

        if (!lifecycleChanged && !statusChanged) continue;

        const updated = await updateLivestream(livestream.id, {
          ...(lifecycleChanged && nextLifecycle != null
            ? { youtubeLifecycleStatus: nextLifecycle }
            : lifecycleChanged
              ? { youtubeLifecycleStatus: null }
              : {}),
          ...(statusChanged ? { status: nextStatus } : {}),
        });

        if (updated) {
          lifecycleUpdates += 1;
        }
      } catch (err) {
        console.error(
          `[reconcile] Lifecycle poll error for livestream ${livestream.id} (user ${userId})`,
          err
        );
      }
    }
  }

  if (lifecycleUpdates > 0 || bindingRepairs > 0) {
    console.log(
      `[reconcile] Updated ${lifecycleUpdates} livestream lifecycle status(es) and repaired ${bindingRepairs} YouTube stream binding(s).`
    );
  }

  return { lifecycleUpdates, promotions, staleReleases, bindingRepairs };
}
