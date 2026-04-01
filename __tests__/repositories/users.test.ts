// =============================================================================
// USERS REPOSITORY UNIT TESTS
// =============================================================================
// Mocks node-appwrite TablesDB. Covers getUserById primary path and userId
// column fallback after getRow 404 (legacy / console-created rows).
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockGetRow, mockListRows, mockCreateRow, mockUpdateRow } = vi.hoisted(() => ({
  mockGetRow: vi.fn(),
  mockListRows: vi.fn(),
  mockCreateRow: vi.fn(),
  mockUpdateRow: vi.fn(),
}));

vi.mock('node-appwrite', () => ({
  ID: { unique: () => 'generated-id' },
  Query: {
    equal: (attr: string, value: string) => `equal("${attr}","${value}")`,
    limit: (n: number) => `limit(${n})`,
    offset: (n: number) => `offset(${n})`,
    orderAsc: (attr: string) => `orderAsc("${attr}")`,
  },
  TablesDB: class TablesDB {
    getRow = mockGetRow;
    listRows = mockListRows;
    createRow = mockCreateRow;
    updateRow = mockUpdateRow;
  },
}));

vi.mock('@/lib/appwrite', () => ({
  default: {},
}));

import { getUserById, updateUser } from '@/lib/repositories/users';

const timestamps = {
  $createdAt: '2026-01-01T00:00:00.000Z',
  $updatedAt: '2026-01-02T00:00:00.000Z',
};

function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    $id: 'auth-user-1',
    userId: 'auth-user-1',
    email: 'a@example.com',
    isSupporter: false,
    role: 'user',
    hasCompletedOnboarding: false,
    ...timestamps,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getUserById', () => {
  it('returns mapped user when getRow succeeds (row id = Auth id)', async () => {
    mockGetRow.mockResolvedValue(profileRow());

    const user = await getUserById('auth-user-1');

    expect(mockGetRow).toHaveBeenCalledWith({
      databaseId: 'videosphere',
      tableId: 'user_profiles',
      rowId: 'auth-user-1',
    });
    expect(mockListRows).not.toHaveBeenCalled();
    expect(user).toEqual({
      userId: 'auth-user-1',
      email: 'a@example.com',
      isSupporter: false,
      role: 'user',
      hasCompletedOnboarding: false,
      $createdAt: timestamps.$createdAt,
      $updatedAt: timestamps.$updatedAt,
    });
  });

  it('falls back to listRows by userId when getRow returns 404', async () => {
    mockGetRow.mockRejectedValue({ code: 404 });
    mockListRows.mockResolvedValue({
      rows: [
        profileRow({
          $id: 'legacy-row-id',
          userId: 'auth-user-1',
          role: 'admin',
        }),
      ],
    });

    const user = await getUserById('auth-user-1');

    expect(mockListRows).toHaveBeenCalledWith({
      databaseId: 'videosphere',
      tableId: 'user_profiles',
      queries: ['equal("userId","auth-user-1")', 'limit(1)'],
      total: false,
    });
    expect(user?.role).toBe('admin');
    expect(user?.userId).toBe('auth-user-1');
  });

  it('returns null when getRow 404 and listRows is empty', async () => {
    mockGetRow.mockRejectedValue({ code: 404 });
    mockListRows.mockResolvedValue({ rows: [] });

    const user = await getUserById('missing');

    expect(user).toBeNull();
  });

  it('rethrows non-404 errors from getRow without calling listRows', async () => {
    mockGetRow.mockRejectedValue({ code: 500, message: 'Server error' });

    await expect(getUserById('auth-user-1')).rejects.toMatchObject({ code: 500 });
    expect(mockListRows).not.toHaveBeenCalled();
  });
});

describe('updateUser', () => {
  it('updates via direct rowId when row id equals Auth id', async () => {
    mockUpdateRow.mockResolvedValue(profileRow({ isSupporter: true }));

    const user = await updateUser('auth-user-1', { isSupporter: true });

    expect(mockUpdateRow).toHaveBeenCalledWith({
      databaseId: 'videosphere',
      tableId: 'user_profiles',
      rowId: 'auth-user-1',
      data: { isSupporter: true },
    });
    expect(mockListRows).not.toHaveBeenCalled();
    expect(user.isSupporter).toBe(true);
  });

  it('falls back to listRows then updates via actual row id for console-created rows', async () => {
    mockUpdateRow
      .mockRejectedValueOnce({ code: 404 })
      .mockResolvedValueOnce(profileRow({ $id: 'legacy-row-id', hasCompletedOnboarding: true }));
    mockListRows.mockResolvedValue({
      rows: [profileRow({ $id: 'legacy-row-id', userId: 'auth-user-1' })],
    });

    const user = await updateUser('auth-user-1', { hasCompletedOnboarding: true });

    expect(mockListRows).toHaveBeenCalledWith({
      databaseId: 'videosphere',
      tableId: 'user_profiles',
      queries: ['equal("userId","auth-user-1")', 'limit(1)'],
      total: false,
    });
    expect(mockUpdateRow).toHaveBeenLastCalledWith({
      databaseId: 'videosphere',
      tableId: 'user_profiles',
      rowId: 'legacy-row-id',
      data: { hasCompletedOnboarding: true },
    });
    expect(user.hasCompletedOnboarding).toBe(true);
  });

  it('throws 404 when fallback listRows finds no row', async () => {
    mockUpdateRow.mockRejectedValueOnce({ code: 404 });
    mockListRows.mockResolvedValue({ rows: [] });

    await expect(updateUser('missing-user', { isSupporter: true })).rejects.toMatchObject({
      code: 404,
    });
  });

  it('rethrows non-404 errors without falling back', async () => {
    mockUpdateRow.mockRejectedValueOnce({ code: 500, message: 'Server error' });

    await expect(updateUser('auth-user-1', { isSupporter: true })).rejects.toMatchObject({
      code: 500,
    });
    expect(mockListRows).not.toHaveBeenCalled();
  });
});
