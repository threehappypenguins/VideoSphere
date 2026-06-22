import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  attemptPromoteTempLivestreamToMain,
  computeTempToMainPromotionAt,
} from '@/lib/livestreams/promote-temp-to-main';
import { releaseStaleMainSlot } from '@/lib/livestreams/stale-main-slot';
import type { ConnectedAccount, Livestream } from '@/types';

vi.mock('@/lib/livestreams/stale-main-slot', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/livestreams/stale-main-slot')>();
  return {
    ...actual,
    releaseStaleMainSlot: vi.fn(),
  };
});

vi.mock('@/lib/repositories/livestreams', () => ({
  getLivestreamById: vi.fn(),
  getArmedMainSlotLivestreamForUser: vi.fn(),
  listArmedTempSlotLivestreamsForUser: vi.fn(),
  updateLivestream: vi.fn(),
}));

vi.mock('@/lib/repositories/connected-accounts', () => ({
  getConnectedAccountWithTokens: vi.fn(),
}));

vi.mock('@/lib/platforms/token-refresh', () => ({
  refreshTokenIfNeeded: vi.fn(),
}));

vi.mock('@/lib/platforms/youtube-livestream-api', () => ({
  getYouTubeBroadcastLifecycleStatus: vi.fn(),
  ensureYouTubeBroadcastBoundToStreamKey: vi.fn(),
}));

import {
  getLivestreamById,
  getArmedMainSlotLivestreamForUser,
  listArmedTempSlotLivestreamsForUser,
  updateLivestream,
} from '@/lib/repositories/livestreams';
import { getConnectedAccountWithTokens } from '@/lib/repositories/connected-accounts';
import { refreshTokenIfNeeded } from '@/lib/platforms/token-refresh';
import {
  getYouTubeBroadcastLifecycleStatus,
  ensureYouTubeBroadcastBoundToStreamKey,
} from '@/lib/platforms/youtube-livestream-api';

const USER_ID = 'user-1';
const NOW = new Date('2026-07-01T17:45:00.000Z');

