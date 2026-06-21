import { describe, expect, it } from 'vitest';

import {
  decideKeySlotForNewSchedule,
  pickNextTempCandidateForPromotion,
  requireYouTubeStreamKeyForSlot,
  shouldPromoteTempToMain,
  TEMP_TO_MAIN_PROMOTION_WINDOW_MS,
} from '@/lib/livestreams/key-assignment';
import type { ConnectedAccount } from '@/types';

function baseAccount(overrides: Partial<ConnectedAccount> = {}): ConnectedAccount {
  return {
    id: 'acc-1',
    userId: 'user-1',
    platform: 'youtube',
    accessToken: 'access',
    refreshToken: 'refresh',
    tokenExpiry: '2099-01-01T00:00:00.000Z',
    hasRefreshToken: true,
    hasYoutubeMainStreamKey: false,
    hasYoutubeTempStreamKey: false,
    platformUserId: 'channel-1',
    platformName: 'My Channel',
    $createdAt: '2026-01-01T00:00:00.000Z',
    $updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('decideKeySlotForNewSchedule', () => {
  it('assigns main when no livestreams are armed', () => {
    expect(decideKeySlotForNewSchedule([])).toEqual({ ok: true, keySlot: 'main' });
  });

  it('assigns temp when one livestream is armed', () => {
    expect(decideKeySlotForNewSchedule([{ keySlot: 'main' }])).toEqual({
      ok: true,
      keySlot: 'temp',
    });
  });

  it('assigns temp when two livestreams are armed', () => {
    expect(decideKeySlotForNewSchedule([{ keySlot: 'main' }, { keySlot: 'temp' }])).toEqual({
      ok: true,
      keySlot: 'temp',
    });
  });

  it('assigns temp when five livestreams are armed', () => {
    expect(
      decideKeySlotForNewSchedule([
        { keySlot: 'main' },
        { keySlot: 'temp' },
        { keySlot: 'temp' },
        { keySlot: 'temp' },
        { keySlot: 'temp' },
      ])
    ).toEqual({ ok: true, keySlot: 'temp' });
  });
});

describe('pickNextTempCandidateForPromotion', () => {
  it('returns null for an empty list', () => {
    expect(pickNextTempCandidateForPromotion([])).toBeNull();
  });

  it('returns the only entry when one temp livestream exists', () => {
    expect(
      pickNextTempCandidateForPromotion([
        { id: 'ls-1', scheduledStartTime: '2026-06-15T15:00:00.000Z' },
      ])
    ).toEqual({ id: 'ls-1', scheduledStartTime: '2026-06-15T15:00:00.000Z' });
  });

  it('returns the earliest scheduledStartTime regardless of array order', () => {
    expect(
      pickNextTempCandidateForPromotion([
        { id: 'ls-late', scheduledStartTime: '2026-06-20T15:00:00.000Z' },
        { id: 'ls-first', scheduledStartTime: '2026-06-10T09:00:00.000Z' },
        { id: 'ls-middle', scheduledStartTime: '2026-06-15T12:00:00.000Z' },
      ])
    ).toEqual({ id: 'ls-first', scheduledStartTime: '2026-06-10T09:00:00.000Z' });
  });
});

describe('shouldPromoteTempToMain', () => {
  const now = new Date('2026-06-15T12:00:00.000Z');

  function atOffsetMinutes(minutes: number): string {
    return new Date(now.getTime() + minutes * 60_000).toISOString();
  }

  it('promotes when main slot is null and start time is in the past', () => {
    expect(
      shouldPromoteTempToMain(
        {
          tempCandidate: { scheduledStartTime: atOffsetMinutes(-10) },
          currentMainSlotStream: null,
        },
        now
      )
    ).toBe(true);
  });

  it('promotes when main slot is null and start time is 5 minutes away', () => {
    expect(
      shouldPromoteTempToMain(
        {
          tempCandidate: { scheduledStartTime: atOffsetMinutes(5) },
          currentMainSlotStream: null,
        },
        now
      )
    ).toBe(true);
  });

  it('promotes when main slot is null and start time is exactly 30 minutes away', () => {
    expect(
      shouldPromoteTempToMain(
        {
          tempCandidate: {
            scheduledStartTime: new Date(
              now.getTime() + TEMP_TO_MAIN_PROMOTION_WINDOW_MS
            ).toISOString(),
          },
          currentMainSlotStream: null,
        },
        now
      )
    ).toBe(true);
  });

  it('does not promote when main slot is null and start time is far in the future', () => {
    expect(
      shouldPromoteTempToMain(
        {
          tempCandidate: { scheduledStartTime: atOffsetMinutes(31) },
          currentMainSlotStream: null,
        },
        now
      )
    ).toBe(false);
  });

  it('promotes when main lifecycle is complete and start time is within the window', () => {
    expect(
      shouldPromoteTempToMain(
        {
          tempCandidate: { scheduledStartTime: atOffsetMinutes(5) },
          currentMainSlotStream: { youtubeLifecycleStatus: 'complete' },
        },
        now
      )
    ).toBe(true);
  });

  it('does not promote when main lifecycle is complete but start time is too far away', () => {
    expect(
      shouldPromoteTempToMain(
        {
          tempCandidate: { scheduledStartTime: atOffsetMinutes(45) },
          currentMainSlotStream: { youtubeLifecycleStatus: 'complete' },
        },
        now
      )
    ).toBe(false);
  });

  it('does not promote when main slot is ready even if start time is soon', () => {
    expect(
      shouldPromoteTempToMain(
        {
          tempCandidate: { scheduledStartTime: atOffsetMinutes(5) },
          currentMainSlotStream: { youtubeLifecycleStatus: 'ready' },
        },
        now
      )
    ).toBe(false);
  });

  it('does not promote when main slot is testing even if start time is soon', () => {
    expect(
      shouldPromoteTempToMain(
        {
          tempCandidate: { scheduledStartTime: atOffsetMinutes(5) },
          currentMainSlotStream: { youtubeLifecycleStatus: 'testing' },
        },
        now
      )
    ).toBe(false);
  });
});

describe('requireYouTubeStreamKeyForSlot', () => {
  it('returns the main key when present', () => {
    expect(
      requireYouTubeStreamKeyForSlot(
        baseAccount({ youtubeMainStreamKey: 'main-key-value' }),
        'main'
      )
    ).toEqual({ ok: true, key: 'main-key-value' });
  });

  it('returns the temp key when present', () => {
    expect(
      requireYouTubeStreamKeyForSlot(
        baseAccount({ youtubeTempStreamKey: 'temp-key-value' }),
        'temp'
      )
    ).toEqual({ ok: true, key: 'temp-key-value' });
  });

  it('returns a connections-page message when the main key is missing', () => {
    expect(requireYouTubeStreamKeyForSlot(baseAccount(), 'main')).toEqual({
      ok: false,
      reason: 'Add a main stream key on the Connections page before scheduling a livestream.',
    });
  });

  it('returns a connections-page message when the temp key is missing', () => {
    expect(requireYouTubeStreamKeyForSlot(baseAccount(), 'temp')).toEqual({
      ok: false,
      reason:
        'Add a temporary stream key on the Connections page before scheduling another livestream.',
    });
  });
});
