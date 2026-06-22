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

  it('orders scheduled livestreams by scheduled start time ascending', () => {
    const later = makeLivestream({
      id: 'scheduled-later',
      status: 'scheduled',
      keySlot: 'temp',
      scheduledStartTime: '2026-07-10T18:00:00.000Z',
      $updatedAt: '2026-07-09T12:00:00.000Z',
    });
    const sooner = makeLivestream({
      id: 'scheduled-sooner',
      status: 'scheduled',
      keySlot: 'main',
      scheduledStartTime: '2026-07-01T18:00:00.000Z',
      $updatedAt: '2026-07-08T12:00:00.000Z',
    });

    const { scheduled } = partitionLivestreams([later, sooner]);

    expect(scheduled.map((row) => row.id)).toEqual(['scheduled-sooner', 'scheduled-later']);
  });

  it('orders streamed livestreams by most recently updated first', () => {
    const older = makeLivestream({
      id: 'ended-older',
      status: 'ended',
      scheduledStartTime: '2026-06-01T18:00:00.000Z',
      $updatedAt: '2026-06-01T20:00:00.000Z',
    });
    const newer = makeLivestream({
      id: 'ended-newer',
      status: 'ended',
      scheduledStartTime: '2026-06-15T18:00:00.000Z',
      $updatedAt: '2026-06-15T20:00:00.000Z',
    });

    const { streamed } = partitionLivestreams([older, newer]);

    expect(streamed.map((row) => row.id)).toEqual(['ended-newer', 'ended-older']);
  });
});
