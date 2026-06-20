import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformUpload, UploadJob } from '@/types';

const mockListStalePlatformUploads = vi.hoisted(() => vi.fn());
const mockListStaleSermonAudioUnpublishedPlatformUploads = vi.hoisted(() => vi.fn());
const mockListStaleUploadJobs = vi.hoisted(() => vi.fn());
const mockUpdatePlatformUploadStatus = vi.hoisted(() => vi.fn());
const mockUpdateUploadJobStatus = vi.hoisted(() => vi.fn());

vi.mock('@/lib/repositories/platform-uploads', () => ({
  listStalePlatformUploads: (...args: unknown[]) => mockListStalePlatformUploads(...args),
  listStaleSermonAudioUnpublishedPlatformUploads: (...args: unknown[]) =>
    mockListStaleSermonAudioUnpublishedPlatformUploads(...args),
  updatePlatformUploadStatus: (...args: unknown[]) => mockUpdatePlatformUploadStatus(...args),
}));

vi.mock('@/lib/repositories/upload-jobs', () => ({
  listStaleUploadJobs: (...args: unknown[]) => mockListStaleUploadJobs(...args),
  updateUploadJobStatus: (...args: unknown[]) => mockUpdateUploadJobStatus(...args),
}));

import {
  reconcileStaleUploadDistribution,
  STALE_PLATFORM_UPLOAD_INTERRUPTED_MESSAGE,
  STALE_UPLOAD_JOB_INTERRUPTED_MESSAGE,
} from '@/lib/uploads/reconcile-stale-distribution';

const STALE_THRESHOLD_MS = 30 * 60 * 1000;
const SERMONAUDIO_UNPUBLISHED_STALE_THRESHOLD_MS = 90 * 60 * 1000;
const NOW = new Date('2026-06-20T12:00:00.000Z');
const UPDATED_BEFORE = new Date(NOW.getTime() - STALE_THRESHOLD_MS);
const SERMONAUDIO_UNPUBLISHED_UPDATED_BEFORE = new Date(
  NOW.getTime() - SERMONAUDIO_UNPUBLISHED_STALE_THRESHOLD_MS
);

function stalePlatformUpload(overrides: Partial<PlatformUpload> = {}): PlatformUpload {
  return {
    id: 'pu-stale',
    uploadJobId: 'job-stale',
    platform: 'youtube',
    status: 'uploading',
    platformVideoId: '',
    platformUrl: '',
    title: 'T',
    description: 'D',
    tags: [],
    visibility: 'private',
    scheduledAt: null,
    errorMessage: null,
    $createdAt: '2026-06-20T10:00:00.000Z',
    $updatedAt: '2026-06-20T10:00:00.000Z',
    ...overrides,
  };
}

function staleUploadJob(overrides: Partial<UploadJob> = {}): UploadJob {
  return {
    id: 'job-stale',
    userId: 'user-1',
    draftId: 'draft-1',
    r2Key: 'temp/uploads/user-1/v.mp4',
    status: 'distributing',
    errorMessage: null,
    $createdAt: '2026-06-20T10:00:00.000Z',
    $updatedAt: '2026-06-20T10:00:00.000Z',
    ...overrides,
  };
}

