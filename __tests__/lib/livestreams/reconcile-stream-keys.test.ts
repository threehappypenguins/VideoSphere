import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  reconcileLivestreamKeysAndStatus,
  resolveLivestreamReconcileIntervalMs,
} from '@/lib/livestreams/reconcile-stream-keys';
import type { ConnectedAccount, Livestream } from '@/types';

vi.mock('@/lib/repositories/livestreams', () => ({
  listAllArmedYouTubeLivestreams: vi.fn(),
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

import { listAllArmedYouTubeLivestreams, updateLivestream } from '@/lib/repositories/livestreams';
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

describe('resolveLivestreamReconcileIntervalMs', () => {
  const original = process.env.LIVESTREAM_RECONCILE_INTERVAL_MS;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.LIVESTREAM_RECONCILE_INTERVAL_MS;
    } else {
      process.env.LIVESTREAM_RECONCILE_INTERVAL_MS = original;
    }
  });

  it('defaults to 5 minutes when env is unset', () => {
    delete process.env.LIVESTREAM_RECONCILE_INTERVAL_MS;
    expect(resolveLivestreamReconcileIntervalMs()).toBe(5 * 60 * 1000);
  });

  it('falls back when env is invalid', () => {
    process.env.LIVESTREAM_RECONCILE_INTERVAL_MS = 'not-a-number';
    expect(resolveLivestreamReconcileIntervalMs()).toBe(5 * 60 * 1000);
  });

  it('reads a valid env override', () => {
    process.env.LIVESTREAM_RECONCILE_INTERVAL_MS = '120000';
    expect(resolveLivestreamReconcileIntervalMs()).toBe(120_000);
  });
});

describe('reconcileLivestreamKeysAndStatus', () => {
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
      streamId: 'bound-stream-temp',
      rebound: false,
    });
    vi.mocked(updateLivestream).mockImplementation(async (id, patch) =>
      makeLivestream({ id, ...patch })
    );
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('updates local status to live when YouTube reports testing or live', async () => {
    const scheduled = makeLivestream({
      id: 'live-1',
      keySlot: 'main',
      status: 'scheduled',
      youtubeBroadcastId: 'broadcast-live',
    });

    vi.mocked(listAllArmedYouTubeLivestreams).mockResolvedValue(new Map([[USER_ID, [scheduled]]]));
    vi.mocked(getYouTubeBroadcastLifecycleStatus).mockResolvedValue({
      ok: true,
      lifeCycleStatus: 'live',
    });

    const result = await reconcileLivestreamKeysAndStatus({ now: NOW });

    expect(result.lifecycleUpdates).toBe(1);
    expect(result.promotions).toBe(0);
    expect(updateLivestream).toHaveBeenCalledWith('live-1', {
      youtubeLifecycleStatus: 'live',
      status: 'live',
    });
  });

  it('does not promote temp livestreams (promotion uses scheduled timers)', async () => {
    const temp = makeLivestream({
      id: 'temp-waiting',
      scheduledStartTime: '2026-07-01T18:00:00.000Z',
    });

    vi.mocked(listAllArmedYouTubeLivestreams).mockResolvedValue(new Map([[USER_ID, [temp]]]));
    vi.mocked(getYouTubeBroadcastLifecycleStatus).mockResolvedValue({
      ok: true,
      lifeCycleStatus: 'ready',
    });

    const result = await reconcileLivestreamKeysAndStatus({ now: NOW });

    expect(result.promotions).toBe(0);
    expect(ensureYouTubeBroadcastBoundToStreamKey).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'main-ingest-key',
      expect.anything()
    );
  });

  it('continues other livestreams when one lifecycle poll fails', async () => {
    const failing = makeLivestream({
      id: 'fail-1',
      keySlot: 'main',
      youtubeBroadcastId: 'broadcast-fail',
    });
    const succeeding = makeLivestream({
      id: 'ok-1',
      keySlot: 'temp',
      youtubeBroadcastId: 'broadcast-ok',
    });

    vi.mocked(listAllArmedYouTubeLivestreams).mockResolvedValue(
      new Map([[USER_ID, [failing, succeeding]]])
    );
    vi.mocked(getYouTubeBroadcastLifecycleStatus).mockImplementation(
      async (_token, broadcastId) => {
        if (broadcastId === 'broadcast-fail') {
          return { ok: false, details: 'gone' };
        }
        return { ok: true, lifeCycleStatus: 'ready' };
      }
    );

    const result = await reconcileLivestreamKeysAndStatus({ now: NOW });

    expect(result.lifecycleUpdates).toBe(0);
    expect(getYouTubeBroadcastLifecycleStatus).toHaveBeenCalledTimes(2);
    expect(result.promotions).toBe(0);
  });
});
