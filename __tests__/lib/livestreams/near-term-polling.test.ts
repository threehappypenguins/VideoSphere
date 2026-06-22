import { describe, expect, it } from 'vitest';
import {
  isNearTermLivestreamForReconciliation,
  shouldPollLivestreamsForReconciliation,
} from '@/lib/livestreams/near-term-polling';
import type { Livestream } from '@/types';

function makeLivestream(
  overrides: Partial<Pick<Livestream, 'status' | 'scheduledStartTime'>>
): Pick<Livestream, 'status' | 'scheduledStartTime'> {
  return {
    status: 'scheduled',
    scheduledStartTime: '2026-07-01T18:00:00.000Z',
    ...overrides,
  };
}

describe('near-term livestream polling helpers', () => {
  const now = Date.parse('2026-07-01T16:00:00.000Z');

  it('returns true for a scheduled livestream starting within the near-term window', () => {
    expect(
      isNearTermLivestreamForReconciliation(
        makeLivestream({ scheduledStartTime: '2026-07-01T18:00:00.000Z' }),
        now
      )
    ).toBe(true);
  });

  it('returns false for drafts and far-future scheduled rows', () => {
    expect(
      isNearTermLivestreamForReconciliation(
        makeLivestream({ status: 'draft', scheduledStartTime: '2026-07-01T18:00:00.000Z' }),
        now
      )
    ).toBe(false);
    expect(
      isNearTermLivestreamForReconciliation(
        makeLivestream({ scheduledStartTime: '2026-07-10T18:00:00.000Z' }),
        now
      )
    ).toBe(false);
  });

  it('polls when any row is near-term', () => {
    expect(
      shouldPollLivestreamsForReconciliation(
        [
          makeLivestream({ scheduledStartTime: '2026-07-10T18:00:00.000Z' }),
          makeLivestream({ scheduledStartTime: '2026-07-01T18:00:00.000Z' }),
        ],
        now
      )
    ).toBe(true);
  });
});
