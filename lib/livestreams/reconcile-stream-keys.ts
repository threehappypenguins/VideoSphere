import { getConnectedAccountWithTokens } from '@/lib/repositories/connected-accounts';
import {
  getArmedMainSlotLivestreamForUser,
  listAllArmedYouTubeLivestreams,
  listArmedTempSlotLivestreamsForUser,
  updateLivestream,
} from '@/lib/repositories/livestreams';
import {
  resolveAutoPromoteToMainKeyEnabled,
  resolveAutoPromoteToMainKeyMinutes,
} from '@/lib/livestreams/auto-promote-main-key';
import {
  classifyMainSlotForPromotion,
  isWithinTempPromotionWindow,
  releaseStaleMainSlot,
} from '@/lib/livestreams/stale-main-slot';
import {
  pickNextTempCandidateForPromotion,
  requireYouTubeStreamKeyForSlot,
} from '@/lib/livestreams/key-assignment';
import { localStatusForYouTubeLifecycle } from '@/lib/livestreams/youtube-lifecycle';
import { refreshTokenIfNeeded } from '@/lib/platforms/token-refresh';
import {
  bindYouTubeBroadcastToStream,
  findYouTubeLiveStreamIdByKey,
  getYouTubeBroadcastLifecycleStatus,
} from '@/lib/platforms/youtube-livestream-api';
import type { Livestream } from '@/types';

const DEFAULT_LIVESTREAM_RECONCILE_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Summary of work performed by {@link reconcileLivestreamKeysAndStatus}.
 * @property lifecycleUpdates - Livestream rows whose lifecycle or status changed.
 * @property promotions - Temp-slot livestreams promoted to main in this pass.
 * @property staleReleases - Main-slot livestreams released as stale in this pass.
 */
export interface ReconcileLivestreamKeysAndStatusResult {
  lifecycleUpdates: number;
  promotions: number;
  staleReleases: number;
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
 * Polls YouTube lifecycle status for armed livestreams, ends completed broadcasts, and
 * promotes at most one temp-slot candidate per user to the main stream key when eligible.
 *
 * Runs in-process on a timer started from {@link connectToDatabase}. Promotion eligibility
 * is derived from persisted livestream fields (`scheduledStartTime`, `autoPromoteToMainKey`,
 * `autoPromoteToMainKeyMinutes`), so work survives server restarts once the process reconnects
 * to MongoDB and the timer restarts. It will not run reliably if multiple app instances are
 * deployed behind a load balancer without leader election — fine for this self-hosted
 * single-instance setup, but worth revisiting before horizontal scaling.
 *
 * The temp-slot queue has no cap; this function intentionally promotes at most one
 * candidate per user per pass. A long queue simply waits for later passes — promotion
 * only needs to happen within each livestream's configured lead time before start.
 * @param options - Optional clock override for tests.
 * @returns Counts of lifecycle updates and main-key promotions performed.
 */
export async function reconcileLivestreamKeysAndStatus(options?: {
  now?: Date;
}): Promise<ReconcileLivestreamKeysAndStatusResult> {
  const now = options?.now ?? new Date();
  const armedByUser = await listAllArmedYouTubeLivestreams();

  let lifecycleUpdates = 0;
  let promotions = 0;
  let staleReleases = 0;

  for (const [userId, armedLivestreams] of armedByUser) {
    const mainSlotIdBeforePass =
      armedLivestreams.find((livestream) => livestream.keySlot === 'main')?.id ?? null;
    let mainEndedThisPass = false;

    const accessToken = await resolveYouTubeAccessTokenForUser(userId);
    if (!accessToken) {
      console.warn(
        `[reconcile] Skipping livestream reconciliation for user ${userId}: YouTube not connected or token refresh failed.`
      );
      continue;
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
          if (
            mainSlotIdBeforePass != null &&
            livestream.id === mainSlotIdBeforePass &&
            nextStatus === 'ended'
          ) {
            mainEndedThisPass = true;
          }
        }
      } catch (err) {
        console.error(
          `[reconcile] Lifecycle poll error for livestream ${livestream.id} (user ${userId})`,
          err
        );
      }
    }

    let currentMainSlotStream: Livestream | null;
    if (mainEndedThisPass) {
      currentMainSlotStream = null;
    } else {
      currentMainSlotStream = await getArmedMainSlotLivestreamForUser(userId);
    }

    const tempSlotStreams = await listArmedTempSlotLivestreamsForUser(userId);
    const eligibleTempStreams = tempSlotStreams.filter(
      (stream) =>
        typeof stream.scheduledStartTime === 'string' &&
        stream.scheduledStartTime.trim() !== '' &&
        resolveAutoPromoteToMainKeyEnabled(stream)
    );
    const tempCandidate = pickNextTempCandidateForPromotion(
      eligibleTempStreams.map((stream) => ({
        id: stream.id,
        scheduledStartTime: stream.scheduledStartTime!,
      }))
    );
    if (!tempCandidate) continue;

