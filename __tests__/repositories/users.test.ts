import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockConnectToDatabase,
  mockCreate,
  mockFindById,
  mockFindOne,
  mockFindByIdAndUpdate,
  mockFindOneAndUpdate,
  mockDeleteOne,
  mockRevokeGoogleOAuthTokens,
} = vi.hoisted(() => ({
  mockConnectToDatabase: vi.fn(),
  mockCreate: vi.fn(),
  mockFindById: vi.fn(),
  mockFindOne: vi.fn(),
  mockFindByIdAndUpdate: vi.fn(),
  mockFindOneAndUpdate: vi.fn(),
  mockDeleteOne: vi.fn(),
  mockRevokeGoogleOAuthTokens: vi.fn(),
}));

vi.mock('@/lib/auth/google-oauth', () => ({
  revokeGoogleOAuthTokens: (...args: unknown[]) => mockRevokeGoogleOAuthTokens(...args),
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
    findOneAndUpdate: (...args: unknown[]) => mockFindOneAndUpdate(...args),
    deleteOne: (...args: unknown[]) => mockDeleteOne(...args),
  },
}));

import {
  createUser,
  deleteUserById,
  getUserById,
  persistGoogleAuthForUser,
  revokeStoredGoogleAuthForUser,
  updateUser,
} from '@/lib/repositories/users';
import { decryptToken, encryptToken } from '@/lib/crypto/token-encryption';

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

  it('revokes stored Google refresh token for Google auth users', async () => {
    const encrypted = encryptToken('stored-refresh-token');
    mockFindById.mockReturnValueOnce({
      select: () => ({
        lean: vi.fn().mockResolvedValue({
          authProvider: 'google',
          googleRefreshToken: encrypted,
        }),
      }),
    });
    mockRevokeGoogleOAuthTokens.mockResolvedValueOnce(undefined);

    await revokeStoredGoogleAuthForUser('auth-user-1');

    expect(mockRevokeGoogleOAuthTokens).toHaveBeenCalledWith({
      refreshToken: 'stored-refresh-token',
    });
  });

  it('skips Google revoke for password auth users', async () => {
    mockFindById.mockReturnValueOnce({
      select: () => ({
        lean: vi.fn().mockResolvedValue({
          authProvider: 'password',
        }),
      }),
    });

    await revokeStoredGoogleAuthForUser('auth-user-1');

    expect(mockRevokeGoogleOAuthTokens).not.toHaveBeenCalled();
  });
});

describe('persistGoogleAuthForUser', () => {
  it('updates by _id and encrypts the refresh token before persistence', async () => {
    mockFindByIdAndUpdate.mockReturnValueOnce(leanResult({ _id: 'auth-user-1' }));

    await persistGoogleAuthForUser('auth-user-1', 'google-refresh-token');

    const payload = mockFindByIdAndUpdate.mock.calls[0]?.[1] as {
      authProvider: string;
      googleRefreshToken: string;
    };
    expect(payload.authProvider).toBe('google');
    expect(decryptToken(payload.googleRefreshToken)).toBe('google-refresh-token');
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('updates by _id with authProvider only when no refresh token is provided', async () => {
    mockFindByIdAndUpdate.mockReturnValueOnce(leanResult({ _id: 'auth-user-1' }));

    await persistGoogleAuthForUser('auth-user-1');

    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith('auth-user-1', {
      authProvider: 'google',
    });
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('does not persist an encrypted token for whitespace-only refresh values', async () => {
    mockFindByIdAndUpdate.mockReturnValueOnce(leanResult({ _id: 'auth-user-1' }));

    await persistGoogleAuthForUser('auth-user-1', '   ');

    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith('auth-user-1', {
      authProvider: 'google',
    });
  });

  it('falls back to userId when findByIdAndUpdate does not match', async () => {
    mockFindByIdAndUpdate.mockReturnValueOnce(leanResult(null));
    mockFindOneAndUpdate.mockResolvedValueOnce(null);

    await persistGoogleAuthForUser('legacy-user-id', 'google-refresh-token');

    const byIdPayload = mockFindByIdAndUpdate.mock.calls[0]?.[1] as {
      googleRefreshToken: string;
    };
    const byUserIdPayload = mockFindOneAndUpdate.mock.calls[0]?.[1] as {
      authProvider: string;
      googleRefreshToken: string;
    };
    expect(decryptToken(byIdPayload.googleRefreshToken)).toBe('google-refresh-token');
    expect(byUserIdPayload.authProvider).toBe('google');
    expect(decryptToken(byUserIdPayload.googleRefreshToken)).toBe('google-refresh-token');
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { userId: 'legacy-user-id' },
      byUserIdPayload
    );
  });
});

describe('deleteUserById', () => {
  it('returns true when a profile is deleted by _id', async () => {
    mockDeleteOne.mockResolvedValueOnce({ deletedCount: 1 });

    await expect(deleteUserById('auth-user-1')).resolves.toBe(true);

    expect(mockDeleteOne).toHaveBeenCalledTimes(1);
    expect(mockDeleteOne).toHaveBeenCalledWith({ _id: 'auth-user-1' });
  });

  it('falls back to userId and returns true for migrated profiles', async () => {
    mockDeleteOne.mockResolvedValueOnce({ deletedCount: 0 });
    mockDeleteOne.mockResolvedValueOnce({ deletedCount: 1 });

    await expect(deleteUserById('legacy-user-id')).resolves.toBe(true);

    expect(mockDeleteOne).toHaveBeenNthCalledWith(1, { _id: 'legacy-user-id' });
    expect(mockDeleteOne).toHaveBeenNthCalledWith(2, { userId: 'legacy-user-id' });
  });

  it('returns false when no profile matches _id or userId', async () => {
    mockDeleteOne.mockResolvedValue({ deletedCount: 0 });

    await expect(deleteUserById('missing-user')).resolves.toBe(false);

    expect(mockDeleteOne).toHaveBeenCalledTimes(2);
    expect(mockDeleteOne).toHaveBeenNthCalledWith(1, { _id: 'missing-user' });
    expect(mockDeleteOne).toHaveBeenNthCalledWith(2, { userId: 'missing-user' });
  });
});
