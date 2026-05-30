import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockConnectToDatabase,
  mockCreate,
  mockFind,
  mockFindOne,
  mockFindById,
  mockFindByIdAndUpdate,
  mockDeleteOne,
} = vi.hoisted(() => ({
  mockConnectToDatabase: vi.fn(),
  mockCreate: vi.fn(),
  mockFind: vi.fn(),
  mockFindOne: vi.fn(),
  mockFindById: vi.fn(),
  mockFindByIdAndUpdate: vi.fn(),
  mockDeleteOne: vi.fn(),
}));

vi.mock('@/lib/mongodb', () => ({
  connectToDatabase: (...args: unknown[]) => mockConnectToDatabase(...args),
}));

vi.mock('@/lib/models/ConnectedAccount', () => ({
  ConnectedAccountModel: {
    create: (...args: unknown[]) => mockCreate(...args),
    find: (...args: unknown[]) => mockFind(...args),
    findOne: (...args: unknown[]) => mockFindOne(...args),
    findById: (...args: unknown[]) => mockFindById(...args),
    findByIdAndUpdate: (...args: unknown[]) => mockFindByIdAndUpdate(...args),
    deleteOne: (...args: unknown[]) => mockDeleteOne(...args),
  },
}));

import {
  createConnectedAccount,
  deleteConnectedAccount,
  getConnectedAccount,
  getConnectedAccountsByUser,
  getConnectedAccountForUser,
  updateTokens,
} from '@/lib/repositories/connected-accounts';

function chain<T>(value: T) {
  return {
    sort: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue(value),
  };
}

const baseDoc = {
  _id: 'conn-1',
  userId: 'user-1',
  platform: 'youtube',
  accessToken: 'encrypted',
  refreshToken: 'encrypted-refresh',
  tokenExpiry: '2026-12-31T00:00:00.000Z',
  platformUserId: 'yt-123',
  platformName: 'My Channel',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockConnectToDatabase.mockResolvedValue(undefined);
});

describe('connected-accounts repository (mongo)', () => {
  it('creates connected account and returns public shape', async () => {
    mockCreate.mockResolvedValueOnce({ toObject: () => baseDoc });

    const account = await createConnectedAccount({
      userId: 'user-1',
      platform: 'youtube',
      accessToken: 'a',
      refreshToken: 'r',
      tokenExpiry: '2026-12-31T00:00:00.000Z',
      platformUserId: 'yt-123',
      platformName: 'My Channel',
    });

    expect(mockCreate).toHaveBeenCalled();
    expect(account.id).toBe('conn-1');
    expect(account).not.toHaveProperty('accessToken');
  });

  it('lists and gets account by platform', async () => {
    mockFind.mockReturnValueOnce(chain([baseDoc]));
    mockFindOne.mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(baseDoc) });

    const all = await getConnectedAccountsByUser('user-1');
    const one = await getConnectedAccount('user-1', 'youtube');

    expect(all).toHaveLength(1);
    expect(one?.platform).toBe('youtube');
  });

  it('guards ownership on id lookup', async () => {
    mockFindById.mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(baseDoc) });
    const own = await getConnectedAccountForUser('conn-1', 'user-1');
    expect(own?.id).toBe('conn-1');

    mockFindById.mockReturnValueOnce({
      lean: vi.fn().mockResolvedValue({ ...baseDoc, userId: 'other-user' }),
    });
    const other = await getConnectedAccountForUser('conn-1', 'user-1');
    expect(other).toBeNull();
  });

  it('updates tokens and deletes by id', async () => {
    mockFindByIdAndUpdate.mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(baseDoc) });
    mockDeleteOne.mockResolvedValueOnce({ deletedCount: 1 });

    const updated = await updateTokens('conn-1', 'new-a', 'new-r', '2027-01-01T00:00:00.000Z');
    await deleteConnectedAccount('conn-1');

    expect(updated?.id).toBe('conn-1');
    expect(mockDeleteOne).toHaveBeenCalledWith({ _id: 'conn-1' });
  });
});
