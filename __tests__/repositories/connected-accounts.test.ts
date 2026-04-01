// =============================================================================
// CONNECTED ACCOUNTS REPOSITORY UNIT TESTS
// =============================================================================
// Tests for connected account CRUD and token update. Mocks node-appwrite
// TablesDB so we don't hit a real Appwrite instance.
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockCreateRow, mockListRows, mockUpdateRow, mockDeleteRow, mockGetRow } = vi.hoisted(
  () => ({
    mockCreateRow: vi.fn(),
    mockListRows: vi.fn(),
    mockUpdateRow: vi.fn(),
    mockDeleteRow: vi.fn(),
    mockGetRow: vi.fn(),
  })
);

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
    getRow = mockGetRow;
  },
}));

vi.mock('@/lib/appwrite', () => ({
  default: {},
}));

// Import after mocks (token-encryption is not mocked; uses env key from vitest.setup)
import { encryptToken } from '@/lib/crypto/token-encryption';
import {
  createConnectedAccount,
  getConnectedAccountsByUser,
  getConnectedAccount,
  getConnectedAccountWithTokens,
  getConnectedAccountForUser,
  updateTokens,
  deleteConnectedAccount,
} from '@/lib/repositories/connected-accounts';

const baseRow = {
  $id: 'row-1',
  userId: 'user-1',
  platform: 'youtube',
  accessToken: encryptToken('access'),
  refreshToken: encryptToken('refresh'),
  tokenExpiry: '2026-12-31T00:00:00.000Z',
  platformUserId: 'yt-123',
  platformName: 'My Channel',
  $createdAt: '2026-01-01T00:00:00.000Z',
  $updatedAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('connected-accounts repository', () => {
  describe('createConnectedAccount', () => {
    it('stores OAuth tokens encrypted, platform user ID, and platform name', async () => {
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
      expect(call.data.tokenExpiry).toBe('2026-12-31T00:00:00.000Z');
      expect(call.data.platformUserId).toBe('yt-123');
      expect(call.data.platformName).toBe('My Channel');
      expect(call.data).not.toHaveProperty('createdAt');
      expect(call.data).not.toHaveProperty('updatedAt');
      expect(call.data.accessToken).not.toBe('access');
      expect(call.data.refreshToken).not.toBe('refresh');
      expect(call.data.accessToken).toMatch(/^[A-Za-z0-9+/=]+$/);
      expect(call.data.refreshToken).toMatch(/^[A-Za-z0-9+/=]+$/);

      expect(result.id).toBe('row-1');
      expect(result.userId).toBe('user-1');
      expect(result.platform).toBe('youtube');
      expect(result.platformName).toBe('My Channel');
      expect(result.tokenExpiry).toBe('2026-12-31T00:00:00.000Z');
      expect(result.hasRefreshToken).toBe(true);
      expect(result).not.toHaveProperty('accessToken');
      expect(result).not.toHaveProperty('refreshToken');
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
      expect(result[0].hasRefreshToken).toBe(true);
      expect(result[1].hasRefreshToken).toBe(true);
      result.forEach((account) => {
        expect(account).not.toHaveProperty('accessToken');
        expect(account).not.toHaveProperty('refreshToken');
      });
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

    it('returns public shape without tokens', async () => {
      mockListRows.mockResolvedValue({ rows: [{ ...baseRow }] });

      const result = await getConnectedAccount('user-1', 'youtube');

      expect(result).not.toHaveProperty('accessToken');
      expect(result).not.toHaveProperty('refreshToken');
    });
  });

  describe('getConnectedAccountForUser', () => {
    it('returns the account (public shape) when the row exists and userId matches', async () => {
      mockGetRow.mockResolvedValue({ ...baseRow });

      const result = await getConnectedAccountForUser('row-1', 'user-1');

      expect(mockGetRow).toHaveBeenCalledWith({
        databaseId: 'videosphere',
        tableId: 'connected_accounts',
        rowId: 'row-1',
      });
      expect(result).not.toBeNull();
      expect(result!.id).toBe('row-1');
      expect(result!.userId).toBe('user-1');
      expect(result).not.toHaveProperty('accessToken');
      expect(result).not.toHaveProperty('refreshToken');
    });

    it('returns null when the row belongs to a different user (IDOR check)', async () => {
      mockGetRow.mockResolvedValue({ ...baseRow, userId: 'other-user' });

      const result = await getConnectedAccountForUser('row-1', 'user-1');

      expect(result).toBeNull();
    });

    it('returns null when the row does not exist (404 from Appwrite)', async () => {
      const err = Object.assign(new Error('Not found'), { code: 404 });
      mockGetRow.mockRejectedValue(err);

      const result = await getConnectedAccountForUser('missing-id', 'user-1');

      expect(result).toBeNull();
    });

    it('rethrows non-404 errors', async () => {
      mockGetRow.mockRejectedValue(new Error('DB connection error'));

      await expect(getConnectedAccountForUser('row-1', 'user-1')).rejects.toThrow(
        'DB connection error'
      );
    });
  });

  describe('getConnectedAccountWithTokens', () => {
    it('returns full account with decrypted tokens when found', async () => {
      mockListRows.mockResolvedValue({
        rows: [
          {
            ...baseRow,
            platform: 'youtube',
            accessToken: encryptToken('access'),
            refreshToken: encryptToken('refresh'),
          },
        ],
      });

      const result = await getConnectedAccountWithTokens('user-1', 'youtube');

      expect(result).not.toBeNull();
      expect(result!.platform).toBe('youtube');
      expect(result!.accessToken).toBe('access');
      expect(result!.refreshToken).toBe('refresh');
      expect(result!.tokenExpiry).toBe('2026-12-31T00:00:00.000Z');
    });

    it('returns null when no connection exists', async () => {
      mockListRows.mockResolvedValue({ rows: [] });

      const result = await getConnectedAccountWithTokens('user-1', 'vimeo');

      expect(result).toBeNull();
    });
  });

  describe('updateTokens', () => {
    it('encrypts and stores new tokens, returns updated public account', async () => {
      const updated = {
        ...baseRow,
        accessToken: encryptToken('new-access'),
        refreshToken: encryptToken('new-refresh'),
        tokenExpiry: '2027-01-01T00:00:00.000Z',
        $updatedAt: '2026-03-08T12:00:00.000Z',
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
            tokenExpiry: '2027-01-01T00:00:00.000Z',
          }),
        })
      );
      const data = mockUpdateRow.mock.calls[0][0].data;
      expect(data.accessToken).not.toBe('new-access');
      expect(data.refreshToken).not.toBe('new-refresh');
      expect(data.accessToken).toMatch(/^[A-Za-z0-9+/=]+$/);
      expect(result).not.toBeNull();
      expect(result!.tokenExpiry).toBe('2027-01-01T00:00:00.000Z');
      expect(result!.hasRefreshToken).toBe(true);
      expect(result).not.toHaveProperty('accessToken');
      expect(result).not.toHaveProperty('refreshToken');
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