function makeLivestream(overrides: Partial<Livestream> & { id: string }): Livestream {
  return {
    userId: USER_ID,
    status: 'scheduled',
    title: 'Stream',
    description: '',
    tags: [],
    visibility: 'public',
    targets: ['youtube'],
    platforms: {},
    keySlot: 'temp',
    scheduledStartTime: '2026-07-01T18:00:00.000Z',
    youtubeBroadcastId: `broadcast-${overrides.id}`,
    youtubeBoundStreamId: 'bound-stream-temp',
    youtubeLifecycleStatus: 'ready',
    $createdAt: '2026-01-01T00:00:00.000Z',
    $updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeAccount(): ConnectedAccount {
  return {
    id: 'acc-yt',
    userId: USER_ID,
    platform: 'youtube',
    accessToken: 'access',
    refreshToken: 'refresh',
    tokenExpiry: '2099-01-01T00:00:00.000Z',
    hasRefreshToken: true,
    hasYoutubeMainStreamKey: true,
    hasYoutubeTempStreamKey: true,
    platformUserId: 'channel-1',
    platformName: 'Channel',
    youtubeMainStreamKey: 'main-ingest-key',
    youtubeTempStreamKey: 'temp-ingest-key',
    $createdAt: '2026-01-01T00:00:00.000Z',
    $updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('computeTempToMainPromotionAt', () => {
  it('returns start minus default 30-minute lead for temp scheduled rows', () => {
    const livestream = makeLivestream({ id: 'temp-1' });
    expect(computeTempToMainPromotionAt(livestream)?.toISOString()).toBe(
      '2026-07-01T17:30:00.000Z'
    );
  });

  it('returns start minus configured lead time', () => {
    const livestream = makeLivestream({
      id: 'temp-custom',
      autoPromoteToMainKeyMinutes: 5,
      scheduledStartTime: '2026-07-01T18:10:00.000Z',
    });
    expect(computeTempToMainPromotionAt(livestream)?.toISOString()).toBe(
      '2026-07-01T18:05:00.000Z'
    );
  });

  it('returns null when auto-promote is disabled', () => {
    const livestream = makeLivestream({ id: 'temp-off', autoPromoteToMainKey: false });
    expect(computeTempToMainPromotionAt(livestream)).toBeNull();
  });

  it('returns null when already promoted', () => {
    const livestream = makeLivestream({
      id: 'temp-done',
      keySwapPromotedAt: '2026-07-01T17:00:00.000Z',
    });
    expect(computeTempToMainPromotionAt(livestream)).toBeNull();
  });
});

describe('attemptPromoteTempLivestreamToMain', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getConnectedAccountWithTokens).mockResolvedValue(makeAccount());
    vi.mocked(refreshTokenIfNeeded).mockResolvedValue({
      accessToken: 'yt-access-token',
      refreshToken: 'refresh',
      tokenExpiry: '2099-01-01T00:00:00.000Z',
    });
    vi.mocked(ensureYouTubeBroadcastBoundToStreamKey).mockResolvedValue({
      ok: true,
      streamId: 'main-stream-id',
      rebound: true,
    });
    vi.mocked(updateLivestream).mockImplementation(async (id, patch) =>
      makeLivestream({ id, ...patch })
    );
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('promotes only the earliest temp candidate when main slot is free', async () => {
    const tempEarliest = makeLivestream({
      id: 'temp-earliest',
      scheduledStartTime: '2026-07-01T18:00:00.000Z',
    });
    const tempMiddle = makeLivestream({
      id: 'temp-middle',
      scheduledStartTime: '2026-07-01T19:00:00.000Z',
    });

    vi.mocked(getLivestreamById).mockResolvedValue(tempEarliest);
    vi.mocked(getArmedMainSlotLivestreamForUser).mockResolvedValue(null);
    vi.mocked(listArmedTempSlotLivestreamsForUser).mockResolvedValue([tempEarliest, tempMiddle]);
    vi.mocked(getYouTubeBroadcastLifecycleStatus).mockResolvedValue({
      ok: true,
      lifeCycleStatus: 'ready',
    });

    const result = await attemptPromoteTempLivestreamToMain('temp-earliest', { now: NOW });

    expect(result.ok).toBe(true);
    if (result.ok !== true) return;

    expect(ensureYouTubeBroadcastBoundToStreamKey).toHaveBeenCalledWith(
      'yt-access-token',
      'broadcast-temp-earliest',
      'main-ingest-key',
      { preferredStreamId: 'bound-stream-temp' }
    );
    expect(updateLivestream).toHaveBeenCalledWith('temp-earliest', {
      keySlot: 'main',
      keySwapPromotedAt: NOW.toISOString(),
      youtubeBoundStreamId: 'main-stream-id',
    });
  });

  it('does not promote when not yet due', async () => {
    const temp = makeLivestream({
      id: 'temp-future',
      autoPromoteToMainKeyMinutes: 15,
      scheduledStartTime: new Date(NOW.getTime() + 20 * 60_000).toISOString(),
    });

    vi.mocked(getLivestreamById).mockResolvedValue(temp);

    const result = await attemptPromoteTempLivestreamToMain('temp-future', { now: NOW });

    expect(result).toEqual({
      ok: false,
      reason: 'not_eligible',
      details: 'Promotion is not due yet.',
    });
  });

  it('does not promote when main slot is still occupied', async () => {
    const main = makeLivestream({
      id: 'main-active',
      keySlot: 'main',
      status: 'live',
      youtubeLifecycleStatus: 'live',
    });
    const temp = makeLivestream({ id: 'temp-waiting' });

    vi.mocked(getLivestreamById).mockResolvedValue(temp);
    vi.mocked(getArmedMainSlotLivestreamForUser).mockResolvedValue(main);
    vi.mocked(listArmedTempSlotLivestreamsForUser).mockResolvedValue([temp]);
    vi.mocked(getYouTubeBroadcastLifecycleStatus).mockResolvedValue({
      ok: true,
      lifeCycleStatus: 'live',
    });

    const result = await attemptPromoteTempLivestreamToMain('temp-waiting', { now: NOW });

    expect(result).toEqual({
      ok: false,
      reason: 'blocked',
      details: 'The main stream key slot is still in use.',
    });
  });

  it('releases a stale main slot and promotes', async () => {
    const staleMain = makeLivestream({
      id: 'main-stale',
      keySlot: 'main',
      scheduledStartTime: '2026-07-01T17:00:00.000Z',
    });
    const temp = makeLivestream({ id: 'temp-next' });

    vi.mocked(getLivestreamById).mockResolvedValue(temp);
    vi.mocked(getArmedMainSlotLivestreamForUser).mockResolvedValue(staleMain);
    vi.mocked(listArmedTempSlotLivestreamsForUser).mockResolvedValue([temp]);
    vi.mocked(getYouTubeBroadcastLifecycleStatus).mockResolvedValue({
      ok: true,
      lifeCycleStatus: 'ready',
    });
    vi.mocked(releaseStaleMainSlot).mockResolvedValueOnce({
      ok: true,
      livestream: {
        ...staleMain,
        status: 'ended',
        keySlot: 'temp',
        keySlotStaleAt: NOW.toISOString(),
      },
    });

    const result = await attemptPromoteTempLivestreamToMain('temp-next', { now: NOW });

    expect(result.ok).toBe(true);
    expect(releaseStaleMainSlot).toHaveBeenCalledTimes(1);
  });

  it('does not promote when another temp stream is queue head', async () => {
    const tempEarlier = makeLivestream({
      id: 'temp-earlier',
      scheduledStartTime: '2026-07-01T18:00:00.000Z',
    });
    const tempLater = makeLivestream({
      id: 'temp-later',
      scheduledStartTime: '2026-07-01T19:00:00.000Z',
    });
    const queueCheckTime = new Date('2026-07-01T18:35:00.000Z');

    vi.mocked(getLivestreamById).mockResolvedValue(tempLater);
    vi.mocked(listArmedTempSlotLivestreamsForUser).mockResolvedValue([tempEarlier, tempLater]);

    const result = await attemptPromoteTempLivestreamToMain('temp-later', { now: queueCheckTime });

    expect(result).toEqual({
      ok: false,
      reason: 'not_queue_head',
      details: 'Another temp-slot livestream is ahead in the promotion queue.',
    });
  });
});
