/**
 * Tests for POST /api/uploads/[jobId]/cancel
 *
 * Covers auth, ownership, allowed states (pending/uploading), quota rollback for
 * limited users, R2 deletion (including missing objects), and error paths.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetAuthenticatedUserId = vi.fn();

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: (...args: unknown[]) => mockGetAuthenticatedUserId(...args),
}));

vi.mock('@/lib/repositories/upload-jobs', () => ({
  getUploadJobById: vi.fn(),
  updateUploadJobStatus: vi.fn(async () => ({ id: 'job-123' })),
}));

vi.mock('@/lib/repositories/users', () => ({
  getUserById: vi.fn(),
}));

vi.mock('@/lib/repositories/upload-usage', () => {
  function usageMonthFromUtcIso(isoUtc: string): string {
    const d = new Date(isoUtc);
    if (Number.isNaN(d.getTime())) return '1970-01';
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  return {
    decrementUsage: vi.fn(async () => undefined),
    usageMonthFromUtcIso,
  };
});

vi.mock('@/lib/r2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/r2')>();
  return {
    ...actual,
    deleteObject: vi.fn(async () => undefined),
  };
});

import { POST } from '@/app/api/uploads/[jobId]/cancel/route';
import { getUploadJobById, updateUploadJobStatus } from '@/lib/repositories/upload-jobs';
import { getUserById } from '@/lib/repositories/users';
import { decrementUsage } from '@/lib/repositories/upload-usage';
import { deleteObject, R2ObjectNotFoundError } from '@/lib/r2';

const SESSION_COOKIE = 'videosphere_session';

const baseJob = {
  id: 'job-123',
  userId: 'user-123',
  draftId: 'draft-abc' as const,
  r2Key: 'temp/uploads/user-123/1234567890/test.mp4',
  status: 'pending' as const,
  errorMessage: null,
  /** Matches presign claim for free-tier rollback tests */
  quotaClaimMonth: '2000-01' as const,
  $createdAt: '2000-01-15T12:00:00.000Z',
  $updatedAt: '2000-01-15T12:00:00.000Z',
};

const freeUser = {
  userId: 'user-123',
  email: 'user@example.com',
  isSupporter: false,
  role: 'user' as const,
  hasCompletedOnboarding: false,
  $createdAt: '2000-01-01T00:00:00.000Z',
  $updatedAt: '2000-01-01T00:00:00.000Z',
};

function createRequest(jobId: string, cookies: Record<string, string> = {}): NextRequest {
  const url = new URL(`http://localhost:3000/api/uploads/${jobId}/cancel`);
  const cookieHeader = Object.entries(cookies)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');

  return new NextRequest(url, {
    method: 'POST',
    headers: cookieHeader ? { Cookie: cookieHeader } : {},
  });
}

function makeParams(jobId: string) {
  return { params: Promise.resolve({ jobId }) };
}

