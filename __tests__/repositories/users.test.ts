import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockConnectToDatabase, mockCreate, mockFindById, mockFindOne, mockFindByIdAndUpdate } =
  vi.hoisted(() => ({
    mockConnectToDatabase: vi.fn(),
    mockCreate: vi.fn(),
    mockFindById: vi.fn(),
    mockFindOne: vi.fn(),
    mockFindByIdAndUpdate: vi.fn(),
  }));

vi.mock('@/lib/mongodb', () => ({
  connectToDatabase: (...args: unknown[]) => mockConnectToDatabase(...args),
}));

vi.mock('@/lib/models/UserProfile', () => ({
  UserProfileModel: {
    create: (...args: unknown[]) => mockCreate(...args),
    findById: (...args: unknown[]) => mockFindById(...args),
    findOne: (...args: unknown[]) => mockFindOne(...args),
    findByIdAndUpdate: (...args: unknown[]) => mockFindByIdAndUpdate(...args),
  },
}));

import { createUser, getUserById, updateUser } from '@/lib/repositories/users';

function leanResult<T>(value: T) {
  return {
    lean: vi.fn().mockResolvedValue(value),
  };
}

const baseDoc = {
  _id: 'auth-user-1',
  userId: 'auth-user-1',
  email: 'a@example.com',
  name: 'Ada',
  hasCompletedOnboarding: false,
  role: 'user',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockConnectToDatabase.mockResolvedValue(undefined);
});

describe('users repository (mongo)', () => {
  it('creates a normalized user profile', async () => {
    mockCreate.mockResolvedValueOnce({ toObject: () => baseDoc });

    const user = await createUser({ userId: 'auth-user-1', email: 'A@Example.com', name: 'Ada' });

    expect(mockConnectToDatabase).toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: 'auth-user-1',
        userId: 'auth-user-1',
        email: 'a@example.com',
        name: 'Ada',
        role: 'user',
      })
    );
    expect(user.userId).toBe('auth-user-1');
    expect(user.email).toBe('a@example.com');
    expect(user.name).toBe('Ada');
  });

  it('gets by _id first, then falls back to userId', async () => {
    mockFindById.mockReturnValueOnce(leanResult(null));
    mockFindOne.mockReturnValueOnce(leanResult(baseDoc));

    const user = await getUserById('auth-user-1');

    expect(mockFindById).toHaveBeenCalledWith('auth-user-1');
    expect(mockFindOne).toHaveBeenCalledWith({ userId: 'auth-user-1' });
    expect(user?.userId).toBe('auth-user-1');
  });

  it('updates user by id and returns updated entity', async () => {
    const updatedDoc = {
      ...baseDoc,
      role: 'admin',
      hasCompletedOnboarding: true,
    };
    mockFindByIdAndUpdate.mockReturnValueOnce(leanResult(updatedDoc));

    const user = await updateUser('auth-user-1', {
      role: 'admin',
      hasCompletedOnboarding: true,
    });

    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith(
      'auth-user-1',
      expect.objectContaining({
        role: 'admin',
        hasCompletedOnboarding: true,
      }),
      expect.objectContaining({ returnDocument: 'after' })
    );
    expect(user.role).toBe('admin');
    expect(user.hasCompletedOnboarding).toBe(true);
  });
});
