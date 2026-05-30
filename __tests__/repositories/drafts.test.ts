import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockConnectToDatabase,
  mockCreate,
  mockFindById,
  mockFind,
  mockCountDocuments,
  mockFindByIdAndUpdate,
  mockDeleteOne,
} = vi.hoisted(() => ({
  mockConnectToDatabase: vi.fn(),
  mockCreate: vi.fn(),
  mockFindById: vi.fn(),
  mockFind: vi.fn(),
  mockCountDocuments: vi.fn(),
  mockFindByIdAndUpdate: vi.fn(),
  mockDeleteOne: vi.fn(),
}));

vi.mock('@/lib/mongodb', () => ({
  connectToDatabase: (...args: unknown[]) => mockConnectToDatabase(...args),
}));

vi.mock('@/lib/models/Draft', () => ({
  DraftModel: {
    create: (...args: unknown[]) => mockCreate(...args),
    findById: (...args: unknown[]) => mockFindById(...args),
    find: (...args: unknown[]) => mockFind(...args),
    countDocuments: (...args: unknown[]) => mockCountDocuments(...args),
    findByIdAndUpdate: (...args: unknown[]) => mockFindByIdAndUpdate(...args),
    deleteOne: (...args: unknown[]) => mockDeleteOne(...args),
  },
}));

import {
  countDraftsByUser,
  createDraft,
  deleteDraft,
  getDraftById,
  listDraftsByUser,
  markDraftUsedInUpload,
} from '@/lib/repositories/drafts';

function chain<T>(value: T) {
  return {
    sort: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue(value),
  };
}

const baseDoc = {
  _id: 'draft-1',
  userId: 'user-1',
  document: JSON.stringify({
    targets: ['youtube'],
    title: 'My Video',
    description: 'A great video',
    visibility: 'private',
    tags: [],
    platforms: {},
  }),
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockConnectToDatabase.mockResolvedValue(undefined);
});

describe('drafts repository (mongo)', () => {
  it('creates a draft document JSON row', async () => {
    mockCreate.mockResolvedValueOnce({ toObject: () => baseDoc });

    const draft = await createDraft({
      userId: 'user-1',
      targets: ['youtube'],
      title: 'My Video',
      description: 'A great video',
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        document: expect.any(String),
      })
    );
    expect(draft.id).toBe('draft-1');
  });

  it('gets one draft by id and returns null when missing', async () => {
    mockFindById.mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(baseDoc) });
    const found = await getDraftById('draft-1');
    expect(found?.id).toBe('draft-1');

    mockFindById.mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(null) });
    const missing = await getDraftById('missing');
    expect(missing).toBeNull();
  });

  it('lists and counts drafts by user', async () => {
    mockFind.mockReturnValueOnce(chain([baseDoc]));
    mockCountDocuments.mockResolvedValueOnce(1);

    const list = await listDraftsByUser('user-1');
    const count = await countDraftsByUser('user-1');

    expect(mockFind).toHaveBeenCalledWith({ userId: 'user-1' });
    expect(list).toHaveLength(1);
    expect(count).toBe(1);
  });

  it('marks draft used and supports delete', async () => {
    mockFindById
      .mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(baseDoc) })
      .mockReturnValueOnce({ lean: vi.fn().mockResolvedValue({ ...baseDoc, _id: 'draft-1' }) });
    mockFindByIdAndUpdate.mockReturnValueOnce({
      lean: vi.fn().mockResolvedValue({
        ...baseDoc,
        document: JSON.stringify({
          targets: ['youtube'],
          title: 'My Video',
          description: 'A great video',
          visibility: 'private',
          tags: [],
          platforms: {},
          usedInUploadAt: '2026-01-03T00:00:00.000Z',
        }),
      }),
    });
    mockDeleteOne.mockResolvedValueOnce({ deletedCount: 1 });

    const used = await markDraftUsedInUpload('draft-1', '2026-01-03T00:00:00.000Z');
    const deleted = await deleteDraft('draft-1');

    expect(used?.id).toBe('draft-1');
    expect(mockFindByIdAndUpdate).toHaveBeenCalled();
    expect(deleted).toBeUndefined();
    expect(mockDeleteOne).toHaveBeenCalledWith({ _id: 'draft-1' });
  });
});
