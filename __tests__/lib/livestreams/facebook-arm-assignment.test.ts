import { describe, expect, it } from 'vitest';
import {
  computeFacebookDeferredArmAt,
  decideFacebookArmForNewSchedule,
  isFacebookDeferredArmPending,
} from '@/lib/livestreams/facebook-arm-assignment';
import type { Livestream } from '@/types';

function facebookLivestream(
  overrides: Partial<Livestream> = {}
): Pick<
  Livestream,
  | 'id'
  | 'status'
  | 'targets'
  | 'scheduledStartTime'
  | 'facebookLiveVideoId'
  | 'autoPromoteToMainKey'
  | 'autoPromoteToMainKeyMinutes'
> {
  return {
    id: 'fb-1',
    status: 'scheduled',
    targets: ['facebook'],
    scheduledStartTime: '2026-07-01T18:00:00.000Z',
    autoPromoteToMainKey: true,
    autoPromoteToMainKeyMinutes: 30,
    ...overrides,
  };
}

describe('decideFacebookArmForNewSchedule', () => {
  it('arms immediately when no other Facebook livestream is queued', () => {
    expect(decideFacebookArmForNewSchedule([])).toEqual({ kind: 'immediate' });
  });

  it('defers when another Facebook livestream is already scheduled or live', () => {
    expect(decideFacebookArmForNewSchedule([{ id: 'other' }])).toEqual({ kind: 'deferred' });
  });
});

describe('isFacebookDeferredArmPending', () => {
  it('returns true for queued scheduled Facebook rows with auto-preparation enabled', () => {
    expect(isFacebookDeferredArmPending(facebookLivestream())).toBe(true);
  });

  it('returns false once a LiveVideo id exists', () => {
    expect(
      isFacebookDeferredArmPending(facebookLivestream({ facebookLiveVideoId: 'fb-video-1' }))
    ).toBe(false);
  });

  it('returns false when auto-preparation is disabled', () => {
    expect(isFacebookDeferredArmPending(facebookLivestream({ autoPromoteToMainKey: false }))).toBe(
      false
    );
  });
});

describe('computeFacebookDeferredArmAt', () => {
  it('returns the preparation instant before scheduled start', () => {
    const at = computeFacebookDeferredArmAt(facebookLivestream());
    expect(at?.toISOString()).toBe('2026-07-01T17:30:00.000Z');
  });
});
