import { describe, expect, it } from 'vitest';
import {
  getSchedulableLivestreamPlatforms,
  getYouTubeLivestreamConnection,
  isYouTubeLivestreamSchedulable,
  toLivestreamConnectionSnapshots,
} from '@/lib/livestreams/schedulable-platforms';
import type { ConnectedAccountPublic } from '@/types';

function youtubeConnection(
  overrides: Partial<
    Pick<ConnectedAccountPublic, 'hasYoutubeMainStreamKey' | 'hasYoutubeTempStreamKey'>
  > = {}
): ConnectedAccountPublic {
  return {
    id: 'acc-yt',
    userId: 'user-1',
    platform: 'youtube',
    hasRefreshToken: true,
    tokenExpiry: '2026-12-31T00:00:00.000Z',
    hasYoutubeMainStreamKey: false,
    hasYoutubeTempStreamKey: false,
    platformUserId: 'channel-1',
    platformName: 'My Channel',
    $createdAt: '2026-01-01T00:00:00.000Z',
    $updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('schedulable livestream platforms', () => {
  it('returns no schedulable platforms when YouTube is not connected', () => {
    expect(getSchedulableLivestreamPlatforms([])).toEqual([]);
  });

  it('returns no schedulable platforms when YouTube is connected without stream keys', () => {
    const snapshots = toLivestreamConnectionSnapshots([youtubeConnection()]);
    expect(getSchedulableLivestreamPlatforms(snapshots)).toEqual([]);
    expect(isYouTubeLivestreamSchedulable(getYouTubeLivestreamConnection(snapshots))).toBe(false);
  });

  it('returns no schedulable platforms when only a temporary stream key is configured', () => {
    const snapshots = toLivestreamConnectionSnapshots([
      youtubeConnection({ hasYoutubeTempStreamKey: true }),
    ]);
    expect(getSchedulableLivestreamPlatforms(snapshots)).toEqual([]);
  });

  it('returns YouTube when a main stream key is configured', () => {
    const snapshots = toLivestreamConnectionSnapshots([
      youtubeConnection({ hasYoutubeMainStreamKey: true }),
    ]);
    expect(getSchedulableLivestreamPlatforms(snapshots)).toEqual(['youtube']);
    expect(isYouTubeLivestreamSchedulable(getYouTubeLivestreamConnection(snapshots))).toBe(true);
  });
});

describe('parseLivestreamTargetsAllowEmpty', () => {
  it('allows an empty targets array', async () => {
    const { parseLivestreamTargetsAllowEmpty } = await import('@/lib/livestream-upload-metadata');
    expect(parseLivestreamTargetsAllowEmpty([])).toEqual({ ok: true, value: [] });
  });

  it('dedupes valid livestream platform ids', async () => {
    const { parseLivestreamTargetsAllowEmpty } = await import('@/lib/livestream-upload-metadata');
    expect(parseLivestreamTargetsAllowEmpty(['youtube', 'youtube'])).toEqual({
      ok: true,
      value: ['youtube'],
    });
  });
});
