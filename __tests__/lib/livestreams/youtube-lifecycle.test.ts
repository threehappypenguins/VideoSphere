import { describe, expect, it } from 'vitest';

import {
  livestreamNeedsLifecycleReconcile,
  livestreamNeedsYouTubePull,
  localStatusForYouTubeLifecycle,
} from '@/lib/livestreams/youtube-lifecycle';

describe('localStatusForYouTubeLifecycle', () => {
  it.each([
    ['testing', 'live'],
    ['live', 'live'],
    ['complete', 'ended'],
    ['ready', undefined],
    [null, undefined],
  ] as const)('maps %s to %s', (input, expected) => {
    expect(localStatusForYouTubeLifecycle(input)).toBe(expected);
  });
});

describe('livestreamNeedsLifecycleReconcile', () => {
  it('returns true for scheduled or live rows with a broadcast id', () => {
    expect(
      livestreamNeedsLifecycleReconcile({
        status: 'scheduled',
        youtubeBroadcastId: 'broadcast-1',
      })
    ).toBe(true);
    expect(
      livestreamNeedsLifecycleReconcile({
        status: 'live',
        youtubeBroadcastId: 'broadcast-1',
      })
    ).toBe(true);
  });

  it('returns false for terminal failed status', () => {
    expect(
      livestreamNeedsLifecycleReconcile({
        status: 'ended',
        youtubeBroadcastId: 'broadcast-1',
      })
    ).toBe(false);
  });
});

describe('livestreamNeedsYouTubePull', () => {
  it('returns true for linked rows except failed', () => {
    expect(
      livestreamNeedsYouTubePull({
        status: 'scheduled',
        youtubeBroadcastId: 'broadcast-1',
      })
    ).toBe(true);
    expect(
      livestreamNeedsYouTubePull({
        status: 'ended',
        youtubeBroadcastId: 'broadcast-1',
      })
    ).toBe(true);
  });

  it('returns false without a broadcast id or for failed rows', () => {
    expect(livestreamNeedsYouTubePull({ status: 'scheduled' })).toBe(false);
    expect(
      livestreamNeedsYouTubePull({
        status: 'failed',
        youtubeBroadcastId: 'broadcast-1',
      })
    ).toBe(false);
  });
});
