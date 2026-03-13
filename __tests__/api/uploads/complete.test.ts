/**
 * Tests for POST /api/uploads/[jobId]/complete
 *
 * Verifies authentication, ownership checks, size enforcement,
 * and UploadJob status transition. Mocks external dependencies to isolate
 * endpoint logic.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Mock Appwrite — must be defined before importing the route
const mockGet = vi.fn();

vi.mock('node-appwrite', () => {
  const mockClient = {
    setEndpoint: vi.fn(function () {
      return this;
    }),
    setProject: vi.fn(function () {
      return this;
    }),
    setSession: vi.fn(function () {
      return this;
    }),
  };

  function MockAccount(client: any) {
    this.get = mockGet;
  }

  function MockClient() {
    return mockClient;
  }

  return {
    Client: MockClient,
    Account: MockAccount,
  };
});

// Mock upload-jobs repository
vi.mock('@/lib/repositories/upload-jobs', () => ({
  getUploadJobById: vi.fn(async () => ({
    id: 'job-123',
    userId: 'user-123',
    draftId: 'draft-abc',
    r2Key: 'temp/uploads/user-123/1234567890/test.mp4',
    status: 'pending',
    errorMessage: null,
    createdAt: '',
    updatedAt: '',
  })),
  updateUploadJobStatus: vi.fn(async () => ({
    id: 'job-123',
    userId: 'user-123',
    draftId: 'draft-abc',
    r2Key: 'temp/uploads/user-123/1234567890/test.mp4',
    status: 'uploading',
    errorMessage: null,
    createdAt: '',
    updatedAt: '',
  })),
}));

// Mock R2 — headObject returns a small size by default (well within the 5 GB limit)
// importOriginal is used so that the real R2ObjectNotFoundError class is available
// alongside the mocked function implementations.
vi.mock('@/lib/r2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/r2')>();
  return {
    ...actual,
    headObject: vi.fn(async () => 1024),
    deleteObject: vi.fn(async () => undefined),
  };
});

import { POST } from '@/app/api/uploads/[jobId]/complete/route';
import { getUploadJobById, updateUploadJobStatus } from '@/lib/repositories/upload-jobs';
import { headObject, deleteObject, R2ObjectNotFoundError } from '@/lib/r2';

function createRequest(jobId: string, cookies: Record<string, string> = {}): NextRequest {
  const url = new URL(`http://localhost:3000/api/uploads/${jobId}/complete`);

  const cookieHeader = Object.entries(cookies)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');

  const init: RequestInit = {
    method: 'POST',
    headers: cookieHeader ? { Cookie: cookieHeader } : {},
  };

  return new NextRequest(url, init);
}

function makeParams(jobId: string) {
  return { params: Promise.resolve({ jobId }) };
}

describe('POST /api/uploads/[jobId]/complete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT = 'http://localhost/v1';
    process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID = 'test-project';

    mockGet.mockResolvedValue({ $id: 'user-123' });
    vi.mocked(headObject).mockResolvedValue(1024);
    vi.mocked(deleteObject).mockResolvedValue(undefined);
    vi.mocked(getUploadJobById).mockResolvedValue({
      id: 'job-123',
      userId: 'user-123',
      draftId: 'draft-abc',
      r2Key: 'temp/uploads/user-123/1234567890/test.mp4',
      status: 'pending',
      errorMessage: null,
      createdAt: '',
      updatedAt: '',
    });
    vi.mocked(updateUploadJobStatus).mockResolvedValue({
      id: 'job-123',
      userId: 'user-123',
      draftId: 'draft-abc',
      r2Key: 'temp/uploads/user-123/1234567890/test.mp4',
      status: 'uploading',
      errorMessage: null,
      createdAt: '',
      updatedAt: '',
    });
  });

  describe('Authentication', () => {
    it('should return 401 when not authenticated (no session cookie)', async () => {
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
        createRequest('job-123', { 'a_session_test-project': 'token' }),
        makeParams('job-123')
      );

      expect(response.status).toBe(200);
    });
  });

  describe('Ownership checks', () => {
    it('should return 404 when upload job does not exist', async () => {
      vi.mocked(getUploadJobById).mockResolvedValueOnce(null);

      const response = await POST(
        createRequest('nonexistent', { 'a_session_test-project': 'token' }),
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
        createdAt: '',
        updatedAt: '',
      });

      const response = await POST(
        createRequest('job-other', { 'a_session_test-project': 'token' }),
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
        createRequest('job-123', { 'a_session_test-project': 'token' }),
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
        createRequest('job-123', { 'a_session_test-project': 'token' }),
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
        createdAt: '',
        updatedAt: '',
      });

      const response = await POST(
        createRequest('job-123', { 'a_session_test-project': 'token' }),
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
        createRequest('job-123', { 'a_session_test-project': 'token' }),
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
        createRequest('job-123', { 'a_session_test-project': 'token' }),
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
        createdAt: '',
        updatedAt: '',
      });

      const response = await POST(
        createRequest('job-123', { 'a_session_test-project': 'token' }),
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
        createdAt: '',
        updatedAt: '',
      });

      const response = await POST(
        createRequest('job-123', { 'a_session_test-project': 'token' }),
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
        createdAt: '',
        updatedAt: '',
      });

      const response = await POST(
        createRequest('job-123', { 'a_session_test-project': 'token' }),
        makeParams('job-123')
      );

      expect(response.status).toBe(409);
      expect(vi.mocked(updateUploadJobStatus)).not.toHaveBeenCalled();
    });

    it('should advance status to uploading after successful completion', async () => {
      await POST(
        createRequest('job-123', { 'a_session_test-project': 'token' }),
        makeParams('job-123')
      );

      expect(vi.mocked(updateUploadJobStatus)).toHaveBeenCalledWith('job-123', 'uploading');
    });

    it('should return success: true in response body', async () => {
      const response = await POST(
        createRequest('job-123', { 'a_session_test-project': 'token' }),
        makeParams('job-123')
      );

      const body = await response.json();
      expect(body).toEqual({ success: true });
    });

    it('should return 404 when the job is deleted between ownership check and status update', async () => {
      // updateUploadJobStatus returns null when Appwrite returns 404 (row deleted mid-flight)
      vi.mocked(updateUploadJobStatus).mockResolvedValueOnce(null);

      const response = await POST(
        createRequest('job-123', { 'a_session_test-project': 'token' }),
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
        createRequest('job-123', { 'a_session_test-project': 'token' }),
        makeParams('job-123')
      );

      expect(response.status).toBe(500);
    });
  });
});
