/**
 * Tests for POST /api/uploads/[jobId]/complete
 *
 * Verifies authentication, ownership checks, quota increment behaviour,
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

// Mock user repository
vi.mock('@/lib/repositories/users', () => ({
  getUserById: vi.fn(async () => ({ userId: 'user-123', isSupporter: false })),
}));

// Mock upload-usage repository
vi.mock('@/lib/repositories/upload-usage', () => ({
  incrementUsageIfAllowed: vi.fn(async () => ({ allowed: true, monthlyUsage: 5 })),
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
vi.mock('@/lib/r2', () => ({
  headObject: vi.fn(async () => 1024),
  deleteObject: vi.fn(async () => undefined),
}));

import { POST } from '@/app/api/uploads/[jobId]/complete/route';
import { incrementUsageIfAllowed } from '@/lib/repositories/upload-usage';
import { getUserById } from '@/lib/repositories/users';
import { getUploadJobById, updateUploadJobStatus } from '@/lib/repositories/upload-jobs';
import { headObject, deleteObject } from '@/lib/r2';

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
    vi.mocked(getUserById).mockResolvedValue({
      userId: 'user-123',
      isSupporter: false,
      email: 'test@example.com',
      role: 'user',
      createdAt: '',
      updatedAt: '',
    });
    vi.mocked(incrementUsageIfAllowed).mockResolvedValue({ allowed: true, monthlyUsage: 5 });
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
      expect(vi.mocked(incrementUsageIfAllowed)).not.toHaveBeenCalled();
      expect(vi.mocked(updateUploadJobStatus)).not.toHaveBeenCalled();
    });
  });

  describe('Quota enforcement', () => {
    it('should return 200 when incrementUsageIfAllowed allows the upload', async () => {
      const response = await POST(
        createRequest('job-123', { 'a_session_test-project': 'token' }),
        makeParams('job-123')
      );

      expect(response.status).toBe(200);
      expect(vi.mocked(incrementUsageIfAllowed)).toHaveBeenCalledWith('user-123', false);
    });

    it('should return 403 with quota body when limit is reached', async () => {
      vi.mocked(incrementUsageIfAllowed).mockResolvedValueOnce({
        allowed: false,
        monthlyUsage: 10,
      });

      const response = await POST(
        createRequest('job-123', { 'a_session_test-project': 'token' }),
        makeParams('job-123')
      );

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain('Upload limit reached');
      expect(body.monthlyUsage).toBe(10);
      expect(body.limit).toBe(10);
    });

    it('should not advance job status when quota is exceeded', async () => {
      vi.mocked(incrementUsageIfAllowed).mockResolvedValueOnce({
        allowed: false,
        monthlyUsage: 10,
      });

      await POST(
        createRequest('job-123', { 'a_session_test-project': 'token' }),
        makeParams('job-123')
      );

      expect(vi.mocked(updateUploadJobStatus)).not.toHaveBeenCalled();
    });

    it('should pass isSupporter=true to incrementUsageIfAllowed for supporters', async () => {
      vi.mocked(getUserById).mockResolvedValueOnce({
        userId: 'user-123',
        isSupporter: true,
        email: 'supporter@example.com',
        role: 'user',
        createdAt: '',
        updatedAt: '',
      });

      const response = await POST(
        createRequest('job-123', { 'a_session_test-project': 'token' }),
        makeParams('job-123')
      );

      expect(response.status).toBe(200);
      expect(vi.mocked(incrementUsageIfAllowed)).toHaveBeenCalledWith('user-123', true);
    });

    it('should default to isSupporter=false when getUserById returns null', async () => {
      vi.mocked(getUserById).mockResolvedValueOnce(null);

      const response = await POST(
        createRequest('job-123', { 'a_session_test-project': 'token' }),
        makeParams('job-123')
      );

      expect(response.status).toBe(200);
      expect(vi.mocked(incrementUsageIfAllowed)).toHaveBeenCalledWith('user-123', false);
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
      expect(vi.mocked(incrementUsageIfAllowed)).not.toHaveBeenCalled();
      expect(vi.mocked(updateUploadJobStatus)).not.toHaveBeenCalled();
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
      expect(vi.mocked(incrementUsageIfAllowed)).not.toHaveBeenCalled();
    });
  });

  describe('UploadJob status transition', () => {
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
  });

  describe('Error handling', () => {
    it('should return 500 when incrementUsageIfAllowed throws', async () => {
      vi.mocked(incrementUsageIfAllowed).mockRejectedValueOnce(new Error('DB error'));

      const response = await POST(
        createRequest('job-123', { 'a_session_test-project': 'token' }),
        makeParams('job-123')
      );

      expect(response.status).toBe(500);
    });

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
