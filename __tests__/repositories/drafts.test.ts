import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockConnectToDatabase,
  mockCreate,
  mockFindById,
  mockFind,
  mockCountDocuments,
  mockFindByIdAndUpdate,
  mockDeleteOne,
  mockBulkWrite,
} = vi.hoisted(() => ({
  mockConnectToDatabase: vi.fn(),
  mockCreate: vi.fn(),
  mockFindById: vi.fn(),
  mockFind: vi.fn(),
  mockCountDocuments: vi.fn(),
  mockFindByIdAndUpdate: vi.fn(),
  mockDeleteOne: vi.fn(),
  mockBulkWrite: vi.fn(),
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
    bulkWrite: (...args: unknown[]) => mockBulkWrite(...args),
  },
}));

import {
  countDraftsByUser,
  createDraft,
  deleteDraft,
  getDraftById,
  listDraftsByUser,
  markDraftUsedInUpload,
  removeLabelsFromAllDraftsForUser,
  updateDraft,
} from '@/lib/repositories/drafts';

function chain<T>(value: T) {
  return {
    sort: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue(value),
  };
}

function cursorChain(rows: Array<{ _id: string; document: string }>) {
  async function* generate() {
    for (const row of rows) {
      yield row;
    }
  }

  return {
    select: vi.fn().mockReturnValue({
      lean: vi.fn().mockReturnValue({
        cursor: vi.fn().mockReturnValue(generate()),
      }),
    }),
  };
}

function draftDocumentWithLabels(labels: string[]): string {
  return JSON.stringify({
    targets: ['youtube'],
    title: 'My Video',
    description: 'A great video',
    visibility: 'private',
    tags: [],
    labels,
    platforms: {},
  });
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

  it('persists a stable datePrefixDate when backupNaming omits the date', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-18T12:00:00.000Z'));

    mockCreate.mockImplementationOnce(async (input: { document: string }) => ({
      toObject: () => ({
        ...baseDoc,
        document: input.document,
      }),
    }));

    await createDraft({
      userId: 'user-1',
      targets: ['sftp'],
      title: 'Backup',
      description: '',
      backupNaming: { datePrefixEnabled: true },
    });

    const storedDocument = JSON.parse(String(mockCreate.mock.calls[0][0].document)) as {
      backupNaming?: { datePrefixDate?: string };
    };
    expect(storedDocument.backupNaming?.datePrefixDate).toBe('2026-06-18');

    vi.useRealTimers();
  });

  it('fills datePrefixDate on backupNaming patch when prefix is enabled without a date', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-18T12:00:00.000Z'));

    mockFindById.mockReturnValueOnce({
      lean: vi.fn().mockResolvedValue({
        ...baseDoc,
        document: JSON.stringify({
          targets: ['sftp'],
          title: 'Backup',
          description: '',
          visibility: 'private',
          tags: [],
          platforms: {},
          backupNaming: {
            datePrefixEnabled: false,
            yearFolderEnabled: false,
          },
        }),
      }),
    });
    mockFindByIdAndUpdate.mockImplementationOnce((_id, update: { document: string }) => ({
      lean: vi.fn().mockResolvedValue({
        ...baseDoc,
        document: update.document,
      }),
    }));

    await updateDraft('draft-1', {
      backupNamingPatch: { datePrefixEnabled: true },
    });

    const storedDocument = JSON.parse(String(mockFindByIdAndUpdate.mock.calls[0][1].document)) as {
      backupNaming?: { datePrefixDate?: string };
    };
    expect(storedDocument.backupNaming?.datePrefixDate).toBe('2026-06-18');

    vi.useRealTimers();
  });

  it('removes matching labels from drafts via cursor and bulkWrite', async () => {
    mockFind.mockReturnValueOnce(
      cursorChain([
        { _id: 'draft-1', document: draftDocumentWithLabels(['Easter', 'Sunday']) },
        { _id: 'draft-2', document: draftDocumentWithLabels(['Christmas']) },
      ])
    );
    mockBulkWrite.mockResolvedValueOnce({});

    await removeLabelsFromAllDraftsForUser('user-1', ['Easter']);

    expect(mockFind).toHaveBeenCalledWith({ userId: 'user-1' });
    expect(mockBulkWrite).toHaveBeenCalledTimes(1);
    const ops = mockBulkWrite.mock.calls[0][0] as Array<{
      updateOne: { filter: { _id: string }; update: { $set: { document: string } } };
    }>;
    expect(ops).toHaveLength(1);
    expect(ops[0].updateOne.filter._id).toBe('draft-1');
    expect(JSON.parse(ops[0].updateOne.update.$set.document).labels).toEqual(['Sunday']);
  });

  it('skips bulkWrite when no drafts contain the removed labels', async () => {
    mockFind.mockReturnValueOnce(
      cursorChain([{ _id: 'draft-1', document: draftDocumentWithLabels(['Sunday']) }])
    );

    await removeLabelsFromAllDraftsForUser('user-1', ['Easter']);

    expect(mockBulkWrite).not.toHaveBeenCalled();
  });

  it('flushes bulkWrite in chunks when many drafts need updates', async () => {
    const rows = Array.from({ length: 501 }, (_, index) => ({
      _id: `draft-${index}`,
      document: draftDocumentWithLabels(['Easter']),
    }));
    mockFind.mockReturnValueOnce(cursorChain(rows));
    mockBulkWrite.mockResolvedValue({});

    await removeLabelsFromAllDraftsForUser('user-1', ['Easter']);

    expect(mockBulkWrite).toHaveBeenCalledTimes(2);
    expect(mockBulkWrite.mock.calls[0][0]).toHaveLength(500);
    expect(mockBulkWrite.mock.calls[1][0]).toHaveLength(1);
  });
});
