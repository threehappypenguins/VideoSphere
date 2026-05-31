/**
 * Tests for POST /api/uploads/[jobId]/cancel
 *
 * Covers:
 * - Authentication
 * - Ownership / not-found behavior
 * - Allowed status handling (pending/uploading only)
 * - R2 cleanup behavior
 * - Status update failure paths
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: vi.fn(),
}));

vi.mock('@/lib/repositories/upload-jobs', () => ({
  getUploadJobById: vi.fn(),
  updateUploadJobStatus: vi.fn(),
}));

vi.mock('@/lib/r2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/r2')>();
  return {
    ...actual,
    deleteObject: vi.fn(),
  };
});

import { POST } from '@/app/api/uploads/[jobId]/cancel/route';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getUploadJobById, updateUploadJobStatus } from '@/lib/repositories/upload-jobs';
import { deleteObject, R2ObjectNotFoundError } from '@/lib/r2';

const SESSION_COOKIE = 'videosphere_session';

const baseJob = {
  id: 'job-123',
  userId: 'user-123',
  draftId: 'draft-abc',
  r2Key: 'temp/uploads/user-123/1234567890/test.mp4',
  status: 'pending' as const,
  errorMessage: null,
  $createdAt: '2026-01-01T00:00:00.000Z',
  $updatedAt: '2026-01-01T00:00:00.000Z',
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
    vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-123');
    vi.mocked(getUploadJobById).mockResolvedValue({ ...baseJob });
    vi.mocked(updateUploadJobStatus).mockResolvedValue({
      ...baseJob,
      status: 'cancelled',
      $updatedAt: '2026-01-01T00:00:01.000Z',
    });
    vi.mocked(deleteObject).mockResolvedValue(undefined);
  });

  describe('authentication and ownership', () => {
    it('returns 401 when unauthenticated', async () => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(null);

      const res = await POST(createRequest('job-123'), makeParams('job-123'));
      const body = await res.json();

      expect(res.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
      expect(body.message).toBe('Not authenticated');
      expect(getUploadJobById).not.toHaveBeenCalled();
    });

    it('returns 404 when upload job does not exist', async () => {
      vi.mocked(getUploadJobById).mockResolvedValueOnce(null);

      const res = await POST(
        createRequest('missing', { [`${SESSION_COOKIE}`]: 'token' }),
        makeParams('missing')
      );
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe('Not Found');
      expect(body.message).toBe('Upload job not found');
      expect(updateUploadJobStatus).not.toHaveBeenCalled();
      expect(deleteObject).not.toHaveBeenCalled();
    });

    it('returns 404 when job belongs to another user', async () => {
      vi.mocked(getUploadJobById).mockResolvedValueOnce({ ...baseJob, userId: 'other-user' });

      const res = await POST(
        createRequest('job-123', { [`${SESSION_COOKIE}`]: 'token' }),
        makeParams('job-123')
      );

      expect(res.status).toBe(404);
      expect(updateUploadJobStatus).not.toHaveBeenCalled();
      expect(deleteObject).not.toHaveBeenCalled();
    });
  });

  describe('allowed status handling', () => {
    it('allows cancellation from pending', async () => {
      vi.mocked(getUploadJobById).mockResolvedValueOnce({ ...baseJob, status: 'pending' });

      const res = await POST(
        createRequest('job-123', { [`${SESSION_COOKIE}`]: 'token' }),
        makeParams('job-123')
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({ success: true });
      expect(updateUploadJobStatus).toHaveBeenCalledWith('job-123', 'cancelled', null);
    });

    it('allows cancellation from uploading', async () => {
      vi.mocked(getUploadJobById).mockResolvedValueOnce({
        ...baseJob,
        status: 'uploading' as const,
      });

      const res = await POST(
        createRequest('job-123', { [`${SESSION_COOKIE}`]: 'token' }),
        makeParams('job-123')
      );

      expect(res.status).toBe(200);
      expect(updateUploadJobStatus).toHaveBeenCalledWith('job-123', 'cancelled', null);
    });

    it('returns 409 when status is not cancellable', async () => {
      vi.mocked(getUploadJobById).mockResolvedValueOnce({
        ...baseJob,
        status: 'distributing' as const,
      });

      const res = await POST(
        createRequest('job-123', { [`${SESSION_COOKIE}`]: 'token' }),
        makeParams('job-123')
      );
      const body = await res.json();

      expect(res.status).toBe(409);
      expect(body.error).toBe('Conflict');
      expect(body.message).toContain("Cannot cancel upload in 'distributing' state.");
      expect(updateUploadJobStatus).not.toHaveBeenCalled();
      expect(deleteObject).not.toHaveBeenCalled();
    });
  });

  describe('R2 cleanup behavior', () => {
    it('deletes R2 object after marking the job cancelled', async () => {
      await POST(
        createRequest('job-123', { [`${SESSION_COOKIE}`]: 'token' }),
        makeParams('job-123')
      );

      expect(updateUploadJobStatus).toHaveBeenCalledWith('job-123', 'cancelled', null);
      expect(deleteObject).toHaveBeenCalledWith('temp/uploads/user-123/1234567890/test.mp4');
    });

    it('does not attempt R2 cleanup when job has no r2Key', async () => {
      vi.mocked(getUploadJobById).mockResolvedValueOnce({ ...baseJob, r2Key: null });

      const res = await POST(
        createRequest('job-123', { [`${SESSION_COOKIE}`]: 'token' }),
        makeParams('job-123')
      );

      expect(res.status).toBe(200);
      expect(deleteObject).not.toHaveBeenCalled();
    });

    it('still succeeds when R2 object is already missing', async () => {
      vi.mocked(deleteObject).mockRejectedValueOnce(
        new R2ObjectNotFoundError('temp/uploads/user-123/1234567890/test.mp4')
      );

      const res = await POST(
        createRequest('job-123', { [`${SESSION_COOKIE}`]: 'token' }),
        makeParams('job-123')
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({ success: true });
    });

    it('still succeeds when R2 cleanup throws non-not-found error', async () => {
      vi.mocked(deleteObject).mockRejectedValueOnce(new Error('R2 outage'));

      const res = await POST(
        createRequest('job-123', { [`${SESSION_COOKIE}`]: 'token' }),
        makeParams('job-123')
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({ success: true });
    });
  });

  describe('status update failure paths', () => {
    it('returns 404 when status update reports no row updated', async () => {
      vi.mocked(updateUploadJobStatus).mockResolvedValueOnce(null);

      const res = await POST(
        createRequest('job-123', { [`${SESSION_COOKIE}`]: 'token' }),
        makeParams('job-123')
      );
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe('Not Found');
      expect(body.message).toBe('Upload job not found');
      expect(deleteObject).not.toHaveBeenCalled();
    });

    it('returns 500 when status update throws', async () => {
      vi.mocked(updateUploadJobStatus).mockRejectedValueOnce(new Error('db failure'));

      const res = await POST(
        createRequest('job-123', { [`${SESSION_COOKIE}`]: 'token' }),
        makeParams('job-123')
      );
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.error).toBe('Internal Server Error');
      expect(body.message).toBe('Failed to cancel upload');
    });
  });
});
