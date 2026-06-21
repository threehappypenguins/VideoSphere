import { describe, expect, it } from 'vitest';

import { partitionLivestreams } from '@/lib/livestreams/partition-livestreams';
import type { Livestream } from '@/types';

function makeLivestream(
  overrides: Partial<Livestream> & { id: string; status: Livestream['status'] }
): Livestream {
  return {
    userId: 'user-1',
    title: 'Stream',
    description: '',
    tags: [],
    visibility: 'public',
    targets: ['youtube'],
    platforms: {},
    $createdAt: '2026-01-01T00:00:00.000Z',
    $updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('partitionLivestreams', () => {
  it('splits livestreams into drafts, scheduled, live, and streamed buckets', () => {
    const livestreams = [
      makeLivestream({ id: 'draft-1', status: 'draft' }),
      makeLivestream({ id: 'scheduled-1', status: 'scheduled' }),
      makeLivestream({ id: 'live-1', status: 'live' }),
      makeLivestream({ id: 'ended-1', status: 'ended' }),
      makeLivestream({ id: 'failed-1', status: 'failed' }),
    ];

    expect(partitionLivestreams(livestreams)).toEqual({
      drafts: [livestreams[0]],
      scheduled: [livestreams[1]],
      live: [livestreams[2]],
      streamed: [livestreams[3], livestreams[4]],
    });
  });
});
