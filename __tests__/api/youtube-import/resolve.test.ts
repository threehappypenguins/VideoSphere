import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mockGetAuthenticatedUserId = vi.fn();
const mockRequireYouTubeConnection = vi.fn();
const mockGetLivestreamById = vi.fn();
const mockFetchYouTubeVideoForImport = vi.fn();
const mockMapYouTubeImportResolvedSource = vi.fn();
const mockResolvePreviewDirectMediaUrl = vi.fn();

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: (...args: unknown[]) => mockGetAuthenticatedUserId(...args),
}));

vi.mock('@/lib/platforms/youtube-api', () => ({
  requireYouTubeConnection: (...args: unknown[]) => mockRequireYouTubeConnection(...args),
  youtubeUpstreamErrorResponse: vi.fn((details: string) =>
    NextResponse.json({ error: 'Bad Gateway', message: details, statusCode: 502 }, { status: 502 })
  ),
}));

vi.mock('@/lib/repositories/livestreams', () => ({
  getLivestreamById: (...args: unknown[]) => mockGetLivestreamById(...args),
}));

vi.mock('@/lib/youtube-import/resolve-source', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/youtube-import/resolve-source')>();
  return {
    ...actual,
    fetchYouTubeVideoForImport: (...args: unknown[]) => mockFetchYouTubeVideoForImport(...args),
    mapYouTubeImportResolvedSource: (...args: unknown[]) =>
      mockMapYouTubeImportResolvedSource(...args),
  };
});

vi.mock('@/lib/youtube-import/preview-media-url', () => ({
  buildYoutubeImportPreviewStreamPath: (youtubeVideoId: string) =>
    `/api/youtube-import/preview/stream?youtubeVideoId=${youtubeVideoId}`,
  resolvePreviewDirectMediaUrl: (...args: unknown[]) => mockResolvePreviewDirectMediaUrl(...args),
}));

import { POST } from '@/app/api/youtube-import/resolve/route';

const USER_ID = 'user-123';
const ACCESS_TOKEN = 'yt-access-token';

function createRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:9624/api/youtube-import/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const resolvedMetadata = {
  youtubeVideoId: 'dQw4w9WgXcQ',
  title: 'Sunday Service',
  durationSeconds: 3600,
  thumbnailUrl: 'https://img.youtube.com/high.jpg',
};

const youtubeItem = {
  id: 'dQw4w9WgXcQ',
  snippet: { title: 'Sunday Service' },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthenticatedUserId.mockResolvedValue(USER_ID);
  mockRequireYouTubeConnection.mockResolvedValue({ ok: true, accessToken: ACCESS_TOKEN });
  mockFetchYouTubeVideoForImport.mockResolvedValue({ ok: true, item: youtubeItem });
  mockMapYouTubeImportResolvedSource.mockReturnValue({ ok: true, data: resolvedMetadata });
  mockResolvePreviewDirectMediaUrl.mockResolvedValue({
    url: 'https://r1---sn.example.googlevideo.com/videoplayback?id=abc',
    expiresAt: Date.now() + 3_600_000,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/youtube-import/resolve', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetAuthenticatedUserId.mockResolvedValueOnce(null);

    const response = await POST(createRequest({ sourceUrl: 'https://youtu.be/dQw4w9WgXcQ' }));

    expect(response.status).toBe(401);
    expect(mockRequireYouTubeConnection).not.toHaveBeenCalled();
  });

  it('propagates requireYouTubeConnection failures', async () => {
    mockRequireYouTubeConnection.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json(
        { error: 'Unauthorized', message: 'YouTube is not connected', statusCode: 401 },
        { status: 401 }
      ),
    });

    const response = await POST(createRequest({ sourceUrl: 'https://youtu.be/dQw4w9WgXcQ' }));

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.message).toContain('YouTube is not connected');
  });

  it('returns 400 when neither source selector is provided', async () => {
    const response = await POST(createRequest({}));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toContain('exactly one');
  });

  it('returns 400 when both source selectors are provided', async () => {
    const response = await POST(
      createRequest({
        sourceUrl: 'https://youtu.be/dQw4w9WgXcQ',
        livestreamId: 'livestream-1',
      })
    );

    expect(response.status).toBe(400);
  });

  it('resolves a pasted sourceUrl through the YouTube API', async () => {
    const response = await POST(
      createRequest({ sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({
      ...resolvedMetadata,
      previewStreamUrl: '/api/youtube-import/preview/stream?youtubeVideoId=dQw4w9WgXcQ',
      previewExpiresAt: expect.any(Number),
    });
    expect(mockResolvePreviewDirectMediaUrl).toHaveBeenCalledWith(USER_ID, 'dQw4w9WgXcQ');
    expect(mockFetchYouTubeVideoForImport).toHaveBeenCalledWith(
      ACCESS_TOKEN,
      'dQw4w9WgXcQ',
      expect.any(AbortSignal)
    );
    expect(mockGetLivestreamById).not.toHaveBeenCalled();
  });

  it('returns 400 when sourceUrl does not parse', async () => {
    const response = await POST(createRequest({ sourceUrl: 'not-a-youtube-url' }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toContain('Could not parse');
    expect(mockFetchYouTubeVideoForImport).not.toHaveBeenCalled();
  });

  it('resolves a livestreamId using youtubeBroadcastId', async () => {
    mockGetLivestreamById.mockResolvedValueOnce({
      id: 'livestream-1',
      userId: USER_ID,
      youtubeBroadcastId: 'dQw4w9WgXcQ',
    });

    const response = await POST(createRequest({ livestreamId: 'livestream-1' }));

    expect(response.status).toBe(200);
    expect(mockFetchYouTubeVideoForImport).toHaveBeenCalledWith(
      ACCESS_TOKEN,
      'dQw4w9WgXcQ',
      expect.any(AbortSignal)
    );
  });

  it('returns 403 when the livestream belongs to another user', async () => {
    mockGetLivestreamById.mockResolvedValueOnce({
      id: 'livestream-1',
      userId: 'other-user',
      youtubeBroadcastId: 'dQw4w9WgXcQ',
    });

    const response = await POST(createRequest({ livestreamId: 'livestream-1' }));

    expect(response.status).toBe(403);
    expect(mockFetchYouTubeVideoForImport).not.toHaveBeenCalled();
  });

  it('returns 502 when the YouTube API fetch fails upstream', async () => {
    mockFetchYouTubeVideoForImport.mockResolvedValueOnce({
      ok: false,
      details: 'quotaExceeded',
    });

    const response = await POST(
      createRequest({ sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })
    );

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.message).toBe('quotaExceeded');
  });

  it('returns 400 when mapYouTubeImportResolvedSource rejects the video', async () => {
    mockMapYouTubeImportResolvedSource.mockReturnValueOnce({
      ok: false,
      message: 'Only completed YouTube live broadcasts can be imported.',
    });

    const response = await POST(
      createRequest({ sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toContain('completed YouTube live broadcasts');
  });
});
