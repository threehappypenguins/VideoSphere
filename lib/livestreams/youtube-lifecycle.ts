import type { LivestreamStatus } from '@/types';

/**
 * Maps a YouTube `liveBroadcasts.status.lifeCycleStatus` value to a VideoSphere status.
 * @param lifeCycleStatus - Raw lifecycle status from the YouTube Data API.
 * @returns Local status when recognized, otherwise `undefined`.
 */
export function localStatusForYouTubeLifecycle(
  lifeCycleStatus: string | null
): LivestreamStatus | undefined {
  const normalized = lifeCycleStatus?.trim().toLowerCase();
  if (normalized === 'testing' || normalized === 'live') {
    return 'live';
  }
  if (normalized === 'complete') {
    return 'ended';
  }
  return undefined;
}

/**
 * Returns whether a livestream row should be checked against YouTube lifecycle on list load.
 * @param livestream - Livestream row with status and optional broadcast id.
 * @returns True when a lifecycle poll may change local status.
 */
export function livestreamNeedsLifecycleReconcile(livestream: {
  status: LivestreamStatus;
  youtubeBroadcastId?: string;
}): boolean {
  const broadcastId = livestream.youtubeBroadcastId?.trim();
  if (!broadcastId) {
    return false;
  }
  return livestream.status === 'scheduled' || livestream.status === 'live';
}
