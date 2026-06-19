/**
 * Tests for POST /api/uploads/jobs/[id]/discard
 *
 * Covers auth, ownership, job state, R2 cleanup, and draft thumbnail cleanup.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: vi.fn(),
}));

vi.mock('@/lib/repositories/upload-jobs', () => ({
  getUploadJobById: vi.fn(),
  updateUploadJobStatus: vi.fn(),
}));

vi.mock('@/lib/repositories/drafts', () => ({
  getDraftById: vi.fn(),
}));

vi.mock('@/lib/repositories/platform-uploads', () => ({
  getPlatformUploadsByJob: vi.fn(),
}));

vi.mock('@/lib/draft-upload-metadata', () => ({
  buildMetadataForPlatform: vi.fn(),
}));

const mockDeleteObject = vi.fn();
const mockCleanupDistributedDraftThumbnails = vi.fn();

vi.mock('@/lib/r2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/r2')>();
  return {
    ...actual,
    deleteObject: (...args: unknown[]) => mockDeleteObject(...args),
  };
});

vi.mock('@/lib/api/distribute', () => ({
  cleanupDistributedDraftThumbnails: (...args: unknown[]) =>
    mockCleanupDistributedDraftThumbnails(...args),
}));

import { POST } from '@/app/api/uploads/jobs/[id]/discard/route';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getUploadJobById, updateUploadJobStatus } from '@/lib/repositories/upload-jobs';
import { getDraftById } from '@/lib/repositories/drafts';
import { getPlatformUploadsByJob } from '@/lib/repositories/platform-uploads';
import { buildMetadataForPlatform } from '@/lib/draft-upload-metadata';
import { R2ObjectNotFoundError } from '@/lib/r2';

const SESSION_COOKIE = 'videosphere_session';

const baseJob = {
  id: 'job-123',
  userId: 'user-123',
  draftId: 'draft-abc',
  r2Key: 'temp/uploads/user-123/1234567890/test.mp4',
  status: 'failed' as const,
  errorMessage: '1 platform upload(s) failed',
  $createdAt: '2026-01-01T00:00:00.000Z',
  $updatedAt: '2026-01-01T00:00:01.000Z',
};

function createRequest(jobId: string, cookies: Record<string, string> = {}): NextRequest {
  const url = new URL(`http://localhost:3000/api/uploads/jobs/${jobId}/discard`);
  const cookieHeader = Object.entries(cookies)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');

  return new NextRequest(url, {
    method: 'POST',
    headers: cookieHeader ? { Cookie: cookieHeader } : {},
  });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('POST /api/uploads/jobs/[id]/discard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
    vi.mocked(getUploadJobById).mockResolvedValue({ ...baseJob });
    vi.mocked(updateUploadJobStatus).mockResolvedValue({
      ...baseJob,
      status: 'cancelled',
      $updatedAt: '2026-01-01T00:00:02.000Z',
    });
    vi.mocked(mockDeleteObject).mockResolvedValue(undefined);
    vi.mocked(getDraftById).mockResolvedValue({
      id: 'draft-abc',
      userId: 'user-123',
      targets: ['youtube', 'google_drive'],
      title: 'Test',
      $createdAt: '2026-01-01T00:00:00.000Z',
      $updatedAt: '2026-01-01T00:00:00.000Z',
    } as never);
    vi.mocked(getPlatformUploadsByJob).mockResolvedValue([
      {
        id: 'pu-1',
        jobId: 'job-123',
        platform: 'youtube',
        status: 'completed',
        errorMessage: null,
        $createdAt: '2026-01-01T00:00:00.000Z',
        $updatedAt: '2026-01-01T00:00:01.000Z',
      },
      {
        id: 'pu-2',
        jobId: 'job-123',
        platform: 'google_drive',
        status: 'failed',
        errorMessage: 'quota exceeded',
        $createdAt: '2026-01-01T00:00:00.000Z',
        $updatedAt: '2026-01-01T00:00:01.000Z',
      },
    ] as never);
    vi.mocked(buildMetadataForPlatform).mockReturnValue({
      title: 'Test',
      thumbnailR2Key: 'thumbs/user-123/thumb.jpg',
    } as never);
    vi.mocked(mockCleanupDistributedDraftThumbnails).mockResolvedValue(undefined);
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValue(null);
    const response = await POST(createRequest('job-123'), makeParams('job-123'));
    expect(response.status).toBe(401);
  });

  it('returns 404 when job is missing or not owned', async () => {
    vi.mocked(getUploadJobById).mockResolvedValue(null);
    const response = await POST(
      createRequest('job-123', { [SESSION_COOKIE]: 'token' }),
      makeParams('job-123')
    );
    expect(response.status).toBe(404);
  });

  it('returns 409 when job is distributing', async () => {
    vi.mocked(getUploadJobById).mockResolvedValue({ ...baseJob, status: 'distributing' });
    const response = await POST(
      createRequest('job-123', { [SESSION_COOKIE]: 'token' }),
      makeParams('job-123')
    );
    expect(response.status).toBe(409);
  });

  it('returns 409 when job is not failed', async () => {
    vi.mocked(getUploadJobById).mockResolvedValue({ ...baseJob, status: 'completed' });
    const response = await POST(
      createRequest('job-123', { [SESSION_COOKIE]: 'token' }),
      makeParams('job-123')
    );
    expect(response.status).toBe(409);
  });

  it('cancels failed job, deletes R2 video, and cleans draft thumbnails', async () => {
    const response = await POST(
      createRequest('job-123', { [SESSION_COOKIE]: 'token' }),
      makeParams('job-123')
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ jobId: 'job-123', success: true });

    expect(updateUploadJobStatus).toHaveBeenCalledWith('job-123', 'cancelled', null);
    expect(mockDeleteObject).toHaveBeenCalledWith(baseJob.r2Key);
    expect(mockCleanupDistributedDraftThumbnails).toHaveBeenCalled();
  });

  it('ignores missing R2 object when deleting video', async () => {
    vi.mocked(mockDeleteObject).mockRejectedValue(new R2ObjectNotFoundError('missing'));
    const response = await POST(
      createRequest('job-123', { [SESSION_COOKIE]: 'token' }),
      makeParams('job-123')
    );
    expect(response.status).toBe(200);
  });

  it('skips thumbnail cleanup when job has no draft', async () => {
    vi.mocked(getUploadJobById).mockResolvedValue({ ...baseJob, draftId: null });
    const response = await POST(
      createRequest('job-123', { [SESSION_COOKIE]: 'token' }),
      makeParams('job-123')
    );
    expect(response.status).toBe(200);
    expect(mockCleanupDistributedDraftThumbnails).not.toHaveBeenCalled();
  });
});
