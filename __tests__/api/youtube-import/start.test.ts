import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetAuthenticatedUserId = vi.fn();
const mockGetDraftById = vi.fn();
const mockCreateYoutubeImportJob = vi.fn();
const mockGetActiveYoutubeImportJobForUser = vi.fn();
const mockRunYoutubeImportJob = vi.fn();

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: (...args: unknown[]) => mockGetAuthenticatedUserId(...args),
}));

vi.mock('@/lib/repositories/drafts', () => ({
  getDraftById: (...args: unknown[]) => mockGetDraftById(...args),
}));

vi.mock('@/lib/repositories/youtube-import-jobs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/repositories/youtube-import-jobs')>();
  return {
    ...actual,
    createYoutubeImportJob: (...args: unknown[]) => mockCreateYoutubeImportJob(...args),
    getActiveYoutubeImportJobForUser: (...args: unknown[]) =>
      mockGetActiveYoutubeImportJobForUser(...args),
  };
});

vi.mock('@/lib/youtube-import/run-import-job', () => ({
  runYoutubeImportJob: (...args: unknown[]) => mockRunYoutubeImportJob(...args),
}));

import { POST } from '@/app/api/youtube-import/start/route';
import { YoutubeImportJobAlreadyActiveError } from '@/lib/repositories/youtube-import-jobs';

const USER_ID = 'user-123';
const DRAFT_ID = 'draft-1';
const VIDEO_ID = 'dQw4w9WgXcQ';

const validBody = {
  draftId: DRAFT_ID,
  youtubeVideoId: VIDEO_ID,
  startSeconds: 10,
  endSeconds: 100,
};

const baseJob = {
  id: 'import-job-1',
  userId: USER_ID,
  draftId: DRAFT_ID,
  sourceUrl: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
  youtubeVideoId: VIDEO_ID,
  livestreamId: null,
  startSeconds: 10,
  endSeconds: 100,
  status: 'pending' as const,
  progressPercent: 0,
  errorMessage: null,
  r2Key: null,
  uploadJobId: null,
  $createdAt: '2026-01-01T00:00:00.000Z',
  $updatedAt: '2026-01-01T00:00:00.000Z',
};

function createRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:9624/api/youtube-import/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('YT_IMPORT_MAX_DURATION_SECONDS', '3600');
  mockGetAuthenticatedUserId.mockResolvedValue(USER_ID);
  mockGetDraftById.mockResolvedValue({ id: DRAFT_ID, userId: USER_ID });
  mockCreateYoutubeImportJob.mockResolvedValue(baseJob);
  mockRunYoutubeImportJob.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/youtube-import/start', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetAuthenticatedUserId.mockResolvedValueOnce(null);

    const response = await POST(createRequest(validBody));

    expect(response.status).toBe(401);
    expect(mockGetDraftById).not.toHaveBeenCalled();
  });

  it('returns 400 when endSeconds is not greater than startSeconds', async () => {
    const response = await POST(createRequest({ ...validBody, startSeconds: 50, endSeconds: 50 }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toContain('endSeconds must be greater than startSeconds');
    expect(mockCreateYoutubeImportJob).not.toHaveBeenCalled();
  });

  it('returns 400 when clip length exceeds YT_IMPORT_MAX_DURATION_SECONDS', async () => {
    const response = await POST(createRequest({ ...validBody, startSeconds: 0, endSeconds: 3601 }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toContain('maximum of 3600 seconds');
    expect(mockCreateYoutubeImportJob).not.toHaveBeenCalled();
  });

  it('returns 404 when the draft does not exist', async () => {
    mockGetDraftById.mockResolvedValueOnce(null);

    const response = await POST(createRequest(validBody));

    expect(response.status).toBe(404);
    expect(mockCreateYoutubeImportJob).not.toHaveBeenCalled();
  });

  it('returns 403 when the draft belongs to another user', async () => {
    mockGetDraftById.mockResolvedValueOnce({ id: DRAFT_ID, userId: 'other-user' });

    const response = await POST(createRequest(validBody));

    expect(response.status).toBe(403);
    expect(mockCreateYoutubeImportJob).not.toHaveBeenCalled();
  });

  it('returns 409 with activeJobId when the user already has an active import', async () => {
    mockCreateYoutubeImportJob.mockRejectedValueOnce(
      new YoutubeImportJobAlreadyActiveError(USER_ID)
    );
    mockGetActiveYoutubeImportJobForUser.mockResolvedValueOnce({
      ...baseJob,
      id: 'existing-active-job',
      status: 'downloading',
      progressPercent: 25,
    });

    const response = await POST(createRequest(validBody));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.message).toBe('You already have an import in progress');
    expect(body.activeJobId).toBe('existing-active-job');
    expect(mockRunYoutubeImportJob).not.toHaveBeenCalled();
  });

  it('creates a job, starts the worker without awaiting, and returns 201', async () => {
    const response = await POST(createRequest(validBody));

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({ jobId: 'import-job-1' });

    expect(mockCreateYoutubeImportJob).toHaveBeenCalledWith({
      userId: USER_ID,
      draftId: DRAFT_ID,
      sourceUrl: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
      youtubeVideoId: VIDEO_ID,
      livestreamId: undefined,
      startSeconds: 10,
      endSeconds: 100,
    });
    expect(mockRunYoutubeImportJob).toHaveBeenCalledWith('import-job-1');
  });

  it('passes livestreamId and sourceUrl when provided', async () => {
    await POST(
      createRequest({
        ...validBody,
        livestreamId: 'livestream-1',
        sourceUrl: 'https://youtu.be/dQw4w9WgXcQ',
      })
    );

    expect(mockCreateYoutubeImportJob).toHaveBeenCalledWith(
      expect.objectContaining({
        livestreamId: 'livestream-1',
        sourceUrl: 'https://youtu.be/dQw4w9WgXcQ',
      })
    );
  });
});
