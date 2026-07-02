import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetAuthenticatedUserId = vi.fn();
const mockGetActiveYoutubeImportJobForUser = vi.fn();

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: (...args: unknown[]) => mockGetAuthenticatedUserId(...args),
}));

vi.mock('@/lib/repositories/youtube-import-jobs', () => ({
  getActiveYoutubeImportJobForUser: (...args: unknown[]) =>
    mockGetActiveYoutubeImportJobForUser(...args),
}));

import { GET } from '@/app/api/youtube-import/active/route';

const USER_ID = 'user-123';

const activeJob = {
  id: 'import-job-1',
  userId: USER_ID,
  draftId: 'draft-1',
  sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  youtubeVideoId: 'dQw4w9WgXcQ',
  livestreamId: null,
  startSeconds: 0,
  endSeconds: 120,
  status: 'trimming' as const,
  progressPercent: 72,
  errorMessage: null,
  r2Key: null,
  uploadJobId: null,
  $createdAt: '2026-01-01T00:00:00.000Z',
  $updatedAt: '2026-01-01T00:05:00.000Z',
};

function createRequest(): NextRequest {
  return new NextRequest('http://localhost:9624/api/youtube-import/active', {
    method: 'GET',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthenticatedUserId.mockResolvedValue(USER_ID);
  mockGetActiveYoutubeImportJobForUser.mockResolvedValue(null);
});

describe('GET /api/youtube-import/active', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetAuthenticatedUserId.mockResolvedValueOnce(null);

    const response = await GET(createRequest());

    expect(response.status).toBe(401);
    expect(mockGetActiveYoutubeImportJobForUser).not.toHaveBeenCalled();
  });

  it('returns { job: null } when the user has no active import', async () => {
    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ job: null });
    expect(mockGetActiveYoutubeImportJobForUser).toHaveBeenCalledWith(USER_ID);
  });

  it('returns the active import job when one exists', async () => {
    mockGetActiveYoutubeImportJobForUser.mockResolvedValueOnce(activeJob);

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ job: activeJob });
  });
});
