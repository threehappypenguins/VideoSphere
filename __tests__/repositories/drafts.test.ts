// =============================================================================
// DRAFTS REPOSITORY UNIT TESTS
// =============================================================================
// Mocks node-appwrite TablesDB. Schema: userId + document (JSON).
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockCreateRow, mockGetRow, mockListRows, mockUpdateRow, mockDeleteRow } = vi.hoisted(
  () => ({
    mockCreateRow: vi.fn(),
    mockGetRow: vi.fn(),
    mockListRows: vi.fn(),
    mockUpdateRow: vi.fn(),
    mockDeleteRow: vi.fn(),
  })
);

vi.mock('node-appwrite', () => ({
  ID: {
    unique: () => 'draft-id-123',
  },
  Query: {
    equal: (attr: string, value: string) => `equal("${attr}","${value}")`,
    orderDesc: (attr: string) => `orderDesc("${attr}")`,
    limit: (n: number) => `limit(${n})`,
  },
  TablesDB: class TablesDB {
    createRow = mockCreateRow;
    getRow = mockGetRow;
    listRows = mockListRows;
    updateRow = mockUpdateRow;
    deleteRow = mockDeleteRow;
  },
}));

vi.mock('@/lib/appwrite', () => ({
  default: {},
}));

import {
  createDraft,
  getDraftById,
  listDraftsByUser,
  markDraftUsedInUpload,
  updateDraft,
  deleteDraft,
} from '@/lib/repositories/drafts';
import {
  DraftDocumentTooLargeError,
  stringifyDraftDocumentForStorage,
} from '@/lib/draft-upload-metadata';

const publishDefaults = {
  targets: ['youtube', 'vimeo'] as const,
  title: 'My Video',
  description: 'A great video.',
  visibility: 'public' as const,
  tags: [] as string[],
  platforms: { youtube: { categoryId: '22' } },
};

const baseDocument = stringifyDraftDocumentForStorage({
  targets: [...publishDefaults.targets],
  title: publishDefaults.title,
  description: publishDefaults.description,
  visibility: publishDefaults.visibility,
  tags: publishDefaults.tags,
  platforms: publishDefaults.platforms,
});

