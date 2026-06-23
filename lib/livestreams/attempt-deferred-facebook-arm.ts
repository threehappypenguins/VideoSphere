import { armFacebookLivestream } from '@/lib/livestreams/arm-facebook-livestream';
import {
  computeFacebookDeferredArmAt,
  isFacebookDeferredArmPending,
} from '@/lib/livestreams/facebook-arm-assignment';
import { pickNextTempCandidateForPromotion } from '@/lib/livestreams/key-assignment';
import { resolveFacebookPageId } from '@/lib/platforms/facebook-oauth';
import { refreshTokenIfNeeded } from '@/lib/platforms/token-refresh';
import { getConnectedAccountWithTokens } from '@/lib/repositories/connected-accounts';
import {
  getArmedFacebookLivestreamForUser,
  getLivestreamById,
  listPendingFacebookDeferredArmsForUser,
} from '@/lib/repositories/livestreams';
import type { Livestream } from '@/types';

/**
 * Result of attempting to arm a queued Facebook livestream at its preparation window.
 * @property livestream - Updated row when arm succeeded.
 * @property reason - Failure category when arm did not occur.
 * @property details - Human-readable failure context.
 */
export type AttemptDeferredFacebookArmResult =
  | { ok: true; livestream: Livestream }
  | {
      ok: false;
      reason:
        | 'not_found'
        | 'not_eligible'
        | 'not_queue_head'
        | 'blocked'
        | 'missing_connection'
        | 'upstream_error';
      details: string;
    };

async function resolveFacebookPageAccessToken(userId: string): Promise<{
  accessToken: string;
  pageId: string;
} | null> {
  const account = await getConnectedAccountWithTokens(userId, 'facebook');
  if (!account) {
    return null;
  }

  const pageId = resolveFacebookPageId(account);
  if (!pageId) {
    return null;
  }

  try {
    const tokens = await refreshTokenIfNeeded(account);
    const accessToken = tokens.accessToken.trim();
    if (accessToken.length === 0) {
      return null;
    }
    return { accessToken, pageId };
  } catch (err) {
    console.error(`[facebook-arm] Failed to refresh Facebook token for user ${userId}`, err);
    return null;
  }
}

/**
 * Attempts to create a Facebook LiveVideo for a queued livestream at its preparation window.
 * @param livestreamId - Target livestream id.
 * @param options - Optional clock override for tests.
 * @returns Arm outcome.
 */
export async function attemptDeferredFacebookArm(
  livestreamId: string,
  options?: { now?: Date }
): Promise<AttemptDeferredFacebookArmResult> {
  const now = options?.now ?? new Date();
  const livestream = await getLivestreamById(livestreamId);
  if (!livestream) {
    return { ok: false, reason: 'not_found', details: 'Livestream not found.' };
  }

  if (!isFacebookDeferredArmPending(livestream)) {
    return {
      ok: false,
      reason: 'not_eligible',
      details: 'Livestream is not eligible for deferred Facebook arm.',
    };
  }

  const armAt = computeFacebookDeferredArmAt(livestream);
  if (!armAt) {
    return {
      ok: false,
      reason: 'not_eligible',
      details: 'Deferred Facebook arm time could not be computed.',
    };
  }

  if (now.getTime() < armAt.getTime()) {
    return {
      ok: false,
      reason: 'not_eligible',
      details: 'Deferred Facebook arm is not due yet.',
    };
  }

  const pendingArms = await listPendingFacebookDeferredArmsForUser(livestream.userId);
  const queueHead = pickNextTempCandidateForPromotion(
    pendingArms
      .filter((stream) => typeof stream.scheduledStartTime === 'string')
      .map((stream) => ({
        id: stream.id,
        scheduledStartTime: stream.scheduledStartTime!,
      }))
  );
  if (!queueHead || queueHead.id !== livestreamId) {
    return {
      ok: false,
      reason: 'not_queue_head',
      details: 'Another queued Facebook livestream is ahead in the preparation queue.',
    };
  }

  const armedFacebookLivestream = await getArmedFacebookLivestreamForUser(livestream.userId);
  if (armedFacebookLivestream && armedFacebookLivestream.id !== livestreamId) {
    return {
      ok: false,
      reason: 'blocked',
      details: 'Another Facebook livestream is still armed.',
    };
  }

  const facebookAuth = await resolveFacebookPageAccessToken(livestream.userId);
  if (!facebookAuth) {
    return {
      ok: false,
      reason: 'missing_connection',
      details: 'Facebook is not connected or no Page is selected.',
    };
  }

  const armResult = await armFacebookLivestream(
    facebookAuth.accessToken,
    facebookAuth.pageId,
    livestream,
    armedFacebookLivestream
  );

  if (armResult.ok === false) {
    return {
      ok: false,
      reason: armResult.statusCode === 502 ? 'upstream_error' : 'blocked',
      details: armResult.details,
    };
  }

  return { ok: true, livestream: armResult.livestream };
}
