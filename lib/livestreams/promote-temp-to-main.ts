import {
  resolveAutoPromoteToMainKeyEnabled,
  resolveAutoPromoteToMainKeyMinutes,
} from '@/lib/livestreams/auto-promote-main-key';
import {
  pickNextTempCandidateForPromotion,
  requireYouTubeStreamKeyForSlot,
} from '@/lib/livestreams/key-assignment';
import {
  classifyMainSlotForPromotion,
  releaseStaleMainSlot,
} from '@/lib/livestreams/stale-main-slot';
import { localStatusForYouTubeLifecycle } from '@/lib/livestreams/youtube-lifecycle';
import { refreshTokenIfNeeded } from '@/lib/platforms/token-refresh';
import {
  ensureYouTubeBroadcastBoundToStreamKey,
  getYouTubeBroadcastLifecycleStatus,
} from '@/lib/platforms/youtube-livestream-api';
import { getConnectedAccountWithTokens } from '@/lib/repositories/connected-accounts';
import {
  getArmedMainSlotLivestreamForUser,
  getLivestreamById,
  listArmedTempSlotLivestreamsForUser,
  updateLivestream,
} from '@/lib/repositories/livestreams';
import type { Livestream } from '@/types';

/**
 * Computes the wall-clock instant when a temp-slot livestream should auto-promote to main.
 * @param livestream - Livestream row or editor snapshot.
 * @returns Promotion time, or null when auto-promote does not apply.
 */
export function computeTempToMainPromotionAt(
  livestream: Pick<
    Livestream,
    | 'status'
    | 'keySlot'
    | 'scheduledStartTime'
    | 'autoPromoteToMainKey'
    | 'autoPromoteToMainKeyMinutes'
    | 'keySwapPromotedAt'
  >
): Date | null {
  if (livestream.status !== 'scheduled' || livestream.keySlot !== 'temp') {
    return null;
  }
  if (livestream.keySwapPromotedAt?.trim()) {
    return null;
  }
  if (!resolveAutoPromoteToMainKeyEnabled(livestream)) {
    return null;
  }

  const startMs = Date.parse(livestream.scheduledStartTime ?? '');
  if (Number.isNaN(startMs)) {
    return null;
  }

  const leadMs = resolveAutoPromoteToMainKeyMinutes(livestream) * 60_000;
  return new Date(startMs - leadMs);
}

/**
 * Result of attempting to promote one temp-slot livestream to the main key.
 * @property livestream - Updated row when promotion succeeded.
 * @property reason - Failure category when promotion did not occur.
 * @property details - Human-readable failure context.
 */
export type PromoteTempToMainResult =
  | { ok: true; livestream: Livestream }
  | {
      ok: false;
      reason:
        | 'not_found'
        | 'not_eligible'
        | 'not_queue_head'
        | 'blocked'
        | 'missing_broadcast'
        | 'missing_main_key'
        | 'upstream_error';
      details: string;
    };

async function resolveYouTubeAccessTokenForUser(userId: string): Promise<string | null> {
  const account = await getConnectedAccountWithTokens(userId, 'youtube');
  if (!account) return null;
  try {
    const tokens = await refreshTokenIfNeeded(account);
    const accessToken = tokens.accessToken.trim();
    return accessToken.length > 0 ? accessToken : null;
  } catch (err) {
    console.error(`[promote] Failed to refresh YouTube token for user ${userId}`, err);
    return null;
  }
}

/**
 * Attempts to promote a scheduled temp-slot livestream to the main YouTube stream key.
 * @param livestreamId - Target livestream id.
 * @param options - Optional clock override for tests.
 * @returns Promotion outcome.
 */
