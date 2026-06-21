import type { Livestream } from '@/types';

/**
 * Buckets livestreams into dashboard list sections by status.
 * @property drafts - Rows still being prepared.
 * @property scheduled - Scheduled on YouTube but not yet live.
 * @property live - Currently live on YouTube.
 * @property streamed - Finished or failed broadcasts.
 */
export interface PartitionedLivestreams {
  drafts: Livestream[];
  scheduled: Livestream[];
  live: Livestream[];
  streamed: Livestream[];
}

function compareScheduledStartAsc(a: Livestream, b: Livestream): number {
  const aMs = Date.parse(a.scheduledStartTime ?? '');
  const bMs = Date.parse(b.scheduledStartTime ?? '');
  const aTime = Number.isNaN(aMs) ? Number.POSITIVE_INFINITY : aMs;
  const bTime = Number.isNaN(bMs) ? Number.POSITIVE_INFINITY : bMs;
  if (aTime !== bTime) {
    return aTime - bTime;
  }
  return a.id.localeCompare(b.id);
}

function compareUpdatedAtDesc(a: Livestream, b: Livestream): number {
  const aMs = Date.parse(a.$updatedAt);
  const bMs = Date.parse(b.$updatedAt);
  const aTime = Number.isNaN(aMs) ? 0 : aMs;
  const bTime = Number.isNaN(bMs) ? 0 : bMs;
  if (bTime !== aTime) {
    return bTime - aTime;
  }
  return a.id.localeCompare(b.id);
}

/**
 * Partitions livestreams into drafts, scheduled, live, and streamed sections.
 * Scheduled rows are ordered by {@link Livestream.scheduledStartTime} ascending (soonest first).
 * Streamed rows are ordered by {@link Livestream.$updatedAt} descending (most recently finished first).
 * @param livestreams - All livestreams for the user.
 * @returns Four buckets for the dashboard list UI.
 */
export function partitionLivestreams(livestreams: Livestream[]): PartitionedLivestreams {
  const drafts: Livestream[] = [];
  const scheduled: Livestream[] = [];
  const live: Livestream[] = [];
  const streamed: Livestream[] = [];

  for (const livestream of livestreams) {
    if (livestream.status === 'draft') {
      drafts.push(livestream);
    } else if (livestream.status === 'scheduled') {
      scheduled.push(livestream);
    } else if (livestream.status === 'live') {
      live.push(livestream);
    } else if (livestream.status === 'ended' || livestream.status === 'failed') {
      streamed.push(livestream);
    }
  }

  scheduled.sort(compareScheduledStartAsc);
  streamed.sort(compareUpdatedAtDesc);

  return { drafts, scheduled, live, streamed };
}
