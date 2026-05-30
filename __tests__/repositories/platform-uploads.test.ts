import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockConnectToDatabase, mockCreate, mockFind, mockFindOne, mockFindByIdAndUpdate } =
  vi.hoisted(() => ({
    mockConnectToDatabase: vi.fn(),
    mockCreate: vi.fn(),
    mockFind: vi.fn(),
    mockFindOne: vi.fn(),
    mockFindByIdAndUpdate: vi.fn(),
  }));

vi.mock('@/lib/mongodb', () => ({
  connectToDatabase: (...args: unknown[]) => mockConnectToDatabase(...args),
}));

vi.mock('@/lib/models/PlatformUpload', () => ({
  PlatformUploadModel: {
    create: (...args: unknown[]) => mockCreate(...args),
    find: (...args: unknown[]) => mockFind(...args),
    findOne: (...args: unknown[]) => mockFindOne(...args),
    findByIdAndUpdate: (...args: unknown[]) => mockFindByIdAndUpdate(...args),
  },
}));

import {
  createPlatformUpload,
  getPlatformUploadsByJob,
  updatePlatformUploadStatus,
} from '@/lib/repositories/platform-uploads';

function chain<T>(value: T) {
  return {
    sort: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue(value),
  };
}

const baseDoc = {
  _id: 'pu-1',
  uploadJobId: 'job-1',
  platform: 'youtube',
  status: 'pending',
  platformVideoId: '',
  platformUrl: '',
  document: JSON.stringify({
    title: 'My Video',
    description: 'D',
    tags: [],
    visibility: 'public',
  }),
  scheduledAt: '',
  errorMessage: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockConnectToDatabase.mockResolvedValue(undefined);
});

describe('platform-uploads repository (mongo)', () => {
  it('creates a pending platform upload', async () => {
    mockCreate.mockResolvedValueOnce({ toObject: () => baseDoc });

    const row = await createPlatformUpload({
      uploadJobId: 'job-1',
      platform: 'youtube',
      title: 'My Video',
      description: 'D',
      tags: [],
      visibility: 'public',
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        uploadJobId: 'job-1',
        platform: 'youtube',
        status: 'pending',
      })
    );
    expect(row.id).toBe('pu-1');
  });

  it('returns the existing row when create hits duplicate-key race', async () => {
    const duplicateKeyError = Object.assign(new Error('E11000 duplicate key error'), {
      code: 11000,
    });
    mockCreate.mockRejectedValueOnce(duplicateKeyError);
    mockFindOne.mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(baseDoc) });

    const row = await createPlatformUpload({
      uploadJobId: 'job-1',
      platform: 'youtube',
      title: 'My Video',
      description: 'D',
      tags: [],
      visibility: 'public',
    });

    expect(mockFindOne).toHaveBeenCalledWith({ uploadJobId: 'job-1', platform: 'youtube' });
    expect(row.id).toBe('pu-1');
  });

  it('lists uploads by job in createdAt-desc order', async () => {
    mockFind.mockReturnValueOnce(chain([baseDoc]));

    const rows = await getPlatformUploadsByJob('job-1');

    expect(mockFind).toHaveBeenCalledWith({ uploadJobId: 'job-1' });
    expect(rows).toHaveLength(1);
    expect(rows[0].uploadJobId).toBe('job-1');
  });

  it('updates upload status and returns null when row missing', async () => {
    mockFindByIdAndUpdate.mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(baseDoc) });
    const ok = await updatePlatformUploadStatus('pu-1', 'completed', 'vid-1', 'https://x');
    expect(ok?.id).toBe('pu-1');

    mockFindByIdAndUpdate.mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(null) });
    const missing = await updatePlatformUploadStatus(
      'missing',
      'failed',
      undefined,
      undefined,
      'x'
    );
    expect(missing).toBeNull();
  });
});
