import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockClaimPendingYoutubeImportJob = vi.fn();
const mockGetYoutubeImportJobById = vi.fn();
const mockRunYoutubeImportJob = vi.fn();

vi.mock('@/lib/repositories/youtube-import-jobs', () => ({
  claimPendingYoutubeImportJob: (...args: unknown[]) => mockClaimPendingYoutubeImportJob(...args),
  getYoutubeImportJobById: (...args: unknown[]) => mockGetYoutubeImportJobById(...args),
}));

vi.mock('@/lib/youtube-import/run-import-job', () => ({
  runYoutubeImportJob: (...args: unknown[]) => mockRunYoutubeImportJob(...args),
}));

import { executeYoutubeImportJobWorker } from '@/lib/youtube-import/execute-import-job';

const JOB_ID = 'import-job-1';
const USER_ID = 'user-123';

const pendingJob = {
  id: JOB_ID,
  userId: USER_ID,
  draftId: 'draft-1',
  sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  youtubeVideoId: 'dQw4w9WgXcQ',
  livestreamId: null,
  startSeconds: 0,
  endSeconds: 120,
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

beforeEach(() => {
  vi.clearAllMocks();
  mockClaimPendingYoutubeImportJob.mockResolvedValue({
    ...pendingJob,
    status: 'downloading',
  });
  mockRunYoutubeImportJob.mockResolvedValue(undefined);
});

describe('executeYoutubeImportJobWorker', () => {
  it('claims and runs a pending job', async () => {
    const result = await executeYoutubeImportJobWorker(JOB_ID, USER_ID);

    expect(result).toEqual({ outcome: 'ran' });
    expect(mockClaimPendingYoutubeImportJob).toHaveBeenCalledWith(JOB_ID, USER_ID);
    expect(mockRunYoutubeImportJob).toHaveBeenCalledWith(JOB_ID);
  });

  it('returns already_running when the job is no longer pending', async () => {
    mockClaimPendingYoutubeImportJob.mockResolvedValueOnce(null);
    mockGetYoutubeImportJobById.mockResolvedValueOnce({
      ...pendingJob,
      status: 'downloading',
    });

    const result = await executeYoutubeImportJobWorker(JOB_ID, USER_ID);

    expect(result).toEqual({ outcome: 'already_running', status: 'downloading' });
    expect(mockRunYoutubeImportJob).not.toHaveBeenCalled();
  });

  it('returns not_found when the job row disappeared', async () => {
    mockClaimPendingYoutubeImportJob.mockResolvedValueOnce(null);
    mockGetYoutubeImportJobById.mockResolvedValueOnce(null);

    const result = await executeYoutubeImportJobWorker(JOB_ID, USER_ID);

    expect(result).toEqual({ outcome: 'not_found' });
  });
});
