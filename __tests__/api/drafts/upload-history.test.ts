/**
 * Tests for GET /api/drafts/[id]/upload-history
 *
 * Covers authentication, draft ownership, and limit/offset query handling.
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

import { GET } from '@/app/api/drafts/[id]/upload-history/route';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getDraftById } from '@/lib/repositories/drafts';
import { getUploadJobsWithPlatformUploadsForDraft } from '@/lib/repositories/upload-jobs';

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

function createRequest(
  draftId: string,
  options: { cookies?: Record<string, string>; searchParams?: Record<string, string> } = {}
): NextRequest {
  const url = new URL(`http://localhost:3000/api/drafts/${draftId}/upload-history`);
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

describe('GET /api/drafts/[id]/upload-history', () => {
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

  it('defaults limit to 20 and offset to 0 when query params are absent', async () => {
    await GET(
      createRequest(DRAFT_ID, { cookies: { [SESSION_COOKIE]: 'tok' } }),
      makeParams(DRAFT_ID)
    );

    expect(getUploadJobsWithPlatformUploadsForDraft).toHaveBeenCalledWith('user-123', DRAFT_ID, {
      limit: 20,
      offset: 0,
    });
  });

  it('passes explicit limit and offset through to the repository', async () => {
    await GET(
      createRequest(DRAFT_ID, {
        cookies: { [SESSION_COOKIE]: 'tok' },
        searchParams: { limit: '10', offset: '40' },
      }),
      makeParams(DRAFT_ID)
    );

    expect(getUploadJobsWithPlatformUploadsForDraft).toHaveBeenCalledWith('user-123', DRAFT_ID, {
      limit: 10,
      offset: 40,
    });
  });

  it('clamps limit to a maximum of 100', async () => {
    await GET(
      createRequest(DRAFT_ID, {
        cookies: { [SESSION_COOKIE]: 'tok' },
        searchParams: { limit: '500' },
      }),
      makeParams(DRAFT_ID)
    );

    expect(getUploadJobsWithPlatformUploadsForDraft).toHaveBeenCalledWith('user-123', DRAFT_ID, {
      limit: 100,
      offset: 0,
    });
  });

  it('enforces a minimum limit of 1', async () => {
    await GET(
      createRequest(DRAFT_ID, {
        cookies: { [SESSION_COOKIE]: 'tok' },
        searchParams: { limit: '1' },
      }),
      makeParams(DRAFT_ID)
    );

    expect(getUploadJobsWithPlatformUploadsForDraft).toHaveBeenCalledWith('user-123', DRAFT_ID, {
      limit: 1,
      offset: 0,
    });
  });

  it('treats invalid limit values as the default 20', async () => {
    await GET(
      createRequest(DRAFT_ID, {
        cookies: { [SESSION_COOKIE]: 'tok' },
        searchParams: { limit: 'not-a-number' },
      }),
      makeParams(DRAFT_ID)
    );

    expect(getUploadJobsWithPlatformUploadsForDraft).toHaveBeenCalledWith('user-123', DRAFT_ID, {
      limit: 20,
      offset: 0,
    });
  });

  it('floors negative offset to 0', async () => {
    await GET(
      createRequest(DRAFT_ID, {
        cookies: { [SESSION_COOKIE]: 'tok' },
        searchParams: { offset: '-5' },
      }),
      makeParams(DRAFT_ID)
    );

    expect(getUploadJobsWithPlatformUploadsForDraft).toHaveBeenCalledWith('user-123', DRAFT_ID, {
      limit: 20,
      offset: 0,
    });
  });

  it('treats invalid offset as 0', async () => {
    await GET(
      createRequest(DRAFT_ID, {
        cookies: { [SESSION_COOKIE]: 'tok' },
        searchParams: { offset: 'xyz' },
      }),
      makeParams(DRAFT_ID)
    );

    expect(getUploadJobsWithPlatformUploadsForDraft).toHaveBeenCalledWith('user-123', DRAFT_ID, {
      limit: 20,
      offset: 0,
    });
  });
});
