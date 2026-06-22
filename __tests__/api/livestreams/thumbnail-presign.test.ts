/**
 * Tests for POST /api/livestreams/[id]/thumbnail/presign
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: vi.fn(),
}));

vi.mock('@/lib/repositories/livestreams', () => ({
  getLivestreamById: vi.fn(),
}));

vi.mock('@/lib/r2', () => ({
  buildLivestreamThumbnailPendingKey: vi.fn(() => 'pending/key.jpg'),
  getPresignedUploadUrl: vi.fn(),
}));

import { POST } from '@/app/api/livestreams/[id]/thumbnail/presign/route';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getLivestreamById } from '@/lib/repositories/livestreams';
import { getPresignedUploadUrl } from '@/lib/r2';
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
  return new NextRequest(
    `http://localhost:3000/api/livestreams/${LIVESTREAM_ID}/thumbnail/presign`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: 'videosphere_session=tok' },
      body: JSON.stringify({ contentType: 'image/jpeg', fileSize: 1024 }),
    }
  );
}

describe('POST /api/livestreams/[id]/thumbnail/presign', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getAuthenticatedUserId).mockResolvedValue(USER_ID);
    vi.mocked(getPresignedUploadUrl).mockResolvedValue('https://r2.example/presigned-put');
  });

  it('presigns uploads for draft, scheduled, and live livestreams', async () => {
    for (const status of ['draft', 'scheduled', 'live'] as const) {
      vi.mocked(getLivestreamById).mockResolvedValue(makeLivestream({ status }));

      const response = await POST(makeRequest(), {
        params: Promise.resolve({ id: LIVESTREAM_ID }),
      });

      expect(response.status).toBe(200);
    }
  });

  it('allows presign when the livestream has ended', async () => {
    vi.mocked(getLivestreamById).mockResolvedValue(makeLivestream({ status: 'ended' }));

    const response = await POST(makeRequest(), {
      params: Promise.resolve({ id: LIVESTREAM_ID }),
    });

    expect(response.status).toBe(200);
    expect(getPresignedUploadUrl).toHaveBeenCalled();
  });
});