export async function attemptPromoteTempLivestreamToMain(
  livestreamId: string,
  options?: { now?: Date }
): Promise<PromoteTempToMainResult> {
  const now = options?.now ?? new Date();
  const livestream = await getLivestreamById(livestreamId);
  if (!livestream) {
    return { ok: false, reason: 'not_found', details: 'Livestream not found.' };
  }

  if (computeTempToMainPromotionAt(livestream) == null) {
    return {
      ok: false,
      reason: 'not_eligible',
      details: 'Livestream is not eligible for promotion.',
    };
  }

  const promotionAt = computeTempToMainPromotionAt(livestream)!;
  if (now.getTime() < promotionAt.getTime()) {
    return {
      ok: false,
      reason: 'not_eligible',
      details: 'Promotion is not due yet.',
    };
  }

  const tempSlotStreams = await listArmedTempSlotLivestreamsForUser(livestream.userId);
  const eligibleTempStreams = tempSlotStreams.filter(
    (stream) =>
      typeof stream.scheduledStartTime === 'string' &&
      stream.scheduledStartTime.trim() !== '' &&
      resolveAutoPromoteToMainKeyEnabled(stream)
  );
  const queueHead = pickNextTempCandidateForPromotion(
    eligibleTempStreams.map((stream) => ({
      id: stream.id,
      scheduledStartTime: stream.scheduledStartTime!,
    }))
  );
  if (!queueHead || queueHead.id !== livestreamId) {
    return {
      ok: false,
      reason: 'not_queue_head',
      details: 'Another temp-slot livestream is ahead in the promotion queue.',
    };
  }

  const accessToken = await resolveYouTubeAccessTokenForUser(livestream.userId);
  if (!accessToken) {
    return {
      ok: false,
      reason: 'upstream_error',
      details: 'YouTube is not connected or token refresh failed.',
    };
  }

  const account = await getConnectedAccountWithTokens(livestream.userId, 'youtube');
  if (!account) {
    return {
      ok: false,
      reason: 'upstream_error',
      details: 'YouTube is not connected.',
    };
  }

  let currentMainSlotStream = await getArmedMainSlotLivestreamForUser(livestream.userId);

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
            currentMainSlotStream = refreshed;
            if (nextStatus === 'ended') {
              currentMainSlotStream = null;
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
        `[promote] Main-slot lifecycle poll error for livestream ${currentMainSlotStream.id}`,
        err
      );
    }
  }

  const mainSlotState = classifyMainSlotForPromotion(currentMainSlotStream, now);
  if (mainSlotState === 'blocked') {
    return {
      ok: false,
      reason: 'blocked',
      details: 'The main stream key slot is still in use.',
    };
  }

  if (mainSlotState === 'stale' && currentMainSlotStream) {
    const releaseResult = await releaseStaleMainSlot(
      accessToken,
      account,
      currentMainSlotStream,
      now
    );
    if (releaseResult.ok === false) {
      return {
        ok: false,
        reason: 'upstream_error',
        details: releaseResult.details,
      };
    }
    currentMainSlotStream = null;
  }

  const broadcastId = livestream.youtubeBroadcastId?.trim();
  if (!broadcastId) {
    return {
      ok: false,
      reason: 'missing_broadcast',
      details: 'Livestream is not linked to a YouTube broadcast.',
    };
  }

  const mainKeyResult = requireYouTubeStreamKeyForSlot(account, 'main');
  if (mainKeyResult.ok === false) {
    return {
      ok: false,
      reason: 'missing_main_key',
      details: mainKeyResult.reason,
    };
  }

  try {
    const ensureResult = await ensureYouTubeBroadcastBoundToStreamKey(
      accessToken,
      broadcastId,
      mainKeyResult.key,
      { preferredStreamId: livestream.youtubeBoundStreamId }
    );
    if (ensureResult.ok === false) {
      return {
        ok: false,
        reason: 'upstream_error',
        details: ensureResult.details,
      };
    }

    const promoted = await updateLivestream(livestream.id, {
      keySlot: 'main',
      keySwapPromotedAt: now.toISOString(),
      youtubeBoundStreamId: ensureResult.streamId,
    });
    if (!promoted) {
      return { ok: false, reason: 'not_found', details: 'Livestream not found after promotion.' };
    }

    return { ok: true, livestream: promoted };
  } catch (err) {
    console.error(`[promote] Promotion error for livestream ${livestream.id}`, err);
    return {
      ok: false,
      reason: 'upstream_error',
      details: err instanceof Error ? err.message : 'Promotion failed.',
    };
  }
}
