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
  updateDraft,
  deleteDraft,
} from '@/lib/repositories/drafts';
import { stringifyDraftDocumentForStorage } from '@/lib/draft-upload-metadata';

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
