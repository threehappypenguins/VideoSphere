import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/platforms/youtube-livestream-api', () => ({
  findYouTubeLiveStreamIdByKey: vi.fn(),
  bindYouTubeBroadcastToStream: vi.fn(),
}));

vi.mock('@/lib/repositories/livestreams', () => ({
  updateLivestream: vi.fn(),
}));

import { releaseStaleMainSlot } from '@/lib/livestreams/stale-main-slot';
import {
  bindYouTubeBroadcastToStream,
  findYouTubeLiveStreamIdByKey,
} from '@/lib/platforms/youtube-livestream-api';
import { updateLivestream } from '@/lib/repositories/livestreams';
import type { ConnectedAccount, Livestream } from '@/types';

const NOW = new Date('2026-07-01T17:45:00.000Z');

function staleMainLivestream(): Livestream {
  return {
    id: 'main-stale',
    userId: 'user-1',
    status: 'scheduled',
    title: 'Missed Service',
    description: '',
    tags: [],
    visibility: 'public',
    targets: ['youtube'],
    platforms: {},
    keySlot: 'main',
    scheduledStartTime: '2026-07-01T17:00:00.000Z',
    youtubeBroadcastId: 'broadcast-stale',
    youtubeBoundStreamId: 'bound-main',
    youtubeLifecycleStatus: 'ready',
    $createdAt: '2026-01-01T00:00:00.000Z',
    $updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function connectedAccount(): ConnectedAccount {
  return {
    id: 'conn-1',
    userId: 'user-1',
    platform: 'youtube',
    platformUserId: 'yt-1',
    platformName: 'Channel',
    tokenExpiry: new Date(Date.now() + 3600_000).toISOString(),
    hasRefreshToken: true,
    hasYoutubeMainStreamKey: true,
    hasYoutubeTempStreamKey: true,
    accessToken: 'access',
    refreshToken: 'refresh',
    youtubeMainStreamKey: 'main-key',
    youtubeTempStreamKey: 'temp-key',
    $createdAt: '2026-01-01T00:00:00.000Z',
    $updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('releaseStaleMainSlot', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('rebinds to temp, ends the row, and records keySlotStaleAt', async () => {
    const livestream = staleMainLivestream();

    vi.mocked(findYouTubeLiveStreamIdByKey).mockResolvedValueOnce({
      ok: true,
      streamId: 'yt-stream-temp',
    });
    vi.mocked(bindYouTubeBroadcastToStream).mockResolvedValueOnce({ ok: true });
    vi.mocked(updateLivestream).mockResolvedValueOnce({
      ...livestream,
      status: 'ended',
      keySlot: 'temp',
      keySlotStaleAt: NOW.toISOString(),
      youtubeBoundStreamId: 'yt-stream-temp',
    });

    const result = await releaseStaleMainSlot('token', connectedAccount(), livestream, NOW);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(bindYouTubeBroadcastToStream).toHaveBeenCalledWith(
      'token',
      'broadcast-stale',
      'yt-stream-temp'
    );
    expect(updateLivestream).toHaveBeenCalledWith('main-stale', {
      status: 'ended',
      keySlot: 'temp',
      keySlotStaleAt: NOW.toISOString(),
      youtubeBoundStreamId: 'yt-stream-temp',
      keySwapPromotedAt: null,
    });
    expect(result.livestream.keySlotStaleAt).toBe(NOW.toISOString());
  });

  it('rejects rows that are already live on YouTube', async () => {
    const result = await releaseStaleMainSlot(
      'token',
      connectedAccount(),
      {
        ...staleMainLivestream(),
        youtubeLifecycleStatus: 'live',
        status: 'live',
      },
      NOW
    );

    expect(result).toEqual({
      ok: false,
      details: 'Livestream is not eligible for stale main-slot release.',
    });
  });
});
