/**
 * Tests for POST /api/uploads/[jobId]/complete
 *
 * Verifies authentication, ownership checks, size enforcement,
 * and UploadJob status transition. Mocks external dependencies to isolate
 * endpoint logic.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetAuthenticatedUserId = vi.fn();

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: (...args: unknown[]) => mockGetAuthenticatedUserId(...args),
}));

// Mock upload-jobs repository
vi.mock('@/lib/repositories/upload-jobs', () => ({
  getUploadJobById: vi.fn(async () => ({
    id: 'job-123',
    userId: 'user-123',
    draftId: 'draft-abc',
    r2Key: 'temp/uploads/user-123/1234567890/test.mp4',
    status: 'pending',
    errorMessage: null,
    $createdAt: '2000-01-01T00:00:00.000Z',
    $updatedAt: '2000-01-01T00:00:00.000Z',
  })),
  updateUploadJobStatus: vi.fn(async () => ({
    id: 'job-123',
    userId: 'user-123',
    draftId: 'draft-abc',
    r2Key: 'temp/uploads/user-123/1234567890/test.mp4',
    status: 'uploading',
    errorMessage: null,
    $createdAt: '2000-01-01T00:00:00.000Z',
    $updatedAt: '2000-01-01T00:00:00.000Z',
  })),
}));

// Mock R2 — headObject returns a small size by default (well within the 5 GB limit)
// importOriginal is used so that the real R2ObjectNotFoundError class is available
// alongside the mocked function implementations.
vi.mock('@/lib/r2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/r2')>();
  return {
    ...actual,
    completeMultipartUpload: vi.fn(async () => undefined),
    abortMultipartUpload: vi.fn(async () => undefined),
    headObject: vi.fn(async () => 1024),
    deleteObject: vi.fn(async () => undefined),
  };
});

// Mock drafts repository (needed for auto-distribution)
vi.mock('@/lib/repositories/drafts', () => ({
  getDraftById: vi.fn(async () => ({
    id: 'draft-abc',
    userId: 'user-123',
    targets: ['youtube'],
    title: 'Test Video',
    description: 'desc',
    tags: ['tag1'],
    visibility: 'public',
    platforms: {},
    $createdAt: '2000-01-01T00:00:00.000Z',
    $updatedAt: '2000-01-01T00:00:00.000Z',
  })),
}));

// Mock platform-uploads repository
vi.mock('@/lib/repositories/platform-uploads', () => ({
  ensurePlatformUploadsForJobTargets: vi.fn(async () => [
    {
      id: 'pu-1',
      uploadJobId: 'job-123',
      platform: 'youtube',
      status: 'pending',
      platformVideoId: '',
      platformUrl: '',
      title: 'Test Video',
      description: 'desc',
      tags: ['tag1'],
      visibility: 'public',
      scheduledAt: null,
      errorMessage: null,
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    },
  ]),
}));

// Mock shared distribute module — prevents actual platform uploads during tests
vi.mock('@/lib/api/distribute', () => ({
  distributeCreatePlatformUploadInput: vi.fn(() => ({
    uploadJobId: 'job-123',
    platform: 'youtube',
    title: 'Test Video',
    description: 'desc',
    tags: ['tag1'],
    visibility: 'public',
  })),
  runDistributionInBackground: vi.fn(async () => undefined),
}));

// Mock draft-upload-metadata
vi.mock('@/lib/draft-upload-metadata', () => ({
  buildMetadataForPlatform: vi.fn(() => ({
    title: 'Test Video',
    description: 'desc',
    tags: ['tag1'],
    visibility: 'public',
  })),
}));

// Mock after() to prevent "outside request scope" errors — keeps all other
// next/server exports (NextRequest, NextResponse, etc.) intact.
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: vi.fn() };
});

import { POST } from '@/app/api/uploads/[jobId]/complete/route';
import { getUploadJobById, updateUploadJobStatus } from '@/lib/repositories/upload-jobs';
import {
  completeMultipartUpload,
  abortMultipartUpload,
  headObject,
  deleteObject,
  MAX_MULTIPART_PART_COUNT,
  R2ObjectNotFoundError,
} from '@/lib/r2';
import { getDraftById } from '@/lib/repositories/drafts';

const SESSION_COOKIE = 'videosphere_session';

const validMultipartBody = {
  uploadId: 'multipart-upload-id-abc',
  parts: [{ partNumber: 1, eTag: '"etag-part-1"' }],
};

function createRequest(
  jobId: string,
  cookies: Record<string, string> = {},
  body: unknown = validMultipartBody
): NextRequest {
  const url = new URL(`http://localhost:3000/api/uploads/${jobId}/complete`);

  const cookieHeader = Object.entries(cookies)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');

  const init: RequestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    body: JSON.stringify(body),
  };

  return new NextRequest(url, init);
}

function makeParams(jobId: string) {
  return { params: Promise.resolve({ jobId }) };
}

describe('POST /api/uploads/[jobId]/complete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthenticatedUserId.mockResolvedValue('user-123');

    vi.mocked(completeMultipartUpload).mockResolvedValue(undefined);
    vi.mocked(abortMultipartUpload).mockResolvedValue(undefined);
    vi.mocked(headObject).mockResolvedValue(1024);
    vi.mocked(deleteObject).mockResolvedValue(undefined);
    vi.mocked(getUploadJobById).mockResolvedValue({
      id: 'job-123',
      userId: 'user-123',
      draftId: 'draft-abc',
      r2Key: 'temp/uploads/user-123/1234567890/test.mp4',
      status: 'pending',
      errorMessage: null,
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    });
    vi.mocked(updateUploadJobStatus).mockResolvedValue({
      id: 'job-123',
      userId: 'user-123',
      draftId: 'draft-abc',
      r2Key: 'temp/uploads/user-123/1234567890/test.mp4',
      status: 'uploading',
      errorMessage: null,
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    });
  });

  describe('Multipart completion body', () => {
    it('returns 400 when uploadId is missing', async () => {
      const response = await POST(
        createRequest(
          'job-123',
          { videosphere_session: 'token' },
          { parts: [{ partNumber: 1, eTag: '"etag-1"' }] }
        ),
        makeParams('job-123')
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('uploadId');
      expect(vi.mocked(completeMultipartUpload)).not.toHaveBeenCalled();
      expect(vi.mocked(headObject)).not.toHaveBeenCalled();
    });

    it('returns 400 when parts is empty', async () => {
      const response = await POST(
        createRequest(
          'job-123',
          { videosphere_session: 'token' },
          { uploadId: 'multipart-upload-id-abc', parts: [] }
        ),
        makeParams('job-123')
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('parts');
      expect(vi.mocked(completeMultipartUpload)).not.toHaveBeenCalled();
      expect(vi.mocked(headObject)).not.toHaveBeenCalled();
    });

    it('returns 400 when parts exceeds the S3/R2 maximum part count', async () => {
      const response = await POST(
        createRequest(
          'job-123',
          { videosphere_session: 'token' },
          {
            uploadId: 'multipart-upload-id-abc',
            parts: Array.from({ length: MAX_MULTIPART_PART_COUNT + 1 }, (_, index) => ({
              partNumber: index + 1,
              eTag: '"etag"',
            })),
          }
        ),
        makeParams('job-123')
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain(String(MAX_MULTIPART_PART_COUNT));
      expect(vi.mocked(completeMultipartUpload)).not.toHaveBeenCalled();
      expect(vi.mocked(headObject)).not.toHaveBeenCalled();
    });

    it('returns 400 when a part has an invalid eTag', async () => {
      const response = await POST(
        createRequest(
          'job-123',
          { videosphere_session: 'token' },
          {
            uploadId: 'multipart-upload-id-abc',
            parts: [{ partNumber: 1, eTag: '' }],
          }
        ),
        makeParams('job-123')
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('eTag');
      expect(vi.mocked(completeMultipartUpload)).not.toHaveBeenCalled();
      expect(vi.mocked(headObject)).not.toHaveBeenCalled();
    });

    it('returns 400 when a partNumber exceeds the S3/R2 maximum of 10,000', async () => {
      const response = await POST(
        createRequest(
          'job-123',
          { videosphere_session: 'token' },
          {
            uploadId: 'multipart-upload-id-abc',
            parts: [{ partNumber: MAX_MULTIPART_PART_COUNT + 1, eTag: '"etag-1"' }],
          }
        ),
        makeParams('job-123')
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain(String(MAX_MULTIPART_PART_COUNT));
      expect(vi.mocked(completeMultipartUpload)).not.toHaveBeenCalled();
      expect(vi.mocked(headObject)).not.toHaveBeenCalled();
    });

    it('returns 400 when parts contains duplicate partNumber values', async () => {
      const response = await POST(
        createRequest(
          'job-123',
          { videosphere_session: 'token' },
          {
            uploadId: 'multipart-upload-id-abc',
            parts: [
              { partNumber: 1, eTag: '"etag-1"' },
              { partNumber: 2, eTag: '"etag-2"' },
              { partNumber: 1, eTag: '"etag-1-dup"' },
            ],
          }
        ),
        makeParams('job-123')
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('duplicate partNumber');
      expect(body.error).toContain('1');
      expect(vi.mocked(completeMultipartUpload)).not.toHaveBeenCalled();
      expect(vi.mocked(headObject)).not.toHaveBeenCalled();
    });

    it('marks the job failed and skips headObject when multipart completion fails', async () => {
      vi.mocked(completeMultipartUpload).mockRejectedValueOnce(
        new Error(
          'Failed to complete multipart upload for key "temp/uploads/user-123/1234567890/test.mp4": InvalidPart'
        )
      );

      const response = await POST(
        createRequest('job-123', { videosphere_session: 'token' }),
        makeParams('job-123')
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('Multipart upload completion failed');
      expect(vi.mocked(completeMultipartUpload)).toHaveBeenCalledWith(
        'temp/uploads/user-123/1234567890/test.mp4',
        'multipart-upload-id-abc',
        [{ partNumber: 1, eTag: '"etag-part-1"' }]
      );
      expect(vi.mocked(abortMultipartUpload)).toHaveBeenCalledWith(
        'temp/uploads/user-123/1234567890/test.mp4',
        'multipart-upload-id-abc'
      );
      expect(vi.mocked(updateUploadJobStatus)).toHaveBeenCalledWith(
        'job-123',
        'failed',
        expect.stringContaining('Multipart upload completion failed')
      );
      expect(vi.mocked(headObject)).not.toHaveBeenCalled();
    });

    it('returns 500 and marks the job failed on storage errors during multipart completion', async () => {
      vi.mocked(completeMultipartUpload).mockRejectedValueOnce(
        new Error(
          'Failed to complete multipart upload for key "temp/uploads/user-123/1234567890/test.mp4": ServiceUnavailable'
        )
      );

      const response = await POST(
        createRequest('job-123', { videosphere_session: 'token' }),
        makeParams('job-123')
      );

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toContain('storage error');
      expect(vi.mocked(abortMultipartUpload)).toHaveBeenCalledWith(
        'temp/uploads/user-123/1234567890/test.mp4',
        'multipart-upload-id-abc'
      );
      expect(vi.mocked(updateUploadJobStatus)).toHaveBeenCalledWith(
        'job-123',
        'failed',
        expect.stringContaining('storage error')
      );
      expect(vi.mocked(headObject)).not.toHaveBeenCalled();
    });
  });

  describe('Authentication', () => {
    it('should return 401 when not authenticated (no session cookie)', async () => {
      mockGetAuthenticatedUserId.mockResolvedValueOnce(null);
      const response = await POST(
        createRequest('job-123'), // no cookies
        makeParams('job-123')
      );

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toContain('Please log in');
    });

    it('should return 200 with valid session', async () => {
      const response = await POST(
        createRequest('job-123', { videosphere_session: 'token' }),
        makeParams('job-123')
      );

      expect(response.status).toBe(200);
    });
  });

  describe('Ownership checks', () => {
    it('should return 404 when upload job does not exist', async () => {
      vi.mocked(getUploadJobById).mockResolvedValueOnce(null);

      const response = await POST(
        createRequest('nonexistent', { videosphere_session: 'token' }),
        makeParams('nonexistent')
      );

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toContain('not found');
    });

    it('should return 403 when upload job belongs to a different user', async () => {
      vi.mocked(getUploadJobById).mockResolvedValueOnce({
        id: 'job-other',
        userId: 'other-user-999',
        draftId: null,
        r2Key: 'temp/uploads/other-user-999/123/file.mp4',
        status: 'pending',
        errorMessage: null,
        $createdAt: '2000-01-01T00:00:00.000Z',
        $updatedAt: '2000-01-01T00:00:00.000Z',
      });

      const response = await POST(
        createRequest('job-other', { videosphere_session: 'token' }),
        makeParams('job-other')
      );

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain('Forbidden');
      expect(vi.mocked(updateUploadJobStatus)).not.toHaveBeenCalled();
    });
  });

  describe('Size enforcement', () => {
    const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024;

    it('should return 400 and delete the object when actual size exceeds 5 GB', async () => {
      vi.mocked(headObject).mockResolvedValueOnce(MAX_FILE_SIZE + 1);

      const response = await POST(
        createRequest('job-123', { videosphere_session: 'token' }),
        makeParams('job-123')
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('5 GB');
      expect(vi.mocked(deleteObject)).toHaveBeenCalledWith(
        'temp/uploads/user-123/1234567890/test.mp4'
      );
      expect(vi.mocked(updateUploadJobStatus)).toHaveBeenCalledWith(
        'job-123',
        'failed',
        'Uploaded file exceeds the 5 GB maximum size limit'
      );
    });

    it('should proceed normally when actual size is exactly at the 5 GB limit', async () => {
      vi.mocked(headObject).mockResolvedValueOnce(MAX_FILE_SIZE);

      const response = await POST(
        createRequest('job-123', { videosphere_session: 'token' }),
        makeParams('job-123')
      );

      expect(response.status).toBe(200);
      expect(vi.mocked(deleteObject)).not.toHaveBeenCalled();
    });

    it('should return 400 when the upload job has no r2Key', async () => {
      vi.mocked(getUploadJobById).mockResolvedValueOnce({
        id: 'job-123',
        userId: 'user-123',
        draftId: 'draft-abc',
        r2Key: null,
        status: 'pending',
        errorMessage: null,
        $createdAt: '2000-01-01T00:00:00.000Z',
        $updatedAt: '2000-01-01T00:00:00.000Z',
      });

      const response = await POST(
        createRequest('job-123', { videosphere_session: 'token' }),
        makeParams('job-123')
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('R2 object key');
      expect(vi.mocked(updateUploadJobStatus)).not.toHaveBeenCalled();
    });

    it('should return 404 and mark job failed when object is absent from R2', async () => {
      vi.mocked(headObject).mockRejectedValueOnce(
        new R2ObjectNotFoundError('temp/uploads/user-123/1234567890/test.mp4')
      );

      const response = await POST(
        createRequest('job-123', { videosphere_session: 'token' }),
        makeParams('job-123')
      );

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toContain('not found in storage');
      expect(vi.mocked(updateUploadJobStatus)).toHaveBeenCalledWith(
        'job-123',
        'failed',
        expect.stringContaining('not found in R2')
      );
      expect(vi.mocked(deleteObject)).not.toHaveBeenCalled();
    });

    it('should log and still return 404 when marking job failed throws after R2 not-found', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(headObject).mockRejectedValueOnce(
        new R2ObjectNotFoundError('temp/uploads/user-123/1234567890/test.mp4')
      );
      vi.mocked(updateUploadJobStatus).mockRejectedValueOnce(new Error('DB unavailable'));

      const response = await POST(
        createRequest('job-123', { videosphere_session: 'token' }),
        makeParams('job-123')
      );

      expect(response.status).toBe(404);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('job-123'),
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });
  });

  describe('UploadJob status transition', () => {
    it('should return 409 when the job is already in uploading state', async () => {
      vi.mocked(getUploadJobById).mockResolvedValueOnce({
        id: 'job-123',
        userId: 'user-123',
        draftId: 'draft-abc',
        r2Key: 'temp/uploads/user-123/1234567890/test.mp4',
        status: 'uploading',
        errorMessage: null,
        $createdAt: '2000-01-01T00:00:00.000Z',
        $updatedAt: '2000-01-01T00:00:00.000Z',
      });

      const response = await POST(
        createRequest('job-123', { videosphere_session: 'token' }),
        makeParams('job-123')
      );

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error).toContain('uploading');
      expect(vi.mocked(updateUploadJobStatus)).not.toHaveBeenCalled();
    });

    it('should return 409 when the job is already completed', async () => {
      vi.mocked(getUploadJobById).mockResolvedValueOnce({
        id: 'job-123',
        userId: 'user-123',
        draftId: 'draft-abc',
        r2Key: 'temp/uploads/user-123/1234567890/test.mp4',
        status: 'completed',
        errorMessage: null,
        $createdAt: '2000-01-01T00:00:00.000Z',
        $updatedAt: '2000-01-01T00:00:00.000Z',
      });

      const response = await POST(
        createRequest('job-123', { videosphere_session: 'token' }),
        makeParams('job-123')
      );

      expect(response.status).toBe(409);
      expect(vi.mocked(updateUploadJobStatus)).not.toHaveBeenCalled();
    });

    it('should return 409 when the job has previously failed', async () => {
      vi.mocked(getUploadJobById).mockResolvedValueOnce({
        id: 'job-123',
        userId: 'user-123',
        draftId: 'draft-abc',
        r2Key: 'temp/uploads/user-123/1234567890/test.mp4',
        status: 'failed',
        errorMessage: 'previous failure',
        $createdAt: '2000-01-01T00:00:00.000Z',
        $updatedAt: '2000-01-01T00:00:00.000Z',
      });

      const response = await POST(
        createRequest('job-123', { videosphere_session: 'token' }),
        makeParams('job-123')
      );

      expect(response.status).toBe(409);
      expect(vi.mocked(updateUploadJobStatus)).not.toHaveBeenCalled();
    });

    it('should advance status to distributing and auto-distribute when draft has targets', async () => {
      await POST(createRequest('job-123', { videosphere_session: 'token' }), makeParams('job-123'));

      expect(vi.mocked(completeMultipartUpload)).toHaveBeenCalledWith(
        'temp/uploads/user-123/1234567890/test.mp4',
        'multipart-upload-id-abc',
        [{ partNumber: 1, eTag: '"etag-part-1"' }]
      );
      expect(vi.mocked(updateUploadJobStatus)).toHaveBeenCalledWith(
        'job-123',
        'distributing',
        null
      );
    });

    it('should return success: true and distributing: true in response body', async () => {
      const response = await POST(
        createRequest('job-123', { videosphere_session: 'token' }),
        makeParams('job-123')
      );

      const body = await response.json();
      expect(body).toEqual({ success: true, distributing: true });
    });

    it('should fall back to uploading when draft has no targets', async () => {
      vi.mocked(getDraftById).mockResolvedValueOnce({
        id: 'draft-abc',
        userId: 'user-123',
        targets: [],
        title: 'Test Video',
        description: 'desc',
        tags: ['tag1'],
        visibility: 'public',
        platforms: {},
        $createdAt: '2000-01-01T00:00:00.000Z',
        $updatedAt: '2000-01-01T00:00:00.000Z',
      });

      const response = await POST(
        createRequest('job-123', { videosphere_session: 'token' }),
        makeParams('job-123')
      );

      const body = await response.json();
      expect(body).toEqual({ success: true, distributing: false });
      expect(vi.mocked(updateUploadJobStatus)).toHaveBeenCalledWith('job-123', 'uploading');
    });

    it('should return 404 when the job is deleted between ownership check and status update', async () => {
      // updateUploadJobStatus returns null when the row is deleted mid-flight
      vi.mocked(updateUploadJobStatus).mockResolvedValueOnce(null);

      const response = await POST(
        createRequest('job-123', { [SESSION_COOKIE]: 'token' }),
        makeParams('job-123')
      );

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toContain('no longer exists');
    });
  });

  describe('Error handling', () => {
    it('should return 500 when updateUploadJobStatus throws', async () => {
      vi.mocked(updateUploadJobStatus).mockRejectedValueOnce(new Error('DB error'));

      const response = await POST(
        createRequest('job-123', { videosphere_session: 'token' }),
        makeParams('job-123')
      );

      expect(response.status).toBe(500);
    });
  });
});
