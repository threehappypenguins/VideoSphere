/**
 * Tests for GET /api/uploads/jobs/[id]
 *
 * Polling/status endpoint: auth, ownership, and aggregated platform statuses.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: vi.fn(),
}));

vi.mock('@/lib/repositories/upload-jobs', () => ({
  getUploadJobById: vi.fn(),
}));

vi.mock('@/lib/repositories/platform-uploads', () => ({
  getPlatformUploadsByJob: vi.fn(),
}));

import { GET } from '@/app/api/uploads/jobs/[id]/route';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getUploadJobById } from '@/lib/repositories/upload-jobs';
import { getPlatformUploadsByJob } from '@/lib/repositories/platform-uploads';
import type { ConnectedAccountPlatform, PlatformUpload, PlatformUploadStatus } from '@/types';

const SESSION_COOKIE = 'videosphere_session';

const baseJob = {
  id: 'job-abc',
  userId: 'user-123',
  draftId: 'draft-1',
  r2Key: 'k',
  status: 'distributing' as const,
  errorMessage: null,
  $createdAt: '2026-01-01T00:00:00.000Z',
  $updatedAt: '2026-01-10T00:00:00.000Z',
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
    status: 'pending',
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
  };
  return { ...base, ...overrides };
}

function createRequest(jobId: string, cookies: Record<string, string> = {}): NextRequest {
  const url = new URL(`http://localhost:3000/api/uploads/jobs/${jobId}`);
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  return new NextRequest(url, {
    method: 'GET',
    headers: cookieHeader ? { Cookie: cookieHeader } : {},
  });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('GET /api/uploads/jobs/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(null);

    const res = await GET(createRequest('job-abc'), makeParams('job-abc'));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
    expect(body.statusCode).toBe(401);
    expect(getUploadJobById).not.toHaveBeenCalled();
  });

  it('returns 404 when the upload job does not exist', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
    vi.mocked(getUploadJobById).mockResolvedValueOnce(null);

    const res = await GET(
      createRequest('missing', { [`${SESSION_COOKIE}`]: 'tok' }),
      makeParams('missing')
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Not Found');
    expect(body.message).toBe('Upload job not found');
    expect(getPlatformUploadsByJob).not.toHaveBeenCalled();
  });

  it('returns 404 when the job belongs to another user', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
    vi.mocked(getUploadJobById).mockResolvedValueOnce({
      ...baseJob,
      userId: 'other-user',
    });

    const res = await GET(
      createRequest('job-abc', { [`${SESSION_COOKIE}`]: 'tok' }),
      makeParams('job-abc')
    );

    expect(res.status).toBe(404);
    expect(getPlatformUploadsByJob).not.toHaveBeenCalled();
  });

  it('aggregates to the latest status per platform by $updatedAt', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
    vi.mocked(getUploadJobById).mockResolvedValueOnce({ ...baseJob, status: 'distributing' });
    vi.mocked(getPlatformUploadsByJob).mockResolvedValueOnce([
      makePlatformUpload({
        id: 'pu-old',
        platform: 'youtube',
        status: 'pending',
        $updatedAt: '2026-01-02T00:00:00.000Z',
      }),
      makePlatformUpload({
        id: 'pu-new',
        platform: 'youtube',
        status: 'completed',
        $updatedAt: '2026-01-03T12:00:00.000Z',
      }),
      makePlatformUpload({
        id: 'pu-vm',
        platform: 'vimeo',
        status: 'uploading',
        $updatedAt: '2026-01-02T15:00:00.000Z',
      }),
    ]);

    const res = await GET(
      createRequest('job-abc', { [`${SESSION_COOKIE}`]: 'tok' }),
      makeParams('job-abc')
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        uploadJobId: string;
        status: string;
        createdAt: string;
        updatedAt: string;
        platforms: Array<{ platform: string; status: string; updatedAt: string }>;
      };
    };

    expect(body.data.uploadJobId).toBe('job-abc');
    expect(body.data.status).toBe('distributing');
    expect(body.data.createdAt).toBe(baseJob.$createdAt);
    expect(body.data.updatedAt).toBe(baseJob.$updatedAt);

    const youtube = body.data.platforms.find((p) => p.platform === 'youtube');
    const vimeo = body.data.platforms.find((p) => p.platform === 'vimeo');

    expect(youtube?.status).toBe('completed');
    expect(youtube?.updatedAt).toBe('2026-01-03T12:00:00.000Z');
    expect(vimeo?.status).toBe('uploading');

    expect(getPlatformUploadsByJob).toHaveBeenCalledWith('job-abc');
  });

  it('returns stored platform statuses when the upload job is completed', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
    vi.mocked(getUploadJobById).mockResolvedValueOnce({ ...baseJob, status: 'completed' });
    vi.mocked(getPlatformUploadsByJob).mockResolvedValueOnce([
      makePlatformUpload({
        platform: 'sermon_audio',
        status: 'unpublished',
        $updatedAt: '2026-01-05T00:00:00.000Z',
      }),
    ]);

    const res = await GET(
      createRequest('job-abc', { [`${SESSION_COOKIE}`]: 'tok' }),
      makeParams('job-abc')
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { platforms: Array<{ status: string }> };
    };

    expect(body.data.platforms).toHaveLength(1);
    expect(body.data.platforms[0].status).toBe('unpublished');
  });
});
