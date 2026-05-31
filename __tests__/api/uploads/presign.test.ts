/**
 * Tests for POST /api/uploads/presign
 *
 * Restores dedicated route coverage for:
 * - Authentication (401)
 * - Draft ownership (403)
 * - Successful presign + UploadJob creation (200)
 * - Internal failures (500)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: vi.fn(),
}));

vi.mock('@/lib/r2', () => ({
  getPresignedUploadUrl: vi.fn(),
}));

vi.mock('@/lib/repositories/upload-jobs', () => ({
  createUploadJob: vi.fn(),
}));

vi.mock('@/lib/repositories/drafts', () => ({
  getDraftById: vi.fn(),
  markDraftUsedInUpload: vi.fn(),
}));

import { POST } from '@/app/api/uploads/presign/route';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getPresignedUploadUrl } from '@/lib/r2';
import { createUploadJob } from '@/lib/repositories/upload-jobs';
import { getDraftById, markDraftUsedInUpload } from '@/lib/repositories/drafts';
import type { Draft } from '@/types';

const SESSION_COOKIE = 'videosphere_session';

const baseDraft: Draft = {
  id: 'draft-123',
  userId: 'user-123',
  title: 'My draft',
  description: 'desc',
  tags: ['tag'],
  visibility: 'public' as const,
  targets: ['youtube'],
  platforms: {},
  $createdAt: '2026-01-01T00:00:00.000Z',
  $updatedAt: '2026-01-01T00:00:00.000Z',
};

function createRequest(body: unknown, cookies: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/uploads/presign');
  const cookieHeader = Object.entries(cookies)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');

  return new NextRequest(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/uploads/presign', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
    vi.mocked(getDraftById).mockResolvedValue(baseDraft);
    vi.mocked(getPresignedUploadUrl).mockResolvedValue('https://r2.example/presigned-put-url');
    vi.mocked(createUploadJob).mockResolvedValue({
      id: 'job-123',
      userId: 'user-123',
      draftId: 'draft-123',
      r2Key: 'temp/uploads/user-123/1704067200000/clip.mp4',
      status: 'pending',
      errorMessage: null,
      $createdAt: '2026-01-01T00:00:00.000Z',
      $updatedAt: '2026-01-01T00:00:00.000Z',
    });
    vi.mocked(markDraftUsedInUpload).mockResolvedValue(undefined);
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(null);

    const res = await POST(
      createRequest(
        {
          fileName: 'clip.mp4',
          contentType: 'video/mp4',
          fileSize: 1024,
          draftId: 'draft-123',
        },
        { [`${SESSION_COOKIE}`]: 'token' }
      )
    );

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/Unauthorized/i);
    expect(getDraftById).not.toHaveBeenCalled();
    expect(getPresignedUploadUrl).not.toHaveBeenCalled();
    expect(createUploadJob).not.toHaveBeenCalled();
  });

  it('returns 403 when draft is owned by another user', async () => {
    vi.mocked(getDraftById).mockResolvedValueOnce({
      ...baseDraft,
      userId: 'other-user',
    });

    const res = await POST(
      createRequest(
        {
          fileName: 'clip.mp4',
          contentType: 'video/mp4',
          fileSize: 4096,
          draftId: 'draft-123',
        },
        { [`${SESSION_COOKIE}`]: 'token' }
      )
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Forbidden');
    expect(getPresignedUploadUrl).not.toHaveBeenCalled();
    expect(createUploadJob).not.toHaveBeenCalled();
  });

  it('returns 500 when presign generation fails', async () => {
    vi.mocked(getPresignedUploadUrl).mockRejectedValueOnce(new Error('R2 unavailable'));

    const res = await POST(
      createRequest(
        {
          fileName: 'clip.mp4',
          contentType: 'video/mp4',
          fileSize: 4096,
          draftId: 'draft-123',
        },
        { [`${SESSION_COOKIE}`]: 'token' }
      )
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('Failed to generate upload URL');
    expect(createUploadJob).not.toHaveBeenCalled();
  });

  it('returns 200 and creates UploadJob for valid non-quota flow', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1704067200000);
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('uuid-abc-123');

    const res = await POST(
      createRequest(
        {
          fileName: 'clip.mp4',
          contentType: 'video/mp4',
          fileSize: 1024 * 1024,
          draftId: 'draft-123',
        },
        { [`${SESSION_COOKIE}`]: 'token' }
      )
    );

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(getPresignedUploadUrl).toHaveBeenCalledWith(
      'temp/uploads/user-123/1704067200000-uuid-abc-123/clip.mp4',
      'video/mp4',
      1024 * 1024
    );
    expect(createUploadJob).toHaveBeenCalledWith({
      userId: 'user-123',
      draftId: 'draft-123',
      r2Key: 'temp/uploads/user-123/1704067200000-uuid-abc-123/clip.mp4',
    });
    expect(markDraftUsedInUpload).toHaveBeenCalledWith('draft-123', '2026-01-01T00:00:00.000Z');

    expect(body).toEqual({
      uploadUrl: 'https://r2.example/presigned-put-url',
      key: 'temp/uploads/user-123/1704067200000-uuid-abc-123/clip.mp4',
      bucketName: 'unknown',
      expiresIn: 900,
      uploadJobId: 'job-123',
    });

    // Ensure legacy quota-era fields are not present.
    expect(body.quotaRemaining).toBeUndefined();
    expect(body.quotaResetAt).toBeUndefined();
    expect(body.isSupporter).toBeUndefined();
  });
});
