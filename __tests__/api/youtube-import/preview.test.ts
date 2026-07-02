import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetAuthenticatedUserId = vi.fn();
const mockResolvePreviewDirectMediaUrl = vi.fn();
const mockFetchProxiedPreviewMedia = vi.fn();

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: (...args: unknown[]) => mockGetAuthenticatedUserId(...args),
}));

vi.mock('@/lib/youtube-import/preview-media-url', () => ({
  buildYoutubeImportPreviewStreamPath: (youtubeVideoId: string) =>
    `/api/youtube-import/preview/stream?youtubeVideoId=${youtubeVideoId}`,
  resolvePreviewDirectMediaUrl: (...args: unknown[]) => mockResolvePreviewDirectMediaUrl(...args),
}));

vi.mock('@/lib/youtube-import/proxy-preview-media', () => ({
  fetchProxiedPreviewMedia: (...args: unknown[]) => mockFetchProxiedPreviewMedia(...args),
}));

import { GET as getPreviewMetadata } from '@/app/api/youtube-import/preview/route';
import { GET as getPreviewStream } from '@/app/api/youtube-import/preview/stream/route';

const USER_ID = 'user-123';

function createMetadataRequest(query: Record<string, string>): NextRequest {
  const url = new URL('http://localhost:9624/api/youtube-import/preview');
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return new NextRequest(url, { method: 'GET' });
}

function createStreamRequest(
  query: Record<string, string>,
  headers?: Record<string, string>
): NextRequest {
  const url = new URL('http://localhost:9624/api/youtube-import/preview/stream');
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return new NextRequest(url, {
    method: 'GET',
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthenticatedUserId.mockResolvedValue(USER_ID);
  mockResolvePreviewDirectMediaUrl.mockResolvedValue({
    url: 'https://r1---sn.example.googlevideo.com/videoplayback',
    expiresAt: Date.now() + 60_000,
  });
  mockFetchProxiedPreviewMedia.mockResolvedValue(
    new Response('video-bytes', {
      status: 206,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Range': 'bytes 0-99/1000',
      },
    })
  );
});

describe('GET /api/youtube-import/preview', () => {
  it('returns preview stream metadata', async () => {
    const response = await getPreviewMetadata(
      createMetadataRequest({ youtubeVideoId: 'dQw4w9WgXcQ' })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.streamUrl).toBe(
      '/api/youtube-import/preview/stream?youtubeVideoId=dQw4w9WgXcQ'
    );
    expect(body.data.expiresAt).toEqual(expect.any(Number));
  });

  it('passes refresh=1 through to preview media resolution', async () => {
    await getPreviewMetadata(
      createMetadataRequest({ youtubeVideoId: 'dQw4w9WgXcQ', refresh: '1' })
    );

    expect(mockResolvePreviewDirectMediaUrl).toHaveBeenCalledWith(USER_ID, 'dQw4w9WgXcQ', {
      forceRefresh: true,
    });
  });
});

describe('GET /api/youtube-import/preview/stream', () => {
  it('proxies range requests to the upstream media URL', async () => {
    const response = await getPreviewStream(
      createStreamRequest({ youtubeVideoId: 'dQw4w9WgXcQ' }, { Range: 'bytes=0-99' })
    );

    expect(response.status).toBe(206);
    expect(mockResolvePreviewDirectMediaUrl).toHaveBeenCalledWith(USER_ID, 'dQw4w9WgXcQ', {
      forceRefresh: false,
    });
    expect(mockFetchProxiedPreviewMedia).toHaveBeenCalledWith(
      'https://r1---sn.example.googlevideo.com/videoplayback',
      'bytes=0-99'
    );
  });
});
