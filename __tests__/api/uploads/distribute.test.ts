/**
 * Tests for POST /api/uploads/distribute
 *
 * Verifies auth requirement, validation, free-tier platform limit,
 * record creation, and immediate async kickoff response.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
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

  function MockAccount() {
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

const mockGetDraftById = vi.fn();
const mockGetUserById = vi.fn();
const mockCreateUploadJob = vi.fn();
const mockListUploadJobsByUser = vi.fn();
const mockUpdateUploadJobStatus = vi.fn();
const mockCreatePlatformUpload = vi.fn();
const mockEnsurePlatformUploadsForJobTargets = vi.fn();
const mockGetConnectedAccountWithTokens = vi.fn();
const mockUpdateTokens = vi.fn();
const mockGetObjectWebStream = vi.fn();
const mockDeleteObject = vi.fn();
const mockUploadToYouTube = vi.fn();
const mockRefreshYouTubeAccessToken = vi.fn();
const mockUploadToVimeo = vi.fn();
const mockGetPlatformUploadsByJob = vi.fn();
const mockUpdatePlatformUploadStatus = vi.fn();

vi.mock('@/lib/repositories/drafts', () => ({
  getDraftById: (...args: unknown[]) => mockGetDraftById(...args),
}));

vi.mock('@/lib/repositories/users', () => ({
  getUserById: (...args: unknown[]) => mockGetUserById(...args),
}));

vi.mock('@/lib/repositories/upload-jobs', () => ({
  createUploadJob: (...args: unknown[]) => mockCreateUploadJob(...args),
  listUploadJobsByUser: (...args: unknown[]) => mockListUploadJobsByUser(...args),
  updateUploadJobStatus: (...args: unknown[]) => mockUpdateUploadJobStatus(...args),
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

vi.mock('@/lib/platforms/vimeo', () => ({
  uploadToVimeo: (...args: unknown[]) => mockUploadToVimeo(...args),
}));

import { POST } from '@/app/api/uploads/distribute/route';

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

    process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT = 'http://localhost/v1';
    process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID = 'test-project';

    mockGet.mockResolvedValue({ $id: 'user-123' });

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
      isSupporter: false,
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

    mockListUploadJobsByUser.mockResolvedValue([
      {
        id: 'job-123',
        userId: 'user-123',
        draftId: 'draft-1',
        r2Key: 'temp/uploads/user-123/video.mp4',
        status: 'uploading',
        errorMessage: null,
        $createdAt: '2000-01-01T00:00:00.000Z',
        $updatedAt: '2000-01-01T00:00:00.000Z',
      },
    ]);

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

    mockGetObjectWebStream.mockResolvedValue({
      stream: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
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

    mockUpdatePlatformUploadStatus.mockResolvedValue(null);
    mockGetPlatformUploadsByJob.mockResolvedValue([
      { id: 'pu-youtube', status: 'completed' },
      { id: 'pu-vimeo', status: 'completed' },
    ]);

    mockEnsurePlatformUploadsForJobTargets.mockImplementation(
      async (inputs: CreatePlatformUploadInput[]) =>
        Promise.all(inputs.map((input) => mockCreatePlatformUpload(input)))
    );
  });

  it('returns 401 when user is not authenticated', async () => {
    const response = await POST(
      createRequest({ draftId: 'd1', r2ObjectKey: 'k1', platforms: ['youtube'] })
    );

    expect(response.status).toBe(401);
  });

  it('returns 400 for invalid payload', async () => {
    const response = await POST(
      createRequest(
        { draftId: 'd1', platforms: ['youtube'] },
        { 'a_session_test-project': 'token' }
      )
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
        { 'a_session_test-project': 'token' }
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
        { 'a_session_test-project': 'token' }
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
        { 'a_session_test-project': 'token' }
      )
    );

    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.jobId).toBe('job-123');

    expect(mockCreateUploadJob).not.toHaveBeenCalled();
    expect(mockListUploadJobsByUser).toHaveBeenCalled();
    expect(mockCreatePlatformUpload).toHaveBeenCalledTimes(2);
    expect(mockUpdateUploadJobStatus).toHaveBeenCalledWith('job-123', 'distributing', null);
  });

  it('returns 403 when r2ObjectKey is not under the user temp upload prefix', async () => {
    const response = await POST(
      createRequest(
        {
          draftId: 'draft-1',
          r2ObjectKey: 'temp/uploads/other-user/video.mp4',
          platforms: ['youtube'],
        },
        { 'a_session_test-project': 'token' }
      )
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toMatch(/storage key|account/i);
    expect(mockCreateUploadJob).not.toHaveBeenCalled();
  });

  it('returns 400 when no upload job matches draftId and r2ObjectKey', async () => {
    mockListUploadJobsByUser.mockResolvedValueOnce([]);

    const response = await POST(
      createRequest(
        {
          draftId: 'draft-1',
          r2ObjectKey: 'temp/uploads/user-123/video.mp4',
          platforms: ['youtube'],
        },
        { 'a_session_test-project': 'token' }
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
        vimeo: { categoryUri: '/categories/docs' },
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
        { 'a_session_test-project': 'token' }
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
        vimeoCategoryUri: '/categories/docs',
      })
    );
  });

  it('reuses existing upload job from presign/complete instead of creating a new one', async () => {
    mockListUploadJobsByUser.mockResolvedValueOnce([
      {
        id: 'job-existing',
        userId: 'user-123',
        draftId: 'draft-1',
        r2Key: 'temp/uploads/user-123/video.mp4',
        status: 'uploading',
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
        { 'a_session_test-project': 'token' }
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
        { 'a_session_test-project': 'token' }
      )
    );

    expect(response.status).toBe(202);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockGetObjectWebStream).toHaveBeenCalledWith('temp/uploads/user-123/video.mp4');
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
        { 'a_session_test-project': 'token' }
      )
    );

    expect(response.status).toBe(202);
    expect(mockCreatePlatformUpload).not.toHaveBeenCalled();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockUpdateUploadJobStatus).toHaveBeenCalledWith('job-123', 'completed', null);
    expect(mockDeleteObject).toHaveBeenCalledWith('temp/uploads/user-123/video.mp4');
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
        { 'a_session_test-project': 'token' }
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