describe('POST /api/uploads/[jobId]/cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthenticatedUserId.mockImplementation(async (req: NextRequest) => {
      const token = req.cookies.get(SESSION_COOKIE)?.value;
      if (!token || /bad|invalid|expired/i.test(token)) return null;
      return req.headers.get('x-test-user-id') || 'user-123';
    });
    vi.mocked(getUploadJobById).mockResolvedValue({ ...baseJob });
    vi.mocked(getUserById).mockResolvedValue(freeUser);
    vi.mocked(deleteObject).mockResolvedValue(undefined);
  });

  describe('Authentication and ownership', () => {
    it('returns 401 when not authenticated', async () => {
      const response = await POST(createRequest('job-123'), makeParams('job-123'));

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe('Unauthorized');
      expect(body.message).toBe('Not authenticated');
      expect(body.statusCode).toBe(401);
    });

    it('returns 404 when upload job does not exist', async () => {
      vi.mocked(getUploadJobById).mockResolvedValueOnce(null);

      const response = await POST(
        createRequest('job-123', { [SESSION_COOKIE]: 'token' }),
        makeParams('job-123')
      );

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toBe('Not Found');
      expect(body.message).toBe('Upload job not found');
      expect(body.statusCode).toBe(404);
      expect(vi.mocked(updateUploadJobStatus)).not.toHaveBeenCalled();
    });

    it('returns 404 when job belongs to another user (same as missing job)', async () => {
      vi.mocked(getUploadJobById).mockResolvedValueOnce({
        ...baseJob,
        id: 'job-other',
        userId: 'other-user',
      });

      const response = await POST(
        createRequest('job-other', { [SESSION_COOKIE]: 'token' }),
        makeParams('job-other')
      );

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toBe('Not Found');
      expect(body.message).toBe('Upload job not found');
      expect(body.statusCode).toBe(404);
      expect(vi.mocked(deleteObject)).not.toHaveBeenCalled();
      expect(vi.mocked(updateUploadJobStatus)).not.toHaveBeenCalled();
    });
  });

  describe('User lookup before cancellation (legacy jobs)', () => {
    it('returns 500 and does not delete R2 or update job when getUserById fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(getUserById).mockRejectedValueOnce(new Error('User repository unavailable'));
      vi.mocked(getUploadJobById).mockResolvedValueOnce({ ...baseJob, quotaClaimMonth: null });

      const response = await POST(
        createRequest('job-123', { [SESSION_COOKIE]: 'token' }),
        makeParams('job-123')
      );

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toBe('Internal Server Error');
      expect(body.message).toBe('Failed to cancel upload');
      expect(body.statusCode).toBe(500);
      expect(vi.mocked(deleteObject)).not.toHaveBeenCalled();
      expect(vi.mocked(updateUploadJobStatus)).not.toHaveBeenCalled();
      expect(vi.mocked(decrementUsage)).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('disallowed job states', () => {
    const terminalStates = ['distributing', 'completed', 'failed', 'cancelled'] as const;

    it.each(terminalStates)('returns 409 when status is %s', async (status) => {
      vi.mocked(getUploadJobById).mockResolvedValueOnce({
        ...baseJob,
        status,
      });

      const response = await POST(
        createRequest('job-123', { [SESSION_COOKIE]: 'token' }),
        makeParams('job-123')
      );

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error).toBe('Conflict');
      expect(body.message).toContain(status);
      expect(vi.mocked(deleteObject)).not.toHaveBeenCalled();
      expect(vi.mocked(updateUploadJobStatus)).not.toHaveBeenCalled();
    });
  });

  describe('successful cancellation', () => {
    it('returns 200, deletes R2 object, marks job cancelled, and rolls back quota for free users', async () => {
      const response = await POST(
        createRequest('job-123', { [SESSION_COOKIE]: 'token' }),
        makeParams('job-123')
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);

      expect(vi.mocked(deleteObject)).toHaveBeenCalledWith(baseJob.r2Key);
      expect(vi.mocked(updateUploadJobStatus)).toHaveBeenCalledWith('job-123', 'cancelled', null);
      expect(vi.mocked(decrementUsage)).toHaveBeenCalledWith('user-123', '2000-01');
    });

    it('allows cancellation when status is uploading', async () => {
      vi.mocked(getUploadJobById).mockResolvedValueOnce({
        ...baseJob,
        status: 'uploading',
      });

      const response = await POST(
        createRequest('job-123', { [SESSION_COOKIE]: 'token' }),
        makeParams('job-123')
      );

      expect(response.status).toBe(200);
      expect(vi.mocked(updateUploadJobStatus)).toHaveBeenCalledWith('job-123', 'cancelled', null);
    });

    it('skips deleteObject when r2Key is null', async () => {
      vi.mocked(getUploadJobById).mockResolvedValueOnce({
        ...baseJob,
        r2Key: null,
      });

      const response = await POST(
        createRequest('job-123', { [SESSION_COOKIE]: 'token' }),
        makeParams('job-123')
      );

      expect(response.status).toBe(200);
      expect(vi.mocked(deleteObject)).not.toHaveBeenCalled();
      expect(vi.mocked(updateUploadJobStatus)).toHaveBeenCalledWith('job-123', 'cancelled', null);
    });

    it('does not call decrementUsage when presign did not claim quota (quotaClaimMonth empty)', async () => {
      vi.mocked(getUploadJobById).mockResolvedValueOnce({
        ...baseJob,
        quotaClaimMonth: '',
      });

      const response = await POST(
        createRequest('job-123', { [SESSION_COOKIE]: 'token' }),
        makeParams('job-123')
      );

      expect(response.status).toBe(200);
      expect(vi.mocked(decrementUsage)).not.toHaveBeenCalled();
    });

    it('rolls back quota using quotaClaimMonth from the job (not current tier)', async () => {
      vi.mocked(getUploadJobById).mockResolvedValueOnce({
        ...baseJob,
        quotaClaimMonth: '2025-11',
        $createdAt: '2025-11-30T23:00:00.000Z',
      });

      const response = await POST(
        createRequest('job-123', { [SESSION_COOKIE]: 'token' }),
        makeParams('job-123')
      );

      expect(response.status).toBe(200);
      expect(vi.mocked(decrementUsage)).toHaveBeenCalledWith('user-123', '2025-11');
    });

    it('legacy jobs (null quotaClaimMonth) use current tier and $createdAt for rollback', async () => {
      vi.mocked(getUploadJobById).mockResolvedValueOnce({
        ...baseJob,
        quotaClaimMonth: null,
        $createdAt: '2025-11-30T23:00:00.000Z',
      });

      const response = await POST(
        createRequest('job-123', { [SESSION_COOKIE]: 'token' }),
        makeParams('job-123')
      );

      expect(response.status).toBe(200);
      expect(vi.mocked(decrementUsage)).toHaveBeenCalledWith('user-123', '2025-11');
    });

    it('still returns 200 when decrementUsage fails (best-effort rollback)', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(decrementUsage).mockRejectedValueOnce(new Error('DB unavailable'));

      const response = await POST(
        createRequest('job-123', { [SESSION_COOKIE]: 'token' }),
        makeParams('job-123')
      );

      expect(response.status).toBe(200);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to roll back quota'),
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });
  });

  describe('R2 deletion', () => {
    it('ignores R2ObjectNotFoundError and still completes cancellation', async () => {
      vi.mocked(deleteObject).mockRejectedValueOnce(
        new R2ObjectNotFoundError('temp/uploads/user-123/1234567890/test.mp4')
      );

      const response = await POST(
        createRequest('job-123', { [SESSION_COOKIE]: 'token' }),
        makeParams('job-123')
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(vi.mocked(updateUploadJobStatus)).toHaveBeenCalledWith('job-123', 'cancelled', null);
    });

    it('returns 200 and still marks job cancelled when deleteObject fails with a non-not-found error', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(deleteObject).mockRejectedValueOnce(new Error('R2 unavailable'));

      const response = await POST(
        createRequest('job-123', { [SESSION_COOKIE]: 'token' }),
        makeParams('job-123')
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(vi.mocked(updateUploadJobStatus)).toHaveBeenCalledWith('job-123', 'cancelled', null);
      expect(vi.mocked(decrementUsage)).toHaveBeenCalledWith('user-123', '2000-01');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to delete R2 object'),
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });
  });

  describe('status update', () => {
    it('returns 404 when updateUploadJobStatus returns null (row gone / race)', async () => {
      vi.mocked(updateUploadJobStatus).mockResolvedValueOnce(null);

      const response = await POST(
        createRequest('job-123', { [SESSION_COOKIE]: 'token' }),
        makeParams('job-123')
      );

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toBe('Not Found');
      expect(body.message).toBe('Upload job not found');
      expect(vi.mocked(decrementUsage)).not.toHaveBeenCalled();
    });
  });
});
