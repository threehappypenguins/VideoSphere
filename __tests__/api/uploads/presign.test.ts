/**
 * Tests for POST /api/uploads/presign
 *
 * Tests request validation, authentication, and presigned URL generation.
 * Mocks external dependencies (Appwrite, R2) to isolate endpoint logic.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock Appwrite - must be defined before importing the route
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

// Mock R2 library
vi.mock('@/lib/r2', () => ({
  getPresignedUploadUrl: vi.fn(async (key: string) => {
    return `https://r2.example.com/upload/${encodeURIComponent(key)}?signature=test`;
  }),
}));

import { POST } from '@/app/api/uploads/presign/route';
import { getPresignedUploadUrl } from '@/lib/r2';

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

    it('should return 401 when Appwrite session is invalid', async () => {
      mockGet.mockRejectedValueOnce(new Error('Invalid session'));

      const request = createRequest(
        { filename: 'test.mp4', contentType: 'video/mp4' },
        { 'a_session_test-project': 'invalid-token' }
      );
      const response = await POST(request);

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toContain('Invalid session');
    });

    it('should authenticate successfully with valid session', async () => {
      mockGet.mockResolvedValueOnce({ $id: 'user-123' });

      const request = createRequest(
        { filename: 'test.mp4', contentType: 'video/mp4' },
        { 'a_session_test-project': 'valid-token' }
      );
      const response = await POST(request);

      expect(response.status).toBe(200);
    });
  });

  describe('Request Validation', () => {
    beforeEach(() => {
      mockGet.mockResolvedValue({ $id: 'user-123' });
    });

    it('should return 400 when filename is missing', async () => {
      const request = createRequest(
        { contentType: 'video/mp4' },
        { 'a_session_test-project': 'token' }
      );
      const response = await POST(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('filename is required');
    });

    it('should return 400 when filename is empty', async () => {
      const request = createRequest(
        { filename: '', contentType: 'video/mp4' },
        { 'a_session_test-project': 'token' }
      );
      const response = await POST(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('filename is required');
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
        { filename: 'test.mp4', contentType: 'video/mp4' },
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
  });

  describe('Presigned URL Generation', () => {
    beforeEach(() => {
      mockGet.mockResolvedValue({ $id: 'user-123' });
      vi.mocked(getPresignedUploadUrl).mockResolvedValue(
        'https://r2.example.com/upload?signed=true'
      );
    });

    it('should generate presigned URL response with correct fields', async () => {
      const request = createRequest(
        { filename: 'test.mp4', contentType: 'video/mp4' },
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
    });

    it('should include object key in response', async () => {
      const request = createRequest(
        { filename: 'test.mp4', contentType: 'video/mp4' },
        { 'a_session_test-project': 'token' }
      );
      const response = await POST(request);
      const body = await response.json();

      expect(body.key).toContain('temp/uploads/user-123');
      expect(body.key).toContain('test.mp4');
    });

    it('should sanitize filename path separators', async () => {
      const request = createRequest(
        { filename: 'path/to\\test.mp4', contentType: 'video/mp4' },
        { 'a_session_test-project': 'token' }
      );
      const response = await POST(request);
      const body = await response.json();

      expect(body.key).not.toContain('/to/');
      expect(body.key).toContain('path_to_test.mp4');
    });

    it('should call R2 getPresignedUploadUrl with key and contentType', async () => {
      const request = createRequest(
        { filename: 'video.mp4', contentType: 'video/mp4' },
        { 'a_session_test-project': 'token' }
      );
      await POST(request);

      expect(vi.mocked(getPresignedUploadUrl)).toHaveBeenCalledWith(
        expect.stringContaining('temp/uploads/user-123/'),
        'video/mp4'
      );
    });

    it('should generate unique keys with timestamps for different uploads', async () => {
      const request1 = createRequest(
        { filename: 'video1.mp4', contentType: 'video/mp4' },
        { 'a_session_test-project': 'token' }
      );
      const response1 = await POST(request1);
      const body1 = await response1.json();

      // Small delay to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      mockGet.mockResolvedValueOnce({ $id: 'user-123' });
      const request2 = createRequest(
        { filename: 'video2.mp4', contentType: 'video/mp4' },
        { 'a_session_test-project': 'token' }
      );
      const response2 = await POST(request2);
      const body2 = await response2.json();

      expect(body1.key).not.toBe(body2.key);
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      mockGet.mockResolvedValue({ $id: 'user-123' });
    });

    it('should return 500 and error message when R2 service fails', async () => {
      vi.mocked(getPresignedUploadUrl).mockRejectedValueOnce(new Error('R2 service unavailable'));

      const request = createRequest(
        { filename: 'test.mp4', contentType: 'video/mp4' },
        { 'a_session_test-project': 'token' }
      );
      const response = await POST(request);

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toBeDefined();
    });

    it('should not expose R2 error details in production', async () => {
      vi.stubEnv('NODE_ENV', 'production');

      vi.mocked(getPresignedUploadUrl).mockRejectedValueOnce(
        new Error('R2 AccessKeyId does not exist')
      );

      const request = createRequest(
        { filename: 'test.mp4', contentType: 'video/mp4' },
        { 'a_session_test-project': 'token' }
      );
      const response = await POST(request);

      const body = await response.json();
      expect(body.error).not.toContain('AccessKeyId');
    });
  });
});
