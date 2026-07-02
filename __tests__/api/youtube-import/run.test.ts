import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetAuthenticatedUserId = vi.fn();
const mockGetYoutubeImportJobById = vi.fn();
const mockClaimPendingYoutubeImportJob = vi.fn();
const mockRunYoutubeImportJob = vi.fn();

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: (...args: unknown[]) => mockGetAuthenticatedUserId(...args),
}));

vi.mock('@/lib/repositories/youtube-import-jobs', () => ({
  getYoutubeImportJobById: (...args: unknown[]) => mockGetYoutubeImportJobById(...args),
  claimPendingYoutubeImportJob: (...args: unknown[]) => mockClaimPendingYoutubeImportJob(...args),
}));

vi.mock('@/lib/youtube-import/run-import-job', () => ({
  runYoutubeImportJob: (...args: unknown[]) => mockRunYoutubeImportJob(...args),
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
  $createdAt: '2026-01-01T00:00:00.000Z',
  $updatedAt: '2026-01-01T00:00:00.000Z',
};

function createRequest(jobId = JOB_ID, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost:9624/api/youtube-import/${jobId}/run`, {
    method: 'POST',
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('YOUTUBE_IMPORT_WORKER_SECRET', 'worker-secret');
  mockGetAuthenticatedUserId.mockResolvedValue(USER_ID);
  mockGetYoutubeImportJobById.mockResolvedValue(pendingJob);
  mockClaimPendingYoutubeImportJob.mockResolvedValue({
    ...pendingJob,
    status: 'downloading',
  });
  mockGetYoutubeImportJobById.mockResolvedValueOnce(pendingJob).mockResolvedValueOnce({
    ...pendingJob,
    status: 'completed',
    progressPercent: 100,
  });
  mockRunYoutubeImportJob.mockResolvedValue(undefined);
});

describe('POST /api/youtube-import/[jobId]/run', () => {
  it('runs a pending job for the authenticated owner', async () => {
    const response = await POST(createRequest(), { params: Promise.resolve({ jobId: JOB_ID }) });

    expect(response.status).toBe(200);
    expect(mockClaimPendingYoutubeImportJob).toHaveBeenCalledWith(JOB_ID, USER_ID);
    expect(mockRunYoutubeImportJob).toHaveBeenCalledWith(JOB_ID);
  });

  it('returns 409 when the job is no longer pending', async () => {
    mockGetYoutubeImportJobById.mockResolvedValue({
      ...pendingJob,
      status: 'downloading',
    });
    mockClaimPendingYoutubeImportJob.mockResolvedValue(null);

    const response = await POST(createRequest(), { params: Promise.resolve({ jobId: JOB_ID }) });

    expect(response.status).toBe(409);
    expect(mockRunYoutubeImportJob).not.toHaveBeenCalled();
  });

  it('accepts worker-secret auth without a user session', async () => {
    mockGetAuthenticatedUserId.mockResolvedValueOnce(null);

    const response = await POST(
      createRequest(JOB_ID, { 'x-youtube-import-worker-secret': 'worker-secret' }),
      { params: Promise.resolve({ jobId: JOB_ID }) }
    );

    expect(response.status).toBe(200);
    expect(mockRunYoutubeImportJob).toHaveBeenCalledWith(JOB_ID);
  });
});
