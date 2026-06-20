/**
 * Tests for POST /api/uploads/distribute
 *
 * Verifies auth requirement, validation, free-tier platform limit,
 * record creation, and immediate async kickoff response.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Readable } from 'node:stream';
import type { CreatePlatformUploadInput } from '@/lib/repositories/platform-uploads';

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return {
    ...actual,
    // Route handlers run outside Next request scope in these tests; run `after` tasks immediately.
    after: (task: (() => void | Promise<void>) | Promise<void>) => {
      if (typeof task === 'function') {
        void task();
      } else {
        void task;
      }
    },
  };
});

const mockGetAuthenticatedUserId = vi.fn();

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: (...args: unknown[]) => mockGetAuthenticatedUserId(...args),
}));

const mockGetDraftById = vi.fn();
const mockGetUserById = vi.fn();
const mockCreateUploadJob = vi.fn();
const mockFindUploadJobForDistribution = vi.fn();
const mockUpdateUploadJobStatus = vi.fn();
const mockCreatePlatformUpload = vi.fn();
const mockEnsurePlatformUploadsForJobTargets = vi.fn();
const mockGetConnectedAccountWithTokens = vi.fn();
const mockUpdateTokens = vi.fn();
const mockGetObjectWebStream = vi.fn();
const mockGetObjectNodeStream = vi.fn();
const mockHeadObjectMetadata = vi.fn();
const mockDeleteObject = vi.fn();
const mockUploadToYouTube = vi.fn();
const mockRefreshYouTubeAccessToken = vi.fn();
const mockRefreshTokenIfNeeded = vi.fn();
const mockUploadToVimeo = vi.fn();
const mockUploadToGoogleDrive = vi.fn();
const mockUploadToSftp = vi.fn();
const mockUploadToSmb = vi.fn();
const mockGetPlatformUploadsByJob = vi.fn();
const mockUpdatePlatformUploadStatus = vi.fn();
const mockGetUploadJobById = vi.fn();
const mockUpdateDraft = vi.fn();

vi.mock('@/lib/repositories/drafts', () => ({
  getDraftById: (...args: unknown[]) => mockGetDraftById(...args),
  updateDraft: (...args: unknown[]) => mockUpdateDraft(...args),
}));

vi.mock('@/lib/repositories/users', () => ({
  getUserById: (...args: unknown[]) => mockGetUserById(...args),
}));

vi.mock('@/lib/repositories/upload-jobs', () => ({
  createUploadJob: (...args: unknown[]) => mockCreateUploadJob(...args),
  findUploadJobForDistribution: (...args: unknown[]) => mockFindUploadJobForDistribution(...args),
  updateUploadJobStatus: (...args: unknown[]) => mockUpdateUploadJobStatus(...args),
  getUploadJobById: (...args: unknown[]) => mockGetUploadJobById(...args),
}));

vi.mock('@/lib/repositories/platform-uploads', () => ({
  ensurePlatformUploadsForJobTargets: (...args: unknown[]) =>
    mockEnsurePlatformUploadsForJobTargets(...args),
  createPlatformUpload: (...args: unknown[]) => mockCreatePlatformUpload(...args),
  getPlatformUploadsByJob: (...args: unknown[]) => mockGetPlatformUploadsByJob(...args),
  updatePlatformUploadStatus: (...args: unknown[]) => mockUpdatePlatformUploadStatus(...args),
}));

vi.mock('@/lib/repositories/connected-accounts', () => ({
  getConnectedAccountWithTokens: (...args: unknown[]) => mockGetConnectedAccountWithTokens(...args),
  updateTokens: (...args: unknown[]) => mockUpdateTokens(...args),
}));

vi.mock('@/lib/r2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/r2')>();
  return {
    ...actual,
    getObjectWebStream: (...args: unknown[]) => mockGetObjectWebStream(...args),
    getObjectNodeStream: (...args: unknown[]) => mockGetObjectNodeStream(...args),
    headObjectMetadata: (...args: unknown[]) => mockHeadObjectMetadata(...args),
    deleteObject: (...args: unknown[]) => mockDeleteObject(...args),
  };
});

vi.mock('@/lib/platforms/youtube', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/platforms/youtube')>();
  return {
    ...actual,
    uploadToYouTube: (...args: unknown[]) => mockUploadToYouTube(...args),
    refreshYouTubeAccessToken: (...args: unknown[]) => mockRefreshYouTubeAccessToken(...args),
  };
});

vi.mock('@/lib/platforms/token-refresh', () => ({
  refreshTokenIfNeeded: (...args: unknown[]) => mockRefreshTokenIfNeeded(...args),
  TOKEN_REFRESH_LEAD_MS: 300000,
}));

vi.mock('@/lib/platforms/vimeo', () => ({
  uploadToVimeo: (...args: unknown[]) => mockUploadToVimeo(...args),
}));

vi.mock('@/lib/platforms/google-drive', () => ({
  uploadToGoogleDrive: (...args: unknown[]) => mockUploadToGoogleDrive(...args),
}));

vi.mock('@/lib/platforms/sftp', () => ({
  uploadToSftp: (...args: unknown[]) => mockUploadToSftp(...args),
}));

vi.mock('@/lib/platforms/smb', () => ({
  uploadToSmb: (...args: unknown[]) => mockUploadToSmb(...args),
}));

import { POST } from '@/app/api/uploads/distribute/route';

const SESSION_COOKIE = 'videosphere_session';

function createRequest(
  body: Record<string, unknown>,
  cookies: Record<string, string> = {}
): NextRequest {
  const url = new URL('http://localhost:3000/api/uploads/distribute');
  const cookieHeader = Object.entries(cookies)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');

  const init: RequestInit = {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
  };

  return new NextRequest(url, init);
}

describe('POST /api/uploads/distribute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthenticatedUserId.mockResolvedValue('user-123');

    mockGetDraftById.mockResolvedValue({
      id: 'draft-1',
      userId: 'user-123',
      targets: ['youtube', 'vimeo'],
      title: 'My title',
      description: 'My description',
      visibility: 'private',
      tags: ['tag-1', 'tag-2'],
      platforms: {},
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    });

    mockGetUserById.mockResolvedValue({
      userId: 'user-123',
      email: 'test@example.com',
      role: 'user',
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    });

    mockCreateUploadJob.mockResolvedValue({
      id: 'job-123',
      userId: 'user-123',
      draftId: 'draft-1',
      r2Key: 'temp/uploads/user-123/video.mp4',
      status: 'pending',
      errorMessage: null,
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    });

    mockFindUploadJobForDistribution.mockResolvedValue({
      id: 'job-123',
      userId: 'user-123',
      draftId: 'draft-1',
      r2Key: 'temp/uploads/user-123/video.mp4',
      status: 'uploading',
      errorMessage: null,
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    });

    mockUpdateUploadJobStatus.mockResolvedValue({
      id: 'job-123',
      userId: 'user-123',
      draftId: 'draft-1',
      r2Key: 'temp/uploads/user-123/video.mp4',
      status: 'distributing',
      errorMessage: null,
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    });

    mockGetUploadJobById.mockResolvedValue({
      id: 'job-123',
      userId: 'user-123',
      draftId: 'draft-1',
      r2Key: 'temp/uploads/user-123/video.mp4',
      status: 'distributing',
      errorMessage: null,
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    });

    mockUpdateDraft.mockResolvedValue(null);

    mockCreatePlatformUpload.mockImplementation(
      async (data: {
        platform: string;
        title: string;
        description: string;
        tags: string[];
        visibility: string;
      }) => ({
        id: `pu-${data.platform}`,
        uploadJobId: 'job-123',
        platform: data.platform,
        status: 'pending',
        platformVideoId: '',
        platformUrl: '',
        title: data.title,
        description: data.description,
        tags: data.tags,
        visibility: data.visibility,
        scheduledAt: null,
        errorMessage: null,
        $createdAt: '2000-01-01T00:00:00.000Z',
        $updatedAt: '2000-01-01T00:00:00.000Z',
      })
    );

    mockUpdateTokens.mockResolvedValue({
      id: 'ca-youtube',
      userId: 'user-123',
      platform: 'youtube',
      tokenExpiry: new Date(Date.now() + 3600_000).toISOString(),
      hasRefreshToken: true,
      platformUserId: 'channel-1',
      platformName: 'Test Channel',
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    });

    mockRefreshYouTubeAccessToken.mockResolvedValue({
      ok: true,
      accessToken: 'new-access-token',
      refreshToken: 'refresh-token',
      tokenExpiry: new Date(Date.now() + 3600_000).toISOString(),
    });

    mockRefreshTokenIfNeeded.mockImplementation(
      async (account: { accessToken: string; refreshToken: string; tokenExpiry: string }) => ({
        accessToken: account.accessToken,
        refreshToken: account.refreshToken,
        tokenExpiry:
          account.tokenExpiry?.trim() !== ''
            ? account.tokenExpiry
            : new Date(Date.now() + 3600_000).toISOString(),
      })
    );

    mockGetObjectWebStream.mockResolvedValue({
      stream: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
      contentLength: 1024,
      contentType: 'video/mp4',
    });
    mockHeadObjectMetadata.mockResolvedValue({
      contentLength: 1024,
      contentType: 'video/mp4',
    });
    mockGetObjectNodeStream.mockResolvedValue({
      readable: Readable.from([]),
      contentLength: 1024,
      contentType: 'video/mp4',
    });
    mockDeleteObject.mockResolvedValue(undefined);

    mockGetConnectedAccountWithTokens.mockResolvedValue({
      id: 'acct-1',
      userId: 'user-123',
      platform: 'youtube',
      accessToken: 'token',
      refreshToken: '',
      tokenExpiry: '',
      hasRefreshToken: false,
      platformUserId: 'p1',
      platformName: 'n1',
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    });

    mockUploadToYouTube.mockResolvedValue({
      ok: true,
      platformVideoId: 'yt-1',
      platformUrl: 'https://youtube.com/watch?v=yt-1',
    });

    mockUploadToVimeo.mockResolvedValue({
      ok: true,
      platformVideoId: 'vm-1',
      platformUrl: 'https://vimeo.com/vm-1',
    });

    mockUploadToGoogleDrive.mockResolvedValue({
      ok: true,
      platformVideoId: 'drive-1',
      platformUrl: 'https://drive.google.com/file/d/drive-1/view',
    });

    mockUploadToSftp.mockResolvedValue({
      ok: true,
      platformVideoId: '/backups/file.mp4',
      platformUrl: 'sftp://sftp.example.com/backups/file.mp4',
    });

    mockUploadToSmb.mockResolvedValue({
      ok: true,
      platformVideoId: '\\VideoSphere\\file.mp4',
      platformUrl: 'smb://192.168.1.10/Backups/VideoSphere/file.mp4',
    });

    mockUpdatePlatformUploadStatus.mockImplementation(async (id: string, status: string) => ({
      id,
      uploadJobId: 'job-123',
      platform: id.includes('vimeo')
        ? 'vimeo'
        : id.includes('google_drive')
          ? 'google_drive'
          : id.includes('sftp')
            ? 'sftp'
            : id.includes('smb')
              ? 'smb'
              : 'youtube',
      status,
      platformVideoId: '',
      platformUrl: '',
      title: '',
      description: '',
      tags: [] as string[],
      visibility: 'private' as const,
      scheduledAt: null,
      errorMessage: null,
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    }));
    mockGetPlatformUploadsByJob.mockResolvedValue([
      { id: 'pu-youtube', platform: 'youtube', status: 'completed' },
      { id: 'pu-vimeo', platform: 'vimeo', status: 'completed' },
    ]);

    mockEnsurePlatformUploadsForJobTargets.mockImplementation(
      async (inputs: CreatePlatformUploadInput[]) =>
        Promise.all(inputs.map((input) => mockCreatePlatformUpload(input)))
    );
  });

  it('returns 401 when user is not authenticated', async () => {
    mockGetAuthenticatedUserId.mockResolvedValueOnce(null);
    const response = await POST(
      createRequest({ draftId: 'd1', r2ObjectKey: 'k1', platforms: ['youtube'] })
    );

    expect(response.status).toBe(401);
  });

  it('returns 400 for invalid payload', async () => {
    const response = await POST(
      createRequest({ draftId: 'd1', platforms: ['youtube'] }, { [SESSION_COOKIE]: 'token' })
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('r2ObjectKey');
  });

  it('applies free-tier limit to unique platforms only (duplicates do not count)', async () => {
    const response = await POST(
      createRequest(
        {
          draftId: 'draft-1',
          r2ObjectKey: 'temp/uploads/user-123/video.mp4',
          platforms: ['youtube', 'vimeo', 'youtube'],
        },
        { [SESSION_COOKIE]: 'token' }
      )
    );

    expect(response.status).toBe(202);
    expect(mockCreatePlatformUpload).toHaveBeenCalledTimes(2);
  });

  it('dedupes repeated platforms to a single upload row', async () => {
    const response = await POST(
      createRequest(
        {
          draftId: 'draft-1',
          r2ObjectKey: 'temp/uploads/user-123/video.mp4',
          platforms: ['youtube', 'youtube', 'youtube'],
        },
        { [SESSION_COOKIE]: 'token' }
      )
    );

    expect(response.status).toBe(202);
    expect(mockCreatePlatformUpload).toHaveBeenCalledTimes(1);
  });

  it('uses existing upload job + PlatformUpload rows and responds immediately with jobId', async () => {
    const response = await POST(
      createRequest(
        {
          draftId: 'draft-1',
          r2ObjectKey: 'temp/uploads/user-123/video.mp4',
          platforms: ['youtube', 'vimeo'],
        },
        { [SESSION_COOKIE]: 'token' }
      )
    );

    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.jobId).toBe('job-123');

    expect(mockCreateUploadJob).not.toHaveBeenCalled();
    expect(mockFindUploadJobForDistribution).toHaveBeenCalledWith({
      userId: 'user-123',
      draftId: 'draft-1',
      r2Key: 'temp/uploads/user-123/video.mp4',
    });
    expect(mockCreatePlatformUpload).toHaveBeenCalledTimes(2);
    expect(mockUpdateUploadJobStatus).toHaveBeenCalledWith('job-123', 'distributing', null);
  });

  it('returns 202 with same jobId when job is already distributing (idempotent client retry)', async () => {
    mockFindUploadJobForDistribution.mockResolvedValueOnce({
      id: 'job-123',
      userId: 'user-123',
      draftId: 'draft-1',
      r2Key: 'temp/uploads/user-123/video.mp4',
      status: 'distributing',
      errorMessage: null,
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    });

    const response = await POST(
      createRequest(
        {
          draftId: 'draft-1',
          r2ObjectKey: 'temp/uploads/user-123/video.mp4',
          platforms: ['youtube'],
        },
        { [SESSION_COOKIE]: 'token' }
      )
    );

    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.jobId).toBe('job-123');
    expect(mockUpdateUploadJobStatus).not.toHaveBeenCalled();
    expect(mockEnsurePlatformUploadsForJobTargets).not.toHaveBeenCalled();
  });

  it('returns 409 when job is distributing but request adds platforms not on the job', async () => {
    mockFindUploadJobForDistribution.mockResolvedValueOnce({
      id: 'job-123',
      userId: 'user-123',
      draftId: 'draft-1',
      r2Key: 'temp/uploads/user-123/video.mp4',
      status: 'distributing',
      errorMessage: null,
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    });

    mockGetPlatformUploadsByJob.mockResolvedValueOnce([
      {
        id: 'pu-youtube',
        uploadJobId: 'job-123',
        platform: 'youtube',
        status: 'uploading',
        platformVideoId: '',
        platformUrl: '',
        title: '',
        description: '',
        tags: [],
        visibility: 'private',
        scheduledAt: null,
        errorMessage: null,
        $createdAt: '2000-01-01T00:00:00.000Z',
        $updatedAt: '2000-01-01T00:00:00.000Z',
      },
    ]);

    const response = await POST(
      createRequest(
        {
          draftId: 'draft-1',
          r2ObjectKey: 'temp/uploads/user-123/video.mp4',
          platforms: ['youtube', 'vimeo'],
        },
        { [SESSION_COOKIE]: 'token' }
      )
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toMatch(/vimeo|not part of this job/i);
    expect(mockEnsurePlatformUploadsForJobTargets).not.toHaveBeenCalled();
  });

  it('returns 403 when r2ObjectKey is not under the user temp upload prefix', async () => {
    const response = await POST(
      createRequest(
        {
          draftId: 'draft-1',
          r2ObjectKey: 'temp/uploads/other-user/video.mp4',
          platforms: ['youtube'],
        },
        { [SESSION_COOKIE]: 'token' }
      )
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toMatch(/storage key|account/i);
    expect(mockCreateUploadJob).not.toHaveBeenCalled();
  });

  it('returns 400 when no upload job matches draftId and r2ObjectKey', async () => {
    mockFindUploadJobForDistribution.mockResolvedValueOnce(null);

    const response = await POST(
      createRequest(
        {
          draftId: 'draft-1',
          r2ObjectKey: 'temp/uploads/user-123/video.mp4',
          platforms: ['youtube'],
        },
        { [SESSION_COOKIE]: 'token' }
      )
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/upload job|Complete the upload/i);
    expect(mockCreateUploadJob).not.toHaveBeenCalled();
  });

  it('passes per-platform draft fields into createPlatformUpload for document snapshot', async () => {
    mockGetDraftById.mockResolvedValue({
      id: 'draft-1',
      userId: 'user-123',
      targets: ['youtube', 'vimeo'],
      title: 'T',
      description: 'D',
      visibility: 'public',
      tags: ['one'],
      platforms: {
        youtube: { categoryId: '22', madeForKids: true },
        vimeo: { categoryUris: ['/categories/docs'] },
      },
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    });

    const response = await POST(
      createRequest(
        {
          draftId: 'draft-1',
          r2ObjectKey: 'temp/uploads/user-123/video.mp4',
          platforms: ['youtube', 'vimeo'],
        },
        { [SESSION_COOKIE]: 'token' }
      )
    );

    expect(response.status).toBe(202);

    expect(mockCreatePlatformUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'youtube',
        categoryId: '22',
        madeForKids: true,
      })
    );
    expect(mockCreatePlatformUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'vimeo',
        vimeoCategoryUris: ['/categories/docs'],
      })
    );
  });

  it('reuses existing upload job from presign/complete instead of creating a new one', async () => {
    mockFindUploadJobForDistribution.mockResolvedValueOnce({
      id: 'job-existing',
      userId: 'user-123',
      draftId: 'draft-1',
      r2Key: 'temp/uploads/user-123/video.mp4',
      status: 'uploading',
      errorMessage: null,
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    });

    const response = await POST(
      createRequest(
        {
          draftId: 'draft-1',
          r2ObjectKey: 'temp/uploads/user-123/video.mp4',
          platforms: ['youtube'],
        },
        { [SESSION_COOKIE]: 'token' }
      )
    );

    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.jobId).toBe('job-existing');
    expect(mockCreateUploadJob).not.toHaveBeenCalled();
    expect(mockUpdateUploadJobStatus).toHaveBeenCalledWith('job-existing', 'distributing', null);
  });

  it('kicks off async distribution without blocking response', async () => {
    const response = await POST(
      createRequest(
        {
          draftId: 'draft-1',
          r2ObjectKey: 'temp/uploads/user-123/video.mp4',
          platforms: ['youtube'],
        },
        { [SESSION_COOKIE]: 'token' }
      )
    );

    expect(response.status).toBe(202);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockHeadObjectMetadata).toHaveBeenCalledWith(
      'temp/uploads/user-123/video.mp4',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(mockGetObjectWebStream).not.toHaveBeenCalled();
    expect(mockUploadToYouTube).toHaveBeenCalledTimes(1);
    expect(mockDeleteObject).toHaveBeenCalledWith('temp/uploads/user-123/video.mp4');
  });

  it('completes job when stale platform_upload rows exist but are not part of this attempt', async () => {
    mockEnsurePlatformUploadsForJobTargets.mockResolvedValueOnce([
      {
        id: 'pu-youtube',
        uploadJobId: 'job-123',
        platform: 'youtube',
        status: 'pending',
        platformVideoId: '',
        platformUrl: '',
        title: 'My title',
        description: 'My description',
        tags: ['tag-1', 'tag-2'],
        visibility: 'private',
        scheduledAt: null,
        errorMessage: null,
        $createdAt: '2000-01-01T00:00:00.000Z',
        $updatedAt: '2000-01-01T00:00:00.000Z',
      },
    ]);

    mockGetPlatformUploadsByJob.mockResolvedValueOnce([
      {
        id: 'orphan-vimeo',
        uploadJobId: 'job-123',
        platform: 'vimeo',
        status: 'failed',
        platformVideoId: '',
        platformUrl: '',
        title: '',
        description: '',
        tags: [],
        visibility: 'private',
        scheduledAt: null,
        errorMessage: 'stale failure from older attempt',
        $createdAt: '2000-01-01T00:00:00.000Z',
        $updatedAt: '2000-01-01T00:00:00.000Z',
      },
      {
        id: 'pu-youtube',
        uploadJobId: 'job-123',
        platform: 'youtube',
        status: 'completed',
        platformVideoId: 'yt-1',
        platformUrl: 'https://youtube.com/watch?v=yt-1',
        title: 'My title',
        description: 'My description',
        tags: ['tag-1', 'tag-2'],
        visibility: 'private',
        scheduledAt: null,
        errorMessage: null,
        $createdAt: '2000-01-01T00:00:00.000Z',
        $updatedAt: '2000-01-01T00:00:00.000Z',
      },
    ]);

    const response = await POST(
      createRequest(
        {
          draftId: 'draft-1',
          r2ObjectKey: 'temp/uploads/user-123/video.mp4',
          platforms: ['youtube'],
        },
        { [SESSION_COOKIE]: 'token' }
      )
    );

    expect(response.status).toBe(202);
    expect(mockCreatePlatformUpload).not.toHaveBeenCalled();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockUpdateUploadJobStatus).toHaveBeenCalledWith('job-123', 'completed', null);
    expect(mockDeleteObject).toHaveBeenCalledWith('temp/uploads/user-123/video.mp4');
  });

  it('clears per-platform thumbnail overrides and deletes R2 objects after successful distribution', async () => {
    const youtubeThumb = 'draft-thumbnails/user-123/draft-1/youtube-thumb.jpg';
    const vimeoThumb = 'draft-thumbnails/user-123/draft-1/vimeo-thumb.jpg';

    mockGetDraftById.mockResolvedValue({
      id: 'draft-1',
      userId: 'user-123',
      targets: ['youtube', 'vimeo'],
      title: 'My title',
      description: 'My description',
      visibility: 'private',
      tags: ['tag-1'],
      platforms: {
        youtube: {
          thumbnailR2KeyOverride: youtubeThumb,
          thumbnailContentTypeOverride: 'image/jpeg',
        },
        vimeo: {
          thumbnailR2KeyOverride: vimeoThumb,
          thumbnailContentTypeOverride: 'image/png',
        },
      },
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    });

    mockUpdateDraft.mockResolvedValue({
      id: 'draft-1',
      userId: 'user-123',
      targets: ['youtube', 'vimeo'],
      title: 'My title',
      description: 'My description',
      visibility: 'private',
      tags: ['tag-1'],
      platforms: {},
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    });

    const response = await POST(
      createRequest(
        {
          draftId: 'draft-1',
          r2ObjectKey: 'temp/uploads/user-123/video.mp4',
          platforms: ['youtube', 'vimeo'],
        },
        { [SESSION_COOKIE]: 'token' }
      )
    );

    expect(response.status).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockUpdateDraft).toHaveBeenCalledWith('draft-1', {
      platformsPatch: {
        youtube: {
          thumbnailR2KeyOverride: '',
          thumbnailContentTypeOverride: '',
        },
        vimeo: {
          thumbnailR2KeyOverride: '',
          thumbnailContentTypeOverride: '',
        },
      },
    });
    expect(mockDeleteObject).toHaveBeenCalledWith(youtubeThumb);
    expect(mockDeleteObject).toHaveBeenCalledWith(vimeoThumb);
  });

  it('clears draft thumbnail fields before deleting R2 object after successful distribution', async () => {
    mockGetDraftById.mockResolvedValue({
      id: 'draft-1',
      userId: 'user-123',
      targets: ['youtube'],
      title: 'My title',
      description: 'My description',
      visibility: 'private',
      tags: ['tag-1'],
      platforms: {},
      thumbnailR2Key: 'draft-thumbnails/user-123/draft-1/thumb-1.jpg',
      thumbnailContentType: 'image/jpeg',
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    });

    mockUpdateDraft.mockResolvedValue({
      id: 'draft-1',
      userId: 'user-123',
      targets: ['youtube'],
      title: 'My title',
      description: 'My description',
      visibility: 'private',
      tags: ['tag-1'],
      platforms: {},
      thumbnailR2Key: undefined,
      thumbnailContentType: undefined,
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    });

    const response = await POST(
      createRequest(
        {
          draftId: 'draft-1',
          r2ObjectKey: 'temp/uploads/user-123/video.mp4',
          platforms: ['youtube'],
        },
        { [SESSION_COOKIE]: 'token' }
      )
    );

    expect(response.status).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockDeleteObject).toHaveBeenCalledWith('draft-thumbnails/user-123/draft-1/thumb-1.jpg');
    expect(mockUpdateDraft).toHaveBeenCalledWith('draft-1', {
      thumbnailR2Key: null,
      thumbnailContentType: null,
    });
    // updateDraft (DB clear) must happen before deleteObject (R2 cleanup) so a failed
    // persistence write leaves the object intact rather than creating a stale key.
    const updateCallOrder = mockUpdateDraft.mock.invocationCallOrder[0];
    const deleteCallOrder = mockDeleteObject.mock.invocationCallOrder[1];
    expect(updateCallOrder).toBeLessThan(deleteCallOrder);
  });

  it('retains draft thumbnail fields when updateDraft fails during thumbnail cleanup', async () => {
    mockGetDraftById.mockResolvedValue({
      id: 'draft-1',
      userId: 'user-123',
      targets: ['youtube'],
      title: 'My title',
      description: 'My description',
      visibility: 'private',
      tags: ['tag-1'],
      platforms: {},
      thumbnailR2Key: 'draft-thumbnails/user-123/draft-1/thumb-2.jpg',
      thumbnailContentType: 'image/jpeg',
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    });

    mockUpdateDraft.mockRejectedValue(new Error('persistence error'));

    const response = await POST(
      createRequest(
        {
          draftId: 'draft-1',
          r2ObjectKey: 'temp/uploads/user-123/video.mp4',
          platforms: ['youtube'],
        },
        { [SESSION_COOKIE]: 'token' }
      )
    );

    expect(response.status).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // R2 delete must NOT have been called — draft retains its key so cleanup can be retried.
    expect(mockDeleteObject).not.toHaveBeenCalledWith(
      'draft-thumbnails/user-123/draft-1/thumb-2.jpg'
    );
  });

  it('skips thumbnail cleanup when draft key changed during distribution (user replaced thumbnail)', async () => {
    const originalKey = 'draft-thumbnails/user-123/draft-1/thumb-original.jpg';
    const replacedKey = 'draft-thumbnails/user-123/draft-1/thumb-replaced.jpg';

    const baseDraft = {
      id: 'draft-1',
      userId: 'user-123',
      targets: ['youtube'],
      title: 'My title',
      description: 'My description',
      visibility: 'private',
      tags: [],
      platforms: {},
      thumbnailContentType: 'image/jpeg',
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    };

    // First call: route handler fetches the draft to build metadata — original key is captured
    // into the metadataByPlatformId snapshot (buildMetadataForPlatform reads draft.thumbnailR2Key).
    mockGetDraftById.mockResolvedValueOnce({ ...baseDraft, thumbnailR2Key: originalKey });
    // Subsequent calls (cleanup after distribution): user has already replaced the thumbnail.
    mockGetDraftById.mockResolvedValue({ ...baseDraft, thumbnailR2Key: replacedKey });

    const response = await POST(
      createRequest(
        {
          draftId: 'draft-1',
          r2ObjectKey: 'temp/uploads/user-123/video.mp4',
          platforms: ['youtube'],
        },
        { [SESSION_COOKIE]: 'token' }
      )
    );

    expect(response.status).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Neither the original nor the replaced thumbnail should be deleted.
    expect(mockDeleteObject).not.toHaveBeenCalledWith(originalKey);
    expect(mockDeleteObject).not.toHaveBeenCalledWith(replacedKey);
    expect(mockUpdateDraft).not.toHaveBeenCalledWith('draft-1', {
      thumbnailR2Key: null,
      thumbnailContentType: null,
    });
  });

  it('skips thumbnail cleanup when the job snapshot had no thumbnail (draft had none at distribution start)', async () => {
    const addedAfterKey = 'draft-thumbnails/user-123/draft-1/thumb-added-after.jpg';

    // First call: route handler fetches draft with no thumbnail — metadata snapshot captures undefined.
    mockGetDraftById.mockResolvedValueOnce({
      id: 'draft-1',
      userId: 'user-123',
      targets: ['youtube'],
      title: 'My title',
      description: 'My description',
      visibility: 'private',
      tags: [],
      platforms: {},
      thumbnailR2Key: undefined,
      thumbnailContentType: undefined,
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    });
    // Cleanup call: user added a thumbnail after distribution started.
    mockGetDraftById.mockResolvedValue({
      id: 'draft-1',
      userId: 'user-123',
      targets: ['youtube'],
      title: 'My title',
      description: 'My description',
      visibility: 'private',
      tags: [],
      platforms: {},
      thumbnailR2Key: addedAfterKey,
      thumbnailContentType: 'image/jpeg',
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    });

    const response = await POST(
      createRequest(
        {
          draftId: 'draft-1',
          r2ObjectKey: 'temp/uploads/user-123/video.mp4',
          platforms: ['youtube'],
        },
        { [SESSION_COOKIE]: 'token' }
      )
    );

    expect(response.status).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The thumbnail the user added after distribution must not be touched.
    expect(mockDeleteObject).not.toHaveBeenCalledWith(addedAfterKey);
    expect(mockUpdateDraft).not.toHaveBeenCalledWith('draft-1', {
      thumbnailR2Key: null,
      thumbnailContentType: null,
    });
  });

  it('retries updateDraft for thumbnail cleanup when first attempt fails transiently', async () => {
    vi.useFakeTimers();
    const thumbKey = 'draft-thumbnails/user-123/draft-1/thumb-retry.jpg';

    mockGetDraftById.mockResolvedValue({
      id: 'draft-1',
      userId: 'user-123',
      targets: ['youtube'],
      title: 'My title',
      description: 'My description',
      visibility: 'private',
      tags: [],
      platforms: {},
      thumbnailR2Key: thumbKey,
      thumbnailContentType: 'image/jpeg',
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    });
    mockUpdateDraft
      .mockRejectedValueOnce(new Error('transient persistence error'))
      .mockResolvedValueOnce({
        id: 'draft-1',
        userId: 'user-123',
        targets: ['youtube'],
        title: 'My title',
        description: 'My description',
        visibility: 'private',
        tags: [],
        platforms: {},
        $createdAt: '2000-01-01T00:00:00.000Z',
        $updatedAt: '2000-01-01T00:00:00.000Z',
      });

    const response = await POST(
      createRequest(
        {
          draftId: 'draft-1',
          r2ObjectKey: 'temp/uploads/user-123/video.mp4',
          platforms: ['youtube'],
        },
        { [SESSION_COOKIE]: 'token' }
      )
    );
    expect(response.status).toBe(202);

    await vi.runAllTimersAsync();

    try {
      expect(mockUpdateDraft).toHaveBeenCalledTimes(2);
      expect(mockUpdateDraft).toHaveBeenLastCalledWith('draft-1', {
        thumbnailR2Key: null,
        thumbnailContentType: null,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('logs error and retains R2 object when all updateDraft retry attempts fail during thumbnail cleanup', async () => {
    vi.useFakeTimers();
    const errLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const thumbKey = 'draft-thumbnails/user-123/draft-1/thumb-stale.jpg';

    mockGetDraftById.mockResolvedValue({
      id: 'draft-1',
      userId: 'user-123',
      targets: ['youtube'],
      title: 'My title',
      description: 'My description',
      visibility: 'private',
      tags: [],
      platforms: {},
      thumbnailR2Key: thumbKey,
      thumbnailContentType: 'image/jpeg',
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    });
    mockUpdateDraft.mockRejectedValue(new Error('persistence down'));

    const response = await POST(
      createRequest(
        {
          draftId: 'draft-1',
          r2ObjectKey: 'temp/uploads/user-123/video.mp4',
          platforms: ['youtube'],
        },
        { [SESSION_COOKIE]: 'token' }
      )
    );
    expect(response.status).toBe(202);

    await vi.runAllTimersAsync();

    try {
      expect(mockUpdateDraft).toHaveBeenCalledTimes(3);
      // deleteObject must not have been called — R2 object is retained since draft fields were not cleared.
      expect(mockDeleteObject).not.toHaveBeenCalledWith(thumbKey);
      const retainLog = errLog.mock.calls.find(
        (args) => typeof args[0] === 'string' && args[0].includes('retaining R2 keys for retry')
      );
      expect(retainLog).toBeDefined();
      expect(retainLog![0]).toContain('draft-1');
    } finally {
      errLog.mockRestore();
      vi.useRealTimers();
    }
  });

  it('uploads to Google Drive successfully when selected as a target', async () => {
    mockGetDraftById.mockResolvedValueOnce({
      id: 'draft-1',
      userId: 'user-123',
      targets: ['google_drive'],
      title: 'Backup title',
      description: 'Backup description',
      visibility: 'private',
      tags: ['backup'],
      platforms: {},
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    });

    mockGetPlatformUploadsByJob.mockResolvedValueOnce([
      {
        id: 'pu-google_drive',
        uploadJobId: 'job-123',
        platform: 'google_drive',
        status: 'completed',
        platformVideoId: 'drive-1',
        platformUrl: 'https://drive.google.com/file/d/drive-1/view',
        title: '',
        description: '',
        tags: [],
        visibility: 'private',
        scheduledAt: null,
        errorMessage: null,
        $createdAt: '2000-01-01T00:00:00.000Z',
        $updatedAt: '2000-01-01T00:00:00.000Z',
      },
    ]);

    const response = await POST(
      createRequest(
        {
          draftId: 'draft-1',
          r2ObjectKey: 'temp/uploads/user-123/video.mp4',
          platforms: ['google_drive'],
        },
        { [SESSION_COOKIE]: 'token' }
      )
    );

    expect(response.status).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockUploadToGoogleDrive).toHaveBeenCalledTimes(1);
    expect(mockUpdatePlatformUploadStatus).toHaveBeenCalledWith(
      'pu-google_drive',
      'completed',
      'drive-1',
      'https://drive.google.com/file/d/drive-1/view',
      null
    );
  });

  it('marks Google Drive platform failed when account is missing without affecting other targets', async () => {
    mockGetConnectedAccountWithTokens.mockImplementation(
      async (_userId: string, platform: string) =>
        platform === 'google_drive'
          ? null
          : {
              id: `acct-${platform}`,
              userId: 'user-123',
              platform,
              accessToken: 'token',
              refreshToken: '',
              tokenExpiry: '',
              hasRefreshToken: false,
              platformUserId: 'p1',
              platformName: 'n1',
              $createdAt: '2000-01-01T00:00:00.000Z',
              $updatedAt: '2000-01-01T00:00:00.000Z',
            }
    );

    mockGetPlatformUploadsByJob.mockResolvedValueOnce([
      {
        id: 'pu-google_drive',
        uploadJobId: 'job-123',
        platform: 'google_drive',
        status: 'failed',
        platformVideoId: '',
        platformUrl: '',
        title: '',
        description: '',
        tags: [],
        visibility: 'private',
        scheduledAt: null,
        errorMessage: 'No connected google_drive account found.',
        $createdAt: '2000-01-01T00:00:00.000Z',
        $updatedAt: '2000-01-01T00:00:00.000Z',
      },
      {
        id: 'pu-youtube',
        uploadJobId: 'job-123',
        platform: 'youtube',
        status: 'completed',
        platformVideoId: 'yt-1',
        platformUrl: 'https://youtube.com/watch?v=yt-1',
        title: '',
        description: '',
        tags: [],
        visibility: 'private',
        scheduledAt: null,
        errorMessage: null,
        $createdAt: '2000-01-01T00:00:00.000Z',
        $updatedAt: '2000-01-01T00:00:00.000Z',
      },
    ]);

    const response = await POST(
      createRequest(
        {
          draftId: 'draft-1',
          r2ObjectKey: 'temp/uploads/user-123/video.mp4',
          platforms: ['google_drive', 'youtube'],
        },
        { [SESSION_COOKIE]: 'token' }
      )
    );

    expect(response.status).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockUpdatePlatformUploadStatus).toHaveBeenCalledWith(
      'pu-google_drive',
      'failed',
      undefined,
      undefined,
      'No connected google_drive account found.'
    );
    expect(mockUpdatePlatformUploadStatus).toHaveBeenCalledWith(
      'pu-youtube',
      'completed',
      'yt-1',
      'https://youtube.com/watch?v=yt-1',
      null
    );
  });

  it('marks Google Drive as failed when Drive API upload fails while preserving other results', async () => {
    mockUploadToGoogleDrive.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'GOOGLE_DRIVE_UPLOAD_FAILED',
        message: 'Google Drive upload failed',
        statusCode: 500,
      },
    });

    mockGetConnectedAccountWithTokens.mockImplementation(
      async (_userId: string, platform: string) => ({
        id: `acct-${platform}`,
        userId: 'user-123',
        platform,
        accessToken: 'token',
        refreshToken: '',
        tokenExpiry: '',
        hasRefreshToken: false,
        platformUserId: 'p1',
        platformName: 'n1',
        $createdAt: '2000-01-01T00:00:00.000Z',
        $updatedAt: '2000-01-01T00:00:00.000Z',
      })
    );

    mockGetPlatformUploadsByJob.mockResolvedValueOnce([
      {
        id: 'pu-google_drive',
        uploadJobId: 'job-123',
        platform: 'google_drive',
        status: 'failed',
        platformVideoId: '',
        platformUrl: '',
        title: '',
        description: '',
        tags: [],
        visibility: 'private',
        scheduledAt: null,
        errorMessage: 'GOOGLE_DRIVE_UPLOAD_FAILED: Google Drive upload failed (HTTP 500)',
        $createdAt: '2000-01-01T00:00:00.000Z',
        $updatedAt: '2000-01-01T00:00:00.000Z',
      },
      {
        id: 'pu-vimeo',
        uploadJobId: 'job-123',
        platform: 'vimeo',
        status: 'completed',
        platformVideoId: 'vm-1',
        platformUrl: 'https://vimeo.com/vm-1',
        title: '',
        description: '',
        tags: [],
        visibility: 'private',
        scheduledAt: null,
        errorMessage: null,
        $createdAt: '2000-01-01T00:00:00.000Z',
        $updatedAt: '2000-01-01T00:00:00.000Z',
      },
    ]);

    const response = await POST(
      createRequest(
        {
          draftId: 'draft-1',
          r2ObjectKey: 'temp/uploads/user-123/video.mp4',
          platforms: ['google_drive', 'vimeo'],
        },
        { [SESSION_COOKIE]: 'token' }
      )
    );

    expect(response.status).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockUpdatePlatformUploadStatus).toHaveBeenCalledWith(
      'pu-google_drive',
      'failed',
      undefined,
      undefined,
      'GOOGLE_DRIVE_UPLOAD_FAILED: Google Drive upload failed (HTTP 500)'
    );
    expect(mockUpdatePlatformUploadStatus).toHaveBeenCalledWith(
      'pu-vimeo',
      'completed',
      'vm-1',
      'https://vimeo.com/vm-1',
      null
    );
  });

  it('uploads to SFTP successfully when selected as a target', async () => {
    mockGetDraftById.mockResolvedValueOnce({
      id: 'draft-1',
      userId: 'user-123',
      targets: ['sftp'],
      title: 'Backup title',
      description: 'Backup description',
      visibility: 'private',
      tags: ['backup'],
      platforms: {},
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    });

    mockGetPlatformUploadsByJob.mockResolvedValueOnce([
      {
        id: 'pu-sftp',
        uploadJobId: 'job-123',
        platform: 'sftp',
        status: 'completed',
        platformVideoId: '/backups/file.mp4',
        platformUrl: 'sftp://sftp.example.com/backups/file.mp4',
        title: '',
        description: '',
        tags: [],
        visibility: 'private',
        scheduledAt: null,
        errorMessage: null,
        $createdAt: '2000-01-01T00:00:00.000Z',
        $updatedAt: '2000-01-01T00:00:00.000Z',
      },
    ]);

    const response = await POST(
      createRequest(
        {
          draftId: 'draft-1',
          r2ObjectKey: 'temp/uploads/user-123/video.mp4',
          platforms: ['sftp'],
        },
        { [SESSION_COOKIE]: 'token' }
      )
    );

    expect(response.status).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockUploadToSftp).toHaveBeenCalledTimes(1);
    expect(mockUpdatePlatformUploadStatus).toHaveBeenCalledWith(
      'pu-sftp',
      'completed',
      '/backups/file.mp4',
      'sftp://sftp.example.com/backups/file.mp4',
      null
    );
  });

  it('updates platform statuses independently and marks job failed when any platform fails', async () => {
    mockCreatePlatformUpload.mockImplementation(
      async (data: {
        platform: string;
        title: string;
        description: string;
        tags: string[];
        visibility: string;
      }) => ({
        id: `pu-${data.platform}`,
        uploadJobId: 'job-123',
        platform: data.platform,
        status: 'pending',
        platformVideoId: '',
        platformUrl: '',
        title: data.title,
        description: data.description,
        tags: data.tags,
        visibility: data.visibility,
        scheduledAt: null,
        errorMessage: null,
        $createdAt: '2000-01-01T00:00:00.000Z',
        $updatedAt: '2000-01-01T00:00:00.000Z',
      })
    );

    mockUploadToYouTube.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'YOUTUBE_UPLOAD_FAILED',
        message: 'YouTube upload failed',
      },
    });

    mockUploadToVimeo.mockResolvedValueOnce({
      ok: true,
      platformVideoId: 'vm-9',
      platformUrl: 'https://vimeo.com/vm-9',
    });

    mockGetConnectedAccountWithTokens.mockImplementation(
      async (_userId: string, platform: string) => ({
        id: `acct-${platform}`,
        userId: 'user-123',
        platform,
        accessToken: 'token',
        refreshToken: '',
        tokenExpiry: '',
        hasRefreshToken: false,
        platformUserId: 'p1',
        platformName: 'n1',
        $createdAt: '2000-01-01T00:00:00.000Z',
        $updatedAt: '2000-01-01T00:00:00.000Z',
      })
    );

    mockGetPlatformUploadsByJob.mockResolvedValueOnce([
      {
        id: 'pu-youtube',
        uploadJobId: 'job-123',
        platform: 'youtube',
        status: 'failed',
        platformVideoId: '',
        platformUrl: '',
        title: '',
        description: '',
        tags: [],
        visibility: 'private',
        scheduledAt: null,
        errorMessage: 'YouTube upload failed',
        $createdAt: '2000-01-01T00:00:00.000Z',
        $updatedAt: '2000-01-01T00:00:00.000Z',
      },
      {
        id: 'pu-vimeo',
        uploadJobId: 'job-123',
        platform: 'vimeo',
        status: 'completed',
        platformVideoId: 'vm-9',
        platformUrl: 'https://vimeo.com/vm-9',
        title: '',
        description: '',
        tags: [],
        visibility: 'private',
        scheduledAt: null,
        errorMessage: null,
        $createdAt: '2000-01-01T00:00:00.000Z',
        $updatedAt: '2000-01-01T00:00:00.000Z',
      },
    ]);

    const response = await POST(
      createRequest(
        {
          draftId: 'draft-1',
          r2ObjectKey: 'temp/uploads/user-123/video.mp4',
          platforms: ['youtube', 'vimeo'],
        },
        { [SESSION_COOKIE]: 'token' }
      )
    );

    expect(response.status).toBe(202);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockUpdatePlatformUploadStatus).toHaveBeenCalledWith(
      'pu-youtube',
      'failed',
      undefined,
      undefined,
      'YOUTUBE_UPLOAD_FAILED: YouTube upload failed'
    );

    expect(mockUpdatePlatformUploadStatus).toHaveBeenCalledWith(
      'pu-vimeo',
      'completed',
      'vm-9',
      'https://vimeo.com/vm-9',
      null
    );

    expect(mockUpdateUploadJobStatus).toHaveBeenCalledWith(
      'job-123',
      'failed',
      '1 platform upload(s) failed: youtube: YouTube upload failed'
    );
  });
});
