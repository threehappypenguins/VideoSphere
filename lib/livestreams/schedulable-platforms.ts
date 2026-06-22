import type { ConnectedAccountPlatform, ConnectedAccountPublic } from '@/types';

/** Connection fields required to decide whether a livestream can be scheduled to YouTube. */
export type LivestreamConnectionSnapshot = Pick<
  ConnectedAccountPublic,
  'platform' | 'hasYoutubeMainStreamKey' | 'hasYoutubeTempStreamKey'
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
 * Platforms the user can schedule livestreams to right now.
 * @param connections - Public connection snapshots from `/api/platforms/connections`.
 * @returns Connected platforms that meet livestream scheduling requirements.
 */
export function getSchedulableLivestreamPlatforms(
  connections: LivestreamConnectionSnapshot[]
): ConnectedAccountPlatform[] {
  return isYouTubeLivestreamSchedulable(getYouTubeLivestreamConnection(connections))
    ? ['youtube']
    : [];
}

/**
 * Maps a connections API payload to livestream scheduling snapshots.
 * @param connections - Raw connected account rows from the API.
 * @returns Normalized snapshots for scheduling eligibility checks.
 */
export function toLivestreamConnectionSnapshots(
  connections: ConnectedAccountPublic[]
): LivestreamConnectionSnapshot[] {
  return connections.map(({ platform, hasYoutubeMainStreamKey, hasYoutubeTempStreamKey }) => ({
    platform,
    hasYoutubeMainStreamKey,
    hasYoutubeTempStreamKey,
  }));
}
