import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetAuthenticatedUserId = vi.fn();
const mockGetYoutubeImportJobById = vi.fn();
const mockUpdateYoutubeImportJobStatus = vi.fn();

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: (...args: unknown[]) => mockGetAuthenticatedUserId(...args),
}));

vi.mock('@/lib/repositories/youtube-import-jobs', () => ({
  getYoutubeImportJobById: (...args: unknown[]) => mockGetYoutubeImportJobById(...args),
  updateYoutubeImportJobStatus: (...args: unknown[]) => mockUpdateYoutubeImportJobStatus(...args),
}));

import { POST } from '@/app/api/youtube-import/[jobId]/cancel/route';

const USER_ID = 'user-123';
const JOB_ID = 'import-job-1';

const activeJob = {
  id: JOB_ID,
  userId: USER_ID,
  draftId: 'draft-1',
  sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  youtubeVideoId: 'dQw4w9WgXcQ',
  livestreamId: null,
  startSeconds: 0,
  endSeconds: 120,
  status: 'downloading' as const,
  progressPercent: 20,
  errorMessage: null,
  r2Key: null,
  uploadJobId: null,
  $createdAt: '2026-01-01T00:00:00.000Z',
  $updatedAt: '2026-01-01T00:05:00.000Z',
};

function createRequest(jobId: string): NextRequest {
  return new NextRequest(`http://localhost:9624/api/youtube-import/${jobId}/cancel`, {
    method: 'POST',
  });
}

function makeParams(jobId: string) {
  return { params: Promise.resolve({ jobId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthenticatedUserId.mockResolvedValue(USER_ID);
  mockGetYoutubeImportJobById.mockResolvedValue(activeJob);
  mockUpdateYoutubeImportJobStatus.mockResolvedValue(undefined);
});

describe('POST /api/youtube-import/[jobId]/cancel', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetAuthenticatedUserId.mockResolvedValueOnce(null);

    const response = await POST(createRequest(JOB_ID), makeParams(JOB_ID));

    expect(response.status).toBe(401);
    expect(mockUpdateYoutubeImportJobStatus).not.toHaveBeenCalled();
  });

  it('returns 404 when the job does not exist', async () => {
    mockGetYoutubeImportJobById.mockResolvedValueOnce(null);

    const response = await POST(createRequest(JOB_ID), makeParams(JOB_ID));

    expect(response.status).toBe(404);
    expect(mockUpdateYoutubeImportJobStatus).not.toHaveBeenCalled();
  });

  it('returns 403 when the job belongs to another user', async () => {
    mockGetYoutubeImportJobById.mockResolvedValueOnce({ ...activeJob, userId: 'other-user' });

    const response = await POST(createRequest(JOB_ID), makeParams(JOB_ID));

    expect(response.status).toBe(403);
    expect(mockUpdateYoutubeImportJobStatus).not.toHaveBeenCalled();
  });

  it.each(['completed', 'failed', 'cancelled'] as const)(
    'returns 409 when the job is already %s',
    async (status) => {
      mockGetYoutubeImportJobById.mockResolvedValueOnce({ ...activeJob, status });

      const response = await POST(createRequest(JOB_ID), makeParams(JOB_ID));

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.message).toContain(status);
      expect(mockUpdateYoutubeImportJobStatus).not.toHaveBeenCalled();
    }
  );

  it('marks an in-progress job as cancelled', async () => {
    const response = await POST(createRequest(JOB_ID), makeParams(JOB_ID));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: true });
    expect(mockUpdateYoutubeImportJobStatus).toHaveBeenCalledWith(JOB_ID, {
      status: 'cancelled',
      errorMessage: null,
    });
  });
});
