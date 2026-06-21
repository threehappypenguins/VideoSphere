import { getConnectedAccountWithTokens } from '@/lib/repositories/connected-accounts';
import {
  getArmedMainSlotLivestreamForUser,
  listAllArmedYouTubeLivestreams,
  listArmedTempSlotLivestreamsForUser,
  updateLivestream,
} from '@/lib/repositories/livestreams';
import {
  pickNextTempCandidateForPromotion,
  requireYouTubeStreamKeyForSlot,
  shouldPromoteTempToMain,
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
 */
export interface ReconcileLivestreamKeysAndStatusResult {
  lifecycleUpdates: number;
  promotions: number;
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
 * Runs in-process on a timer started from {@link connectToDatabase}. It will not run
 * reliably if multiple app instances are deployed behind a load balancer without leader
 * election — fine for this self-hosted single-instance setup, but worth revisiting before
 * horizontal scaling.
 *
 * The temp-slot queue has no cap; this function intentionally promotes at most one
 * candidate per user per pass. A long queue simply waits for later passes — promotion
 * only needs to happen within ~30 minutes of each livestream's scheduled start anyway.
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

    let currentMainSlotStream: { youtubeLifecycleStatus?: string } | null;
    if (mainEndedThisPass) {
      currentMainSlotStream = null;
    } else {
      const mainSlot = await getArmedMainSlotLivestreamForUser(userId);
      currentMainSlotStream = mainSlot;
    }

    const tempSlotStreams = await listArmedTempSlotLivestreamsForUser(userId);
    const tempCandidate = pickNextTempCandidateForPromotion(
      tempSlotStreams.filter(
        (stream): stream is typeof stream & { scheduledStartTime: string } =>
          typeof stream.scheduledStartTime === 'string' && stream.scheduledStartTime.trim() !== ''
      )
    );
    if (!tempCandidate) continue;

    if (!shouldPromoteTempToMain({ tempCandidate, currentMainSlotStream }, now)) {
      continue;
    }

    const candidateRow = tempSlotStreams.find((stream) => stream.id === tempCandidate.id) ?? null;
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

  if (lifecycleUpdates > 0 || promotions > 0) {
    console.log(
      `[reconcile] Updated ${lifecycleUpdates} livestream lifecycle status(es) and promoted ${promotions} temp-slot livestream(s) to main.`
    );
  }

  return { lifecycleUpdates, promotions };
}