    const candidateRow =
      eligibleTempStreams.find((stream) => stream.id === tempCandidate.id) ?? null;
    const promotionWindowMs = resolveAutoPromoteToMainKeyMinutes(candidateRow ?? {}) * 60 * 1000;

    if (!isWithinTempPromotionWindow(tempCandidate, now, promotionWindowMs)) {
      continue;
    }

    if (currentMainSlotStream?.youtubeBroadcastId?.trim()) {
      try {
        const lifecycleResult = await getYouTubeBroadcastLifecycleStatus(
          accessToken,
          currentMainSlotStream.youtubeBroadcastId.trim()
        );
        if (lifecycleResult.ok === true) {
          const nextLifecycle = lifecycleResult.lifeCycleStatus ?? null;
          const nextStatus = localStatusForYouTubeLifecycle(nextLifecycle);
          const lifecycleChanged =
            nextLifecycle !== (currentMainSlotStream.youtubeLifecycleStatus ?? null);
          const statusChanged =
            nextStatus !== undefined && nextStatus !== currentMainSlotStream.status;

          if (lifecycleChanged || statusChanged) {
            const refreshed = await updateLivestream(currentMainSlotStream.id, {
              ...(lifecycleChanged && nextLifecycle != null
                ? { youtubeLifecycleStatus: nextLifecycle }
                : lifecycleChanged
                  ? { youtubeLifecycleStatus: null }
                  : {}),
              ...(statusChanged ? { status: nextStatus } : {}),
            });
            if (refreshed) {
              lifecycleUpdates += 1;
              currentMainSlotStream = refreshed;
              if (nextStatus === 'live' || nextStatus === 'ended') {
                if (nextStatus === 'ended') {
                  currentMainSlotStream = null;
                }
              }
            } else if (lifecycleChanged) {
              currentMainSlotStream = {
                ...currentMainSlotStream,
                youtubeLifecycleStatus: nextLifecycle ?? undefined,
              };
            }
          }
        }
      } catch (err) {
        console.error(
          `[reconcile] Main-slot lifecycle poll error for livestream ${currentMainSlotStream.id} (user ${userId})`,
          err
        );
      }
    }

    const mainSlotState = classifyMainSlotForPromotion(currentMainSlotStream, now);
    if (mainSlotState === 'blocked') {
      continue;
    }

    if (mainSlotState === 'stale' && currentMainSlotStream) {
      const account = await getConnectedAccountWithTokens(userId, 'youtube');
      if (!account) continue;

      const releaseResult = await releaseStaleMainSlot(
        accessToken,
        account,
        currentMainSlotStream,
        now
      );
      if (releaseResult.ok === false) {
        console.warn(
          `[reconcile] Stale main-slot release failed for livestream ${currentMainSlotStream.id}: ${releaseResult.details}`
        );
        continue;
      }

      staleReleases += 1;
      lifecycleUpdates += 1;
      currentMainSlotStream = null;
    }

    const broadcastId = candidateRow?.youtubeBroadcastId?.trim();
    if (!candidateRow || !broadcastId) {
      console.warn(
        `[reconcile] Skipping promotion for livestream ${tempCandidate.id}: missing broadcast id.`
      );
      continue;
    }

    const account = await getConnectedAccountWithTokens(userId, 'youtube');
    if (!account) continue;

    const mainKeyResult = requireYouTubeStreamKeyForSlot(account, 'main');
    if (mainKeyResult.ok === false) {
      console.warn(`[reconcile] Skipping promotion for user ${userId}: ${mainKeyResult.reason}`);
      continue;
    }

    try {
      const streamLookup = await findYouTubeLiveStreamIdByKey(accessToken, mainKeyResult.key);
      if (streamLookup.ok === false) {
        console.warn(
          `[reconcile] Main stream key lookup failed for user ${userId}: ${streamLookup.details}`
        );
        continue;
      }

      const bindResult = await bindYouTubeBroadcastToStream(
        accessToken,
        broadcastId,
        streamLookup.streamId
      );
      if (bindResult.ok === false) {
        console.warn(
          `[reconcile] Bind failed promoting livestream ${candidateRow.id}: ${bindResult.details}`
        );
        continue;
      }

      const promoted = await updateLivestream(candidateRow.id, {
        keySlot: 'main',
        keySwapPromotedAt: now.toISOString(),
        youtubeBoundStreamId: streamLookup.streamId,
      });
      if (promoted) {
        promotions += 1;
      }
    } catch (err) {
      console.error(
        `[reconcile] Promotion error for livestream ${candidateRow.id} (user ${userId})`,
        err
      );
    }
  }

  if (lifecycleUpdates > 0 || promotions > 0 || staleReleases > 0) {
    console.log(
      `[reconcile] Updated ${lifecycleUpdates} livestream lifecycle status(es), released ${staleReleases} stale main-slot livestream(s), and promoted ${promotions} temp-slot livestream(s) to main.`
    );
  }

  return { lifecycleUpdates, promotions, staleReleases };
}
