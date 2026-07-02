import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildYoutubeImportPreviewStreamPath,
  clearPreviewMediaCacheForTests,
  isAllowedPreviewUpstreamUrl,
  resolvePreviewDirectMediaUrl,
  setPreviewMediaCacheMaxEntriesForTests,
} from '@/lib/youtube-import/preview-media-url';

const mockGetDirectMediaUrl = vi.fn();

vi.mock('@/lib/youtube-import/probe-keyframes', () => ({
  getDirectMediaUrl: (...args: unknown[]) => mockGetDirectMediaUrl(...args),
}));

describe('isAllowedPreviewUpstreamUrl', () => {
  it('allows googlevideo.com hosts', () => {
    expect(
      isAllowedPreviewUpstreamUrl('https://r1---sn.example.googlevideo.com/videoplayback')
    ).toBe(true);
  });

  it('rejects non-YouTube hosts', () => {
    expect(isAllowedPreviewUpstreamUrl('https://evil.example.com/video.mp4')).toBe(false);
  });
});

describe('buildYoutubeImportPreviewStreamPath', () => {
  it('builds a same-origin preview stream path', () => {
    expect(buildYoutubeImportPreviewStreamPath('dQw4w9WgXcQ')).toBe(
      '/api/youtube-import/preview/stream?youtubeVideoId=dQw4w9WgXcQ'
    );
  });
});

describe('resolvePreviewDirectMediaUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPreviewMediaCacheForTests();
    setPreviewMediaCacheMaxEntriesForTests(null);
    mockGetDirectMediaUrl.mockResolvedValue({
      url: 'https://r1---sn.example.googlevideo.com/videoplayback',
      expiresAt: Date.now() + 3_600_000,
    });
  });

  it('resolves and caches direct media URLs', async () => {
    const first = await resolvePreviewDirectMediaUrl('user-1', 'dQw4w9WgXcQ');
    const second = await resolvePreviewDirectMediaUrl('user-1', 'dQw4w9WgXcQ');

    expect(first.url).toContain('googlevideo.com');
    expect(second.url).toBe(first.url);
    expect(mockGetDirectMediaUrl).toHaveBeenCalledTimes(1);
  });

  it('bypasses the cache when forceRefresh is true', async () => {
    await resolvePreviewDirectMediaUrl('user-1', 'dQw4w9WgXcQ');
    await resolvePreviewDirectMediaUrl('user-1', 'dQw4w9WgXcQ', { forceRefresh: true });

    expect(mockGetDirectMediaUrl).toHaveBeenCalledTimes(2);
  });

  it('evicts the oldest entry when the cache exceeds its size cap', async () => {
    setPreviewMediaCacheMaxEntriesForTests(2);

    await resolvePreviewDirectMediaUrl('user-1', 'aaaaaaaaaaa');
    await resolvePreviewDirectMediaUrl('user-1', 'bbbbbbbbbbb');
    await resolvePreviewDirectMediaUrl('user-1', 'ccccccccccc');
    await resolvePreviewDirectMediaUrl('user-1', 'aaaaaaaaaaa');

    expect(mockGetDirectMediaUrl).toHaveBeenCalledTimes(4);
  });
});
