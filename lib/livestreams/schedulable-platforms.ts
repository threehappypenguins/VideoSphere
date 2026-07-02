import { isUsablePlatformConnection } from '@/lib/platforms/connection-status';
import { isFacebookLivestreamSchedulingEnabled } from '@/lib/livestreams/facebook-livestream-feature';
import type { ConnectedAccountPlatform, ConnectedAccountPublic } from '@/types';

/** Connection fields required to decide whether a livestream can be scheduled to a platform. */
export type LivestreamConnectionSnapshot = Pick<
  ConnectedAccountPublic,
  | 'platform'
  | 'hasYoutubeMainStreamKey'
  | 'hasYoutubeTempStreamKey'
  | 'facebookTargetType'
  | 'facebookPageId'
>;

/**
 * Returns the user's YouTube connection row, if present.
 * @param connections - Public connection snapshots from `/api/platforms/connections`.
 * @returns YouTube snapshot or `undefined` when YouTube is not connected.
 */
export function getYouTubeLivestreamConnection(
  connections: LivestreamConnectionSnapshot[]
): LivestreamConnectionSnapshot | undefined {
  return connections.find((connection) => connection.platform === 'youtube');
}

/**
 * Returns the user's Facebook connection row, if present.
 * @param connections - Public connection snapshots from `/api/platforms/connections`.
 * @returns Facebook snapshot or `undefined` when Facebook is not connected.
 */
export function getFacebookLivestreamConnection(
  connections: LivestreamConnectionSnapshot[]
): LivestreamConnectionSnapshot | undefined {
  return connections.find((connection) => connection.platform === 'facebook');
}

/**
 * True when YouTube is connected and a main stream key is configured.
 * A main key is required to schedule the first livestream on the channel.
 * @param youtube - YouTube connection snapshot.
 * @returns Whether YouTube livestreams can be scheduled for this account.
 */
export function isYouTubeLivestreamSchedulable(
  youtube: LivestreamConnectionSnapshot | undefined
): boolean {
  return youtube?.hasYoutubeMainStreamKey === true;
}

/**
 * True when Facebook is connected to a Page with a configured Page ID.
 * @param facebook - Facebook connection snapshot.
 * @returns Whether Facebook livestreams can be scheduled for this account.
 */
export function isFacebookLivestreamSchedulable(
  facebook: LivestreamConnectionSnapshot | undefined
): boolean {
  if (!isFacebookLivestreamSchedulingEnabled()) {
    return false;
  }
  if (!facebook || facebook.platform !== 'facebook') {
    return false;
  }
  if (facebook.facebookTargetType !== 'page') {
    return false;
  }
  return Boolean(facebook.facebookPageId?.trim());
}

/**
 * Platforms the user can schedule livestreams to right now.
 * @param connections - Public connection snapshots from `/api/platforms/connections`.
 * @returns Connected platforms that meet livestream scheduling requirements.
 */
export function getSchedulableLivestreamPlatforms(
  connections: LivestreamConnectionSnapshot[]
): ConnectedAccountPlatform[] {
  const platforms: ConnectedAccountPlatform[] = [];
  if (isYouTubeLivestreamSchedulable(getYouTubeLivestreamConnection(connections))) {
    platforms.push('youtube');
  }
  if (isFacebookLivestreamSchedulable(getFacebookLivestreamConnection(connections))) {
    platforms.push('facebook');
  }
  return platforms;
}

/**
 * Maps a connections API payload to livestream scheduling snapshots.
 * @param connections - Raw connected account rows from the API.
 * @returns Normalized snapshots for scheduling eligibility checks.
 */
export function toLivestreamConnectionSnapshots(
  connections: ConnectedAccountPublic[]
): LivestreamConnectionSnapshot[] {
  return connections
    .filter(isUsablePlatformConnection)
    .map(
      ({
        platform,
        hasYoutubeMainStreamKey,
        hasYoutubeTempStreamKey,
        facebookTargetType,
        facebookPageId,
      }) => ({
        platform,
        hasYoutubeMainStreamKey,
        hasYoutubeTempStreamKey,
        ...(facebookTargetType != null ? { facebookTargetType } : {}),
        ...(facebookPageId != null ? { facebookPageId } : {}),
      })
    );
}
