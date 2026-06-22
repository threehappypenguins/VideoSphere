import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/platforms/youtube-livestream-api', () => ({
  findYouTubeLiveStreamIdByKey: vi.fn(),
  bindYouTubeBroadcastToStream: vi.fn(),
}));

vi.mock('@/lib/repositories/livestreams', () => ({
  updateLivestream: vi.fn(),
}));

import { changeLivestreamKeySlot } from '@/lib/livestreams/change-livestream-key-slot';
import {
  bindYouTubeBroadcastToStream,
  findYouTubeLiveStreamIdByKey,
} from '@/lib/platforms/youtube-livestream-api';
import { updateLivestream } from '@/lib/repositories/livestreams';
import type { ConnectedAccount, Livestream } from '@/types';

const USER_ID = 'user-1';

function scheduledLivestream(overrides: Partial<Livestream> = {}): Livestream {
  return {
    id: 'stream-1',
    userId: USER_ID,
    status: 'scheduled',
    title: 'Service',
    description: '',
    tags: [],
    visibility: 'public',
    targets: ['youtube'],
    platforms: {},
    youtubeBroadcastId: 'broadcast-1',
    keySlot: 'main',
    $createdAt: '2026-01-01T00:00:00.000Z',
    $updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function connectedAccount(): ConnectedAccount {
  return {
    id: 'conn-1',
    userId: USER_ID,
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

describe('changeLivestreamKeySlot', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('rejects non-scheduled livestreams', async () => {
    const result = await changeLivestreamKeySlot(
      'token',
      connectedAccount(),
      scheduledLivestream({ status: 'draft' }),
      [],
      'temp'
    );

    expect(result).toEqual({
      ok: false,
      details: 'Only scheduled livestreams can change stream keys.',
      statusCode: 409,
    });
  });

  it('rejects livestreams without a YouTube broadcast id', async () => {
    const result = await changeLivestreamKeySlot(
      'token',
      connectedAccount(),
      scheduledLivestream({ youtubeBroadcastId: undefined }),
      [],
      'temp'
    );

    expect(result).toEqual({
      ok: false,
      details: 'Livestream is not linked to a YouTube broadcast.',
      statusCode: 409,
    });
  });

  it('rejects missing configured stream keys with 400', async () => {
    const account = connectedAccount();
    account.youtubeTempStreamKey = '';

    const result = await changeLivestreamKeySlot(
      'token',
      account,
      scheduledLivestream({ keySlot: 'main' }),
      [],
      'temp'
    );

    expect(result).toEqual({
      ok: false,
      statusCode: 400,
      details: expect.stringContaining('temporary stream key'),
    });
  });

  it('rebinds YouTube and updates the row when switching slots', async () => {
    const livestream = scheduledLivestream({ keySlot: 'main' });
    const armed = [scheduledLivestream({ id: 'other', keySlot: 'main', title: 'Other stream' })];

    vi.mocked(findYouTubeLiveStreamIdByKey).mockResolvedValueOnce({
      ok: true,
      streamId: 'yt-stream-temp',
    });
    vi.mocked(bindYouTubeBroadcastToStream).mockResolvedValueOnce({ ok: true });
    vi.mocked(updateLivestream).mockResolvedValueOnce({
      ...livestream,
      keySlot: 'temp',
      youtubeBoundStreamId: 'yt-stream-temp',
      keySwapPromotedAt: null,
    });

    const result = await changeLivestreamKeySlot(
      'token',
      connectedAccount(),
      livestream,
      armed,
      'temp'
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(findYouTubeLiveStreamIdByKey).toHaveBeenCalledWith('token', 'temp-key');
    expect(bindYouTubeBroadcastToStream).toHaveBeenCalledWith(
      'token',
      'broadcast-1',
      'yt-stream-temp'
    );
    expect(updateLivestream).toHaveBeenCalledWith('stream-1', {
      keySlot: 'temp',
      youtubeBoundStreamId: 'yt-stream-temp',
      keySwapPromotedAt: null,
    });
    expect(result.livestream.keySlot).toBe('temp');
    expect(result.conflict).toBeNull();
  });

  it('returns conflict metadata without blocking the slot change', async () => {
    const livestream = scheduledLivestream({ keySlot: 'temp' });
    const armed = [scheduledLivestream({ id: 'other', keySlot: 'main', title: 'Main slot taken' })];

    vi.mocked(findYouTubeLiveStreamIdByKey).mockResolvedValueOnce({
      ok: true,
      streamId: 'yt-stream-main',
    });
    vi.mocked(bindYouTubeBroadcastToStream).mockResolvedValueOnce({ ok: true });
    vi.mocked(updateLivestream).mockResolvedValueOnce({
      ...livestream,
      keySlot: 'main',
      youtubeBoundStreamId: 'yt-stream-main',
    });

    const result = await changeLivestreamKeySlot(
      'token',
      connectedAccount(),
      livestream,
      armed,
      'main'
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.conflict).toEqual({
      id: 'other',
      title: 'Main slot taken',
      keySlot: 'main',
    });
  });
});
