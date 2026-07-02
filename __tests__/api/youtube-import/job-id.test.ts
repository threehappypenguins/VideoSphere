import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetAuthenticatedUserId = vi.fn();
const mockGetYoutubeImportJobById = vi.fn();

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: (...args: unknown[]) => mockGetAuthenticatedUserId(...args),
}));

vi.mock('@/lib/repositories/youtube-import-jobs', () => ({
  getYoutubeImportJobById: (...args: unknown[]) => mockGetYoutubeImportJobById(...args),
}));

import { GET } from '@/app/api/youtube-import/[jobId]/route';

const USER_ID = 'user-123';
const JOB_ID = 'import-job-1';

const baseJob = {
  id: JOB_ID,
  userId: USER_ID,
  draftId: 'draft-1',
  sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  youtubeVideoId: 'dQw4w9WgXcQ',
  livestreamId: null,
  startSeconds: 0,
  endSeconds: 120,
  status: 'downloading' as const,
  progressPercent: 35,
  errorMessage: null,
  r2Key: null,
  uploadJobId: null,
  $createdAt: '2026-01-01T00:00:00.000Z',
  $updatedAt: '2026-01-01T00:05:00.000Z',
};

function createRequest(jobId: string): NextRequest {
  return new NextRequest(`http://localhost:9624/api/youtube-import/${jobId}`, {
    method: 'GET',
  });
}

function makeParams(jobId: string) {
  return { params: Promise.resolve({ jobId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthenticatedUserId.mockResolvedValue(USER_ID);
  mockGetYoutubeImportJobById.mockResolvedValue(baseJob);
});

describe('GET /api/youtube-import/[jobId]', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetAuthenticatedUserId.mockResolvedValueOnce(null);

    const response = await GET(createRequest(JOB_ID), makeParams(JOB_ID));

    expect(response.status).toBe(401);
    expect(mockGetYoutubeImportJobById).not.toHaveBeenCalled();
  });

  it('returns 404 when the job does not exist', async () => {
    mockGetYoutubeImportJobById.mockResolvedValueOnce(null);

    const response = await GET(createRequest(JOB_ID), makeParams(JOB_ID));

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.message).toContain('not found');
  });

  it('returns 403 when the job belongs to another user', async () => {
    mockGetYoutubeImportJobById.mockResolvedValueOnce({ ...baseJob, userId: 'other-user' });

    const response = await GET(createRequest(JOB_ID), makeParams(JOB_ID));

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe('Forbidden');
  });

  it('returns the full job record for the owner', async () => {
    const response = await GET(createRequest(JOB_ID), makeParams(JOB_ID));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual(baseJob);
    expect(mockGetYoutubeImportJobById).toHaveBeenCalledWith(JOB_ID);
  });
});
