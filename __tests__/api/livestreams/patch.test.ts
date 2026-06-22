/**
 * Tests for PATCH /api/livestreams/[id]
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: vi.fn(),
}));

vi.mock('@/lib/repositories/livestreams', () => ({
  getLivestreamById: vi.fn(),
  updateLivestream: vi.fn(),
}));

vi.mock('@/lib/platforms/youtube-user-defaults-persist', () => ({
  persistUserYouTubePlatformDefaults: vi.fn(),
}));

vi.mock('@/lib/platforms/youtube-api', () => ({
  requireYouTubeConnection: vi.fn(),
  youtubeUpstreamErrorResponse: vi.fn(),
}));

vi.mock('@/lib/livestreams/sync-youtube-broadcast', () => ({
  syncLivestreamMetadataToYouTube: vi.fn(),
}));

vi.mock('@/lib/livestreams/livestream-thumbnail-preview', () => ({
  livestreamWithThumbnailPreview: vi.fn(async (livestream: unknown) => livestream),
}));

import { PATCH } from '@/app/api/livestreams/[id]/route';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getLivestreamById, updateLivestream } from '@/lib/repositories/livestreams';
import { requireYouTubeConnection } from '@/lib/platforms/youtube-api';
import { syncLivestreamMetadataToYouTube } from '@/lib/livestreams/sync-youtube-broadcast';
import type { Livestream } from '@/types';

const USER_ID = 'user-123';
const LIVESTREAM_ID = 'livestream-abc';

function makeLivestream(overrides: Partial<Livestream> = {}): Livestream {
  return {
    id: LIVESTREAM_ID,
    userId: USER_ID,
    status: 'live',
    title: 'Sunday Service',
    description: 'Live now',
    tags: ['service'],
    visibility: 'public',
    targets: ['youtube'],
    platforms: {},
    youtubeBroadcastId: 'broadcast-1',
    $createdAt: '2026-01-01T00:00:00.000Z',
    $updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makePatchRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest(`http://localhost:3000/api/livestreams/${LIVESTREAM_ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: 'videosphere_session=tok' },
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/livestreams/[id]', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getAuthenticatedUserId).mockResolvedValue(USER_ID);
    vi.mocked(requireYouTubeConnection).mockResolvedValue({
      ok: true,
      accessToken: 'token',
    });
    vi.mocked(syncLivestreamMetadataToYouTube).mockResolvedValue({ ok: true, droppedTags: [] });
  });

  it('updates metadata for a live livestream and syncs to YouTube', async () => {
    const existing = makeLivestream();
    const updated = makeLivestream({ title: 'Updated live title' });

    vi.mocked(getLivestreamById).mockResolvedValueOnce(existing).mockResolvedValueOnce(updated);
    vi.mocked(updateLivestream).mockResolvedValue(updated);

    const response = await PATCH(makePatchRequest({ title: 'Updated live title' }), {
      params: Promise.resolve({ id: LIVESTREAM_ID }),
    });

    expect(response.status).toBe(200);
    expect(updateLivestream).toHaveBeenCalledWith(LIVESTREAM_ID, { title: 'Updated live title' });
    expect(syncLivestreamMetadataToYouTube).toHaveBeenCalled();
  });

  it('rejects schedule changes while live', async () => {
    vi.mocked(getLivestreamById).mockResolvedValue(makeLivestream());

    const response = await PATCH(
      makePatchRequest({ scheduledStartTime: '2026-06-21T03:00:00.000Z' }),
      { params: Promise.resolve({ id: LIVESTREAM_ID }) }
    );

    expect(response.status).toBe(409);
    expect(updateLivestream).not.toHaveBeenCalled();
  });

  it('allows metadata edits after the livestream has ended', async () => {
    vi.mocked(getLivestreamById).mockResolvedValue(
      makeLivestream({ status: 'ended', youtubeBroadcastId: 'broadcast-1' })
    );
    vi.mocked(updateLivestream).mockResolvedValue(
      makeLivestream({ status: 'ended', title: 'Updated title' })
    );

    const response = await PATCH(makePatchRequest({ title: 'Updated title' }), {
      params: Promise.resolve({ id: LIVESTREAM_ID }),
    });

    expect(response.status).toBe(200);
    expect(updateLivestream).toHaveBeenCalled();
  });

  it('rejects schedule changes after the livestream has ended', async () => {
    vi.mocked(getLivestreamById).mockResolvedValue(makeLivestream({ status: 'ended' }));

    const response = await PATCH(
      makePatchRequest({ scheduledStartTime: '2026-06-21T03:00:00.000Z' }),
      { params: Promise.resolve({ id: LIVESTREAM_ID }) }
    );

    expect(response.status).toBe(409);
    expect(updateLivestream).not.toHaveBeenCalled();
  });
});
