import { describe, expect, it } from 'vitest';
import {
  filterStreamedLivestreams,
  filterYoutubeImportLivestreams,
  isStreamedLivestream,
  isYoutubeImportLivestream,
  paginateLivestreams,
} from '@/lib/livestreams/livestream-list-filters';
import type { Livestream } from '@/types';

function makeLivestream(overrides: Partial<Livestream> = {}): Livestream {
  return {
    id: 'livestream-1',
    userId: 'user-1',
    status: 'ended',
    title: 'Sunday Service',
    description: '',
    tags: [],
    visibility: 'public',
    targets: ['youtube'],
    platforms: {},
    youtubeBroadcastId: 'broadcast-1',
    $createdAt: '2026-01-01T00:00:00.000Z',
    $updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('livestream list filters', () => {
  it('identifies streamed livestreams by ended or failed status', () => {
    expect(isStreamedLivestream(makeLivestream({ status: 'ended' }))).toBe(true);
    expect(isStreamedLivestream(makeLivestream({ status: 'failed' }))).toBe(true);
    expect(isStreamedLivestream(makeLivestream({ status: 'live' }))).toBe(false);
  });

  it('identifies YouTube import sources with a linked broadcast', () => {
    expect(isYoutubeImportLivestream(makeLivestream())).toBe(true);
    expect(
      isYoutubeImportLivestream(
        makeLivestream({ status: 'live', youtubeLifecycleStatus: 'complete' })
      )
    ).toBe(true);
    expect(isYoutubeImportLivestream(makeLivestream({ targets: ['facebook'] }))).toBe(false);
    expect(isYoutubeImportLivestream(makeLivestream({ youtubeBroadcastId: undefined }))).toBe(
      false
    );
  });

  it('filters and paginates streamed livestreams in repository order', () => {
    const rows = [
      makeLivestream({ id: 'ended-1', status: 'ended' }),
      makeLivestream({ id: 'live-1', status: 'live' }),
      makeLivestream({ id: 'failed-1', status: 'failed' }),
    ];

    expect(filterStreamedLivestreams(rows).map((row) => row.id)).toEqual(['ended-1', 'failed-1']);
    expect(filterYoutubeImportLivestreams(rows).map((row) => row.id)).toEqual([
      'ended-1',
      'failed-1',
    ]);
    expect(paginateLivestreams(filterStreamedLivestreams(rows), 1, 1).map((row) => row.id)).toEqual(
      ['failed-1']
    );
  });
});
