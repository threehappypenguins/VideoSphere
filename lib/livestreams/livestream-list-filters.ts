import type { Livestream } from '@/types';

const STREAMED_LIVESTREAM_STATUSES = ['ended', 'failed'] as const;

/**
 * Returns whether a livestream belongs in the streamed/history sections.
 * @param livestream - Livestream row to evaluate.
 * @returns True when the broadcast has ended or failed.
 */
export function isStreamedLivestream(livestream: Pick<Livestream, 'status'>): boolean {
  return livestream.status === 'ended' || livestream.status === 'failed';
}

/**
 * Returns whether a livestream can be selected as a YouTube import source.
 * @param livestream - Livestream row to evaluate.
 * @returns True when the row is linked to a YouTube broadcast and has finished.
 */
export function isYoutubeImportLivestream(
  livestream: Pick<
    Livestream,
    'status' | 'targets' | 'youtubeBroadcastId' | 'youtubeLifecycleStatus'
  >
): boolean {
  if (!livestream.targets.includes('youtube')) {
    return false;
  }

  if (!livestream.youtubeBroadcastId?.trim()) {
    return false;
  }

  if (isStreamedLivestream(livestream)) {
    return true;
  }

  return (
    livestream.status === 'live' &&
    livestream.youtubeLifecycleStatus?.trim().toLowerCase() === 'complete'
  );
}

/**
 * Builds a MongoDB filter for streamed livestream history pages.
 * @param userId - Owner user id.
 * @returns Query filter for ended/failed rows.
 */
export function buildStreamedLivestreamsMongoFilter(userId: string): Record<string, unknown> {
  return {
    userId,
    status: { $in: STREAMED_LIVESTREAM_STATUSES },
  };
}

/**
 * Builds a MongoDB filter for YouTube import source picker pages.
 * @param userId - Owner user id.
 * @returns Query filter for importable YouTube-linked rows.
 */
export function buildYoutubeImportLivestreamsMongoFilter(userId: string): Record<string, unknown> {
  return {
    userId,
    hasYoutubeTarget: true,
    youtubeBroadcastId: { $ne: '' },
    $or: [
      { status: { $in: STREAMED_LIVESTREAM_STATUSES } },
      { status: 'live', youtubeLifecycleStatus: /^complete$/i },
    ],
  };
}

/**
 * Filters livestreams to streamed rows, preserving repository sort order.
 * @param livestreams - Livestreams ordered most recently updated first.
 * @returns Streamed livestreams in the same order.
 */
export function filterStreamedLivestreams(livestreams: readonly Livestream[]): Livestream[] {
  return livestreams.filter(isStreamedLivestream);
}

/**
 * Filters livestreams to rows importable from YouTube, preserving repository sort order.
 * @param livestreams - Livestreams ordered most recently updated first.
 * @returns YouTube-importable livestreams in the same order.
 */
export function filterYoutubeImportLivestreams(livestreams: readonly Livestream[]): Livestream[] {
  return livestreams.filter(isYoutubeImportLivestream);
}

/**
 * Returns a page slice from an already-filtered livestream list.
 * @param livestreams - Ordered livestream rows.
 * @param offset - Number of rows to skip.
 * @param limit - Maximum rows to return.
 * @returns Page slice.
 */
export function paginateLivestreams(
  livestreams: readonly Livestream[],
  offset: number,
  limit: number
): Livestream[] {
  return livestreams.slice(offset, offset + limit);
}
