/**
 * Unit tests for `lib/api/distribute` retryability heuristics and upload deadline behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PlatformUpload } from '@/types';
import type { PlatformUploadMetadata, PlatformUploadResult } from '@/lib/platforms/types';
import type { uploadToSermonAudio } from '@/lib/platforms/sermon-audio';

const mockGetObjectWebStream = vi.fn();
const mockDeleteObject = vi.fn();
const mockGetConnectedAccountWithTokens = vi.fn();
const mockRefreshTokenIfNeeded = vi.fn();
const mockUploadToYouTube = vi.fn();
const mockUploadToVimeo = vi.fn();
const mockGetPlatformUploadsByJob = vi.fn();
const mockUpdatePlatformUploadStatus = vi.fn();
const mockUpdateUploadJobStatus = vi.fn();
const mockGetUploadJobById = vi.fn();
const mockUpdateTokens = vi.fn();
const mockUploadToSermonAudio = vi.fn<typeof uploadToSermonAudio>();
const mockPollSermonAudioProcessing = vi.fn();
const mockPublishSermonAudio = vi.fn();

vi.mock('@/lib/r2', () => ({
  getObjectWebStream: (...args: unknown[]) => mockGetObjectWebStream(...args),
  deleteObject: (...args: unknown[]) => mockDeleteObject(...args),
}));

vi.mock('@/lib/repositories/connected-accounts', () => ({
  getConnectedAccountWithTokens: (...args: unknown[]) => mockGetConnectedAccountWithTokens(...args),
  updateTokens: (...args: unknown[]) => mockUpdateTokens(...args),
}));

vi.mock('@/lib/repositories/platform-uploads', () => ({
  getPlatformUploadsByJob: (...args: unknown[]) => mockGetPlatformUploadsByJob(...args),
  updatePlatformUploadStatus: (...args: unknown[]) => mockUpdatePlatformUploadStatus(...args),
}));

vi.mock('@/lib/repositories/upload-jobs', () => ({
  getUploadJobById: (...args: unknown[]) => mockGetUploadJobById(...args),
  updateUploadJobStatus: (...args: unknown[]) => mockUpdateUploadJobStatus(...args),
}));

vi.mock('@/lib/repositories/drafts', () => ({
  getDraftById: vi.fn(),
  updateDraft: vi.fn(),
}));

vi.mock('@/lib/platforms/youtube', () => ({
  uploadToYouTube: (...args: unknown[]) => mockUploadToYouTube(...args),
  refreshYouTubeAccessToken: vi.fn(),
}));

vi.mock('@/lib/platforms/token-refresh', () => ({
  refreshTokenIfNeeded: (...args: unknown[]) => mockRefreshTokenIfNeeded(...args),
}));

vi.mock('@/lib/platforms/vimeo', () => ({
  uploadToVimeo: (...args: unknown[]) => mockUploadToVimeo(...args),
}));

vi.mock('@/lib/platforms/sermon-audio', () => ({
  uploadToSermonAudio: (...args: Parameters<typeof uploadToSermonAudio>) =>
    mockUploadToSermonAudio(...args),
  pollSermonAudioProcessing: (...args: unknown[]) => mockPollSermonAudioProcessing(...args),
  publishSermonAudio: (...args: unknown[]) => mockPublishSermonAudio(...args),
}));

vi.mock('@/lib/platforms/google-drive', () => ({
  uploadToGoogleDrive: vi.fn(),
}));

vi.mock('@/lib/platforms/sftp', () => ({
  uploadToSftp: vi.fn(),
}));

vi.mock('@/lib/platforms/smb', () => ({
  uploadToSmb: vi.fn(),
}));

import { runDistributionInBackground } from '@/lib/api/distribute';
import { assessPlatformUploadRetryability } from '@/lib/utils/retryability';
import { isPlatformUploadRowActive } from '@/lib/uploads/status';

const TWENTY_MIN_MS = 20 * 60 * 1000;
const TIMEOUT_MSG_SECONDS = Math.floor(TWENTY_MIN_MS / 1000);

function basePlatformUpload(overrides: Partial<PlatformUpload> = {}): PlatformUpload {
  return {
    id: 'pu-youtube',
    uploadJobId: 'job-1',
    platform: 'youtube',
    status: 'pending',
    platformVideoId: '',
    platformUrl: '',
    title: 'T',
    description: 'D',
    tags: [],
    visibility: 'private',
    scheduledAt: null,
    errorMessage: null,
    $createdAt: '2000-01-01T00:00:00.000Z',
    $updatedAt: '2000-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const baseMetadata: PlatformUploadMetadata = {
  title: 'T',
  description: 'D',
  tags: [],
  visibility: 'private',
};

type PlatformUploadSuccess = Extract<PlatformUploadResult, { ok: true }>;

function platformUploadSuccess(
  overrides: Partial<PlatformUploadSuccess> = {}
): PlatformUploadSuccess {
  return {
    ok: true,
    platformVideoId: 'platform-vid',
    platformUrl: 'https://example.com/platform-vid',
    ...overrides,
  };
}

describe('assessPlatformUploadRetryability', () => {
  it('treats null and blank messages as non-retryable', () => {
    expect(assessPlatformUploadRetryability(null).retryable).toBe(false);
    expect(assessPlatformUploadRetryability('').retryable).toBe(false);
    expect(assessPlatformUploadRetryability('   ').retryable).toBe(false);
    expect(assessPlatformUploadRetryability(null).reason).toMatch(/no error detail/i);
  });

  it('uses (HTTP nnn) in the message for status classification (case-insensitive)', () => {
    expect(assessPlatformUploadRetryability('Upstream (HTTP 429)').retryable).toBe(true);
    expect(assessPlatformUploadRetryability('x (http 408) y').retryable).toBe(true);
    expect(assessPlatformUploadRetryability('(HTTP 503)').retryable).toBe(true);
    expect(assessPlatformUploadRetryability('(HTTP 500)').retryable).toBe(true);
    expect(assessPlatformUploadRetryability('(HTTP 401)').retryable).toBe(false);
    expect(assessPlatformUploadRetryability('(HTTP 403)').retryable).toBe(false);
    expect(assessPlatformUploadRetryability('(HTTP 400)').retryable).toBe(false);
    expect(assessPlatformUploadRetryability('(HTTP 404)').retryable).toBe(false);
    expect(assessPlatformUploadRetryability('(HTTP 409)').retryable).toBe(false);
    expect(assessPlatformUploadRetryability('(HTTP 422)').retryable).toBe(false);
  });

  it('classifies HTTP 418 as non-retryable when not covered by explicit HTTP rules', () => {
    const r = assessPlatformUploadRetryability('Weird (HTTP 418) response');
    expect(r.retryable).toBe(false);
    expect(r.reason).toMatch(/does not match known transient/i);
  });

  it('prefers explicit HTTP classification over misleading keywords in the same message', () => {
    const r = assessPlatformUploadRetryability('(HTTP 403) forbidden scope');
    expect(r.retryable).toBe(false);
    expect(r.reason).toMatch(/HTTP 403/);
  });

  it('marks auth/quota/config keyword failures as non-retryable', () => {
    const keywords = [
      'Daily upload quota exceeded',
      'insufficient permissions',
      'invalid_grant from Google',
      'Token missing',
      'Refresh token is missing',
      'Please reconnect your account',
      'No connected youtube account',
      'Account no longer exists',
      'privacy violation',
      'category invalid',
    ];
    for (const msg of keywords) {
      expect(assessPlatformUploadRetryability(msg).retryable).toBe(false);
      expect(assessPlatformUploadRetryability(msg).reason).toMatch(/auth\/quota\/config/i);
    }
  });

  it('marks typical transient wording as retryable when no overriding HTTP status applies', () => {
    const samples = [
      'network error when calling API',
      'fetch failed',
      'The operation timed out',
      'timeout waiting for response',
      'ECONNRESET',
      'EAI_AGAIN',
      'socket hang up',
      'rate limit exceeded (soft)',
      'temporary failure',
      'service unavailable',
      'too many requests (client)',
    ];
    for (const msg of samples) {
      expect(assessPlatformUploadRetryability(msg).retryable).toBe(true);
      expect(assessPlatformUploadRetryability(msg).reason).toMatch(/transient/i);
    }
  });

  it('returns non-retryable for unknown generic errors', () => {
    const r = assessPlatformUploadRetryability('Something went wrong with the video file.');
    expect(r.retryable).toBe(false);
    expect(r.reason).toMatch(/does not match known transient/i);
  });
});

describe('runDistributionInBackground — platform upload timeout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockGetConnectedAccountWithTokens.mockResolvedValue({
      id: 'acct-1',
      userId: 'u1',
      platform: 'youtube',
      accessToken: 'tok',
      refreshToken: '',
      tokenExpiry: '',
      hasRefreshToken: false,
      platformUserId: 'p1',
      platformName: 'n',
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    });

    mockRefreshTokenIfNeeded.mockImplementation(
      async (account: { accessToken: string; refreshToken: string; tokenExpiry: string }) => ({
        accessToken: account.accessToken,
        refreshToken: account.refreshToken,
        tokenExpiry: account.tokenExpiry || new Date(Date.now() + 3600_000).toISOString(),
      })
    );

    mockGetObjectWebStream.mockImplementation(
      (_key: string, opts?: { signal?: AbortSignal }) =>
        new Promise((_, reject) => {
          const sig = opts?.signal;
          if (!sig) {
            reject(new Error('expected AbortSignal from distribute'));
            return;
          }
          if (sig.aborted) {
            reject(sig.reason instanceof Error ? sig.reason : new Error('Aborted'));
            return;
          }
          const onAbort = () => {
            reject(sig.reason instanceof Error ? sig.reason : new Error('Aborted'));
          };
          sig.addEventListener('abort', onAbort, { once: true });
        })
    );

    mockUpdatePlatformUploadStatus.mockImplementation(
      async (
        id: string,
        status: PlatformUpload['status'],
        _pv?: string,
        _pu?: string,
        err?: string | null
      ) => ({
        id,
        uploadJobId: 'job-1',
        platform: 'youtube',
        status,
        platformVideoId: '',
        platformUrl: '',
        title: '',
        description: '',
        tags: [],
        visibility: 'private' as const,
        scheduledAt: null,
        errorMessage: err ?? null,
        $createdAt: '2000-01-01T00:00:00.000Z',
        $updatedAt: '2000-01-01T00:00:00.000Z',
      })
    );

    const failedRow = basePlatformUpload({
      id: 'pu-youtube',
      status: 'failed',
      errorMessage: `youtube upload timed out after ${TIMEOUT_MSG_SECONDS}s`,
    });

    mockGetPlatformUploadsByJob.mockResolvedValue([failedRow]);

    mockUpdateUploadJobStatus.mockResolvedValue({
      id: 'job-1',
      userId: 'u1',
      draftId: 'd1',
      r2Key: 'temp/uploads/u1/v.mp4',
      status: 'failed',
      errorMessage: null,
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks the platform upload and job failed when the R2 read is aborted by the upload deadline', async () => {
    const pu = basePlatformUpload({ id: 'pu-youtube', platform: 'youtube' });
    const meta = new Map<string, PlatformUploadMetadata>([['pu-youtube', baseMetadata]]);

    const done = runDistributionInBackground('job-1', 'u1', 'temp/uploads/u1/v.mp4', [pu], meta);

    await vi.advanceTimersByTimeAsync(TWENTY_MIN_MS);
    await done;

    expect(mockUploadToYouTube).not.toHaveBeenCalled();

    expect(mockUpdatePlatformUploadStatus).toHaveBeenCalledWith(
      'pu-youtube',
      'uploading',
      undefined,
      undefined,
      undefined
    );

    expect(mockUpdatePlatformUploadStatus).toHaveBeenCalledWith(
      'pu-youtube',
      'failed',
      undefined,
      undefined,
      `youtube upload timed out after ${TIMEOUT_MSG_SECONDS}s`
    );

    expect(mockUpdateUploadJobStatus).toHaveBeenCalledWith(
      'job-1',
      'failed',
      expect.stringMatching(/platform upload\(s\) failed: youtube: youtube upload timed out/)
    );

    expect(mockDeleteObject).not.toHaveBeenCalled();
  });
});

function makeVideoStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  });
}

describe('runDistributionInBackground — SermonAudio auto-publish failure', () => {
  const sermonUrl = 'https://www.sermonaudio.com/sermons/sermon-123';

  function sermonAudioUploadSuccess(
    overrides: Partial<PlatformUploadSuccess> = {}
  ): PlatformUploadSuccess {
    return platformUploadSuccess({
      platformVideoId: 'sermon-123',
      platformUrl: sermonUrl,
      ...overrides,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();

    mockGetConnectedAccountWithTokens.mockResolvedValue({
      id: 'acct-sa',
      userId: 'u1',
      platform: 'sermon_audio',
      accessToken: 'sa-api-key',
      refreshToken: '',
      tokenExpiry: '',
      hasRefreshToken: false,
      platformUserId: 'broadcaster-1',
      platformName: 'Broadcaster',
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    });

    mockRefreshTokenIfNeeded.mockImplementation(
      async (account: { accessToken: string; refreshToken: string; tokenExpiry: string }) => ({
        accessToken: account.accessToken,
        refreshToken: account.refreshToken,
        tokenExpiry: account.tokenExpiry || new Date(Date.now() + 3600_000).toISOString(),
      })
    );

    mockGetObjectWebStream.mockResolvedValue({
      stream: makeVideoStream(),
      contentLength: 3,
      contentType: 'video/mp4',
    });

    mockUploadToSermonAudio.mockResolvedValue(sermonAudioUploadSuccess());

    mockUpdatePlatformUploadStatus.mockImplementation(
      async (
        id: string,
        status: PlatformUpload['status'],
        platformVideoId?: string,
        platformUrl?: string,
        err?: string | null
      ) => ({
        id,
        uploadJobId: 'job-1',
        platform: 'sermon_audio',
        status,
        platformVideoId: platformVideoId ?? '',
        platformUrl: platformUrl ?? '',
        title: '',
        description: '',
        tags: [],
        visibility: 'private' as const,
        scheduledAt: null,
        errorMessage: err ?? null,
        $createdAt: '2000-01-01T00:00:00.000Z',
        $updatedAt: '2000-01-01T00:00:00.000Z',
      })
    );

    mockGetPlatformUploadsByJob.mockResolvedValue([
      basePlatformUpload({
        id: 'pu-sa',
        platform: 'sermon_audio',
        status: 'unpublished',
        platformVideoId: 'sermon-123',
        platformUrl: sermonUrl,
      }),
    ]);

    mockUpdateUploadJobStatus.mockResolvedValue({
      id: 'job-1',
      userId: 'u1',
      draftId: 'd1',
      r2Key: 'temp/uploads/u1/v.mp4',
      status: 'completed',
      errorMessage: null,
      $createdAt: '2000-01-01T00:00:00.000Z',
      $updatedAt: '2000-01-01T00:00:00.000Z',
    });

    mockGetUploadJobById.mockResolvedValue(null);
    mockDeleteObject.mockResolvedValue(undefined);
  });

  it('persists failed status and errorMessage when auto-publish poll/publish fails', async () => {
    const processingError = new Error('SermonAudio transcoding failed') as Error & {
      code: string;
    };
    processingError.code = 'SERMONAUDIO_PROCESSING_FAILED';
    mockPollSermonAudioProcessing.mockRejectedValue(processingError);

    const pu = basePlatformUpload({ id: 'pu-sa', platform: 'sermon_audio' });
    const meta = new Map<string, PlatformUploadMetadata>([
      [
        'pu-sa',
        {
          ...baseMetadata,
          autoPublishOnProcessed: true,
        },
      ],
    ]);

    await runDistributionInBackground('job-1', 'u1', 'temp/uploads/u1/v.mp4', [pu], meta);

    await vi.waitFor(() => {
      expect(mockPollSermonAudioProcessing).toHaveBeenCalledWith(
        expect.objectContaining({
          sermonID: 'sermon-123',
          customThumbnailUploaded: false,
        })
      );
    });

    await vi.waitFor(() => {
      expect(mockUpdatePlatformUploadStatus).toHaveBeenCalledWith(
        'pu-sa',
        'failed',
        'sermon-123',
        sermonUrl,
        'SERMONAUDIO_PROCESSING_FAILED: SermonAudio transcoding failed'
      );
    });

    expect(mockPublishSermonAudio).not.toHaveBeenCalled();
    expect(
      isPlatformUploadRowActive({
        platform: 'sermon_audio',
        status: 'failed',
        sermonAudioAutoPublishOnProcessed: true,
      })
    ).toBe(false);
  });

  it('passes customThumbnailUploaded true to poll when thumbnail upload succeeded', async () => {
    mockUploadToSermonAudio.mockResolvedValue(
      sermonAudioUploadSuccess({ sermonAudioCustomThumbnailUploaded: true })
    );
    mockPollSermonAudioProcessing.mockResolvedValue(undefined);
    mockPublishSermonAudio.mockResolvedValue(undefined);

    const pu = basePlatformUpload({ id: 'pu-sa', platform: 'sermon_audio' });
    const meta = new Map<string, PlatformUploadMetadata>([
      [
        'pu-sa',
        {
          ...baseMetadata,
          autoPublishOnProcessed: true,
          thumbnailR2Key: 'draft-thumbnails/u1/thumb.jpg',
        },
      ],
    ]);

    await runDistributionInBackground('job-1', 'u1', 'temp/uploads/u1/v.mp4', [pu], meta);

    await vi.waitFor(() => {
      expect(mockPollSermonAudioProcessing).toHaveBeenCalledWith(
        expect.objectContaining({
          sermonID: 'sermon-123',
          customThumbnailUploaded: true,
        })
      );
    });
  });

  it('persists failed status when auto-publish cannot run without a captured API key', async () => {
    mockRefreshTokenIfNeeded.mockResolvedValue({
      accessToken: '',
      refreshToken: '',
      tokenExpiry: new Date(Date.now() + 3600_000).toISOString(),
    });

    const pu = basePlatformUpload({ id: 'pu-sa', platform: 'sermon_audio' });
    const meta = new Map<string, PlatformUploadMetadata>([
      [
        'pu-sa',
        {
          ...baseMetadata,
          autoPublishOnProcessed: true,
        },
      ],
    ]);

    await runDistributionInBackground('job-1', 'u1', 'temp/uploads/u1/v.mp4', [pu], meta);

    await vi.waitFor(() => {
      expect(mockUpdatePlatformUploadStatus).toHaveBeenCalledWith(
        'pu-sa',
        'failed',
        'sermon-123',
        sermonUrl,
        'SermonAudio API key was not captured during upload; auto-publish could not run.'
      );
    });

    expect(mockPollSermonAudioProcessing).not.toHaveBeenCalled();
    expect(mockPublishSermonAudio).not.toHaveBeenCalled();
  });
});
