// =============================================================================
// CONNECTED ACCOUNTS REPOSITORY UNIT TESTS
// =============================================================================
// Tests for connected account CRUD and token update. Mocks node-appwrite
// TablesDB so we don't hit a real Appwrite instance.
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockCreateRow, mockListRows, mockUpdateRow, mockDeleteRow } = vi.hoisted(() => ({
  mockCreateRow: vi.fn(),
  mockListRows: vi.fn(),
  mockUpdateRow: vi.fn(),
  mockDeleteRow: vi.fn(),
}));

vi.mock('node-appwrite', () => ({
  ID: {
    unique: () => 'test-row-id-123',
  },
  Query: {
    equal: (attr: string, value: string) => `equal("${attr}","${value}")`,
    orderAsc: (attr: string) => `orderAsc("${attr}")`,
    limit: (n: number) => `limit(${n})`,
  },
  TablesDB: class TablesDB {
    createRow = mockCreateRow;
    listRows = mockListRows;
    updateRow = mockUpdateRow;
    deleteRow = mockDeleteRow;
  },
}));

vi.mock('@/lib/appwrite', () => ({
  default: {},
}));

// Import after mocks
import {
  createConnectedAccount,
  getConnectedAccountsByUser,
  getConnectedAccount,
  updateTokens,
  deleteConnectedAccount,
} from '@/lib/repositories/connected-accounts';

const baseRow = {
  $id: 'row-1',
  userId: 'user-1',
  platform: 'youtube',
  accessToken: 'access',
  refreshToken: 'refresh',
  tokenExpiry: '2026-12-31T00:00:00.000Z',
  platformUserId: 'yt-123',
  platformName: 'My Channel',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('connected-accounts repository', () => {
  describe('createConnectedAccount', () => {
    it('stores OAuth tokens, platform user ID, and platform name', async () => {
      mockCreateRow.mockResolvedValue({ ...baseRow });

      const result = await createConnectedAccount({
        userId: 'user-1',
        platform: 'youtube',
        accessToken: 'access',
        refreshToken: 'refresh',
        tokenExpiry: '2026-12-31T00:00:00.000Z',
        platformUserId: 'yt-123',
        platformName: 'My Channel',
      });

      expect(mockCreateRow).toHaveBeenCalledTimes(1);
      const call = mockCreateRow.mock.calls[0][0];
      expect(call.databaseId).toBe('videosphere');
      expect(call.tableId).toBe('connected_accounts');
      expect(call.rowId).toBe('test-row-id-123');
      expect(call.data.userId).toBe('user-1');
      expect(call.data.platform).toBe('youtube');
      expect(call.data.accessToken).toBe('access');
      expect(call.data.refreshToken).toBe('refresh');
      expect(call.data.tokenExpiry).toBe('2026-12-31T00:00:00.000Z');
      expect(call.data.platformUserId).toBe('yt-123');
      expect(call.data.platformName).toBe('My Channel');
      expect(call.data.createdAt).toBeDefined();
      expect(call.data.updatedAt).toBeDefined();

      expect(result.id).toBe('row-1');
      expect(result.userId).toBe('user-1');
      expect(result.platform).toBe('youtube');
      expect(result.platformName).toBe('My Channel');
    });
  });

  describe('getConnectedAccountsByUser', () => {
    it('returns all connected accounts for a user', async () => {
      mockListRows.mockResolvedValue({
        rows: [
          { ...baseRow, platform: 'youtube' },
          { ...baseRow, $id: 'row-2', platform: 'vimeo', platformName: 'Vimeo User' },
        ],
      });

      const result = await getConnectedAccountsByUser('user-1');

      expect(mockListRows).toHaveBeenCalledWith(
        expect.objectContaining({
          databaseId: 'videosphere',
          tableId: 'connected_accounts',
          total: false,
        })
      );
      expect(result).toHaveLength(2);
      expect(result[0].platform).toBe('youtube');
      expect(result[1].platform).toBe('vimeo');
      expect(result[1].platformName).toBe('Vimeo User');
    });

    it('returns empty array when user has no connections', async () => {
      mockListRows.mockResolvedValue({ rows: [] });

      const result = await getConnectedAccountsByUser('user-1');

      expect(result).toEqual([]);
    });
  });

  describe('getConnectedAccount', () => {
    it('returns a specific platform connection for a user', async () => {
      mockListRows.mockResolvedValue({ rows: [{ ...baseRow, platform: 'youtube' }] });

      const result = await getConnectedAccount('user-1', 'youtube');

      expect(mockListRows).toHaveBeenCalledWith(
        expect.objectContaining({
          databaseId: 'videosphere',
          tableId: 'connected_accounts',
        })
      );
      expect(result).not.toBeNull();
      expect(result!.platform).toBe('youtube');
      expect(result!.userId).toBe('user-1');
    });

    it('returns null when no connection exists for that platform', async () => {
      mockListRows.mockResolvedValue({ rows: [] });

      const result = await getConnectedAccount('user-1', 'vimeo');

      expect(result).toBeNull();
    });
  });

  describe('updateTokens', () => {
    it('updates access, refresh, and expiry and returns updated account', async () => {
      const updated = {
        ...baseRow,
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        tokenExpiry: '2027-01-01T00:00:00.000Z',
        updatedAt: '2026-03-08T12:00:00.000Z',
      };
      mockUpdateRow.mockResolvedValue(updated);

      const result = await updateTokens(
        'row-1',
        'new-access',
        'new-refresh',
        '2027-01-01T00:00:00.000Z'
      );

      expect(mockUpdateRow).toHaveBeenCalledWith(
        expect.objectContaining({
          databaseId: 'videosphere',
          tableId: 'connected_accounts',
          rowId: 'row-1',
          data: expect.objectContaining({
            accessToken: 'new-access',
            refreshToken: 'new-refresh',
            tokenExpiry: '2027-01-01T00:00:00.000Z',
          }),
        })
      );
      expect(result).not.toBeNull();
      expect(result!.accessToken).toBe('new-access');
      expect(result!.refreshToken).toBe('new-refresh');
      expect(result!.tokenExpiry).toBe('2027-01-01T00:00:00.000Z');
    });

    it('returns null when row is not found (404)', async () => {
      const err = new Error('Not found') as Error & { code?: number };
      err.code = 404;
      mockUpdateRow.mockRejectedValue(err);

      const result = await updateTokens('bad-id', 'a', 'r', 'e');

      expect(result).toBeNull();
    });

    it('rethrows non-404 errors', async () => {
      mockUpdateRow.mockRejectedValue(new Error('Server error'));

      await expect(updateTokens('row-1', 'a', 'r', 'e')).rejects.toThrow('Server error');
    });
  });

  describe('deleteConnectedAccount', () => {
    it('calls deleteRow with the given id', async () => {
      mockDeleteRow.mockResolvedValue(undefined);

      await deleteConnectedAccount('row-1');

      expect(mockDeleteRow).toHaveBeenCalledWith({
        databaseId: 'videosphere',
        tableId: 'connected_accounts',
        rowId: 'row-1',
      });
    });
  });
});
