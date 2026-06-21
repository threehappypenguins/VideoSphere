import { buildLivestreamPatchFromYouTubeMetadata } from '@/lib/livestreams/pull-youtube-livestream-patch';
import { livestreamNeedsYouTubePull } from '@/lib/livestreams/youtube-lifecycle';
import { getYouTubeLiveBroadcastMetadata } from '@/lib/platforms/youtube-livestream-api';
import { getConnectedAccountWithTokens } from '@/lib/repositories/connected-accounts';
import {
  deleteLivestream,
  getLivestreamById,
  listLivestreamsByUser,
  updateLivestream,
} from '@/lib/repositories/livestreams';
import { refreshTokenIfNeeded } from '@/lib/platforms/token-refresh';
import type { Livestream } from '@/types';

async function resolveYouTubeAccessTokenForUser(userId: string): Promise<string | null> {
  const account = await getConnectedAccountWithTokens(userId, 'youtube');
  if (!account) {
    return null;
  }

  try {
    const tokens = await refreshTokenIfNeeded(account);
    const accessToken = tokens.accessToken.trim();
    return accessToken.length > 0 ? accessToken : null;
  } catch (err) {
    console.error(
      `[reconcile] Failed to refresh YouTube token for user ${userId} during YouTube pull`,
      err
    );
    return null;
  }
}

/**
 * Pulls metadata and lifecycle status from YouTube for one linked livestream row.
 * Deletes the local row when the linked YouTube broadcast no longer exists.
 * @param accessToken - OAuth access token with YouTube read scope.
 * @param livestream - Local livestream row to reconcile.
 * @returns Updated row when changes were applied, `null` when deleted on YouTube, otherwise the original row.
 */
export async function reconcileLivestreamFromYouTube(
  accessToken: string,
  livestream: Livestream
): Promise<Livestream | null> {
  if (!livestreamNeedsYouTubePull(livestream)) {
    return livestream;
  }

  const broadcastId = livestream.youtubeBroadcastId!.trim();

  try {
    const metadataResult = await getYouTubeLiveBroadcastMetadata(accessToken, broadcastId);
    if (metadataResult.ok === false) {
      console.warn(
        `[reconcile] YouTube metadata pull failed for livestream ${livestream.id}: ${metadataResult.details}`
      );
      return livestream;
    }

    if (!metadataResult.metadata) {
      console.info(
        `[reconcile] YouTube broadcast ${broadcastId} deleted; removing livestream ${livestream.id}`
      );
      await deleteLivestream(livestream.id);
      return null;
    }

    const patch = buildLivestreamPatchFromYouTubeMetadata(livestream, metadataResult.metadata);
    if (!patch) {
      return livestream;
    }

    const updated = await updateLivestream(livestream.id, patch);
    return updated ?? livestream;
  } catch (err) {
    console.error(
      `[reconcile] YouTube pull error for livestream ${livestream.id} (user ${livestream.userId})`,
      err
    );
    return livestream;
  }
}

/**
 * Pulls YouTube metadata and lifecycle for all linked livestreams belonging to a user.
 * Intended for list-page refresh — does not promote temp stream keys.
 * @param userId - Owner user id.
 * @returns Number of livestream rows updated.
 */
export async function reconcileLivestreamsFromYouTubeForUser(userId: string): Promise<number> {
  const accessToken = await resolveYouTubeAccessTokenForUser(userId);
  if (!accessToken) {
    return 0;
  }

  const livestreams = await listLivestreamsByUser(userId);
  let updates = 0;

  for (const livestream of livestreams) {
    if (!livestreamNeedsYouTubePull(livestream)) {
      continue;
    }

    const beforeUpdatedAt = livestream.$updatedAt;
    const reconciled = await reconcileLivestreamFromYouTube(accessToken, livestream);
    if (reconciled === null || reconciled.$updatedAt !== beforeUpdatedAt) {
      updates += 1;
    }
  }

  return updates;
}

/**
 * Pulls YouTube metadata and lifecycle for a single livestream owned by the user.
 * @param userId - Owner user id.
 * @param livestreamId - Livestream row id.
 * @returns Reconciled livestream, or `null` when the row does not exist, is not owned, or was removed because YouTube deleted the broadcast.
 */
export async function reconcileLivestreamFromYouTubeById(
  userId: string,
  livestreamId: string
): Promise<Livestream | null> {
  const livestream = await getLivestreamById(livestreamId);
  if (!livestream || livestream.userId !== userId) {
    return null;
  }

  const accessToken = await resolveYouTubeAccessTokenForUser(userId);
  if (!accessToken) {
    return livestream;
  }

  return reconcileLivestreamFromYouTube(accessToken, livestream);
}

/** @deprecated Use {@link reconcileLivestreamsFromYouTubeForUser}. */
export const reconcileLivestreamLifecycleForUser = reconcileLivestreamsFromYouTubeForUser;
