import { describe, expect, it } from 'vitest';

import { buildLivestreamPatchFromYouTubeMetadata } from '@/lib/livestreams/pull-youtube-livestream-patch';
import type { Livestream } from '@/types';

function makeLivestream(overrides: Partial<Livestream> = {}): Livestream {
  return {
    id: 'ls-1',
    userId: 'user-1',
    status: 'scheduled',
    title: 'Old title',
    description: 'Old description',
    tags: ['old'],
    visibility: 'public',
    targets: ['youtube'],
    platforms: { youtube: { categoryId: '24' } },
    scheduledStartTime: '2026-07-01T18:00:00.000Z',
    youtubeBroadcastId: 'broadcast-1',
    youtubeLifecycleStatus: 'ready',
    $createdAt: '2026-01-01T00:00:00.000Z',
    $updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildLivestreamPatchFromYouTubeMetadata', () => {
  it('returns a patch when YouTube metadata differs from the local row', () => {
    const patch = buildLivestreamPatchFromYouTubeMetadata(makeLivestream(), {
      title: 'New title',
      description: 'New description',
      tags: ['new'],
      privacyStatus: 'unlisted',
      scheduledStartTime: '2026-07-02T19:00:00.000Z',
      lifeCycleStatus: 'live',
      categoryId: '22',
      madeForKids: true,
    });

    expect(patch).toEqual({
      title: 'New title',
      description: 'New description',
      tags: ['new'],
      visibility: 'unlisted',
      scheduledStartTime: '2026-07-02T19:00:00.000Z',
      youtubeLifecycleStatus: 'live',
      status: 'live',
      platformsPatch: {
        youtube: {
          categoryId: '22',
          madeForKids: true,
        },
      },
    });
  });

  it('does not overwrite local playlist fields from YouTube pull metadata', () => {
    const patch = buildLivestreamPatchFromYouTubeMetadata(
      makeLivestream({
        platforms: {
          youtube: {
            categoryId: '24',
            playlistIds: ['PLlocal'],
            playlistTitles: ['Sunday Services'],
          },
        },
      }),
      {
        title: 'Old title',
        description: 'Old description',
        tags: ['old'],
        privacyStatus: 'public',
        scheduledStartTime: '2026-07-01T18:00:00.000Z',
        lifeCycleStatus: 'ready',
        categoryId: '24',
      }
    );

    expect(patch).toBeNull();
  });

  it('returns null when the local row already matches YouTube', () => {
    const livestream = makeLivestream({
      title: 'Same title',
      description: 'Same description',
      tags: ['a'],
      visibility: 'private',
      scheduledStartTime: '2026-07-01T18:00:00.000Z',
      platforms: { youtube: { categoryId: '22', madeForKids: false } },
      youtubeLifecycleStatus: 'ready',
    });

    expect(
      buildLivestreamPatchFromYouTubeMetadata(livestream, {
        title: 'Same title',
        description: 'Same description',
        tags: ['a'],
        privacyStatus: 'private',
        scheduledStartTime: '2026-07-01T18:00:00.000Z',
        lifeCycleStatus: 'ready',
        categoryId: '22',
        madeForKids: false,
        thumbnailUrl: 'https://i.ytimg.com/vi/abc/hqdefault.jpg',
      })
    ).toBeNull();
  });
});
