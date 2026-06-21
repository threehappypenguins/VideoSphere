import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanupLivestreamThumbnailAfterYouTubeSync } from '@/lib/livestreams/cleanup-livestream-thumbnail-after-youtube-sync';

vi.mock('@/lib/r2', () => ({
  deleteObject: vi.fn(),
  isLivestreamThumbnailFinalKeyForUser: vi.fn(),
}));

vi.mock('@/lib/repositories/livestreams', () => ({
  updateLivestream: vi.fn(),
}));

import { deleteObject, isLivestreamThumbnailFinalKeyForUser } from '@/lib/r2';
import { updateLivestream } from '@/lib/repositories/livestreams';

const USER_ID = 'user-1';
const LIVESTREAM_ID = 'ls-1';
const THUMB_KEY = 'livestreams/thumbnails/user-1/ls-1/thumb.jpg';
const YOUTUBE_URL = 'https://i.ytimg.com/vi/abc/default.jpg';

describe('cleanupLivestreamThumbnailAfterYouTubeSync', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(isLivestreamThumbnailFinalKeyForUser).mockReturnValue(true);
    vi.mocked(deleteObject).mockResolvedValue(undefined);
    vi.mocked(updateLivestream).mockResolvedValue({
      id: LIVESTREAM_ID,
      userId: USER_ID,
      status: 'scheduled',
      title: 'Stream',
      description: '',
      tags: [],
      visibility: 'public',
      targets: ['youtube'],
      platforms: { youtube: { thumbnailUrl: YOUTUBE_URL } },
      $createdAt: '2026-01-01T00:00:00.000Z',
      $updatedAt: '2026-01-02T00:00:00.000Z',
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('clears R2 thumbnail fields, stores YouTube URL, then deletes the object', async () => {
    const error = await cleanupLivestreamThumbnailAfterYouTubeSync(
      USER_ID,
      LIVESTREAM_ID,
      THUMB_KEY,
      YOUTUBE_URL,
      '2026-01-02T00:00:00.000Z'
    );

    expect(error).toBeNull();
    expect(updateLivestream).toHaveBeenCalledWith(LIVESTREAM_ID, {
      thumbnailR2Key: null,
      thumbnailContentType: null,
      platformsPatch: {
        youtube: { thumbnailUrl: YOUTUBE_URL, thumbnailUpdatedAt: '2026-01-02T00:00:00.000Z' },
      },
    });
    expect(deleteObject).toHaveBeenCalledWith(THUMB_KEY);
  });

  it('does not delete R2 when the document update fails', async () => {
    vi.mocked(updateLivestream).mockResolvedValue(null);

    const error = await cleanupLivestreamThumbnailAfterYouTubeSync(
      USER_ID,
      LIVESTREAM_ID,
      THUMB_KEY,
      YOUTUBE_URL,
      '2026-01-02T00:00:00.000Z'
    );

    expect(error).toBe('Livestream not found after YouTube thumbnail upload.');
    expect(deleteObject).not.toHaveBeenCalled();
  });
});
