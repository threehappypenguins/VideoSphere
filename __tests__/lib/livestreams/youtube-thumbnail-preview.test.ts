import { describe, expect, it } from 'vitest';

import { livestreamWithThumbnailPreview } from '@/lib/livestreams/livestream-thumbnail-preview';
import {
  livestreamYouTubeThumbnailCacheKey,
  youtubeThumbnailPreviewUrl,
} from '@/lib/livestreams/youtube-thumbnail-preview';
import { stripServerManagedLivestreamPlatformsPatch } from '@/lib/livestream-upload-metadata';
import type { Livestream } from '@/types';

describe('youtubeThumbnailPreviewUrl', () => {
  it('appends a cache-bust query parameter', () => {
    expect(
      youtubeThumbnailPreviewUrl(
        'https://i.ytimg.com/vi/abc/hqdefault.jpg',
        '2026-01-02T00:00:00.000Z'
      )
    ).toBe('https://i.ytimg.com/vi/abc/hqdefault.jpg?vs=2026-01-02T00%3A00%3A00.000Z');
  });
});

describe('stripServerManagedLivestreamPlatformsPatch', () => {
  it('removes server-managed YouTube thumbnail fields from client PATCH payloads', () => {
    expect(
      stripServerManagedLivestreamPlatformsPatch({
        youtube: {
          categoryId: '22',
          thumbnailUrl: 'https://i.ytimg.com/stale.jpg',
          thumbnailUpdatedAt: '2026-01-01T00:00:00.000Z',
        },
      })
    ).toEqual({
      youtube: {
        categoryId: '22',
      },
    });
  });
});

describe('livestreamWithThumbnailPreview', () => {
  it('cache-busts stored YouTube thumbnail URLs for preview', async () => {
    const livestream: Livestream = {
      id: 'ls-1',
      userId: 'user-1',
      status: 'scheduled',
      title: 'Stream',
      description: '',
      tags: [],
      visibility: 'public',
      targets: ['youtube'],
      platforms: {
        youtube: {
          thumbnailUrl: 'https://i.ytimg.com/vi/abc/hqdefault.jpg',
          thumbnailUpdatedAt: '2026-01-02T12:00:00.000Z',
        },
      },
      $createdAt: '2026-01-01T00:00:00.000Z',
      $updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const preview = await livestreamWithThumbnailPreview(livestream, 'user-1', 'ls-1');

    expect(preview.thumbnailPreviewUrl).toBe(
      youtubeThumbnailPreviewUrl(
        livestream.platforms.youtube!.thumbnailUrl!,
        livestreamYouTubeThumbnailCacheKey(livestream)
      )
    );
  });
});
