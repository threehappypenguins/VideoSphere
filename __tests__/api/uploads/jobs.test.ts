/**
 * Tests for GET /api/uploads/jobs
 *
 * History list: pagination meta, draft titles, R2 availability for failed jobs, retry flags.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: vi.fn(),
}));

vi.mock('@/lib/repositories/upload-jobs', () => ({
  countUploadJobsByUser: vi.fn(),
  getUploadJobsWithPlatformUploadsPage: vi.fn(),
}));

vi.mock('@/lib/repositories/drafts', () => ({
  getDraftTitlesByIdsForUser: vi.fn(),
}));

const mockHeadObject = vi.fn();

vi.mock('@/lib/r2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/r2')>();
  return {
    ...actual,
    headObject: (...args: unknown[]) => mockHeadObject(...args),
  };
});

import { GET } from '@/app/api/uploads/jobs/route';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import {
  countUploadJobsByUser,
  getUploadJobsWithPlatformUploadsPage,
} from '@/lib/repositories/upload-jobs';
import { getDraftTitlesByIdsForUser } from '@/lib/repositories/drafts';
import { R2ObjectNotFoundError } from '@/lib/r2';
import type { PlatformUpload, UploadJobWithPlatformUploads } from '@/types';

const SESSION_COOKIE = 'a_session_test-project';

function makePlatformUpload(overrides: Partial<PlatformUpload> = {}): PlatformUpload {
  return {
    id: 'pu-1',
    uploadJobId: 'job-1',
    platform: 'youtube',
    status: 'completed',
    platformVideoId: '',
    platformUrl: '',
    title: 't',
    description: '',
    tags: [],
    visibility: 'public',
    scheduledAt: null,
    errorMessage: null,
    $createdAt: '2026-01-01T00:00:00.000Z',
    $updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeJob(
  id: string,
  overrides: Partial<UploadJobWithPlatformUploads> = {}
): UploadJobWithPlatformUploads {
  return {
    id,
    userId: 'user-123',
    draftId: 'draft-1',
    r2Key: 'temp/uploads/user-123/x/video.mp4',
    status: 'completed',
    errorMessage: null,
    quotaClaimMonth: null,
    $createdAt: '2026-01-01T00:00:00.000Z',
    $updatedAt: '2026-01-02T00:00:00.000Z',
    platformUploads: [makePlatformUpload({ uploadJobId: id })],
    ...overrides,
  };
}

function createRequest(search = ''): NextRequest {
  const url = new URL(`http://localhost:3000/api/uploads/jobs${search}`);
  return new NextRequest(url, {
    method: 'GET',
    headers: { Cookie: `${SESSION_COOKIE}=tok` },
  });
}

describe('GET /api/uploads/jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT = 'http://localhost/v1';
    process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID = 'test-project';
    mockHeadObject.mockResolvedValue(1024);
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(null);

    const res = await GET(createRequest());

    expect(res.status).toBe(401);
    expect(countUploadJobsByUser).not.toHaveBeenCalled();
    expect(getUploadJobsWithPlatformUploadsPage).not.toHaveBeenCalled();
  });

  it('returns data, meta.total, and default limit/offset', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
    vi.mocked(countUploadJobsByUser).mockResolvedValueOnce(1);
    vi.mocked(getUploadJobsWithPlatformUploadsPage).mockResolvedValueOnce([makeJob('job-a')]);
    vi.mocked(getDraftTitlesByIdsForUser).mockResolvedValueOnce(new Map([['draft-1', 'My draft']]));

    const res = await GET(createRequest());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ uploadJobId: string; draftTitle: string | null }>;
      meta: { total: number; limit: number; offset: number };
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].uploadJobId).toBe('job-a');
    expect(body.data[0].draftTitle).toBe('My draft');
    expect(body.meta.total).toBe(1);
    expect(body.meta.limit).toBe(20);
    expect(body.meta.offset).toBe(0);
    expect(getUploadJobsWithPlatformUploadsPage).toHaveBeenCalledWith('user-123', {
      limit: 20,
      offset: 0,
    });
  });

  it('applies limit and offset slicing; meta.total reflects full list', async () => {
    const page = ['j2', 'j3'].map((id) => makeJob(id, { draftId: 'd1' }));
    vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
    vi.mocked(countUploadJobsByUser).mockResolvedValueOnce(5);
    vi.mocked(getUploadJobsWithPlatformUploadsPage).mockResolvedValueOnce(page);
    vi.mocked(getDraftTitlesByIdsForUser).mockResolvedValueOnce(new Map());

    const res = await GET(createRequest('?limit=2&offset=2'));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ uploadJobId: string }>;
      meta: { total: number; limit: number; offset: number };
    };
    expect(body.data.map((d) => d.uploadJobId)).toEqual(['j2', 'j3']);
    expect(body.meta.total).toBe(5);
    expect(body.meta.limit).toBe(2);
    expect(body.meta.offset).toBe(2);
    expect(getUploadJobsWithPlatformUploadsPage).toHaveBeenCalledWith('user-123', {
      limit: 2,
      offset: 2,
    });
  });

  it('caps limit at 100', async () => {
    const jobs = Array.from({ length: 3 }, (_, i) => makeJob(`job-${i}`));
    vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
    vi.mocked(countUploadJobsByUser).mockResolvedValueOnce(3);
    vi.mocked(getUploadJobsWithPlatformUploadsPage).mockResolvedValueOnce(jobs);
    vi.mocked(getDraftTitlesByIdsForUser).mockResolvedValueOnce(new Map());

    const res = await GET(createRequest('?limit=500'));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { meta: { limit: number }; data: unknown[] };
    expect(body.meta.limit).toBe(100);
    expect(body.data).toHaveLength(3);
    expect(getUploadJobsWithPlatformUploadsPage).toHaveBeenCalledWith('user-123', {
      limit: 100,
      offset: 0,
    });
  });

  it('uses default limit when limit param is not a number', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
    vi.mocked(countUploadJobsByUser).mockResolvedValueOnce(1);
    vi.mocked(getUploadJobsWithPlatformUploadsPage).mockResolvedValueOnce([makeJob('only')]);
    vi.mocked(getDraftTitlesByIdsForUser).mockResolvedValueOnce(new Map());

    const res = await GET(createRequest('?limit=not-a-number'));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { meta: { limit: number } };
    expect(body.meta.limit).toBe(20);
  });

  it('sets draftTitle to null when draft id is missing or not returned for the user', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
    vi.mocked(countUploadJobsByUser).mockResolvedValueOnce(1);
    vi.mocked(getUploadJobsWithPlatformUploadsPage).mockResolvedValueOnce([
      makeJob('job-x', { draftId: 'orphan-draft-id' }),
    ]);
    vi.mocked(getDraftTitlesByIdsForUser).mockResolvedValueOnce(new Map());

    const res = await GET(createRequest());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ draftId: string | null; draftTitle: null }>;
    };
    expect(body.data[0].draftId).toBe('orphan-draft-id');
    expect(body.data[0].draftTitle).toBeNull();
  });

  it('sets r2FileAvailable to null when no platform is failed', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
    vi.mocked(countUploadJobsByUser).mockResolvedValueOnce(1);
    vi.mocked(getUploadJobsWithPlatformUploadsPage).mockResolvedValueOnce([
      makeJob('job-ok', {
        status: 'completed',
        platformUploads: [makePlatformUpload({ status: 'completed' })],
      }),
    ]);
    vi.mocked(getDraftTitlesByIdsForUser).mockResolvedValueOnce(new Map());

    const res = await GET(createRequest());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ r2FileAvailable: boolean | null }> };
    expect(body.data[0].r2FileAvailable).toBeNull();
    expect(mockHeadObject).not.toHaveBeenCalled();
  });

  it('sets r2FileAvailable true when a platform failed and R2 object exists', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
    vi.mocked(countUploadJobsByUser).mockResolvedValueOnce(1);
    vi.mocked(getUploadJobsWithPlatformUploadsPage).mockResolvedValueOnce([
      makeJob('job-fail', {
        status: 'failed',
        r2Key: 'temp/uploads/user-123/k/file.mp4',
        platformUploads: [
          makePlatformUpload({
            status: 'failed',
            errorMessage: 'quota exceeded',
          }),
        ],
      }),
    ]);
    vi.mocked(getDraftTitlesByIdsForUser).mockResolvedValueOnce(new Map());

    const res = await GET(createRequest());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ r2FileAvailable: boolean | null }> };
    expect(body.data[0].r2FileAvailable).toBe(true);
    expect(mockHeadObject).toHaveBeenCalledWith('temp/uploads/user-123/k/file.mp4');
  });

  it('sets r2FileAvailable false when R2 object is missing', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
    mockHeadObject.mockRejectedValueOnce(
      new R2ObjectNotFoundError('temp/uploads/user-123/k/file.mp4')
    );
    vi.mocked(countUploadJobsByUser).mockResolvedValueOnce(1);
    vi.mocked(getUploadJobsWithPlatformUploadsPage).mockResolvedValueOnce([
      makeJob('job-expired', {
        status: 'failed',
        r2Key: 'temp/uploads/user-123/k/file.mp4',
        platformUploads: [
          makePlatformUpload({
            status: 'failed',
            errorMessage: 'network error',
          }),
        ],
      }),
    ]);
    vi.mocked(getDraftTitlesByIdsForUser).mockResolvedValueOnce(new Map());

    const res = await GET(createRequest());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ r2FileAvailable: boolean | null }> };
    expect(body.data[0].r2FileAvailable).toBe(false);
  });

  it('sets r2FileAvailable false when a platform failed but job has no r2Key', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
    vi.mocked(countUploadJobsByUser).mockResolvedValueOnce(1);
    vi.mocked(getUploadJobsWithPlatformUploadsPage).mockResolvedValueOnce([
      makeJob('job-no-key', {
        status: 'failed',
        r2Key: null,
        platformUploads: [
          makePlatformUpload({
            status: 'failed',
            errorMessage: 'network error',
          }),
        ],
      }),
    ]);
    vi.mocked(getDraftTitlesByIdsForUser).mockResolvedValueOnce(new Map());

    const res = await GET(createRequest());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ r2FileAvailable: boolean | null }> };
    expect(body.data[0].r2FileAvailable).toBe(false);
    expect(mockHeadObject).not.toHaveBeenCalled();
  });

  it('maps retryable true for failed uploads with transient-looking errors', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
    vi.mocked(countUploadJobsByUser).mockResolvedValueOnce(1);
    vi.mocked(getUploadJobsWithPlatformUploadsPage).mockResolvedValueOnce([
      makeJob('job-retry', {
        status: 'failed',
        platformUploads: [
          makePlatformUpload({
            status: 'failed',
            errorMessage: 'fetch failed: network',
          }),
        ],
      }),
    ]);
    vi.mocked(getDraftTitlesByIdsForUser).mockResolvedValueOnce(new Map());

    const res = await GET(createRequest());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ platforms: Array<{ retryable: boolean; retryReason: string }> }>;
    };
    expect(body.data[0].platforms[0].retryable).toBe(true);
    expect(body.data[0].platforms[0].retryReason).toMatch(/transient|network/i);
  });

  it('maps retryable false for failed uploads with quota-style errors', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
    vi.mocked(countUploadJobsByUser).mockResolvedValueOnce(1);
    vi.mocked(getUploadJobsWithPlatformUploadsPage).mockResolvedValueOnce([
      makeJob('job-quota', {
        status: 'failed',
        platformUploads: [
          makePlatformUpload({
            status: 'failed',
            errorMessage: 'VIMEO_CREATE_VIDEO_FAILED: quota exceeded (HTTP 403)',
          }),
        ],
      }),
    ]);
    vi.mocked(getDraftTitlesByIdsForUser).mockResolvedValueOnce(new Map());

    const res = await GET(createRequest());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ platforms: Array<{ retryable: boolean }> }>;
    };
    expect(body.data[0].platforms[0].retryable).toBe(false);
  });

  it('normalizes platform status to completed when job status is completed', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
    vi.mocked(countUploadJobsByUser).mockResolvedValueOnce(1);
    vi.mocked(getUploadJobsWithPlatformUploadsPage).mockResolvedValueOnce([
      makeJob('job-done', {
        status: 'completed',
        platformUploads: [
          makePlatformUpload({
            status: 'failed',
            errorMessage: 'old',
            $updatedAt: '2026-01-01T00:00:00.000Z',
          }),
        ],
      }),
    ]);
    vi.mocked(getDraftTitlesByIdsForUser).mockResolvedValueOnce(new Map());

    const res = await GET(createRequest());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ platforms: Array<{ status: string }> }>;
    };
    expect(body.data[0].platforms[0].status).toBe('completed');
  });
});
