import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetAuthenticatedUserId = vi.fn();
const mockResolvePreviewDirectMediaUrl = vi.fn();
const mockProbeNearbyKeyframes = vi.fn();

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: (...args: unknown[]) => mockGetAuthenticatedUserId(...args),
}));

vi.mock('@/lib/youtube-import/preview-media-url', () => ({
  resolvePreviewDirectMediaUrl: (...args: unknown[]) => mockResolvePreviewDirectMediaUrl(...args),
}));

vi.mock('@/lib/youtube-import/probe-keyframes', () => ({
  probeNearbyKeyframes: (...args: unknown[]) => mockProbeNearbyKeyframes(...args),
}));

import { GET } from '@/app/api/youtube-import/keyframes/route';

const USER_ID = 'user-123';

function createRequest(query: Record<string, string>): NextRequest {
  const url = new URL('http://localhost:9624/api/youtube-import/keyframes');
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return new NextRequest(url, { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthenticatedUserId.mockResolvedValue(USER_ID);
  mockResolvePreviewDirectMediaUrl.mockResolvedValue({
    url: 'https://example.com/video.mp4',
    expiresAt: Date.now() + 60_000,
    durationSeconds: 212,
  });
  mockProbeNearbyKeyframes.mockResolvedValue([10, 12]);
});

describe('GET /api/youtube-import/keyframes', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetAuthenticatedUserId.mockResolvedValueOnce(null);

    const response = await GET(createRequest({ youtubeVideoId: 'dQw4w9WgXcQ', near: '12.5' }));

    expect(response.status).toBe(401);
    expect(mockResolvePreviewDirectMediaUrl).not.toHaveBeenCalled();
  });

  it('returns 400 for a malformed youtubeVideoId', async () => {
    const response = await GET(createRequest({ youtubeVideoId: 'not-valid', near: '5' }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toContain('youtubeVideoId');
    expect(mockResolvePreviewDirectMediaUrl).not.toHaveBeenCalled();
  });

  it('returns keyframe timestamps on the happy path', async () => {
    const response = await GET(createRequest({ youtubeVideoId: 'dQw4w9WgXcQ', near: '12.5' }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({ keyframeSeconds: [10, 12] });
    expect(mockResolvePreviewDirectMediaUrl).toHaveBeenCalledWith(USER_ID, 'dQw4w9WgXcQ');
    expect(mockProbeNearbyKeyframes).toHaveBeenCalledWith(
      'https://example.com/video.mp4',
      12.5,
      212
    );
  });

  it('returns 502 when upstream probing fails', async () => {
    mockResolvePreviewDirectMediaUrl.mockRejectedValueOnce(
      new Error('yt-dlp metadata lookup failed')
    );

    const response = await GET(createRequest({ youtubeVideoId: 'dQw4w9WgXcQ', near: '3' }));

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.message).toContain('yt-dlp metadata lookup failed');
  });
});
