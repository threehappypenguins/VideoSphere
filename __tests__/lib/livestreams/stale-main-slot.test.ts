import { describe, expect, it } from 'vitest';

import {
  classifyMainSlotForPromotion,
  isWithinTempPromotionWindow,
  mainSlotNeverWentLive,
  shouldReleaseStaleMainSlot,
} from '@/lib/livestreams/stale-main-slot';

const NOW = new Date('2026-07-01T17:45:00.000Z');

describe('classifyMainSlotForPromotion', () => {
  it('treats a missing main holder as free', () => {
    expect(classifyMainSlotForPromotion(null, NOW)).toBe('free');
  });

  it('blocks when the main holder is live on YouTube', () => {
    expect(
      classifyMainSlotForPromotion(
        {
          keySlot: 'main',
          status: 'live',
          scheduledStartTime: '2026-07-01T12:00:00.000Z',
          youtubeLifecycleStatus: 'live',
        },
        NOW
      )
    ).toBe('blocked');
  });

  it('marks a never-live main holder as stale at the temp promotion check', () => {
    expect(
      classifyMainSlotForPromotion(
        {
          keySlot: 'main',
          status: 'scheduled',
          scheduledStartTime: '2026-07-01T17:00:00.000Z',
          youtubeLifecycleStatus: 'ready',
        },
        NOW
      )
    ).toBe('stale');
  });

  it('does not mark a late-start main holder stale before its scheduled start', () => {
    expect(
      classifyMainSlotForPromotion(
        {
          keySlot: 'main',
          status: 'scheduled',
          scheduledStartTime: '2026-07-01T18:30:00.000Z',
          youtubeLifecycleStatus: 'ready',
        },
        NOW
      )
    ).toBe('blocked');
  });

  it('treats a completed main broadcast as free', () => {
    expect(
      classifyMainSlotForPromotion(
        {
          keySlot: 'main',
          status: 'scheduled',
          scheduledStartTime: '2026-07-01T12:00:00.000Z',
          youtubeLifecycleStatus: 'complete',
        },
        NOW
      )
    ).toBe('free');
  });
});

describe('mainSlotNeverWentLive', () => {
  it('is true for ready main-slot rows that never started on YouTube', () => {
    expect(
      mainSlotNeverWentLive({
        keySlot: 'main',
        status: 'scheduled',
        scheduledStartTime: '2026-07-01T09:00:00.000Z',
        youtubeLifecycleStatus: 'ready',
      })
    ).toBe(true);
  });

  it('is false once YouTube reports testing or live', () => {
    expect(
      shouldReleaseStaleMainSlot({
        keySlot: 'main',
        status: 'scheduled',
        scheduledStartTime: '2026-07-01T09:00:00.000Z',
        youtubeLifecycleStatus: 'testing',
      })
    ).toBe(false);
  });
});

describe('isWithinTempPromotionWindow', () => {
  it('returns true when start is within the lead time', () => {
    expect(
      isWithinTempPromotionWindow(
        { scheduledStartTime: '2026-07-01T18:00:00.000Z' },
        NOW,
        30 * 60_000
      )
    ).toBe(true);
  });
});
