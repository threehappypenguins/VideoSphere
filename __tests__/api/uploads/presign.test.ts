/**
 * Tests for POST /api/uploads/presign
 *
 * Restores dedicated route coverage for:
 * - Authentication (401)
 * - Draft ownership (403)
 * - Successful presign + UploadJob creation (200)
 * - Internal failures (500)
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: vi.fn(),
}));

vi.mock('@/lib/r2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/r2')>();
  return {
    ...actual,
    createMultipartUpload: vi.fn(),
    abortMultipartUpload: vi.fn(async () => undefined),
    getPresignedUploadPartUrls: vi.fn(),
  };
});

vi.mock('@/lib/repositories/upload-jobs', () => ({
  createUploadJob: vi.fn(),
}));

vi.mock('@/lib/repositories/drafts', () => ({
  getDraftById: vi.fn(),
  markDraftUsedInUpload: vi.fn(),
}));

import { POST } from '@/app/api/uploads/presign/route';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import {
  abortMultipartUpload,
  createMultipartUpload,
  DEFAULT_MULTIPART_PART_SIZE_BYTES,
  getPresignedUploadPartUrls,
} from '@/lib/r2';
import { createUploadJob } from '@/lib/repositories/upload-jobs';
import { getDraftById, markDraftUsedInUpload } from '@/lib/repositories/drafts';
import type { Draft } from '@/types';

const SESSION_COOKIE = 'videosphere_session';
const MULTIPART_PART_URL_EXPIRY_SECONDS = 12 * 60 * 60;

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
    vi.stubEnv('R2_BUCKET_NAME', '');

    vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
    vi.mocked(getDraftById).mockResolvedValue(baseDraft);
    vi.mocked(createMultipartUpload).mockResolvedValue('multipart-upload-id-abc');
    vi.mocked(abortMultipartUpload).mockResolvedValue(undefined);
    vi.mocked(getPresignedUploadPartUrls).mockResolvedValue([
      { partNumber: 1, url: 'https://r2.example/part-1' },
    ]);
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

  afterEach(() => {
    vi.unstubAllEnvs();
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
    expect(createMultipartUpload).not.toHaveBeenCalled();
    expect(getPresignedUploadPartUrls).not.toHaveBeenCalled();
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
    expect(createMultipartUpload).not.toHaveBeenCalled();
    expect(getPresignedUploadPartUrls).not.toHaveBeenCalled();
    expect(createUploadJob).not.toHaveBeenCalled();
  });

  it('returns 500 when multipart presign generation fails', async () => {
    vi.mocked(createMultipartUpload).mockRejectedValueOnce(new Error('R2 unavailable'));

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
    expect(abortMultipartUpload).not.toHaveBeenCalled();
  });

  it('aborts the multipart upload when createUploadJob fails after presign succeeds', async () => {
    vi.mocked(createUploadJob).mockRejectedValueOnce(new Error('DB unavailable'));

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
    expect(abortMultipartUpload).toHaveBeenCalledWith(
      expect.stringMatching(/^temp\/uploads\/user-123\/.+\/clip\.mp4$/),
      'multipart-upload-id-abc'
    );
  });

  it('aborts the multipart upload when part URL presigning fails', async () => {
    vi.mocked(getPresignedUploadPartUrls).mockRejectedValueOnce(new Error('R2 presign failed'));

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
    expect(createUploadJob).not.toHaveBeenCalled();
    expect(abortMultipartUpload).toHaveBeenCalledWith(
      expect.stringMatching(/^temp\/uploads\/user-123\/.+\/clip\.mp4$/),
      'multipart-upload-id-abc'
    );
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

    const objectKey = 'temp/uploads/user-123/1704067200000-uuid-abc-123/clip.mp4';

    expect(createMultipartUpload).toHaveBeenCalledWith(objectKey, 'video/mp4');
    expect(getPresignedUploadPartUrls).toHaveBeenCalledWith(
      objectKey,
      'multipart-upload-id-abc',
      1,
      MULTIPART_PART_URL_EXPIRY_SECONDS
    );
    expect(createUploadJob).toHaveBeenCalledWith({
      userId: 'user-123',
      draftId: 'draft-123',
      r2Key: objectKey,
    });
    expect(markDraftUsedInUpload).toHaveBeenCalledWith('draft-123', '2026-01-01T00:00:00.000Z');

    expect(body).toEqual({
      uploadId: 'multipart-upload-id-abc',
      key: objectKey,
      bucketName: 'unknown',
      partSize: DEFAULT_MULTIPART_PART_SIZE_BYTES,
      parts: [{ partNumber: 1, url: 'https://r2.example/part-1' }],
      uploadJobId: 'job-123',
    });

    // Ensure legacy quota-era fields are not present.
    expect(body.quotaRemaining).toBeUndefined();
    expect(body.quotaResetAt).toBeUndefined();
    expect(body.isSupporter).toBeUndefined();
    expect(body.uploadUrl).toBeUndefined();
    expect(body.expiresIn).toBeUndefined();
  });
});
