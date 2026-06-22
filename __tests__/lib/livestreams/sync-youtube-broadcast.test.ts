import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { syncLivestreamMetadataToYouTube } from '@/lib/livestreams/sync-youtube-broadcast';
import type { Livestream } from '@/types';

vi.mock('@/lib/livestreams/resolve-youtube-livestream-sync-fields', () => ({
  resolveYouTubeCategoryIdForLivestreamSync: vi.fn(() => '22'),
}));

vi.mock('@/lib/repositories/users', () => ({
  getUserById: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/r2', () => ({
  getObjectWebStream: vi.fn(),
  isLivestreamThumbnailFinalKeyForUser: vi.fn(),
}));

vi.mock('@/lib/livestreams/cleanup-livestream-thumbnail-after-youtube-sync', () => ({
  cleanupLivestreamThumbnailAfterYouTubeSync: vi.fn(),
}));

vi.mock('@/lib/platforms/youtube-livestream-api', () => ({
  updateYouTubeLiveBroadcast: vi.fn(),
  setYouTubeBroadcastVideoStatus: vi.fn(),
  setYouTubeBroadcastSnippetMetadata: vi.fn(),
  uploadYouTubeLivestreamThumbnail: vi.fn(),
}));

vi.mock('@/lib/platforms/youtube', () => ({
  addYouTubeVideoToPlaylists: vi.fn(),
}));

import { cleanupLivestreamThumbnailAfterYouTubeSync } from '@/lib/livestreams/cleanup-livestream-thumbnail-after-youtube-sync';
import { getObjectWebStream, isLivestreamThumbnailFinalKeyForUser } from '@/lib/r2';
import {
  setYouTubeBroadcastSnippetMetadata,
  setYouTubeBroadcastVideoStatus,
  updateYouTubeLiveBroadcast,
  uploadYouTubeLivestreamThumbnail,
} from '@/lib/platforms/youtube-livestream-api';
import { addYouTubeVideoToPlaylists } from '@/lib/platforms/youtube';

const USER_ID = 'user-1';
const LIVESTREAM_ID = 'ls-1';
const THUMB_KEY = 'livestreams/thumbnails/user-1/ls-1/thumb.jpg';

function makeLivestream(overrides: Partial<Livestream> = {}): Livestream {
  return {
    id: LIVESTREAM_ID,
    userId: USER_ID,
    status: 'scheduled',
    title: 'Sunday Service',
    description: 'Live worship',
    tags: [],
    visibility: 'public',
    targets: ['youtube'],
    platforms: {},
    youtubeBroadcastId: 'broadcast-1',
    thumbnailR2Key: THUMB_KEY,
    thumbnailContentType: 'image/jpeg',
    $createdAt: '2026-01-01T00:00:00.000Z',
    $updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('syncLivestreamMetadataToYouTube thumbnail cleanup', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(updateYouTubeLiveBroadcast).mockResolvedValue({ ok: true });
    vi.mocked(setYouTubeBroadcastVideoStatus).mockResolvedValue({ ok: true });
    vi.mocked(setYouTubeBroadcastSnippetMetadata).mockResolvedValue({ ok: true, droppedTags: [] });
    vi.mocked(isLivestreamThumbnailFinalKeyForUser).mockReturnValue(true);
    vi.mocked(getObjectWebStream).mockResolvedValue({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.close();
        },
      }),
      contentLength: 3,
      contentType: 'image/jpeg',
    });
    vi.mocked(uploadYouTubeLivestreamThumbnail).mockResolvedValue({
      ok: true,
      thumbnailUrl: 'https://i.ytimg.com/vi/abc/default.jpg',
    });
    vi.mocked(cleanupLivestreamThumbnailAfterYouTubeSync).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('uploads the R2 thumbnail to YouTube and cleans up local storage', async () => {
    const result = await syncLivestreamMetadataToYouTube(
      'yt-token',
      USER_ID,
      LIVESTREAM_ID,
      makeLivestream()
    );

    expect(result).toEqual({ ok: true, droppedTags: [] });
    expect(uploadYouTubeLivestreamThumbnail).toHaveBeenCalled();
    expect(cleanupLivestreamThumbnailAfterYouTubeSync).toHaveBeenCalledWith(
      USER_ID,
      LIVESTREAM_ID,
      THUMB_KEY,
      'https://i.ytimg.com/vi/abc/default.jpg',
      expect.any(String)
    );
  });

  it('returns an error when cleanup after upload fails', async () => {
    vi.mocked(cleanupLivestreamThumbnailAfterYouTubeSync).mockResolvedValue(
      'Failed to persist YouTube thumbnail URL after upload.'
    );

    const result = await syncLivestreamMetadataToYouTube(
      'yt-token',
      USER_ID,
      LIVESTREAM_ID,
      makeLivestream()
    );

    expect(result).toEqual({
      ok: false,
      details: 'Failed to persist YouTube thumbnail URL after upload.',
    });
  });
});

describe('syncLivestreamMetadataToYouTube playlist sync', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(updateYouTubeLiveBroadcast).mockResolvedValue({ ok: true });
    vi.mocked(setYouTubeBroadcastVideoStatus).mockResolvedValue({ ok: true });
    vi.mocked(setYouTubeBroadcastSnippetMetadata).mockResolvedValue({ ok: true, droppedTags: [] });
    vi.mocked(addYouTubeVideoToPlaylists).mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('adds the broadcast to playlists only while the livestream is still a draft', async () => {
    await syncLivestreamMetadataToYouTube(
      'yt-token',
      USER_ID,
      LIVESTREAM_ID,
      makeLivestream({
        status: 'draft',
        youtubeBroadcastId: 'broadcast-1',
        thumbnailR2Key: undefined,
        platforms: {
          youtube: {
            playlistIds: ['PL123'],
            playlistTitles: ['Sunday Services'],
          },
        },
      })
    );

    expect(addYouTubeVideoToPlaylists).toHaveBeenCalledWith('yt-token', 'broadcast-1', {
      playlistIds: ['PL123'],
      playlistTitles: ['Sunday Services'],
      visibility: 'public',
    });
  });

  it('does not push playlist changes after scheduling', async () => {
    await syncLivestreamMetadataToYouTube(
      'yt-token',
      USER_ID,
      LIVESTREAM_ID,
      makeLivestream({
        status: 'scheduled',
        thumbnailR2Key: undefined,
        platforms: {
          youtube: {
            playlistIds: ['PL123'],
            playlistTitles: ['Sunday Services'],
          },
        },
      })
    );

    expect(addYouTubeVideoToPlaylists).not.toHaveBeenCalled();
  });
});
