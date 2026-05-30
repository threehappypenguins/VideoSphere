/**
 * Tests for POST /api/uploads/jobs/[id]/retry
 *
 * Auth, ownership, job state, R2 presence, draft linkage, and failed+retryable selection.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return {
    ...actual,
    after: (task: (() => void | Promise<void>) | Promise<void>) => {
      if (typeof task === 'function') void task();
    },
  };
});

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: vi.fn(),
}));

vi.mock('@/lib/repositories/upload-jobs', () => ({
  getUploadJobById: vi.fn(),
  updateUploadJobStatus: vi.fn(),
}));

vi.mock('@/lib/repositories/platform-uploads', () => ({
  getPlatformUploadsByJob: vi.fn(),
  ensurePlatformUploadsForJobTargets: vi.fn(),
}));

vi.mock('@/lib/repositories/drafts', () => ({
  getDraftById: vi.fn(),
}));

const mockHeadObject = vi.fn();

vi.mock('@/lib/r2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/r2')>();
  return {
    ...actual,
    headObject: (...args: unknown[]) => mockHeadObject(...args),
  };
});

const mockRunDistributionInBackground = vi.fn();
const mockDistributeCreatePlatformUploadInput = vi.fn();

vi.mock('@/lib/api/distribute', () => ({
  distributeCreatePlatformUploadInput: (...args: unknown[]) =>
    mockDistributeCreatePlatformUploadInput(...args),
  runDistributionInBackground: (...args: unknown[]) => mockRunDistributionInBackground(...args),
}));

import { POST } from '@/app/api/uploads/jobs/[id]/retry/route';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getUploadJobById, updateUploadJobStatus } from '@/lib/repositories/upload-jobs';
import {
  ensurePlatformUploadsForJobTargets,
  getPlatformUploadsByJob,
} from '@/lib/repositories/platform-uploads';
import { getDraftById } from '@/lib/repositories/drafts';
import { R2ObjectNotFoundError } from '@/lib/r2';
import type {
  ConnectedAccountPlatform,
  Draft,
  PlatformUpload,
  PlatformUploadStatus,
  UploadJobStatus,
} from '@/types';

const SESSION_COOKIE = 'videosphere_session';

const baseDraft: Draft = {
  id: 'draft-1',
  userId: 'user-123',
  targets: ['youtube', 'vimeo'],
  title: 'My title',
  description: 'D',
  tags: ['a'],
  visibility: 'public',
  platforms: {},
  $createdAt: '2026-01-01T00:00:00.000Z',
  $updatedAt: '2026-01-02T00:00:00.000Z',
};

const baseJob = {
  id: 'job-abc',
  userId: 'user-123',
  draftId: 'draft-1',
  r2Key: 'temp/uploads/user-123/v.mp4',
  status: 'failed' as const,
  errorMessage: null as string | null,
  quotaClaimMonth: null as null,
  $createdAt: '2026-01-01T00:00:00.000Z',
  $updatedAt: '2026-01-02T00:00:00.000Z',
};

function makePlatformUpload(
  overrides: Partial<PlatformUpload> & {
    platform?: ConnectedAccountPlatform;
    status?: PlatformUploadStatus;
  }
): PlatformUpload {
  const base: PlatformUpload = {
    id: 'pu-1',
    uploadJobId: 'job-abc',
    platform: 'youtube',
    status: 'failed',
    platformVideoId: '',
    platformUrl: '',
    title: 't',
    description: '',
    tags: [],
    visibility: 'public',
    scheduledAt: null,
    errorMessage: 'network error',
    $createdAt: '2026-01-01T00:00:00.000Z',
    $updatedAt: '2026-01-01T00:00:00.000Z',
  };
  return { ...base, ...overrides };
}

function createRequest(jobId: string, cookies: Record<string, string> = {}): NextRequest {
  const url = new URL(`http://localhost:3000/api/uploads/jobs/${jobId}/retry`);
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  return new NextRequest(url, {
    method: 'POST',
    headers: cookieHeader ? { Cookie: cookieHeader } : {},
  });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('POST /api/uploads/jobs/[id]/retry', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockHeadObject.mockResolvedValue(4096);
    vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
    vi.mocked(getUploadJobById).mockResolvedValue(baseJob);
    vi.mocked(getDraftById).mockResolvedValue(baseDraft);
    vi.mocked(updateUploadJobStatus).mockResolvedValue({
      ...baseJob,
      status: 'distributing',
    });
    mockRunDistributionInBackground.mockResolvedValue(undefined);

    vi.mocked(getPlatformUploadsByJob).mockResolvedValue([
      makePlatformUpload({
        id: 'pu-yt',
        platform: 'youtube',
        status: 'failed',
        errorMessage: 'fetch failed (transient)',
      }),
    ]);

    vi.mocked(ensurePlatformUploadsForJobTargets).mockImplementation(async (inputs) =>
      inputs.map((input, i) =>
        makePlatformUpload({
          id: `pu-${input.platform}-${i}`,
          platform: input.platform,
          uploadJobId: baseJob.id,
          status: 'pending',
          errorMessage: null,
        })
      )
    );

    mockDistributeCreatePlatformUploadInput.mockImplementation(
      (uploadJobId: string, draft: Draft, platform: ConnectedAccountPlatform) => ({
        uploadJobId,
        platform,
        title: draft.title,
        description: draft.description,
        tags: draft.tags,
        visibility: draft.visibility,
      })
    );
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(null);

    const res = await POST(createRequest('job-abc'), makeParams('job-abc'));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/log in/i);
    expect(getUploadJobById).not.toHaveBeenCalled();
  });

  it('returns 404 when the job does not exist', async () => {
    vi.mocked(getUploadJobById).mockResolvedValueOnce(null);

    const res = await POST(
      createRequest('missing', { [`${SESSION_COOKIE}`]: 'tok' }),
      makeParams('missing')
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Upload job not found');
    expect(mockHeadObject).not.toHaveBeenCalled();
  });

  it('returns 404 when the job belongs to another user', async () => {
    vi.mocked(getUploadJobById).mockResolvedValueOnce({
      ...baseJob,
      userId: 'other-user',
    });

    const res = await POST(
      createRequest('job-abc', { [`${SESSION_COOKIE}`]: 'tok' }),
      makeParams('job-abc')
    );

    expect(res.status).toBe(404);
    expect(await bodyError(res)).toBe('Upload job not found');
    expect(mockHeadObject).not.toHaveBeenCalled();
  });

  it('returns 409 when the job is still distributing', async () => {
    vi.mocked(getUploadJobById).mockResolvedValueOnce({
      ...baseJob,
      status: 'distributing',
    });

    const res = await POST(
      createRequest('job-abc', { [`${SESSION_COOKIE}`]: 'tok' }),
      makeParams('job-abc')
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/currently distributing/i);
    expect(mockHeadObject).not.toHaveBeenCalled();
  });

  it.each(['pending', 'uploading', 'completed', 'cancelled'] as const)(
    'returns 409 when the job status is %s (only failed jobs may be retried)',
    async (status: UploadJobStatus) => {
      vi.mocked(getUploadJobById).mockResolvedValueOnce({
        ...baseJob,
        status,
      });

      const res = await POST(
        createRequest('job-abc', { [`${SESSION_COOKIE}`]: 'tok' }),
        makeParams('job-abc')
      );

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toMatch(/only allowed for failed upload jobs|not in a failed state/i);
      expect(mockHeadObject).not.toHaveBeenCalled();
    }
  );

  it('returns 404 when the job has no R2 key (source file already cleared)', async () => {
    vi.mocked(getUploadJobById).mockResolvedValueOnce({
      ...baseJob,
      r2Key: null,
    });

    const res = await POST(
      createRequest('job-abc', { [`${SESSION_COOKIE}`]: 'tok' }),
      makeParams('job-abc')
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/no longer has an associated video file|re-upload/i);
    expect(mockHeadObject).not.toHaveBeenCalled();
  });

  it('returns 404 with expired when the R2 object is missing (HEAD 404)', async () => {
    mockHeadObject.mockRejectedValueOnce(new R2ObjectNotFoundError(baseJob.r2Key));

    const res = await POST(
      createRequest('job-abc', { [`${SESSION_COOKIE}`]: 'tok' }),
      makeParams('job-abc')
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Video file expired — please re-upload');
    expect(mockHeadObject).toHaveBeenCalledWith(baseJob.r2Key);
    expect(getDraftById).not.toHaveBeenCalled();
  });

  it('returns 400 when the job is not linked to a draft', async () => {
    vi.mocked(getUploadJobById).mockResolvedValueOnce({
      ...baseJob,
      draftId: null,
    });

    const res = await POST(
      createRequest('job-abc', { [`${SESSION_COOKIE}`]: 'tok' }),
      makeParams('job-abc')
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/not linked to a draft/i);
  });

  it('returns 404 when the draft is missing or not owned by the user', async () => {
    vi.mocked(getDraftById).mockResolvedValueOnce(null);

    const res = await POST(
      createRequest('job-abc', { [`${SESSION_COOKIE}`]: 'tok' }),
      makeParams('job-abc')
    );

    expect(res.status).toBe(404);
    expect(await bodyError(res)).toMatch(/draft not found/i);

    vi.mocked(getDraftById).mockResolvedValueOnce({ ...baseDraft, userId: 'other' });

    const res2 = await POST(
      createRequest('job-abc', { [`${SESSION_COOKIE}`]: 'tok' }),
      makeParams('job-abc')
    );

    expect(res2.status).toBe(404);
    expect(await bodyError(res2)).toMatch(/draft not found/i);
  });

  it('returns 400 when no failed uploads are retryable (e.g. only permanent HTTP errors)', async () => {
    vi.mocked(getPlatformUploadsByJob).mockResolvedValueOnce([
      makePlatformUpload({
        id: 'pu-yt',
        platform: 'youtube',
        status: 'failed',
        errorMessage: 'OAuth error (HTTP 403)',
      }),
      makePlatformUpload({
        id: 'pu-vm',
        platform: 'vimeo',
        status: 'failed',
        errorMessage: 'Bad request (HTTP 400)',
      }),
    ]);

    const res = await POST(
      createRequest('job-abc', { [`${SESSION_COOKIE}`]: 'tok' }),
      makeParams('job-abc')
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('No retryable failed platform uploads were found for this job.');
    expect(ensurePlatformUploadsForJobTargets).not.toHaveBeenCalled();
    expect(updateUploadJobStatus).not.toHaveBeenCalled();
    expect(mockRunDistributionInBackground).not.toHaveBeenCalled();
  });

  it('returns 400 when failures are only non-retryable by keyword (empty message)', async () => {
    vi.mocked(getPlatformUploadsByJob).mockResolvedValueOnce([
      makePlatformUpload({
        id: 'pu-yt',
        platform: 'youtube',
        status: 'failed',
        errorMessage: null,
      }),
    ]);

    const res = await POST(
      createRequest('job-abc', { [`${SESSION_COOKIE}`]: 'tok' }),
      makeParams('job-abc')
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('No retryable failed platform uploads were found for this job.');
  });

  it('returns 400 when there are no failed platform uploads at all', async () => {
    vi.mocked(getPlatformUploadsByJob).mockResolvedValueOnce([
      makePlatformUpload({
        id: 'pu-yt',
        platform: 'youtube',
        status: 'completed',
        errorMessage: null,
      }),
    ]);

    const res = await POST(
      createRequest('job-abc', { [`${SESSION_COOKIE}`]: 'tok' }),
      makeParams('job-abc')
    );

    expect(res.status).toBe(400);
    expect(await bodyError(res)).toBe(
      'No retryable failed platform uploads were found for this job.'
    );
  });

  it('retries only failed+retryable platforms and runs subset distribution', async () => {
    vi.mocked(getPlatformUploadsByJob).mockResolvedValueOnce([
      makePlatformUpload({
        id: 'pu-yt',
        platform: 'youtube',
        status: 'failed',
        errorMessage: 'network error',
        $updatedAt: '2026-01-03T10:00:00.000Z',
      }),
      makePlatformUpload({
        id: 'pu-vm',
        platform: 'vimeo',
        status: 'failed',
        errorMessage: 'Permission denied (HTTP 403)',
        $updatedAt: '2026-01-03T10:00:00.000Z',
      }),
      makePlatformUpload({
        id: 'pu-yt-old',
        platform: 'youtube',
        status: 'completed',
        errorMessage: null,
        $updatedAt: '2026-01-02T10:00:00.000Z',
      }),
    ]);

    const created = [
      makePlatformUpload({
        id: 'pu-youtube-new',
        platform: 'youtube',
        status: 'pending',
        errorMessage: null,
      }),
    ];
    vi.mocked(ensurePlatformUploadsForJobTargets).mockResolvedValueOnce(created);

    const res = await POST(
      createRequest('job-abc', { [`${SESSION_COOKIE}`]: 'tok' }),
      makeParams('job-abc')
    );

    expect(res.status).toBe(202);
    const body = (await res.json()) as { jobId: string; retriedPlatforms: string[] };
    expect(body.jobId).toBe('job-abc');
    expect(body.retriedPlatforms).toEqual(['youtube']);

    expect(ensurePlatformUploadsForJobTargets).toHaveBeenCalledTimes(1);
    const callInputs = vi.mocked(ensurePlatformUploadsForJobTargets).mock.calls[0][0];
    expect(callInputs).toHaveLength(1);
    expect(callInputs[0].platform).toBe('youtube');

    expect(updateUploadJobStatus).toHaveBeenCalledWith('job-abc', 'distributing', null);

    expect(mockRunDistributionInBackground).toHaveBeenCalledTimes(1);
    const rdArgs = mockRunDistributionInBackground.mock.calls[0];
    expect(rdArgs[0]).toBe('job-abc');
    expect(rdArgs[1]).toBe('user-123');
    expect(rdArgs[2]).toBe(baseJob.r2Key);
    expect(rdArgs[3]).toBe(created);
    expect(rdArgs[5]).toEqual({ subsetRetry: true });
  });

  it('uses latest row by $updatedAt per platform when deciding retry targets', async () => {
    vi.mocked(getPlatformUploadsByJob).mockResolvedValueOnce([
      makePlatformUpload({
        id: 'pu-yt-older-failed',
        platform: 'youtube',
        status: 'failed',
        errorMessage: 'network error',
        $updatedAt: '2026-01-01T00:00:00.000Z',
      }),
      makePlatformUpload({
        id: 'pu-yt-newer-completed',
        platform: 'youtube',
        status: 'completed',
        errorMessage: null,
        $updatedAt: '2026-01-03T00:00:00.000Z',
      }),
      makePlatformUpload({
        id: 'pu-vm-failed',
        platform: 'vimeo',
        status: 'failed',
        errorMessage: 'fetch failed',
        $updatedAt: '2026-01-02T00:00:00.000Z',
      }),
    ]);

    const created = [
      makePlatformUpload({
        id: 'pu-vimeo-new',
        platform: 'vimeo',
        status: 'pending',
        errorMessage: null,
      }),
    ];
    vi.mocked(ensurePlatformUploadsForJobTargets).mockResolvedValueOnce(created);

    const res = await POST(
      createRequest('job-abc', { [`${SESSION_COOKIE}`]: 'tok' }),
      makeParams('job-abc')
    );

    expect(res.status).toBe(202);
    const body = (await res.json()) as { retriedPlatforms: string[] };
    expect(body.retriedPlatforms).toEqual(['vimeo']);
    const callInputs = vi.mocked(ensurePlatformUploadsForJobTargets).mock.calls[0][0];
    expect(callInputs).toHaveLength(1);
    expect(callInputs[0].platform).toBe('vimeo');
  });

  it('returns 404 and does not schedule distribution when updateUploadJobStatus returns null', async () => {
    vi.mocked(updateUploadJobStatus).mockResolvedValueOnce(null);

    const res = await POST(
      createRequest('job-abc', { [`${SESSION_COOKIE}`]: 'tok' }),
      makeParams('job-abc')
    );

    expect(res.status).toBe(404);
    expect(await bodyError(res)).toBe('Upload job not found');
    expect(mockRunDistributionInBackground).not.toHaveBeenCalled();
  });
});

async function bodyError(res: Response): Promise<string> {
  const j = (await res.json()) as { error?: string };
  return j.error ?? '';
}
