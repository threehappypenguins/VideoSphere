import {
  livestreamNeedsLifecycleReconcile,
  localStatusForYouTubeLifecycle,
} from '@/lib/livestreams/youtube-lifecycle';
import { getYouTubeBroadcastLifecycleStatus } from '@/lib/platforms/youtube-livestream-api';
import { getConnectedAccountWithTokens } from '@/lib/repositories/connected-accounts';
import { listLivestreamsByUser, updateLivestream } from '@/lib/repositories/livestreams';
import { refreshTokenIfNeeded } from '@/lib/platforms/token-refresh';

/**
 * Polls YouTube lifecycle status for a user's scheduled/live broadcasts and updates local rows.
 * Intended for list-page refresh — does not promote temp stream keys.
 * @param userId - Owner user id.
 * @returns Number of livestream rows updated.
 */
export async function reconcileLivestreamLifecycleForUser(userId: string): Promise<number> {
  const account = await getConnectedAccountWithTokens(userId, 'youtube');
  if (!account) {
    return 0;
  }

  let accessToken: string;
  try {
    const tokens = await refreshTokenIfNeeded(account);
    accessToken = tokens.accessToken.trim();
    if (!accessToken) {
      return 0;
    }
  } catch (err) {
    console.error(
      `[reconcile] Failed to refresh YouTube token for user ${userId} during list lifecycle sync`,
      err
    );
    return 0;
  }

  const livestreams = await listLivestreamsByUser(userId);
  let updates = 0;

  for (const livestream of livestreams) {
    if (!livestreamNeedsLifecycleReconcile(livestream)) {
      continue;
    }

    const broadcastId = livestream.youtubeBroadcastId!.trim();

    try {
      const lifecycleResult = await getYouTubeBroadcastLifecycleStatus(accessToken, broadcastId);
      if (lifecycleResult.ok === false) {
        console.warn(
          `[reconcile] List lifecycle poll failed for livestream ${livestream.id}: ${lifecycleResult.details}`
        );
        continue;
      }

      const nextLifecycle = lifecycleResult.lifeCycleStatus;
      const nextStatus = localStatusForYouTubeLifecycle(nextLifecycle ?? null);
      const lifecycleChanged = nextLifecycle !== (livestream.youtubeLifecycleStatus ?? null);
      const statusChanged = nextStatus !== undefined && nextStatus !== livestream.status;

      if (!lifecycleChanged && !statusChanged) {
        continue;
      }

      const updated = await updateLivestream(livestream.id, {
        ...(lifecycleChanged && nextLifecycle != null
          ? { youtubeLifecycleStatus: nextLifecycle }
          : lifecycleChanged
            ? { youtubeLifecycleStatus: null }
            : {}),
        ...(statusChanged ? { status: nextStatus } : {}),
      });

      if (updated) {
        updates += 1;
      }
    } catch (err) {
      console.error(
        `[reconcile] List lifecycle poll error for livestream ${livestream.id} (user ${userId})`,
        err
      );
    }
  }

  return updates;
}
