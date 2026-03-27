/**
 * Tests for GET /api/drafts/[id]/used-platforms
 *
 * Covers authentication, draft ownership, and deduped platform aggregation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: vi.fn(),
}));

vi.mock('@/lib/repositories/drafts', () => ({
  getDraftById: vi.fn(),
}));

vi.mock('@/lib/repositories/upload-jobs', () => ({
  getUploadJobsWithPlatformUploadsForDraft: vi.fn(async () => []),
}));

import { GET } from '@/app/api/drafts/[id]/used-platforms/route';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getDraftById } from '@/lib/repositories/drafts';
import { getUploadJobsWithPlatformUploadsForDraft } from '@/lib/repositories/upload-jobs';
import type { PlatformUpload, UploadJobWithPlatformUploads } from '@/types';

const SESSION_COOKIE = 'a_session_test-project';
const DRAFT_ID = 'draft-abc';

const baseDraft = {
  id: DRAFT_ID,
  userId: 'user-123',
  targets: ['youtube'] as const,
  title: 'My Video',
  description: '',
  tags: [] as string[],
  visibility: 'private' as const,
  platforms: {} as const,
  $createdAt: '2026-01-01T00:00:00.000Z',
  $updatedAt: '2026-01-01T00:00:00.000Z',
};

function minimalPlatformUpload(platform: PlatformUpload['platform']): PlatformUpload {
  return {
    id: `pu-${platform}`,
    uploadJobId: 'job-x',
    platform,
    status: 'completed',
    platformVideoId: '',
    platformUrl: '',
    title: '',
    description: '',
    tags: [],
    visibility: 'public',
    scheduledAt: null,
    errorMessage: null,
    $createdAt: '2026-01-01T00:00:00.000Z',
    $updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function createRequest(
  draftId: string,
  options: { cookies?: Record<string, string>; searchParams?: Record<string, string> } = {}
): NextRequest {
  const url = new URL(`http://localhost:3000/api/drafts/${draftId}/used-platforms`);
  if (options.searchParams) {
    for (const [k, v] of Object.entries(options.searchParams)) {
      url.searchParams.set(k, v);
    }
  }
  const cookieHeader = Object.entries(options.cookies ?? {})
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

function jobWithUploads(
  id: string,
  platforms: PlatformUpload['platform'][]
): UploadJobWithPlatformUploads {
  return {
    id,
    userId: 'user-123',
    draftId: DRAFT_ID,
    r2Key: 'k',
    status: 'completed',
    errorMessage: null,
    quotaClaimMonth: null,
    $createdAt: '2026-01-01T00:00:00.000Z',
    $updatedAt: '2026-01-01T00:00:00.000Z',
    platformUploads: platforms.map((p) => minimalPlatformUpload(p)),
  };
}

describe('GET /api/drafts/[id]/used-platforms', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT = 'http://localhost/v1';
    process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID = 'test-project';

    vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
    vi.mocked(getDraftById).mockResolvedValue(baseDraft);
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(null);

    const res = await GET(createRequest(DRAFT_ID), makeParams(DRAFT_ID));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
    expect(getDraftById).not.toHaveBeenCalled();
    expect(getUploadJobsWithPlatformUploadsForDraft).not.toHaveBeenCalled();
  });

  it('returns 404 when the draft does not exist', async () => {
    vi.mocked(getDraftById).mockResolvedValueOnce(null);

    const res = await GET(
      createRequest(DRAFT_ID, { cookies: { [SESSION_COOKIE]: 'tok' } }),
      makeParams(DRAFT_ID)
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.message).toBe('Draft not found');
    expect(getUploadJobsWithPlatformUploadsForDraft).not.toHaveBeenCalled();
  });

  it('returns 404 when the draft belongs to another user', async () => {
    vi.mocked(getDraftById).mockResolvedValueOnce({
      ...baseDraft,
      userId: 'other-user',
    });

    const res = await GET(
      createRequest(DRAFT_ID, { cookies: { [SESSION_COOKIE]: 'tok' } }),
      makeParams(DRAFT_ID)
    );

    expect(res.status).toBe(404);
    expect(getUploadJobsWithPlatformUploadsForDraft).not.toHaveBeenCalled();
  });

  it('dedupes platforms across jobs and platform_upload rows', async () => {
    vi.mocked(getUploadJobsWithPlatformUploadsForDraft).mockResolvedValueOnce([
      jobWithUploads('job-1', ['youtube', 'vimeo']),
      jobWithUploads('job-2', ['youtube', 'vimeo']),
    ]);

    const res = await GET(
      createRequest(DRAFT_ID, { cookies: { [SESSION_COOKIE]: 'tok' } }),
      makeParams(DRAFT_ID)
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: string[] };

    expect(getUploadJobsWithPlatformUploadsForDraft).toHaveBeenCalledWith('user-123', DRAFT_ID, {
      limit: 100,
      offset: 0,
    });
    expect(body.data).toEqual(['youtube', 'vimeo']);
  });

  it('returns platforms in canonical order regardless of job/upload iteration order', async () => {
    vi.mocked(getUploadJobsWithPlatformUploadsForDraft).mockResolvedValueOnce([
      jobWithUploads('job-1', ['vimeo', 'youtube']),
    ]);

    const res = await GET(
      createRequest(DRAFT_ID, { cookies: { [SESSION_COOKIE]: 'tok' } }),
      makeParams(DRAFT_ID)
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: string[] };
    expect(body.data).toEqual(['youtube', 'vimeo']);
  });

  it('passes explicit limit/offset and clamps invalid values', async () => {
    vi.mocked(getUploadJobsWithPlatformUploadsForDraft).mockResolvedValueOnce([]);

    await GET(
      createRequest(DRAFT_ID, {
        cookies: { [SESSION_COOKIE]: 'tok' },
        searchParams: { limit: '500', offset: '-10' },
      }),
      makeParams(DRAFT_ID)
    );

    expect(getUploadJobsWithPlatformUploadsForDraft).toHaveBeenCalledWith('user-123', DRAFT_ID, {
      limit: 300,
      offset: 0,
    });
  });
});
