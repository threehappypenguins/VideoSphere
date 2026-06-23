import { getFacebookLiveVideoStatus } from '@/lib/platforms/facebook-livestream-api';
import { resolveFacebookPageId } from '@/lib/platforms/facebook-oauth';
import { refreshTokenIfNeeded } from '@/lib/platforms/token-refresh';
import { getConnectedAccountWithTokens } from '@/lib/repositories/connected-accounts';
import {
  listAllArmedFacebookLivestreams,
  updateLivestream,
  type UpdateLivestreamPatch,
} from '@/lib/repositories/livestreams';

/**
 * Summary of work performed by {@link reconcileFacebookLivestreamStatus}.
 * @property lifecycleUpdates - Livestream rows whose lifecycle or status changed.
 */
export interface ReconcileFacebookLivestreamStatusResult {
  lifecycleUpdates: number;
}

async function resolveFacebookPageAccessTokenForUser(userId: string): Promise<string | null> {
  const account = await getConnectedAccountWithTokens(userId, 'facebook');
  if (!account) return null;

  const pageId = resolveFacebookPageId(account);
  if (!pageId) {
    return null;
  }

  try {
    const tokens = await refreshTokenIfNeeded(account);
    const accessToken = tokens.accessToken.trim();
    return accessToken.length > 0 ? accessToken : null;
  } catch (err) {
    console.error(`[reconcile-facebook] Failed to refresh Facebook token for user ${userId}`, err);
    return null;
  }
}

/**
 * Polls Facebook `LiveVideo.status` for armed livestreams and syncs local lifecycle state.
 *
 * Runs in-process on the same timer as {@link reconcileLivestreamKeysAndStatus}. It will not run
 * reliably if multiple app instances are deployed behind a load balancer without leader election.
 * @param _options - Optional clock override reserved for tests.
 * @returns Count of lifecycle updates performed.
 */
export async function reconcileFacebookLivestreamStatus(_options?: {
  now?: Date;
}): Promise<ReconcileFacebookLivestreamStatusResult> {
  const armedByUser = await listAllArmedFacebookLivestreams();

  let lifecycleUpdates = 0;

  for (const [userId, armedLivestreams] of armedByUser) {
    const pageAccessToken = await resolveFacebookPageAccessTokenForUser(userId);
    if (!pageAccessToken) {
      console.warn(
        `[reconcile-facebook] Skipping Facebook livestream reconciliation for user ${userId}: Facebook Page not connected or token refresh failed.`
      );
      continue;
    }

    for (const livestream of armedLivestreams) {
      const liveVideoId = livestream.facebookLiveVideoId?.trim();
      if (!liveVideoId) {
        continue;
      }

      try {
        const statusResult = await getFacebookLiveVideoStatus(pageAccessToken, liveVideoId);
        if (statusResult.ok === false) {
          console.warn(
            `[reconcile-facebook] Lifecycle poll failed for livestream ${livestream.id}: ${statusResult.details}`
          );
          continue;
        }

        const facebookStatus = statusResult.status.trim();
        const patch: UpdateLivestreamPatch = {};

        if (facebookStatus === 'VOD' && livestream.status !== 'ended') {
          patch.status = 'ended';
          patch.facebookLifecycleStatus = 'VOD';
        } else if (facebookStatus === 'LIVE_NOW' && livestream.status === 'scheduled') {
          patch.status = 'live';
          patch.facebookLifecycleStatus = 'LIVE_NOW';
        }

        if (Object.keys(patch).length === 0) {
          continue;
        }

        const updated = await updateLivestream(livestream.id, patch);

        if (updated) {
          lifecycleUpdates += 1;
        }
      } catch (err) {
        console.error(
          `[reconcile-facebook] Lifecycle poll error for livestream ${livestream.id} (user ${userId})`,
          err
        );
      }
    }
  }

  if (lifecycleUpdates > 0) {
    console.log(
      `[reconcile-facebook] Updated ${lifecycleUpdates} Facebook livestream lifecycle status(es).`
    );
  }

  return { lifecycleUpdates };
}
