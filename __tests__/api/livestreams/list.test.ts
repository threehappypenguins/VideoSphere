/**
 * Tests for GET /api/livestreams
 *
 * Streamed history pagination: limit/offset parsing, meta.total, and conditional reconcile.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: vi.fn(),
}));

vi.mock('@/lib/livestreams/reconcile-user-lifecycle', () => ({
  reconcileLivestreamsFromYouTubeForUser: vi.fn(),
}));

vi.mock('@/lib/repositories/livestreams', () => ({
  countStreamedLivestreamsByUser: vi.fn(),
  countYoutubeImportLivestreamsByUser: vi.fn(),
  listLivestreamsByUser: vi.fn(),
  listStreamedLivestreamsByUserPage: vi.fn(),
  listYoutubeImportLivestreamsByUserPage: vi.fn(),
}));

import { GET } from '@/app/api/livestreams/route';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { reconcileLivestreamsFromYouTubeForUser } from '@/lib/livestreams/reconcile-user-lifecycle';
import {
  countStreamedLivestreamsByUser,
  countYoutubeImportLivestreamsByUser,
  listLivestreamsByUser,
  listStreamedLivestreamsByUserPage,
  listYoutubeImportLivestreamsByUserPage,
} from '@/lib/repositories/livestreams';
import type { Livestream } from '@/types';

const USER_ID = 'user-123';

function makeLivestream(id: string, overrides: Partial<Livestream> = {}): Livestream {
  return {
    id,
    userId: USER_ID,
    status: 'ended',
    title: `Stream ${id}`,
    description: '',
    tags: [],
    visibility: 'public',
    targets: ['youtube'],
    platforms: {},
    $createdAt: '2026-01-01T00:00:00.000Z',
    $updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

function createRequest(search = ''): NextRequest {
  const url = new URL(`http://localhost:3000/api/livestreams${search}`);
  return new NextRequest(url, {
    method: 'GET',
    headers: { Cookie: 'videosphere_session=tok' },
  });
}

describe('GET /api/livestreams', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthenticatedUserId).mockResolvedValue(USER_ID);
    vi.mocked(reconcileLivestreamsFromYouTubeForUser).mockResolvedValue(0);
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(null);

    const res = await GET(createRequest('?status=streamed'));

    expect(res.status).toBe(401);
    expect(reconcileLivestreamsFromYouTubeForUser).not.toHaveBeenCalled();
    expect(listStreamedLivestreamsByUserPage).not.toHaveBeenCalled();
  });

  describe('status=streamed', () => {
    it('returns data, meta.total, and default limit/offset on the first page', async () => {
      const page = [makeLivestream('ls-1')];
      vi.mocked(countStreamedLivestreamsByUser).mockResolvedValueOnce(42);
      vi.mocked(listStreamedLivestreamsByUserPage).mockResolvedValueOnce(page);

      const res = await GET(createRequest('?status=streamed'));

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data: Livestream[];
        meta: { total: number; limit: number; offset: number };
      };
      expect(body.data).toEqual(page);
      expect(body.meta.total).toBe(42);
      expect(body.meta.limit).toBe(20);
      expect(body.meta.offset).toBe(0);
      expect(reconcileLivestreamsFromYouTubeForUser).toHaveBeenCalledWith(USER_ID);
      expect(listStreamedLivestreamsByUserPage).toHaveBeenCalledWith(USER_ID, {
        limit: 20,
        offset: 0,
      });
    });

    it('applies limit and offset; meta.total reflects the full streamed count', async () => {
      const page = [makeLivestream('ls-2'), makeLivestream('ls-3')];
      vi.mocked(countStreamedLivestreamsByUser).mockResolvedValueOnce(5);
      vi.mocked(listStreamedLivestreamsByUserPage).mockResolvedValueOnce(page);

      const res = await GET(createRequest('?status=streamed&limit=2&offset=2'));

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data: Livestream[];
        meta: { total: number; limit: number; offset: number };
      };
      expect(body.data.map((item) => item.id)).toEqual(['ls-2', 'ls-3']);
      expect(body.meta.total).toBe(5);
      expect(body.meta.limit).toBe(2);
      expect(body.meta.offset).toBe(2);
      expect(listStreamedLivestreamsByUserPage).toHaveBeenCalledWith(USER_ID, {
        limit: 2,
        offset: 2,
      });
    });

    it('reconciles YouTube livestreams only when offset is 0', async () => {
      vi.mocked(countStreamedLivestreamsByUser).mockResolvedValueOnce(0);
      vi.mocked(listStreamedLivestreamsByUserPage).mockResolvedValueOnce([]);

      const res = await GET(createRequest('?status=streamed&offset=20'));

      expect(res.status).toBe(200);
      expect(reconcileLivestreamsFromYouTubeForUser).not.toHaveBeenCalled();
    });

    it('caps limit at 100', async () => {
      vi.mocked(countStreamedLivestreamsByUser).mockResolvedValueOnce(3);
      vi.mocked(listStreamedLivestreamsByUserPage).mockResolvedValueOnce([makeLivestream('ls-a')]);

      const res = await GET(createRequest('?status=streamed&limit=500'));

      expect(res.status).toBe(200);
      const body = (await res.json()) as { meta: { limit: number } };
      expect(body.meta.limit).toBe(100);
      expect(listStreamedLivestreamsByUserPage).toHaveBeenCalledWith(USER_ID, {
        limit: 100,
        offset: 0,
      });
    });

    it('uses default limit when limit param is not a number', async () => {
      vi.mocked(countStreamedLivestreamsByUser).mockResolvedValueOnce(1);
      vi.mocked(listStreamedLivestreamsByUserPage).mockResolvedValueOnce([makeLivestream('ls-b')]);

      const res = await GET(createRequest('?status=streamed&limit=not-a-number'));

      expect(res.status).toBe(200);
      const body = (await res.json()) as { meta: { limit: number } };
      expect(body.meta.limit).toBe(20);
    });

    it('clamps limit below 1 up to 1', async () => {
      vi.mocked(countStreamedLivestreamsByUser).mockResolvedValueOnce(1);
      vi.mocked(listStreamedLivestreamsByUserPage).mockResolvedValueOnce([makeLivestream('ls-c')]);

      const res = await GET(createRequest('?status=streamed&limit=0'));

      expect(res.status).toBe(200);
      const body = (await res.json()) as { meta: { limit: number } };
      expect(body.meta.limit).toBe(1);
      expect(listStreamedLivestreamsByUserPage).toHaveBeenCalledWith(USER_ID, {
        limit: 1,
        offset: 0,
      });
    });

    it('clamps negative offset to 0', async () => {
      vi.mocked(countStreamedLivestreamsByUser).mockResolvedValueOnce(1);
      vi.mocked(listStreamedLivestreamsByUserPage).mockResolvedValueOnce([makeLivestream('ls-d')]);

      const res = await GET(createRequest('?status=streamed&offset=-5'));

      expect(res.status).toBe(200);
      const body = (await res.json()) as { meta: { offset: number } };
      expect(body.meta.offset).toBe(0);
      expect(reconcileLivestreamsFromYouTubeForUser).toHaveBeenCalledWith(USER_ID);
      expect(listStreamedLivestreamsByUserPage).toHaveBeenCalledWith(USER_ID, {
        limit: 20,
        offset: 0,
      });
    });

    it('uses the YouTube import filter when for=youtube-import is requested', async () => {
      const page = [makeLivestream('importable-1')];
      vi.mocked(countYoutubeImportLivestreamsByUser).mockResolvedValueOnce(1);
      vi.mocked(listYoutubeImportLivestreamsByUserPage).mockResolvedValueOnce(page);

      const res = await GET(createRequest('?status=streamed&for=youtube-import'));

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: Livestream[]; meta: { total: number } };
      expect(body.data).toEqual(page);
      expect(body.meta.total).toBe(1);
      expect(countYoutubeImportLivestreamsByUser).toHaveBeenCalledWith(USER_ID);
      expect(listYoutubeImportLivestreamsByUserPage).toHaveBeenCalledWith(USER_ID, {
        limit: 20,
        offset: 0,
      });
      expect(countStreamedLivestreamsByUser).not.toHaveBeenCalled();
      expect(listStreamedLivestreamsByUserPage).not.toHaveBeenCalled();
    });
  });

  describe('unfiltered list', () => {
    it('reconciles and returns all livestreams without pagination meta', async () => {
      const livestreams = [makeLivestream('ls-live', { status: 'live' })];
      vi.mocked(listLivestreamsByUser).mockResolvedValueOnce(livestreams);

      const res = await GET(createRequest());

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: Livestream[]; meta?: unknown };
      expect(body.data).toEqual(livestreams);
      expect(body.meta).toBeUndefined();
      expect(reconcileLivestreamsFromYouTubeForUser).toHaveBeenCalledWith(USER_ID);
      expect(listLivestreamsByUser).toHaveBeenCalledWith(USER_ID);
      expect(listStreamedLivestreamsByUserPage).not.toHaveBeenCalled();
    });
  });
});
