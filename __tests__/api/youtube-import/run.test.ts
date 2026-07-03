import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetAuthenticatedUserId = vi.fn();
const mockGetYoutubeImportJobById = vi.fn();
const mockExecuteYoutubeImportJobWorker = vi.fn();

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: (...args: unknown[]) => mockGetAuthenticatedUserId(...args),
}));

vi.mock('@/lib/repositories/youtube-import-jobs', () => ({
  getYoutubeImportJobById: (...args: unknown[]) => mockGetYoutubeImportJobById(...args),
}));

vi.mock('@/lib/youtube-import/execute-import-job', () => ({
  executeYoutubeImportJobWorker: (...args: unknown[]) => mockExecuteYoutubeImportJobWorker(...args),
}));

import { POST } from '@/app/api/youtube-import/[jobId]/run/route';

const USER_ID = 'user-123';
const JOB_ID = 'import-job-1';

const pendingJob = {
  id: JOB_ID,
  userId: USER_ID,
  draftId: 'draft-1',
  sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  youtubeVideoId: 'dQw4w9WgXcQ',
  livestreamId: null,
  startSeconds: 10,
  endSeconds: 100,
  status: 'pending' as const,
  progressPercent: 0,
  errorMessage: null,
  r2Key: null,
  uploadJobId: null,
  distributeQueued: false,
  smartCut: false,
  $createdAt: '2026-01-01T00:00:00.000Z',
  $updatedAt: '2026-01-01T00:00:00.000Z',
};

function createRequest(jobId = JOB_ID): NextRequest {
  return new NextRequest(`http://localhost:9624/api/youtube-import/${jobId}/run`, {
    method: 'POST',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthenticatedUserId.mockResolvedValue(USER_ID);
  mockGetYoutubeImportJobById.mockResolvedValue(pendingJob);
  mockExecuteYoutubeImportJobWorker.mockResolvedValue({ outcome: 'ran' });
  mockGetYoutubeImportJobById.mockResolvedValueOnce(pendingJob).mockResolvedValueOnce({
    ...pendingJob,
    status: 'completed',
    progressPercent: 100,
  });
});

describe('POST /api/youtube-import/[jobId]/run', () => {
  it('runs a pending job for the authenticated owner', async () => {
    const response = await POST(createRequest(), { params: Promise.resolve({ jobId: JOB_ID }) });

    expect(response.status).toBe(200);
    expect(mockExecuteYoutubeImportJobWorker).toHaveBeenCalledWith(JOB_ID, USER_ID);
  });

  it('returns 409 when the job is no longer pending', async () => {
    mockExecuteYoutubeImportJobWorker.mockResolvedValueOnce({
      outcome: 'already_running',
      status: 'downloading',
    });

    const response = await POST(createRequest(), { params: Promise.resolve({ jobId: JOB_ID }) });

    expect(response.status).toBe(409);
  });

  it('returns 403 without a user session', async () => {
    mockGetAuthenticatedUserId.mockResolvedValueOnce(null);

    const response = await POST(createRequest(), { params: Promise.resolve({ jobId: JOB_ID }) });

    expect(response.status).toBe(403);
    expect(mockExecuteYoutubeImportJobWorker).not.toHaveBeenCalled();
  });
});
