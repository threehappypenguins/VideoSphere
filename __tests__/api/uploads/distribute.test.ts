/**
 * Tests for POST /api/uploads/distribute
 *
 * Verifies auth requirement, validation, free-tier platform limit,
 * record creation, and immediate async kickoff response.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

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
const mockGetConnectedAccountWithTokens = vi.fn();
const mockUpdateTokens = vi.fn();
const mockGetObjectUrl = vi.fn();
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
    getObjectUrl: (...args: unknown[]) => mockGetObjectUrl(...args),
    deleteObject: (...args: unknown[]) => mockDeleteObject(...args),
  };
});

vi.mock('@/lib/platforms/youtube', () => ({
  uploadToYouTube: (...args: unknown[]) => mockUploadToYouTube(...args),
  refreshYouTubeAccessToken: (...args: unknown[]) => mockRefreshYouTubeAccessToken(...args),
}));

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
      title: 'My title',
      description: 'My description',
      tags: ['tag-1', 'tag-2'],
      createdAt: '',
      updatedAt: '',
    });

    mockGetUserById.mockResolvedValue({
      userId: 'user-123',
      email: 'test@example.com',
      isSupporter: false,
      role: 'user',
      createdAt: '',
      updatedAt: '',
    });

    mockCreateUploadJob.mockResolvedValue({
      id: 'job-123',
      userId: 'user-123',
      draftId: 'draft-1',
      r2Key: 'temp/uploads/user-123/video.mp4',
      status: 'pending',
      errorMessage: null,
      createdAt: '',
      updatedAt: '',
    });

    mockListUploadJobsByUser.mockResolvedValue([]);

    mockUpdateUploadJobStatus.mockResolvedValue({
      id: 'job-123',
      userId: 'user-123',
      draftId: 'draft-1',
      r2Key: 'temp/uploads/user-123/video.mp4',
      status: 'distributing',
      errorMessage: null,
      createdAt: '',
      updatedAt: '',
    });

    mockCreatePlatformUpload.mockImplementation(async ({ platform }: { platform: string }) => ({
      id: `pu-${platform}`,
      uploadJobId: 'job-123',
      platform,
      status: 'pending',
      platformVideoId: '',
      platformUrl: '',
      title: 'My title',
      description: 'My description',
      tags: '["tag-1","tag-2"]',
      visibility: 'private',
      scheduledAt: null,
      errorMessage: null,
      createdAt: '',
      updatedAt: '',
    }));

    mockUpdateTokens.mockResolvedValue({
      id: 'ca-youtube',
      userId: 'user-123',
      platform: 'youtube',
      tokenExpiry: new Date(Date.now() + 3600_000).toISOString(),
      platformUserId: 'channel-1',
      platformName: 'Test Channel',
      createdAt: '',
      updatedAt: '',
    });

    mockRefreshYouTubeAccessToken.mockResolvedValue({
      ok: true,
      accessToken: 'new-access-token',
      refreshToken: 'refresh-token',
      tokenExpiry: new Date(Date.now() + 3600_000).toISOString(),
    });

    mockGetObjectUrl.mockResolvedValue('https://r2.example.com/video.mp4');
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
      createdAt: '',
      updatedAt: '',
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

  it('enforces free-tier platform limit of 2', async () => {
    const response = await POST(
      createRequest(
        { draftId: 'draft-1', r2ObjectKey: 'k1', platforms: ['youtube', 'vimeo', 'youtube'] },
        { 'a_session_test-project': 'token' }
      )
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toContain('at most 2 platforms');
  });

  it('creates UploadJob + PlatformUpload rows and responds immediately with jobId', async () => {
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

    expect(mockCreateUploadJob).toHaveBeenCalledWith({
      userId: 'user-123',
      draftId: 'draft-1',
      r2Key: 'temp/uploads/user-123/video.mp4',
    });

    expect(mockCreatePlatformUpload).toHaveBeenCalledTimes(2);
    expect(mockUpdateUploadJobStatus).toHaveBeenCalledWith('job-123', 'distributing', null);
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
        createdAt: '',
        updatedAt: '',
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

    expect(mockGetObjectUrl).toHaveBeenCalledWith('temp/uploads/user-123/video.mp4');
    expect(mockUploadToYouTube).toHaveBeenCalledTimes(1);
    expect(mockDeleteObject).toHaveBeenCalledWith('temp/uploads/user-123/video.mp4');
  });

  it('updates platform statuses independently and marks job failed when any platform fails', async () => {
    mockCreatePlatformUpload.mockImplementation(async ({ platform }: { platform: string }) => ({
      id: `pu-${platform}`,
      uploadJobId: 'job-123',
      platform,
      status: 'pending',
      platformVideoId: '',
      platformUrl: '',
      title: 'My title',
      description: 'My description',
      tags: '["tag-1","tag-2"]',
      visibility: 'private',
      scheduledAt: null,
      errorMessage: null,
      createdAt: '',
      updatedAt: '',
    }));

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
        createdAt: '',
        updatedAt: '',
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
        tags: '',
        visibility: 'private',
        scheduledAt: null,
        errorMessage: 'YouTube upload failed',
        createdAt: '',
        updatedAt: '',
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
        tags: '',
        visibility: 'private',
        scheduledAt: null,
        errorMessage: null,
        createdAt: '',
        updatedAt: '',
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
