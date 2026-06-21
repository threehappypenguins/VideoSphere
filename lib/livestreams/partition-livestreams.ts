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

/**
 * Partitions livestreams into drafts, scheduled, live, and streamed sections.
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

  return { drafts, scheduled, live, streamed };
}