describe('reconcileStaleUploadDistribution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListStalePlatformUploads.mockResolvedValue([]);
    mockListStaleSermonAudioUnpublishedPlatformUploads.mockResolvedValue([]);
    mockListStaleUploadJobs.mockResolvedValue([]);
    mockUpdatePlatformUploadStatus.mockResolvedValue(null);
    mockUpdateUploadJobStatus.mockResolvedValue(null);
  });

  it('marks stale in-progress platform uploads and upload jobs as failed', async () => {
    const stalePu = stalePlatformUpload();
    const staleJob = staleUploadJob();
    mockListStalePlatformUploads.mockResolvedValueOnce([stalePu]);
    mockListStaleUploadJobs.mockResolvedValueOnce([staleJob]);
    mockUpdatePlatformUploadStatus.mockResolvedValueOnce({ ...stalePu, status: 'failed' });
    mockUpdateUploadJobStatus.mockResolvedValueOnce({ ...staleJob, status: 'failed' });

    const result = await reconcileStaleUploadDistribution({
      now: NOW,
      staleThresholdMs: STALE_THRESHOLD_MS,
      sermonAudioUnpublishedStaleThresholdMs: SERMONAUDIO_UNPUBLISHED_STALE_THRESHOLD_MS,
    });

    expect(mockListStalePlatformUploads).toHaveBeenCalledWith(UPDATED_BEFORE);
    expect(mockListStaleSermonAudioUnpublishedPlatformUploads).toHaveBeenCalledWith(
      SERMONAUDIO_UNPUBLISHED_UPDATED_BEFORE
    );
    expect(mockListStaleUploadJobs).toHaveBeenCalledWith(UPDATED_BEFORE);
    expect(mockUpdatePlatformUploadStatus).toHaveBeenCalledWith(
      'pu-stale',
      'failed',
      undefined,
      undefined,
      STALE_PLATFORM_UPLOAD_INTERRUPTED_MESSAGE
    );
    expect(mockUpdateUploadJobStatus).toHaveBeenCalledWith(
      'job-stale',
      'failed',
      STALE_UPLOAD_JOB_INTERRUPTED_MESSAGE
    );
    expect(result).toEqual({ platformUploadsFailed: 1, uploadJobsFailed: 1 });
  });

  it('leaves fresh in-progress rows alone when they are not returned by stale queries', async () => {
    await reconcileStaleUploadDistribution({
      now: NOW,
      staleThresholdMs: STALE_THRESHOLD_MS,
      sermonAudioUnpublishedStaleThresholdMs: SERMONAUDIO_UNPUBLISHED_STALE_THRESHOLD_MS,
    });

    expect(mockListStalePlatformUploads).toHaveBeenCalledWith(UPDATED_BEFORE);
    expect(mockListStaleSermonAudioUnpublishedPlatformUploads).toHaveBeenCalledWith(
      SERMONAUDIO_UNPUBLISHED_UPDATED_BEFORE
    );
    expect(mockListStaleUploadJobs).toHaveBeenCalledWith(UPDATED_BEFORE);
    expect(mockUpdatePlatformUploadStatus).not.toHaveBeenCalled();
    expect(mockUpdateUploadJobStatus).not.toHaveBeenCalled();
  });

  it('is idempotent when stale queries return no rows on a subsequent startup run', async () => {
    const stalePu = stalePlatformUpload();
    const staleJob = staleUploadJob();
    mockListStalePlatformUploads.mockResolvedValueOnce([stalePu]).mockResolvedValueOnce([]);
    mockListStaleUploadJobs.mockResolvedValueOnce([staleJob]).mockResolvedValueOnce([]);
    mockUpdatePlatformUploadStatus.mockResolvedValueOnce({ ...stalePu, status: 'failed' });
    mockUpdateUploadJobStatus.mockResolvedValueOnce({ ...staleJob, status: 'failed' });

    await reconcileStaleUploadDistribution({
      now: NOW,
      staleThresholdMs: STALE_THRESHOLD_MS,
      sermonAudioUnpublishedStaleThresholdMs: SERMONAUDIO_UNPUBLISHED_STALE_THRESHOLD_MS,
    });
    const secondRun = await reconcileStaleUploadDistribution({
      now: NOW,
      staleThresholdMs: STALE_THRESHOLD_MS,
      sermonAudioUnpublishedStaleThresholdMs: SERMONAUDIO_UNPUBLISHED_STALE_THRESHOLD_MS,
    });

    expect(mockUpdatePlatformUploadStatus).toHaveBeenCalledTimes(1);
    expect(mockUpdateUploadJobStatus).toHaveBeenCalledTimes(1);
    expect(secondRun).toEqual({ platformUploadsFailed: 0, uploadJobsFailed: 0 });
  });

  it('marks stale SermonAudio unpublished auto-publish rows as failed', async () => {
    const staleSermonAudio = stalePlatformUpload({
      id: 'pu-sa-stale',
      platform: 'sermon_audio',
      status: 'unpublished',
      sermonAudioAutoPublishOnProcessed: true,
    });
    mockListStaleSermonAudioUnpublishedPlatformUploads.mockResolvedValueOnce([staleSermonAudio]);
    mockUpdatePlatformUploadStatus.mockResolvedValueOnce({ ...staleSermonAudio, status: 'failed' });

    const result = await reconcileStaleUploadDistribution({
      now: NOW,
      staleThresholdMs: STALE_THRESHOLD_MS,
      sermonAudioUnpublishedStaleThresholdMs: SERMONAUDIO_UNPUBLISHED_STALE_THRESHOLD_MS,
    });

    expect(mockUpdatePlatformUploadStatus).toHaveBeenCalledWith(
      'pu-sa-stale',
      'failed',
      undefined,
      undefined,
      STALE_PLATFORM_UPLOAD_INTERRUPTED_MESSAGE
    );
    expect(result).toEqual({ platformUploadsFailed: 1, uploadJobsFailed: 0 });
  });
});
