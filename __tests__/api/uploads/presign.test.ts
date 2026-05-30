/**
 * Tests for POST /api/uploads/presign
 *
 * Tests request validation, authentication, upload quota, and presigned URL generation.
 * Mocks external dependencies (Appwrite, R2, repositories) to isolate endpoint logic.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetAuthenticatedUserId = vi.fn();

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: (...args: unknown[]) => mockGetAuthenticatedUserId(...args),
}));

// Mock R2 library
vi.mock('@/lib/r2', () => ({
  getPresignedUploadUrl: vi.fn(async (key: string) => {
    return `https://r2.example.com/upload/${encodeURIComponent(key)}?signature=test`;
  }),
}));

// Mock user repository
vi.mock('@/lib/repositories/users', () => ({
  getUserById: vi.fn(async () => ({
    userId: 'user-123',
    email: 'user@example.com',
    isSupporter: false,
    hasCompletedOnboarding: true,
    role: 'user' as const,
    $createdAt: '2000-01-01T00:00:00.000Z',
    $updatedAt: '2000-01-01T00:00:00.000Z',
  })),
}));

// Mock upload-usage repository (usageMonth must match presign rollback / tests)
vi.mock('@/lib/repositories/upload-usage', () => ({
  incrementUsageIfAllowed: vi.fn(async () => ({
    allowed: true,
    monthlyUsage: 5,
    usageMonth: '2000-01',
  })),
  decrementUsage: vi.fn(async () => undefined),
}));

// Mock drafts repository
vi.mock('@/lib/repositories/drafts', () => ({
  getDraftById: vi.fn(async () => ({
    id: 'draft-abc',
    userId: 'user-123',
    targets: ['youtube'] as const,
    title: 'Test Draft',
    description: '',
    tags: [] as string[],
    visibility: 'private' as const,
    platforms: {},
    $createdAt: '2000-01-01T00:00:00.000Z',
    $updatedAt: '2000-01-01T00:00:00.000Z',
  })),
  markDraftUsedInUpload: vi.fn(async () => null),
}));

// Mock upload-jobs repository
vi.mock('@/lib/repositories/upload-jobs', () => ({
  createUploadJob: vi.fn(async () => ({
    id: 'job-123',
    userId: 'user-123',
    draftId: null,
    r2Key: 'temp/uploads/user-123/1234567890/test.mp4',
    status: 'pending',
    errorMessage: null,
    $createdAt: '2000-01-01T00:00:00.000Z',
    $updatedAt: '2000-01-01T00:00:00.000Z',
  })),
}));

import { POST } from '@/app/api/uploads/presign/route';
import { getPresignedUploadUrl } from '@/lib/r2';
import { incrementUsageIfAllowed, decrementUsage } from '@/lib/repositories/upload-usage';
import { getUserById } from '@/lib/repositories/users';
import { createUploadJob } from '@/lib/repositories/upload-jobs';
import { getDraftById, markDraftUsedInUpload } from '@/lib/repositories/drafts';

function createRequest(
  body: Record<string, unknown>,
  cookies: Record<string, string> = {}
): NextRequest {
  const url = new URL('http://localhost:3000/api/uploads/presign');

  // Build cookie header string
  const cookieHeader = Object.entries(cookies)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');

  const init: RequestInit = {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
    },
  };

  // Only add cookie header if cookies exist
  if (cookieHeader) {
    init.headers = {
      ...init.headers,
      Cookie: cookieHeader,
    };
  }

  return new NextRequest(url, init);
}

describe('POST /api/uploads/presign', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT = 'http://localhost/v1';
    process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID = 'test-project';
    process.env.R2_BUCKET_NAME = 'test-bucket';

    // Default: mimic helper behavior from real JWT cookie auth.
    mockGetAuthenticatedUserId.mockImplementation(async (req: NextRequest) => {
      const token =
        req.cookies.get('videosphere_session')?.value ??
        req.cookies.get('a_session_test-project')?.value;
      if (!token || /bad|invalid|expired/i.test(token)) return null;
      return req.headers.get('x-test-user-id') || 'user-123';
    });
    vi.mocked(getUserById).mockResolvedValue({
      userId: 'user-123',
      isSupporter: false,
      email: 'test@example.com',
      role: 'user',
      hasCompletedOnboarding: false,
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    });
    vi.mocked(incrementUsageIfAllowed).mockResolvedValue({
      allowed: true,
      monthlyUsage: 5,
      usageMonth: '2000-01',
    });
    vi.mocked(getPresignedUploadUrl).mockResolvedValue('https://r2.example.com/upload?signed=true');
    vi.mocked(createUploadJob).mockResolvedValue({
      id: 'job-123',
      userId: 'user-123',
      draftId: null,
      r2Key: 'temp/uploads/user-123/1234567890/test.mp4',
      status: 'pending',
      errorMessage: null,
      quotaClaimMonth: '2000-01',
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    });
    vi.mocked(getDraftById).mockResolvedValue({
      id: 'draft-abc',
      userId: 'user-123',
      targets: ['youtube'],
      title: 'Test Draft',
      description: '',
      tags: [],
      visibility: 'private',
      platforms: {},
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Authentication', () => {
    it('should return 401 when not authenticated (no session)', async () => {
      const request = createRequest({ filename: 'test.mp4', contentType: 'video/mp4' });
      const response = await POST(request);

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toContain('Please log in');
    });

    it('should return 400 when request is authenticated but missing required fields', async () => {
      // Legacy Appwrite session mocking is no longer part of route auth.
      // With an auth cookie present, this request now fails body validation.

      const request = createRequest(
        { filename: 'test.mp4', contentType: 'video/mp4' },
        { 'a_session_test-project': 'valid-session' }
      );
      const response = await POST(request);

      expect(response.status).toBe(400);
    });

    it('should authenticate successfully with valid session', async () => {
      const request = createRequest(
        {
          filename: 'test.mp4',
          contentType: 'video/mp4',
          fileSize: 1024 * 1024,
          draftId: 'draft-abc',
        },
        { 'a_session_test-project': 'valid-token' }
      );
      const response = await POST(request);

      expect(response.status).toBe(200);
    });
  });

  describe('Request Validation', () => {
    it('should return 400 when filename is missing', async () => {
      const request = createRequest(
        { contentType: 'video/mp4' },
        { 'a_session_test-project': 'token' }
      );
      const response = await POST(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('fileName (or filename) is required');
    });

    it('should return 400 when filename is empty', async () => {
      const request = createRequest(
        { filename: '', contentType: 'video/mp4' },
        { 'a_session_test-project': 'token' }
      );
      const response = await POST(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('fileName (or filename) is required');
    });

    it('should return 400 when contentType is missing', async () => {
      const request = createRequest(
        { filename: 'test.mp4' },
        { 'a_session_test-project': 'token' }
      );
      const response = await POST(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('contentType is required');
    });

    it('should return 400 when contentType is empty', async () => {
      const request = createRequest(
        { filename: 'test.mp4', contentType: '' },
        { 'a_session_test-project': 'token' }
      );
      const response = await POST(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('contentType is required');
    });

    it('should return 400 when contentType format is invalid (missing /)', async () => {
      const request = createRequest(
        { filename: 'test.mp4', contentType: 'invalid' },
        { 'a_session_test-project': 'token' }
      );
      const response = await POST(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('valid MIME type');
    });

    it('should accept valid MIME types', async () => {
      const request = createRequest(
        {
          filename: 'test.mp4',
          contentType: 'video/mp4',
          fileSize: 1024 * 1024,
          draftId: 'draft-abc',
        },
        { 'a_session_test-project': 'token' }
      );
      const response = await POST(request);

      expect(response.status).toBe(200);
    });

    it('should handle invalid JSON body', async () => {
      const url = new URL('http://localhost:3000/api/uploads/presign');
      const init: RequestInit = {
        method: 'POST',
        body: 'invalid json}',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'a_session_test-project=token',
        },
      };
      const request = new NextRequest(url, init);

      const response = await POST(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('Invalid JSON');
    });

    it('should accept fileName (camelCase) as well as filename', async () => {
      const request = createRequest(
        {
          fileName: 'test.mp4',
          contentType: 'video/mp4',
          fileSize: 1024 * 1024,
          draftId: 'draft-abc',
        },
        { 'a_session_test-project': 'token' }
      );
      const response = await POST(request);
      expect(response.status).toBe(200);
    });
  });

  describe('Format Validation', () => {
    const validCases = [
      {
        filename: 'video.mp4',
        contentType: 'video/mp4',
        fileSize: 1024 * 1024,
        draftId: 'draft-abc',
      },
      {
        filename: 'video.mov',
        contentType: 'video/quicktime',
        fileSize: 1024 * 1024,
        draftId: 'draft-abc',
      },
      {
        filename: 'video.avi',
        contentType: 'video/x-msvideo',
        fileSize: 1024 * 1024,
        draftId: 'draft-abc',
      },
      {
        filename: 'video.mkv',
        contentType: 'video/x-matroska',
        fileSize: 1024 * 1024,
        draftId: 'draft-abc',
      },
      {
        filename: 'video.webm',
        contentType: 'video/webm',
        fileSize: 1024 * 1024,
        draftId: 'draft-abc',
      },
    ];

    for (const { filename, contentType, fileSize, draftId } of validCases) {
      it(`should accept ${filename} (${contentType})`, async () => {
        const request = createRequest(
          { filename, contentType, fileSize, draftId },
          { 'a_session_test-project': 'token' }
        );
        const response = await POST(request);
        expect(response.status).toBe(200);
      });
    }

    it('should reject unsupported MIME type', async () => {
      const request = createRequest(
        { filename: 'video.mp4', contentType: 'video/mpeg' },
        { 'a_session_test-project': 'token' }
      );
      const response = await POST(request);
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('Unsupported file format');
    });

    it('should reject unsupported extension even with valid MIME type', async () => {
      const request = createRequest(
        { filename: 'video.flv', contentType: 'video/mp4' },
        { 'a_session_test-project': 'token' }
      );
      const response = await POST(request);
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('Unsupported file format');
    });
  });

  describe('File Size Validation', () => {
    it('should return 400 when fileSize is missing', async () => {
      const request = createRequest(
        { filename: 'video.mp4', contentType: 'video/mp4' },
        { 'a_session_test-project': 'token' }
      );
      const response = await POST(request);
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('fileSize is required');
    });

    it('should accept a file within the 5 GB limit', async () => {
      const request = createRequest(
        {
          filename: 'video.mp4',
          contentType: 'video/mp4',
          fileSize: 1 * 1024 * 1024 * 1024, // 1 GB
          draftId: 'draft-abc',
        },
        { 'a_session_test-project': 'token' }
      );
      const response = await POST(request);
      expect(response.status).toBe(200);
    });

    it('should reject a file over 5 GB', async () => {
      const request = createRequest(
        {
          filename: 'video.mp4',
          contentType: 'video/mp4',
          fileSize: 6 * 1024 * 1024 * 1024, // 6 GB
        },
        { 'a_session_test-project': 'token' }
      );
      const response = await POST(request);
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('5 GB');
    });

    it('should reject an invalid (non-positive) fileSize', async () => {
      const request = createRequest(
        { filename: 'video.mp4', contentType: 'video/mp4', fileSize: -1 },
        { 'a_session_test-project': 'token' }
      );
      const response = await POST(request);
      expect(response.status).toBe(400);
    });

    it('should reject NaN as fileSize', async () => {
      const request = createRequest(
        { filename: 'video.mp4', contentType: 'video/mp4', fileSize: NaN },
        { 'a_session_test-project': 'token' }
      );
      const response = await POST(request);
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('fileSize is required');
    });

    it('should reject Infinity as fileSize', async () => {
      const request = createRequest(
        { filename: 'video.mp4', contentType: 'video/mp4', fileSize: Infinity },
        { 'a_session_test-project': 'token' }
      );
      const response = await POST(request);
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('fileSize is required');
    });

    it('should reject a fractional fileSize', async () => {
      const request = createRequest(
        { filename: 'video.mp4', contentType: 'video/mp4', fileSize: 1024.5 },
        { 'a_session_test-project': 'token' }
      );
      const response = await POST(request);
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('fileSize is required');
    });
  });

  describe('Upload Quota', () => {
    it('should return 403 when free-tier quota is exceeded', async () => {
      vi.mocked(incrementUsageIfAllowed).mockResolvedValueOnce({
        allowed: false,
        monthlyUsage: 10,
      });

      const request = createRequest(
        {
          filename: 'test.mp4',
          contentType: 'video/mp4',
          fileSize: 1024 * 1024,
          draftId: 'draft-abc',
        },
        { 'a_session_test-project': 'token' }
      );
      const response = await POST(request);

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain('Upload limit reached');
      expect(body.monthlyUsage).toBe(10);
      expect(body.limit).toBe(10);
    });

    it('should allow upload when quota is not exceeded', async () => {
      vi.mocked(incrementUsageIfAllowed).mockResolvedValueOnce({
        allowed: true,
        monthlyUsage: 5,
        usageMonth: '2000-01',
      });

      const request = createRequest(
        {
          filename: 'test.mp4',
          contentType: 'video/mp4',
          fileSize: 1024 * 1024,
          draftId: 'draft-abc',
        },
        { 'a_session_test-project': 'token' }
      );
      const response = await POST(request);
      expect(response.status).toBe(200);
    });

    it('should pass isSupporter=true to incrementUsageIfAllowed for supporters', async () => {
      vi.mocked(getUserById).mockResolvedValueOnce({
        userId: 'user-123',
        isSupporter: true,
        email: 'supporter@example.com',
        role: 'user',
        hasCompletedOnboarding: false,
        $createdAt: '2000-01-01T00:00:00.000Z',
        $updatedAt: '2000-01-01T00:00:00.000Z',
      });

      const request = createRequest(
        {
          filename: 'test.mp4',
          contentType: 'video/mp4',
          fileSize: 1024 * 1024,
          draftId: 'draft-abc',
        },
        { 'a_session_test-project': 'token' }
      );
      const response = await POST(request);
      expect(response.status).toBe(200);
      expect(vi.mocked(incrementUsageIfAllowed)).toHaveBeenCalledWith('user-123', true);
      expect(vi.mocked(createUploadJob)).toHaveBeenCalledWith(
        expect.objectContaining({
          quotaClaimMonth: '',
        })
      );
    });
  });

  describe('Presigned URL Generation', () => {
    it('should generate presigned URL response with correct fields', async () => {
      const request = createRequest(
        {
          filename: 'test.mp4',
          contentType: 'video/mp4',
          fileSize: 1024 * 1024,
          draftId: 'draft-abc',
        },
        { 'a_session_test-project': 'token' }
      );
      const response = await POST(request);

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body).toHaveProperty('uploadUrl');
      expect(body).toHaveProperty('key');
      expect(body).toHaveProperty('bucketName');
      expect(body).toHaveProperty('expiresIn');
      expect(body.expiresIn).toBe(900);
      expect(body).toHaveProperty('uploadJobId', 'job-123');
      expect(vi.mocked(markDraftUsedInUpload)).toHaveBeenCalledWith(
        'draft-abc',
        '2000-01-01T00:00:00.000Z'
      );
    });

    it('should return 400 when draftId is missing', async () => {
      const request = createRequest(
        { filename: 'test.mp4', contentType: 'video/mp4', fileSize: 1024 * 1024 },
        { 'a_session_test-project': 'token' }
      );
      const response = await POST(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('draftId is required');
      expect(vi.mocked(createUploadJob)).not.toHaveBeenCalled();
    });

    it('should call incrementUsageIfAllowed at presign time (authoritative quota enforcement)', async () => {
      const request = createRequest(
        {
          filename: 'test.mp4',
          contentType: 'video/mp4',
          fileSize: 1024 * 1024,
          draftId: 'draft-abc',
        },
        { 'a_session_test-project': 'token' }
      );
      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(vi.mocked(incrementUsageIfAllowed)).toHaveBeenCalledWith('user-123', false);
    });

    it('should not create an UploadJob when quota is exceeded', async () => {
      vi.mocked(incrementUsageIfAllowed).mockResolvedValueOnce({
        allowed: false,
        monthlyUsage: 10,
      });

      const request = createRequest(
        {
          filename: 'test.mp4',
          contentType: 'video/mp4',
          fileSize: 1024 * 1024,
          draftId: 'draft-abc',
        },
        { 'a_session_test-project': 'token' }
      );
      const response = await POST(request);

      expect(response.status).toBe(403);
      expect(vi.mocked(createUploadJob)).not.toHaveBeenCalled();
    });

    it('should create an UploadJob with draftId when provided', async () => {
      const request = createRequest(
        {
          filename: 'test.mp4',
          contentType: 'video/mp4',
          fileSize: 1024 * 1024,
          draftId: 'draft-abc',
        },
        { 'a_session_test-project': 'token' }
      );
      await POST(request);

      expect(vi.mocked(createUploadJob)).toHaveBeenCalledWith({
        userId: 'user-123',
        draftId: 'draft-abc',
        r2Key: expect.stringContaining('temp/uploads/user-123/'),
        quotaClaimMonth: '2000-01',
      });
    });

    it('should return 404 when draftId does not exist', async () => {
      vi.mocked(getDraftById).mockResolvedValueOnce(null);

      const request = createRequest(
        {
          filename: 'test.mp4',
          contentType: 'video/mp4',
          fileSize: 1024 * 1024,
          draftId: 'nonexistent-draft',
        },
        { 'a_session_test-project': 'token' }
      );
      const response = await POST(request);

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toContain('Draft not found');
      expect(vi.mocked(createUploadJob)).not.toHaveBeenCalled();
    });

    it('should return 403 when draftId belongs to a different user', async () => {
      vi.mocked(getDraftById).mockResolvedValueOnce({
        id: 'draft-other',
        userId: 'other-user-999',
        targets: ['youtube'],
        title: 'Someone Else Draft',
        description: '',
        tags: [],
        visibility: 'private',
        platforms: {},
        $createdAt: '2000-01-01T00:00:00.000Z',
        $updatedAt: '2000-01-01T00:00:00.000Z',
      });

      const request = createRequest(
        {
          filename: 'test.mp4',
          contentType: 'video/mp4',
          fileSize: 1024 * 1024,
          draftId: 'draft-other',
        },
        { 'a_session_test-project': 'token' }
      );
      const response = await POST(request);

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain('Forbidden');
      expect(vi.mocked(createUploadJob)).not.toHaveBeenCalled();
    });

    it('should include object key in response', async () => {
      const request = createRequest(
        {
          filename: 'test.mp4',
          contentType: 'video/mp4',
          fileSize: 1024 * 1024,
          draftId: 'draft-abc',
        },
        { 'a_session_test-project': 'token' }
      );
      const response = await POST(request);
      const body = await response.json();

      expect(body.key).toContain('temp/uploads/user-123');
      expect(body.key).toContain('test.mp4');
    });

    it('should sanitize filename path separators', async () => {
      const request = createRequest(
        {
          filename: 'path/to\\test.mp4',
          contentType: 'video/mp4',
          fileSize: 1024 * 1024,
          draftId: 'draft-abc',
        },
        { 'a_session_test-project': 'token' }
      );
      const response = await POST(request);
      const body = await response.json();

      expect(body.key).not.toContain('/to/');
      expect(body.key).toContain('path_to_test.mp4');
    });

    it('should call R2 getPresignedUploadUrl with key, contentType, and fileSize', async () => {
      const request = createRequest(
        {
          filename: 'video.mp4',
          contentType: 'video/mp4',
          fileSize: 1024 * 1024,
          draftId: 'draft-abc',
        },
        { 'a_session_test-project': 'token' }
      );
      await POST(request);

      expect(vi.mocked(getPresignedUploadUrl)).toHaveBeenCalledWith(
        expect.stringContaining('temp/uploads/user-123/'),
        'video/mp4',
        1024 * 1024
      );
    });

    it('should generate unique keys even for same-millisecond requests (UUID component)', async () => {
      const request1 = createRequest(
        {
          filename: 'video.mp4',
          contentType: 'video/mp4',
          fileSize: 1024 * 1024,
          draftId: 'draft-abc',
        },
        { 'a_session_test-project': 'token' }
      );
      const response1 = await POST(request1);
      const body1 = await response1.json();

      // No delay needed — uniqueness comes from UUID, not timestamp
      mockGetAuthenticatedUserId.mockResolvedValueOnce('user-123');
      const request2 = createRequest(
        {
          filename: 'video.mp4',
          contentType: 'video/mp4',
          fileSize: 1024 * 1024,
          draftId: 'draft-abc',
        },
        { 'a_session_test-project': 'token' }
      );
      const response2 = await POST(request2);
      const body2 = await response2.json();

      expect(body1.key).not.toBe(body2.key);
    });

    it('should include a UUID segment in the generated key', async () => {
      const request = createRequest(
        {
          filename: 'video.mp4',
          contentType: 'video/mp4',
          fileSize: 1024 * 1024,
          draftId: 'draft-abc',
        },
        { 'a_session_test-project': 'token' }
      );
      const response = await POST(request);
      const body = await response.json();

      // Key format: temp/uploads/{userId}/{timestamp}-{uuid}/{filename}
      const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
      expect(uuidRegex.test(body.key)).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should return 500 and error message when R2 service fails', async () => {
      vi.mocked(getPresignedUploadUrl).mockRejectedValueOnce(new Error('R2 service unavailable'));

      const request = createRequest(
        {
          filename: 'test.mp4',
          contentType: 'video/mp4',
          fileSize: 1024 * 1024,
          draftId: 'draft-abc',
        },
        { 'a_session_test-project': 'token' }
      );
      const response = await POST(request);

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toBeDefined();
    });

    it('should roll back the quota slot when getPresignedUploadUrl throws', async () => {
      vi.mocked(getPresignedUploadUrl).mockRejectedValueOnce(new Error('R2 unavailable'));

      const request = createRequest(
        {
          filename: 'test.mp4',
          contentType: 'video/mp4',
          fileSize: 1024 * 1024,
          draftId: 'draft-abc',
        },
        { 'a_session_test-project': 'token' }
      );
      await POST(request);

      expect(vi.mocked(decrementUsage)).toHaveBeenCalledWith('user-123', '2000-01');
    });

    it('should roll back the quota slot when createUploadJob throws', async () => {
      vi.mocked(createUploadJob).mockRejectedValueOnce(new Error('DB unavailable'));

      const request = createRequest(
        {
          filename: 'test.mp4',
          contentType: 'video/mp4',
          fileSize: 1024 * 1024,
          draftId: 'draft-abc',
        },
        { 'a_session_test-project': 'token' }
      );
      await POST(request);

      expect(vi.mocked(decrementUsage)).toHaveBeenCalledWith('user-123', '2000-01');
    });

    it('should NOT roll back the quota slot for a supporter when R2 throws', async () => {
      vi.mocked(getUserById).mockResolvedValueOnce({
        userId: 'user-123',
        isSupporter: true,
        email: 'test@example.com',
        role: 'user',
        hasCompletedOnboarding: false,
        $createdAt: '2000-01-01T00:00:00.000Z',
        $updatedAt: '2000-01-01T00:00:00.000Z',
      });
      vi.mocked(getPresignedUploadUrl).mockRejectedValueOnce(new Error('R2 unavailable'));

      const request = createRequest(
        {
          filename: 'test.mp4',
          contentType: 'video/mp4',
          fileSize: 1024 * 1024,
          draftId: 'draft-abc',
        },
        { 'a_session_test-project': 'token' }
      );
      await POST(request);

      expect(vi.mocked(decrementUsage)).not.toHaveBeenCalled();
    });

    it('should NOT call decrementUsage when presign succeeds end-to-end', async () => {
      const request = createRequest(
        {
          filename: 'test.mp4',
          contentType: 'video/mp4',
          fileSize: 1024 * 1024,
          draftId: 'draft-abc',
        },
        { 'a_session_test-project': 'token' }
      );
      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(vi.mocked(decrementUsage)).not.toHaveBeenCalled();
    });

    it('should not expose R2 error details in production', async () => {
      vi.stubEnv('NODE_ENV', 'production');

      vi.mocked(getPresignedUploadUrl).mockRejectedValueOnce(
        new Error('R2 AccessKeyId does not exist')
      );

      const request = createRequest(
        {
          filename: 'test.mp4',
          contentType: 'video/mp4',
          fileSize: 1024 * 1024,
          draftId: 'draft-abc',
        },
        { 'a_session_test-project': 'token' }
      );
      const response = await POST(request);

      const body = await response.json();
      expect(body.error).not.toContain('AccessKeyId');
    });
  });
});
