import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cancelTempToMainPromotionSchedule,
  syncTempToMainPromotionSchedule,
} from '@/lib/livestreams/temp-to-main-promotion-scheduler';
import type { Livestream } from '@/types';

vi.mock('@/lib/livestreams/promote-temp-to-main', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/livestreams/promote-temp-to-main')>();
  return {
    ...actual,
    attemptPromoteTempLivestreamToMain: vi.fn(),
  };
});

import { attemptPromoteTempLivestreamToMain } from '@/lib/livestreams/promote-temp-to-main';

function makeLivestream(overrides: Partial<Livestream> & { id: string }): Livestream {
  return {
    userId: 'user-1',
    status: 'scheduled',
    title: 'Stream',
    description: '',
    tags: [],
    visibility: 'public',
    targets: ['youtube'],
    platforms: {},
    keySlot: 'temp',
    scheduledStartTime: '2026-07-01T18:10:00.000Z',
    autoPromoteToMainKeyMinutes: 5,
    youtubeBroadcastId: 'broadcast-1',
    $createdAt: '2026-01-01T00:00:00.000Z',
    $updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('syncTempToMainPromotionSchedule', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T18:00:00.000Z'));
    vi.mocked(attemptPromoteTempLivestreamToMain).mockResolvedValue({
      ok: true,
      livestream: makeLivestream({ id: 'temp-1', keySlot: 'main' }),
    });
    cancelTempToMainPromotionSchedule('temp-1');
  });

  afterEach(() => {
    cancelTempToMainPromotionSchedule('temp-1');
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it('fires promotion at the exact lead time before start', async () => {
    const livestream = makeLivestream({ id: 'temp-1' });
    syncTempToMainPromotionSchedule(livestream);

    await vi.advanceTimersByTimeAsync(4 * 60_000 + 59_999);
    expect(attemptPromoteTempLivestreamToMain).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(attemptPromoteTempLivestreamToMain).toHaveBeenCalledWith('temp-1');
  });

  it('runs immediately when promotion time is already past', async () => {
    vi.setSystemTime(new Date('2026-07-01T18:06:00.000Z'));
    syncTempToMainPromotionSchedule(makeLivestream({ id: 'temp-1' }));

    await vi.runAllTimersAsync();
    expect(attemptPromoteTempLivestreamToMain).toHaveBeenCalledWith('temp-1');
  });

  it('cancels a pending promotion', async () => {
    syncTempToMainPromotionSchedule(makeLivestream({ id: 'temp-1' }));
    cancelTempToMainPromotionSchedule('temp-1');

    await vi.runAllTimersAsync();
    expect(attemptPromoteTempLivestreamToMain).not.toHaveBeenCalled();
  });
});
