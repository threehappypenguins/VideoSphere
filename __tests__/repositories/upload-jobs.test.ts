import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockConnectToDatabase,
  mockCreate,
  mockFindById,
  mockFind,
  mockCountDocuments,
  mockFindOne,
  mockFindByIdAndUpdate,
  mockPlatformFind,
} = vi.hoisted(() => ({
  mockConnectToDatabase: vi.fn(),
  mockCreate: vi.fn(),
  mockFindById: vi.fn(),
  mockFind: vi.fn(),
  mockCountDocuments: vi.fn(),
  mockFindOne: vi.fn(),
  mockFindByIdAndUpdate: vi.fn(),
  mockPlatformFind: vi.fn(),
}));

vi.mock('@/lib/mongodb', () => ({
  connectToDatabase: (...args: unknown[]) => mockConnectToDatabase(...args),
}));

vi.mock('@/lib/models/UploadJob', () => ({
  UploadJobModel: {
    create: (...args: unknown[]) => mockCreate(...args),
    findById: (...args: unknown[]) => mockFindById(...args),
    find: (...args: unknown[]) => mockFind(...args),
    countDocuments: (...args: unknown[]) => mockCountDocuments(...args),
    findOne: (...args: unknown[]) => mockFindOne(...args),
    findByIdAndUpdate: (...args: unknown[]) => mockFindByIdAndUpdate(...args),
  },
}));

vi.mock('@/lib/models/PlatformUpload', () => ({
  PlatformUploadModel: {
    find: (...args: unknown[]) => mockPlatformFind(...args),
  },
}));

import {
  countUploadJobsByUser,
  createUploadJob,
  getUploadJobById,
  getUploadJobsWithPlatformUploads,
  listUploadJobsByUser,
  updateUploadJobStatus,
} from '@/lib/repositories/upload-jobs';

function chain<T>(value: T) {
  return {
    sort: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue(value),
  };
}

const baseDoc = {
  _id: 'job-1',
  userId: 'user-1',
  draftId: 'draft-1',
  r2Key: 'temp/uploads/user-1/v.mp4',
  status: 'pending',
  errorMessage: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockConnectToDatabase.mockResolvedValue(undefined);
});

describe('upload-jobs repository (mongo)', () => {
  it('creates a pending upload job', async () => {
    mockCreate.mockResolvedValueOnce({ toObject: () => baseDoc });

    const row = await createUploadJob({
      userId: 'user-1',
      draftId: 'draft-1',
      r2Key: 'temp/uploads/user-1/v.mp4',
    });

    expect(mockCreate).toHaveBeenCalled();
    expect(row.id).toBe('job-1');
  });

  it('gets and lists user upload jobs', async () => {
    mockFindById.mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(baseDoc) });
    mockFind.mockReturnValueOnce(chain([baseDoc]));

    const one = await getUploadJobById('job-1');
    const list = await listUploadJobsByUser('user-1');

    expect(one?.id).toBe('job-1');
    expect(list).toHaveLength(1);
  });

  it('counts and updates upload job status', async () => {
    mockCountDocuments.mockResolvedValueOnce(3);
    mockFindByIdAndUpdate.mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(baseDoc) });

    const total = await countUploadJobsByUser('user-1');
    const updated = await updateUploadJobStatus('job-1', 'failed', 'oops');

    expect(total).toBe(3);
    expect(updated?.id).toBe('job-1');
  });

  it('hydrates platform uploads with jobs', async () => {
    mockFind.mockReturnValueOnce(chain([baseDoc]));
    mockPlatformFind.mockReturnValueOnce(
      chain([
        {
          _id: 'pu-1',
          uploadJobId: 'job-1',
          platform: 'youtube',
          status: 'pending',
          platformVideoId: '',
          platformUrl: '',
          document: JSON.stringify({
            title: 't',
            description: 'd',
            tags: [],
            visibility: 'public',
          }),
          scheduledAt: '',
          errorMessage: '',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ])
    );

    const rows = await getUploadJobsWithPlatformUploads('user-1');

    expect(rows).toHaveLength(1);
    expect(rows[0].platformUploads).toHaveLength(1);
  });
});