const baseRow = {
  $id: 'draft-1',
  userId: 'user-1',
  document: baseDocument,
  $createdAt: '2026-01-01T00:00:00.000Z',
  $updatedAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('drafts repository', () => {
  describe('createDraft', () => {
    it('stores userId and document JSON only', async () => {
      mockCreateRow.mockImplementation(
        async (args: { data: { userId: string; document: string } }) => ({
          $id: 'draft-id-123',
          userId: args.data.userId,
          document: args.data.document,
          $createdAt: '2026-01-01T00:00:00.000Z',
          $updatedAt: '2026-01-01T00:00:00.000Z',
        })
      );

      const result = await createDraft({
        userId: 'user-1',
        targets: ['youtube'],
        title: 'My Video',
        description: 'A great video.',
      });

      expect(mockCreateRow).toHaveBeenCalledTimes(1);
      const call = mockCreateRow.mock.calls[0][0];
      expect(call.data).toEqual({
        userId: 'user-1',
        document: stringifyDraftDocumentForStorage({
          targets: ['youtube'],
          title: 'My Video',
          description: 'A great video.',
          visibility: 'private',
          tags: [],
          platforms: {},
        }),
      });
      expect(call.data).not.toHaveProperty('title');
      expect(call.data).not.toHaveProperty('publishFields');

      expect(result.targets).toEqual(['youtube']);
      expect(result.visibility).toBe('private');
      expect(result.platforms).toEqual({});
    });

    it('persists custom visibility and platforms in document', async () => {
      mockCreateRow.mockImplementation(async (args: { data: { document: string } }) => ({
        $id: 'draft-id-123',
        userId: 'user-1',
        document: args.data.document,
        $createdAt: '2026-01-01T00:00:00.000Z',
        $updatedAt: '2026-01-01T00:00:00.000Z',
      }));

      await createDraft({
        userId: 'user-1',
        targets: ['youtube', 'vimeo'],
        title: 'T',
        description: 'D',
        visibility: 'unlisted',
        platforms: { youtube: { categoryId: '10' } },
      });

      const call = mockCreateRow.mock.calls[0][0];
      const parsed = JSON.parse(call.data.document as string) as {
        visibility: string;
        platforms: unknown;
      };
      expect(parsed.visibility).toBe('unlisted');
      expect(parsed.platforms).toEqual({ youtube: { categoryId: '10' } });
    });

    it('throws DraftDocumentTooLargeError before Appwrite when document JSON exceeds column limit', async () => {
      await expect(
        createDraft({
          userId: 'user-1',
          targets: ['youtube'],
          title: 't',
          description: 'x'.repeat(20_000),
        })
      ).rejects.toBeInstanceOf(DraftDocumentTooLargeError);
      expect(mockCreateRow).not.toHaveBeenCalled();
    });
  });

  describe('getDraftById', () => {
    it('returns typed Draft from document', async () => {
      mockGetRow.mockResolvedValue({ ...baseRow });

      const result = await getDraftById('draft-1');

      expect(result).not.toBeNull();
      expect(result!.title).toBe('My Video');
      expect(result!.targets).toEqual(['youtube', 'vimeo']);
    });

    it('returns null when draft is not found (404)', async () => {
      const err = new Error('Not found') as Error & { code?: number };
      err.code = 404;
      mockGetRow.mockRejectedValue(err);

      expect(await getDraftById('missing-id')).toBeNull();
    });

    it('defaults when document missing', async () => {
      mockGetRow.mockResolvedValue({
        ...baseRow,
        document: '',
      });

      const result = await getDraftById('draft-1');
      expect(result!.title).toBe('');
      expect(result!.targets).toEqual([]);
      expect(result!.visibility).toBe('private');
    });

    it('rethrows non-404 errors', async () => {
      mockGetRow.mockRejectedValue(new Error('Server error'));
      await expect(getDraftById('draft-1')).rejects.toThrow('Server error');
    });
  });

  describe('listDraftsByUser', () => {
    it('returns drafts for user', async () => {
      mockListRows.mockResolvedValue({
        rows: [
          { ...baseRow, $id: 'd1', $updatedAt: '2026-01-03T00:00:00.000Z' },
          { ...baseRow, $id: 'd2', $updatedAt: '2026-01-02T00:00:00.000Z' },
        ],
      });

      const result = await listDraftsByUser('user-1');
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('d1');
    });

    it('returns empty array when none', async () => {
      mockListRows.mockResolvedValue({ rows: [] });
      expect(await listDraftsByUser('user-1')).toEqual([]);
    });
  });

  describe('updateDraft', () => {
    it('updates title via getRow merge + document', async () => {
      mockGetRow.mockResolvedValue({ ...baseRow });
      const updatedDoc = stringifyDraftDocumentForStorage({
        targets: [...publishDefaults.targets],
        title: 'Updated Title',
        description: publishDefaults.description,
        visibility: publishDefaults.visibility,
        tags: publishDefaults.tags,
        platforms: publishDefaults.platforms,
      });
      mockUpdateRow.mockResolvedValue({ ...baseRow, document: updatedDoc });

      const result = await updateDraft('draft-1', {
        title: 'Updated Title',
      });

      expect(mockGetRow).toHaveBeenCalledTimes(1);
      expect(mockUpdateRow).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { document: updatedDoc },
        })
      );
      expect(result!.title).toBe('Updated Title');
    });

    it('preserves usedInUploadAt in the stored document when merging other fields', async () => {
      const usedAt = '2026-01-15T12:00:00.000Z';
      const rowWithUsed = {
        ...baseRow,
        document: stringifyDraftDocumentForStorage({
          targets: [...publishDefaults.targets],
          title: publishDefaults.title,
          description: publishDefaults.description,
          visibility: publishDefaults.visibility,
          tags: publishDefaults.tags,
          platforms: publishDefaults.platforms,
          usedInUploadAt: usedAt,
        }),
      };
      mockGetRow.mockResolvedValue({ ...rowWithUsed });
      const expectedDoc = stringifyDraftDocumentForStorage({
        targets: [...publishDefaults.targets],
        title: 'Updated Title',
        description: publishDefaults.description,
        visibility: publishDefaults.visibility,
        tags: publishDefaults.tags,
        platforms: publishDefaults.platforms,
        usedInUploadAt: usedAt,
      });
      mockUpdateRow.mockResolvedValue({ ...rowWithUsed, document: expectedDoc });

      const result = await updateDraft('draft-1', { title: 'Updated Title' });

      expect(mockUpdateRow).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { document: expectedDoc },
        })
      );
      expect(
        (
          JSON.parse(mockUpdateRow.mock.calls[0][0].data.document as string) as {
            usedInUploadAt?: string;
          }
        ).usedInUploadAt
      ).toBe(usedAt);
      expect(result!.usedInUploadAt).toBe(usedAt);
      expect(result!.title).toBe('Updated Title');
    });

    it('throws before updateRow when merged document exceeds column limit', async () => {
      mockGetRow.mockResolvedValue({ ...baseRow });
      await expect(
        updateDraft('draft-1', { description: 'y'.repeat(20_000) })
      ).rejects.toBeInstanceOf(DraftDocumentTooLargeError);
      expect(mockUpdateRow).not.toHaveBeenCalled();
    });

    it('merges platformsPatch without wiping omitted fields', async () => {
      const rowWithTags = {
        ...baseRow,
        document: stringifyDraftDocumentForStorage({
          targets: [...publishDefaults.targets],
          title: publishDefaults.title,
          description: publishDefaults.description,
          visibility: publishDefaults.visibility,
          tags: ['keep'],
          platforms: {
            youtube: { categoryId: '22' },
          },
        }),
      };
      mockGetRow.mockResolvedValue({ ...rowWithTags });
      const updatedDoc = stringifyDraftDocumentForStorage({
        targets: [...publishDefaults.targets],
        title: publishDefaults.title,
        description: publishDefaults.description,
        visibility: publishDefaults.visibility,
        tags: ['keep'],
        platforms: {
          youtube: { categoryId: '99' },
        },
      });
      mockUpdateRow.mockResolvedValue({ ...rowWithTags, document: updatedDoc });

      await updateDraft('draft-1', {
        platformsPatch: { youtube: { categoryId: '99' } },
      });

      const doc = mockUpdateRow.mock.calls[0][0].data.document as string;
      const parsed = JSON.parse(doc) as {
        tags: string[];
        platforms: { youtube: { categoryId: string } };
      };
      expect(parsed.platforms.youtube.categoryId).toBe('99');
      expect(parsed.tags).toEqual(['keep']);
    });

    it('returns null when updateRow returns 404', async () => {
      const err = new Error('Not found') as Error & { code?: number };
      err.code = 404;
      mockUpdateRow.mockRejectedValue(err);
      expect(await updateDraft('missing-id', { title: 'New' })).toBeNull();
    });

    it('returns null when draft missing for platformsPatch-only update', async () => {
      const err = new Error('Not found') as Error & { code?: number };
      err.code = 404;
      mockGetRow.mockRejectedValue(err);
      const result = await updateDraft('missing-id', {
        platformsPatch: { vimeo: { categoryUri: '/categories/x' } },
      });
      expect(result).toBeNull();
      expect(mockUpdateRow).not.toHaveBeenCalled();
    });

    it('returns current draft when nothing to change', async () => {
      mockGetRow.mockResolvedValue({ ...baseRow });
      const result = await updateDraft('draft-1', {});
      expect(mockUpdateRow).not.toHaveBeenCalled();
      expect(result!.id).toBe('draft-1');
    });
  });

  describe('markDraftUsedInUpload', () => {
    it('stores usedAtIso when usedInUploadAt is missing', async () => {
      mockGetRow.mockResolvedValueOnce({ ...baseRow });

      const usedAt = '2026-01-12T10:00:00.000Z';
      const expectedDoc = stringifyDraftDocumentForStorage({
        targets: [...publishDefaults.targets],
        title: publishDefaults.title,
        description: publishDefaults.description,
        visibility: publishDefaults.visibility,
        tags: publishDefaults.tags,
        platforms: publishDefaults.platforms,
        usedInUploadAt: usedAt,
      });
      mockUpdateRow.mockResolvedValueOnce({ ...baseRow, document: expectedDoc });

      const result = await markDraftUsedInUpload('draft-1', usedAt);

      expect(mockUpdateRow).toHaveBeenCalledWith(
        expect.objectContaining({ data: { document: expectedDoc } })
      );
      expect(result?.usedInUploadAt).toBe(usedAt);
    });

    it('keeps earlier existing usedInUploadAt when incoming timestamp is later', async () => {
      const earlier = '2026-01-10T00:00:00.000Z';
      const later = '2026-01-20T00:00:00.000Z';
      const rowWithUsed = {
        ...baseRow,
        document: stringifyDraftDocumentForStorage({
          targets: [...publishDefaults.targets],
          title: publishDefaults.title,
          description: publishDefaults.description,
          visibility: publishDefaults.visibility,
          tags: publishDefaults.tags,
          platforms: publishDefaults.platforms,
          usedInUploadAt: earlier,
        }),
      };
      mockGetRow.mockResolvedValueOnce(rowWithUsed);
      const expectedDoc = stringifyDraftDocumentForStorage({
        targets: [...publishDefaults.targets],
        title: publishDefaults.title,
        description: publishDefaults.description,
        visibility: publishDefaults.visibility,
        tags: publishDefaults.tags,
        platforms: publishDefaults.platforms,
        usedInUploadAt: earlier,
      });
      mockUpdateRow.mockResolvedValueOnce({ ...rowWithUsed, document: expectedDoc });

      const result = await markDraftUsedInUpload('draft-1', later);

      expect(result?.usedInUploadAt).toBe(earlier);
    });

    it('corrects later existing usedInUploadAt when incoming timestamp is earlier', async () => {
      const later = '2026-01-20T00:00:00.000Z';
      const earlier = '2026-01-10T00:00:00.000Z';
      const rowWithUsed = {
        ...baseRow,
        document: stringifyDraftDocumentForStorage({
          targets: [...publishDefaults.targets],
          title: publishDefaults.title,
          description: publishDefaults.description,
          visibility: publishDefaults.visibility,
          tags: publishDefaults.tags,
          platforms: publishDefaults.platforms,
          usedInUploadAt: later,
        }),
      };
      mockGetRow.mockResolvedValueOnce(rowWithUsed);
      const expectedDoc = stringifyDraftDocumentForStorage({
        targets: [...publishDefaults.targets],
        title: publishDefaults.title,
        description: publishDefaults.description,
        visibility: publishDefaults.visibility,
        tags: publishDefaults.tags,
        platforms: publishDefaults.platforms,
        usedInUploadAt: earlier,
      });
      mockUpdateRow.mockResolvedValueOnce({ ...rowWithUsed, document: expectedDoc });

      const result = await markDraftUsedInUpload('draft-1', earlier);

      expect(result?.usedInUploadAt).toBe(earlier);
    });

    it('ignores invalid/whitespace existing value and uses incoming timestamp', async () => {
      const rowWithBadUsed = {
        ...baseRow,
        document: stringifyDraftDocumentForStorage({
          targets: [...publishDefaults.targets],
          title: publishDefaults.title,
          description: publishDefaults.description,
          visibility: publishDefaults.visibility,
          tags: publishDefaults.tags,
          platforms: publishDefaults.platforms,
          usedInUploadAt: '   ',
        }),
      };
      mockGetRow.mockResolvedValueOnce(rowWithBadUsed);

      const usedAt = '2026-01-05T00:00:00.000Z';
      const expectedDoc = stringifyDraftDocumentForStorage({
        targets: [...publishDefaults.targets],
        title: publishDefaults.title,
        description: publishDefaults.description,
        visibility: publishDefaults.visibility,
        tags: publishDefaults.tags,
        platforms: publishDefaults.platforms,
        usedInUploadAt: usedAt,
      });
      mockUpdateRow.mockResolvedValueOnce({ ...rowWithBadUsed, document: expectedDoc });

      const result = await markDraftUsedInUpload('draft-1', usedAt);

      expect(result?.usedInUploadAt).toBe(usedAt);
    });

    it('reconciles once when a concurrent write stores a later timestamp', async () => {
      const incomingEarlier = '2026-01-05T00:00:00.000Z';
      const concurrentLater = '2026-01-20T00:00:00.000Z';

      mockGetRow.mockResolvedValueOnce({ ...baseRow }).mockResolvedValueOnce({
        ...baseRow,
        document: stringifyDraftDocumentForStorage({
          targets: [...publishDefaults.targets],
          title: publishDefaults.title,
          description: publishDefaults.description,
          visibility: publishDefaults.visibility,
          tags: publishDefaults.tags,
          platforms: publishDefaults.platforms,
          usedInUploadAt: concurrentLater,
        }),
      });

      mockUpdateRow
        .mockResolvedValueOnce({
          ...baseRow,
          document: stringifyDraftDocumentForStorage({
            targets: [...publishDefaults.targets],
            title: publishDefaults.title,
            description: publishDefaults.description,
            visibility: publishDefaults.visibility,
            tags: publishDefaults.tags,
            platforms: publishDefaults.platforms,
            usedInUploadAt: concurrentLater,
          }),
        })
        .mockResolvedValueOnce({
          ...baseRow,
          document: stringifyDraftDocumentForStorage({
            targets: [...publishDefaults.targets],
            title: publishDefaults.title,
            description: publishDefaults.description,
            visibility: publishDefaults.visibility,
            tags: publishDefaults.tags,
            platforms: publishDefaults.platforms,
            usedInUploadAt: incomingEarlier,
          }),
        });

      const result = await markDraftUsedInUpload('draft-1', incomingEarlier);

      expect(mockUpdateRow).toHaveBeenCalledTimes(2);
      expect(result?.usedInUploadAt).toBe(incomingEarlier);
    });

    it('returns null when draft is deleted between initial read and first updateRow', async () => {
      mockGetRow.mockResolvedValueOnce({ ...baseRow });
      const err = new Error('Not found') as Error & { code?: number };
      err.code = 404;
      mockUpdateRow.mockRejectedValueOnce(err);

      const result = await markDraftUsedInUpload('draft-1', '2026-01-05T00:00:00.000Z');

      expect(result).toBeNull();
    });

    it('returns null when draft is deleted before reconcile updateRow', async () => {
      const incomingEarlier = '2026-01-05T00:00:00.000Z';
      const concurrentLater = '2026-01-20T00:00:00.000Z';
      mockGetRow.mockResolvedValueOnce({ ...baseRow }).mockResolvedValueOnce({
        ...baseRow,
        document: stringifyDraftDocumentForStorage({
          targets: [...publishDefaults.targets],
          title: publishDefaults.title,
          description: publishDefaults.description,
          visibility: publishDefaults.visibility,
          tags: publishDefaults.tags,
          platforms: publishDefaults.platforms,
          usedInUploadAt: concurrentLater,
        }),
      });
      const err = new Error('Not found') as Error & { code?: number };
      err.code = 404;
      mockUpdateRow
        .mockResolvedValueOnce({
          ...baseRow,
          document: stringifyDraftDocumentForStorage({
            targets: [...publishDefaults.targets],
            title: publishDefaults.title,
            description: publishDefaults.description,
            visibility: publishDefaults.visibility,
            tags: publishDefaults.tags,
            platforms: publishDefaults.platforms,
            usedInUploadAt: concurrentLater,
          }),
        })
        .mockRejectedValueOnce(err);

      const result = await markDraftUsedInUpload('draft-1', incomingEarlier);

      expect(mockUpdateRow).toHaveBeenCalledTimes(2);
      expect(result).toBeNull();
    });
  });

  describe('deleteDraft', () => {
    it('calls deleteRow', async () => {
      mockDeleteRow.mockResolvedValue(undefined);
      await deleteDraft('draft-1');
      expect(mockDeleteRow).toHaveBeenCalledWith({
        databaseId: 'videosphere',
        tableId: 'drafts',
        rowId: 'draft-1',
      });
    });
  });
});
