import { describe, expect, it } from 'vitest';

import {
  livestreamNeedsLifecycleReconcile,
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

  it('returns false without a broadcast id or for terminal statuses', () => {
    expect(
      livestreamNeedsLifecycleReconcile({
        status: 'scheduled',
      })
    ).toBe(false);
    expect(
      livestreamNeedsLifecycleReconcile({
        status: 'ended',
        youtubeBroadcastId: 'broadcast-1',
      })
    ).toBe(false);
  });
});
