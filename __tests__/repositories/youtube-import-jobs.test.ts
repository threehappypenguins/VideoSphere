import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockConnectToDatabase,
  mockCreate,
  mockFindById,
  mockFindOne,
  mockFindByIdAndUpdate,
  mockDeleteOne,
} = vi.hoisted(() => ({
  mockConnectToDatabase: vi.fn(),
  mockCreate: vi.fn(),
  mockFindById: vi.fn(),
  mockFindOne: vi.fn(),
  mockFindByIdAndUpdate: vi.fn(),
  mockDeleteOne: vi.fn(),
}));

vi.mock('@/lib/mongodb', () => ({
  connectToDatabase: (...args: unknown[]) => mockConnectToDatabase(...args),
}));

vi.mock('@/lib/models/YoutubeImportJob', () => ({
  YoutubeImportJobModel: {
    create: (...args: unknown[]) => mockCreate(...args),
    findById: (...args: unknown[]) => mockFindById(...args),
    findOne: (...args: unknown[]) => mockFindOne(...args),
    findByIdAndUpdate: (...args: unknown[]) => mockFindByIdAndUpdate(...args),
    deleteOne: (...args: unknown[]) => mockDeleteOne(...args),
  },
}));

import {
  createYoutubeImportJob,
  getActiveYoutubeImportJobForUser,
  updateYoutubeImportJobStatus,
} from '@/lib/repositories/youtube-import-jobs';
import type { YoutubeImportJobDocument } from '@/lib/models/YoutubeImportJob';

function chain<T>(value: T) {
  return {
    sort: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue(value),
  };
}

const baseDoc: YoutubeImportJobDocument = {
  _id: 'yt-import-1',
  userId: 'user-1',
  draftId: 'draft-1',
  sourceUrl: 'https://www.youtube.com/watch?v=abc123',
  youtubeVideoId: 'abc123',
  livestreamId: '',
  startSeconds: 0,
  endSeconds: 120,
  status: 'pending',
  progressPercent: 0,
  errorMessage: '',
  r2Key: '',
  uploadJobId: '',
  distributeQueued: false,
  smartCut: false,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockConnectToDatabase.mockResolvedValue(undefined);
});

describe('youtube-import-jobs repository (mongo)', () => {
  it('creates a pending YouTube import job', async () => {
    mockCreate.mockResolvedValueOnce({ toObject: () => baseDoc });

    const row = await createYoutubeImportJob({
      userId: 'user-1',
      draftId: 'draft-1',
      sourceUrl: 'https://www.youtube.com/watch?v=abc123',
      youtubeVideoId: 'abc123',
      startSeconds: 0,
      endSeconds: 120,
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        draftId: 'draft-1',
        status: 'pending',
        progressPercent: 0,
      })
    );
    expect(row.id).toBe('yt-import-1');
    expect(row.livestreamId).toBeNull();
  });

  it('throws YoutubeImportJobAlreadyActiveError on duplicate active job insert', async () => {
    const duplicateKeyError = Object.assign(new Error('E11000 duplicate key error'), {
      code: 11000,
    });
    mockCreate.mockRejectedValueOnce(duplicateKeyError);

    await expect(
      createYoutubeImportJob({
        userId: 'user-1',
        draftId: 'draft-1',
        sourceUrl: 'https://www.youtube.com/watch?v=abc123',
        youtubeVideoId: 'abc123',
        startSeconds: 0,
        endSeconds: 120,
      })
    ).rejects.toMatchObject({
      name: 'YoutubeImportJobAlreadyActiveError',
      userId: 'user-1',
    });
  });

  it('updates only the fields provided in the status patch', async () => {
    mockFindByIdAndUpdate.mockResolvedValueOnce(undefined);

    await updateYoutubeImportJobStatus('yt-import-1', {
      status: 'downloading',
      progressPercent: 25,
    });

    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith(
      'yt-import-1',
      {
        status: 'downloading',
        progressPercent: 25,
      },
      { runValidators: true }
    );
  });

  it('returns null from getActiveYoutubeImportJobForUser when none active', async () => {
    mockFindOne.mockReturnValueOnce(chain(null));

    const row = await getActiveYoutubeImportJobForUser('user-1');

    expect(mockFindOne).toHaveBeenCalledWith({
      userId: 'user-1',
      status: { $in: ['pending', 'downloading', 'trimming', 'uploading'] },
    });
    expect(row).toBeNull();
  });
});
