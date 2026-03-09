// =============================================================================
// DRAFTS REPOSITORY UNIT TESTS
// =============================================================================
// Tests for draft CRUD. Mocks node-appwrite TablesDB so we don't hit a real
// Appwrite instance. Ensures tags are JSON-serialized on write and parsed on read.
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

const baseRow = {
  $id: 'draft-1',
  userId: 'user-1',
  title: 'My Video',
  description: 'A great video.',
  tags: '["tag1","tag2"]',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('drafts repository', () => {
  describe('createDraft', () => {
    it('stores draft with tags JSON-stringified', async () => {
      mockCreateRow.mockResolvedValue({ ...baseRow });

      const result = await createDraft({
        userId: 'user-1',
        title: 'My Video',
        description: 'A great video.',
        tags: ['tag1', 'tag2'],
      });

      expect(mockCreateRow).toHaveBeenCalledTimes(1);
      const call = mockCreateRow.mock.calls[0][0];
      expect(call.databaseId).toBe('videosphere');
      expect(call.tableId).toBe('drafts');
      expect(call.rowId).toBe('draft-id-123');
      expect(call.data.userId).toBe('user-1');
      expect(call.data.title).toBe('My Video');
      expect(call.data.description).toBe('A great video.');
      expect(call.data.tags).toBe(JSON.stringify(['tag1', 'tag2']));
      expect(call.data.createdAt).toBeDefined();
      expect(call.data.updatedAt).toBeDefined();

      expect(result.id).toBe('draft-1');
      expect(result.userId).toBe('user-1');
      expect(result.title).toBe('My Video');
      expect(result.tags).toEqual(['tag1', 'tag2']);
    });

    it('stringifies empty tags array', async () => {
      mockCreateRow.mockResolvedValue({ ...baseRow, tags: '[]' });

      await createDraft({
        userId: 'user-1',
        title: 'No Tags',
        description: 'Desc',
        tags: [],
      });

      const call = mockCreateRow.mock.calls[0][0];
      expect(call.data.tags).toBe('[]');
    });
  });

  describe('getDraftById', () => {
    it('returns typed Draft with tags parsed as string[]', async () => {
      mockGetRow.mockResolvedValue({ ...baseRow, tags: '["a","b","c"]' });

      const result = await getDraftById('draft-1');

      expect(mockGetRow).toHaveBeenCalledWith({
        databaseId: 'videosphere',
        tableId: 'drafts',
        rowId: 'draft-1',
      });
      expect(result).not.toBeNull();
      expect(result!.id).toBe('draft-1');
      expect(result!.title).toBe('My Video');
      expect(result!.tags).toEqual(['a', 'b', 'c']);
    });

    it('returns null when draft is not found (404)', async () => {
      const err = new Error('Not found') as Error & { code?: number };
      err.code = 404;
      mockGetRow.mockRejectedValue(err);

      const result = await getDraftById('missing-id');

      expect(result).toBeNull();
    });

    it('returns empty tags array when tags is invalid or missing', async () => {
      mockGetRow.mockResolvedValue({ ...baseRow, tags: '' });

      const result = await getDraftById('draft-1');

      expect(result!.tags).toEqual([]);
    });

    it('rethrows non-404 errors', async () => {
      mockGetRow.mockRejectedValue(new Error('Server error'));

      await expect(getDraftById('draft-1')).rejects.toThrow('Server error');
    });
  });

  describe('listDraftsByUser', () => {
    it('returns all drafts for user sorted by updatedAt descending', async () => {
      mockListRows.mockResolvedValue({
        rows: [
          { ...baseRow, $id: 'd1', updatedAt: '2026-01-03T00:00:00.000Z' },
          { ...baseRow, $id: 'd2', updatedAt: '2026-01-02T00:00:00.000Z' },
        ],
      });

      const result = await listDraftsByUser('user-1');

      expect(mockListRows).toHaveBeenCalledWith(
        expect.objectContaining({
          databaseId: 'videosphere',
          tableId: 'drafts',
          total: false,
        })
      );
      const queries = mockListRows.mock.calls[0][0].queries;
      expect(queries).toContain('equal("userId","user-1")');
      expect(queries).toContain('orderDesc("updatedAt")');
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('d1');
      expect(result[1].id).toBe('d2');
      result.forEach((draft) => {
        expect(draft).toHaveProperty('tags');
        expect(Array.isArray(draft.tags)).toBe(true);
      });
    });

    it('returns empty array when user has no drafts', async () => {
      mockListRows.mockResolvedValue({ rows: [] });

      const result = await listDraftsByUser('user-1');

      expect(result).toEqual([]);
    });
  });

  describe('updateDraft', () => {
    it('updates provided fields and JSON-stringifies tags', async () => {
      const updated = {
        ...baseRow,
        title: 'Updated Title',
        tags: '["new","tags"]',
        updatedAt: '2026-03-09T12:00:00.000Z',
      };
      mockUpdateRow.mockResolvedValue(updated);

      const result = await updateDraft('draft-1', {
        title: 'Updated Title',
        tags: ['new', 'tags'],
      });

      expect(mockUpdateRow).toHaveBeenCalledWith(
        expect.objectContaining({
          databaseId: 'videosphere',
          tableId: 'drafts',
          rowId: 'draft-1',
          data: expect.objectContaining({
            title: 'Updated Title',
            tags: '["new","tags"]',
            updatedAt: expect.any(String),
          }),
        })
      );
      expect(result).not.toBeNull();
      expect(result!.title).toBe('Updated Title');
      expect(result!.tags).toEqual(['new', 'tags']);
    });

    it('returns null when draft is not found (404)', async () => {
      const err = new Error('Not found') as Error & { code?: number };
      err.code = 404;
      mockUpdateRow.mockRejectedValue(err);

      const result = await updateDraft('missing-id', { title: 'New' });

      expect(result).toBeNull();
    });

    it('rethrows non-404 errors', async () => {
      mockUpdateRow.mockRejectedValue(new Error('Server error'));

      await expect(updateDraft('draft-1', { title: 'X' })).rejects.toThrow('Server error');
    });
  });

  describe('deleteDraft', () => {
    it('calls deleteRow with the given id', async () => {
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
