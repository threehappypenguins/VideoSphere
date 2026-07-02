import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAfter = vi.hoisted(() => vi.fn());

vi.mock('next/server', () => ({
  after: (...args: unknown[]) => mockAfter(...args),
}));

vi.mock('@/lib/repositories/upload-jobs', () => ({
  getUploadJobById: vi.fn(),
  updateUploadJobStatus: vi.fn(),
}));

vi.mock('@/lib/repositories/drafts', () => ({
  getDraftById: vi.fn(),
}));

vi.mock('@/lib/repositories/platform-uploads', () => ({
  ensurePlatformUploadsForJobTargets: vi.fn(),
}));

vi.mock('@/lib/api/distribute', () => ({
  distributeCreatePlatformUploadInput: vi.fn(() => ({
    uploadJobId: 'job-123',
    platform: 'youtube',
    title: 'Test Video',
    description: 'desc',
    tags: ['tag1'],
    visibility: 'public',
  })),
  runDistributionInBackground: vi.fn(async () => undefined),
}));

vi.mock('@/lib/draft-upload-metadata', () => ({
  buildMetadataForPlatform: vi.fn(() => ({
    title: 'Test Video',
    description: 'desc',
    tags: ['tag1'],
    visibility: 'public',
  })),
}));

import { runDistributionInBackground } from '@/lib/api/distribute';
import {
  finalizeUploadJobAndDistribute,
  UploadJobFinalizeNotFoundError,
} from '@/lib/api/finalize-upload-job';
import { getDraftById } from '@/lib/repositories/drafts';
import { ensurePlatformUploadsForJobTargets } from '@/lib/repositories/platform-uploads';
import { getUploadJobById, updateUploadJobStatus } from '@/lib/repositories/upload-jobs';

const baseJob = {
  id: 'job-123',
  userId: 'user-123',
  draftId: 'draft-abc',
  r2Key: 'temp/uploads/user-123/video.mp4',
  status: 'pending' as const,
  errorMessage: null,
  $createdAt: '2000-01-01T00:00:00.000Z',
  $updatedAt: '2000-01-01T00:00:00.000Z',
};

const baseDraft = {
  id: 'draft-abc',
  userId: 'user-123',
  targets: ['youtube'] as const,
  title: 'Test Video',
  description: 'desc',
  tags: ['tag1'],
  visibility: 'public' as const,
  platforms: {},
  $createdAt: '2000-01-01T00:00:00.000Z',
  $updatedAt: '2000-01-01T00:00:00.000Z',
};

const platformUpload = {
  id: 'pu-1',
  uploadJobId: 'job-123',
  platform: 'youtube' as const,
  status: 'pending' as const,
  platformVideoId: '',
  platformUrl: '',
  title: 'Test Video',
  description: 'desc',
  tags: ['tag1'],
  visibility: 'public' as const,
  scheduledAt: null,
  errorMessage: null,
  $createdAt: '2000-01-01T00:00:00.000Z',
  $updatedAt: '2000-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getUploadJobById).mockResolvedValue(baseJob);
  vi.mocked(updateUploadJobStatus).mockResolvedValue({
    ...baseJob,
    status: 'distributing',
  });
  vi.mocked(getDraftById).mockResolvedValue(baseDraft);
  vi.mocked(ensurePlatformUploadsForJobTargets).mockResolvedValue([platformUpload]);
});

describe('finalizeUploadJobAndDistribute', () => {
  it('marks the job uploading and returns distributing false when no draft is linked', async () => {
    vi.mocked(getUploadJobById).mockResolvedValueOnce({ ...baseJob, draftId: null });

    const result = await finalizeUploadJobAndDistribute('job-123', 'user-123');

    expect(result).toEqual({ distributing: false });
    expect(updateUploadJobStatus).toHaveBeenCalledWith('job-123', 'uploading');
    expect(getDraftById).not.toHaveBeenCalled();
    expect(ensurePlatformUploadsForJobTargets).not.toHaveBeenCalled();
    expect(mockAfter).not.toHaveBeenCalled();
  });

  it('marks the job uploading when the draft has no targets', async () => {
    vi.mocked(getDraftById).mockResolvedValueOnce({ ...baseDraft, targets: [] });

    const result = await finalizeUploadJobAndDistribute('job-123', 'user-123');

    expect(result).toEqual({ distributing: false });
    expect(updateUploadJobStatus).toHaveBeenCalledWith('job-123', 'uploading');
    expect(ensurePlatformUploadsForJobTargets).not.toHaveBeenCalled();
    expect(mockAfter).not.toHaveBeenCalled();
  });

  it('creates platform uploads, advances to distributing, and schedules background distribution', async () => {
    const result = await finalizeUploadJobAndDistribute('job-123', 'user-123');

    expect(result).toEqual({ distributing: true });
    expect(ensurePlatformUploadsForJobTargets).toHaveBeenCalled();
    expect(updateUploadJobStatus).toHaveBeenCalledWith('job-123', 'distributing', null);
    expect(mockAfter).toHaveBeenCalledTimes(1);

    const scheduled = mockAfter.mock.calls[0]?.[0] as () => Promise<void>;
    await scheduled();
    expect(runDistributionInBackground).toHaveBeenCalledWith(
      'job-123',
      'user-123',
      'temp/uploads/user-123/video.mp4',
      [platformUpload],
      expect.any(Map)
    );
  });

  it('throws UploadJobFinalizeNotFoundError when the job row is missing', async () => {
    vi.mocked(getUploadJobById).mockResolvedValueOnce(null);

    await expect(finalizeUploadJobAndDistribute('job-123', 'user-123')).rejects.toBeInstanceOf(
      UploadJobFinalizeNotFoundError
    );
  });

  it('throws UploadJobFinalizeNotFoundError when distributing status update returns null', async () => {
    vi.mocked(updateUploadJobStatus).mockResolvedValueOnce(null);

    await expect(finalizeUploadJobAndDistribute('job-123', 'user-123')).rejects.toBeInstanceOf(
      UploadJobFinalizeNotFoundError
    );
  });
});
