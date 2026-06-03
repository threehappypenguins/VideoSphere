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
  getUserPasswordAuthStateByEmail,
  getUserPasswordAuthStateById,
  persistGoogleAuthForUser,
  revertGoogleAuthToPassword,
  getUserAuthProviderById,
  revokeStoredGoogleAuthForUser,
  updateUser,
  updateUserPasswordHash,
} from '@/lib/repositories/users';
import { decryptToken, encryptToken } from '@/lib/crypto/token-encryption';

function leanResult<T>(value: T) {
  return {
    lean: vi.fn().mockResolvedValue(value),
  };
}

function selectLeanResult<T>(value: T) {
  return {
    select: () => ({
      lean: vi.fn().mockResolvedValue(value),
    }),
  };
}

const baseDoc = {
  _id: 'auth-user-1',
  userId: 'auth-user-1',
  email: 'a@example.com',
  name: 'Ada',
  hasCompletedOnboarding: false,
  role: 'user',
  authProvider: 'password',
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
        authProvider: 'password',
      })
    );
    expect(user.userId).toBe('auth-user-1');
    expect(user.email).toBe('a@example.com');
    expect(user.name).toBe('Ada');
  });

  it('gets user by _id', async () => {
    mockFindById.mockReturnValueOnce(leanResult(baseDoc));

    const user = await getUserById('auth-user-1');

    expect(mockFindById).toHaveBeenCalledWith('auth-user-1');
    expect(mockFindOne).not.toHaveBeenCalled();
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

describe('updateUserPasswordHash', () => {
  it('updates the password hash by user id', async () => {
    mockFindByIdAndUpdate.mockReturnValueOnce(leanResult({ _id: 'auth-user-1' }));

    await expect(updateUserPasswordHash('auth-user-1', 'new-bcrypt-hash')).resolves.toBeUndefined();

    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith('auth-user-1', {
      passwordHash: 'new-bcrypt-hash',
    });
  });

  it('throws a 404 error when no profile matches', async () => {
    mockFindByIdAndUpdate.mockReturnValueOnce(leanResult(null));

    await expect(updateUserPasswordHash('missing-user', 'new-bcrypt-hash')).rejects.toMatchObject({
      message: 'User profile not found',
      code: 404,
    });
  });
});

describe('getUserPasswordAuthStateByEmail', () => {
  it('returns supportsPasswordReset true when a password hash exists', async () => {
    mockFindOne.mockReturnValueOnce(
      selectLeanResult({
        userId: 'auth-user-1',
        passwordHash: 'stored-hash',
        authProvider: 'password',
      })
    );

    await expect(getUserPasswordAuthStateByEmail('  User@Example.com ')).resolves.toEqual({
      userId: 'auth-user-1',
      supportsPasswordReset: true,
    });

    expect(mockFindOne).toHaveBeenCalledWith({ email: 'user@example.com' });
  });

  it('returns supportsPasswordReset false for Google OAuth-only accounts', async () => {
    mockFindOne.mockReturnValueOnce(
      selectLeanResult({
        userId: 'auth-user-1',
        authProvider: 'google',
      })
    );

    await expect(getUserPasswordAuthStateByEmail('oauth@example.com')).resolves.toEqual({
      userId: 'auth-user-1',
      supportsPasswordReset: false,
    });
  });

  it('returns null when no profile matches the email', async () => {
    mockFindOne.mockReturnValueOnce(selectLeanResult(null));

    await expect(getUserPasswordAuthStateByEmail('missing@example.com')).resolves.toBeNull();
  });

  it('returns null for blank email without querying', async () => {
    await expect(getUserPasswordAuthStateByEmail('   ')).resolves.toBeNull();

    expect(mockConnectToDatabase).not.toHaveBeenCalled();
    expect(mockFindOne).not.toHaveBeenCalled();
  });
});

describe('getUserPasswordAuthStateById', () => {
  it('returns supportsPasswordReset false for google auth even when passwordHash is present', async () => {
    mockFindById.mockReturnValueOnce(
      selectLeanResult({
        userId: 'auth-user-1',
        passwordHash: 'stored-hash',
        authProvider: 'google',
      })
    );

    await expect(getUserPasswordAuthStateById('auth-user-1')).resolves.toEqual({
      userId: 'auth-user-1',
      supportsPasswordReset: false,
    });

    expect(mockFindById).toHaveBeenCalledWith('auth-user-1');
  });

  it('returns supportsPasswordReset true for password auth provider', async () => {
    mockFindById.mockReturnValueOnce(
      selectLeanResult({
        userId: 'auth-user-1',
        authProvider: 'password',
      })
    );

    await expect(getUserPasswordAuthStateById('auth-user-1')).resolves.toEqual({
      userId: 'auth-user-1',
      supportsPasswordReset: true,
    });
  });

  it('returns supportsPasswordReset false for Google OAuth-only accounts', async () => {
    mockFindById.mockReturnValueOnce(
      selectLeanResult({
        userId: 'auth-user-1',
        authProvider: 'google',
      })
    );

    await expect(getUserPasswordAuthStateById('auth-user-1')).resolves.toEqual({
      userId: 'auth-user-1',
      supportsPasswordReset: false,
    });
  });

  it('returns null when no profile matches the id', async () => {
    mockFindById.mockReturnValueOnce(selectLeanResult(null));

    await expect(getUserPasswordAuthStateById('missing-user')).resolves.toBeNull();
  });
});

describe('persistGoogleAuthForUser', () => {
  it('updates by _id and encrypts the refresh token before persistence', async () => {
    mockFindByIdAndUpdate.mockReturnValueOnce(leanResult({ _id: 'auth-user-1' }));

    await persistGoogleAuthForUser('auth-user-1', 'google-refresh-token');

    const update = mockFindByIdAndUpdate.mock.calls[0]?.[1] as {
      $set: { authProvider: string; googleRefreshToken: string };
    };
    expect(update.$set.authProvider).toBe('google');
    expect(decryptToken(update.$set.googleRefreshToken)).toBe('google-refresh-token');
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('updates by _id with authProvider only when no refresh token is provided', async () => {
    mockFindByIdAndUpdate.mockReturnValueOnce(leanResult({ _id: 'auth-user-1' }));

    await persistGoogleAuthForUser('auth-user-1');

    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith('auth-user-1', {
      $set: { authProvider: 'google' },
    });
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('does not persist an encrypted token for whitespace-only refresh values', async () => {
    mockFindByIdAndUpdate.mockReturnValueOnce(leanResult({ _id: 'auth-user-1' }));

    await persistGoogleAuthForUser('auth-user-1', '   ');

    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith('auth-user-1', {
      $set: { authProvider: 'google' },
    });
  });

  it('unsets passwordHash when connect flow option is set', async () => {
    mockFindByIdAndUpdate.mockReturnValueOnce(leanResult({ _id: 'auth-user-1' }));

    await persistGoogleAuthForUser('auth-user-1', 'google-refresh-token', {
      unsetPasswordHash: true,
    });

    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith('auth-user-1', {
      $set: expect.objectContaining({ authProvider: 'google' }),
      $unset: { passwordHash: 1 },
    });
  });
});

describe('revertGoogleAuthToPassword', () => {
  it('sets password auth and unsets google refresh token', async () => {
    mockFindByIdAndUpdate.mockReturnValueOnce(leanResult({ _id: 'auth-user-1' }));

    await revertGoogleAuthToPassword('auth-user-1', 'new-bcrypt-hash');

    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith('auth-user-1', {
      $set: { passwordHash: 'new-bcrypt-hash', authProvider: 'password' },
      $unset: { googleRefreshToken: 1 },
    });
  });
});

describe('getUserAuthProviderById', () => {
  it('returns the stored auth provider', async () => {
    mockFindById.mockReturnValueOnce({
      select: () => ({
        lean: vi.fn().mockResolvedValue({ authProvider: 'google' }),
      }),
    });

    await expect(getUserAuthProviderById('auth-user-1')).resolves.toBe('google');
  });

  it('returns null when the profile is missing', async () => {
    mockFindById.mockReturnValueOnce({
      select: () => ({
        lean: vi.fn().mockResolvedValue(null),
      }),
    });

    await expect(getUserAuthProviderById('missing-user')).resolves.toBeNull();
  });
});

describe('deleteUserById', () => {
  it('returns true when a profile is deleted by _id', async () => {
    mockDeleteOne.mockResolvedValueOnce({ deletedCount: 1 });

    await expect(deleteUserById('auth-user-1')).resolves.toBe(true);

    expect(mockDeleteOne).toHaveBeenCalledTimes(1);
    expect(mockDeleteOne).toHaveBeenCalledWith({ _id: 'auth-user-1' });
  });

  it('returns false when no profile matches _id', async () => {
    mockDeleteOne.mockResolvedValue({ deletedCount: 0 });

    await expect(deleteUserById('missing-user')).resolves.toBe(false);

    expect(mockDeleteOne).toHaveBeenCalledTimes(1);
    expect(mockDeleteOne).toHaveBeenCalledWith({ _id: 'missing-user' });
  });
});
