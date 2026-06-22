/**
 * Tests for DELETE /api/livestreams/[id]/thumbnail
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: vi.fn(),
}));

vi.mock('@/lib/repositories/livestreams', () => ({
  getLivestreamById: vi.fn(),
  updateLivestream: vi.fn(),
}));

vi.mock('@/lib/r2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/r2')>();
  return {
    ...actual,
    deleteObject: vi.fn(),
    isLivestreamThumbnailFinalKeyForUser: vi.fn(),
  };
});

import { DELETE } from '@/app/api/livestreams/[id]/thumbnail/route';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getLivestreamById, updateLivestream } from '@/lib/repositories/livestreams';
import { deleteObject, isLivestreamThumbnailFinalKeyForUser } from '@/lib/r2';
import type { Livestream } from '@/types';

const USER_ID = 'user-123';
const LIVESTREAM_ID = 'livestream-abc';

function makeLivestream(overrides: Partial<Livestream> = {}): Livestream {
  return {
    id: LIVESTREAM_ID,
    userId: USER_ID,
    status: 'draft',
    title: 'Sunday Service',
    description: '',
    tags: [],
    visibility: 'public',
    targets: ['youtube'],
    platforms: {},
    $createdAt: '2026-01-01T00:00:00.000Z',
    $updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeRequest(): NextRequest {
  return new NextRequest(`http://localhost:3000/api/livestreams/${LIVESTREAM_ID}/thumbnail`, {
    method: 'DELETE',
    headers: { Cookie: 'videosphere_session=tok' },
  });
}

describe('DELETE /api/livestreams/[id]/thumbnail', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getAuthenticatedUserId).mockResolvedValue(USER_ID);
    vi.mocked(deleteObject).mockResolvedValue(undefined);
    vi.mocked(isLivestreamThumbnailFinalKeyForUser).mockReturnValue(false);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns 409 when the livestream is already scheduled on YouTube', async () => {
    vi.mocked(getLivestreamById).mockResolvedValue(
      makeLivestream({
        status: 'scheduled',
        youtubeBroadcastId: 'broadcast-1',
        platforms: {
          youtube: { thumbnailUrl: 'https://i.ytimg.com/vi/abc/default.jpg' },
        },
      })
    );

    const res = await DELETE(makeRequest(), {
      params: Promise.resolve({ id: LIVESTREAM_ID }),
    });

    expect(res.status).toBe(409);
    expect(updateLivestream).not.toHaveBeenCalled();
  });

  it('clears draft thumbnail fields and deletes the R2 object', async () => {
    const thumbKey = 'livestreams/thumbnails/user-123/livestream-abc/thumb.jpg';
    const livestream = makeLivestream({
      thumbnailR2Key: thumbKey,
      thumbnailContentType: 'image/jpeg',
    });
    vi.mocked(getLivestreamById).mockResolvedValue(livestream);
    vi.mocked(isLivestreamThumbnailFinalKeyForUser).mockReturnValue(true);
    vi.mocked(updateLivestream).mockResolvedValue({
      ...livestream,
      thumbnailR2Key: undefined,
      thumbnailContentType: undefined,
    });

    const res = await DELETE(makeRequest(), {
      params: Promise.resolve({ id: LIVESTREAM_ID }),
    });

    expect(res.status).toBe(200);
    expect(updateLivestream).toHaveBeenCalledWith(LIVESTREAM_ID, {
      thumbnailR2Key: null,
      thumbnailContentType: null,
    });
    expect(deleteObject).toHaveBeenCalledWith(thumbKey);
  });
});
