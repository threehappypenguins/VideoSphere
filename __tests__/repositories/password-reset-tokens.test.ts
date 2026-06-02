import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPasswordResetToken } from '@/lib/auth/password-reset-token-hash';

const {
  mockConnectToDatabase,
  mockFindOne,
  mockFindOneAndUpdate,
  mockCountDocuments,
  mockUpdateMany,
  mockUpdateUserPasswordHash,
} = vi.hoisted(() => ({
  mockConnectToDatabase: vi.fn(),
  mockFindOne: vi.fn(),
  mockFindOneAndUpdate: vi.fn(),
  mockCountDocuments: vi.fn(),
  mockUpdateMany: vi.fn(),
  mockUpdateUserPasswordHash: vi.fn(),
}));

vi.mock('@/lib/mongodb', () => ({
  connectToDatabase: (...args: unknown[]) => mockConnectToDatabase(...args),
}));

vi.mock('@/lib/repositories/users', () => ({
  updateUserPasswordHash: (...args: unknown[]) => mockUpdateUserPasswordHash(...args),
}));

vi.mock('@/lib/models/PasswordResetToken', () => ({
  PasswordResetTokenModel: {
    findOne: (...args: unknown[]) => mockFindOne(...args),
    findOneAndUpdate: (...args: unknown[]) => mockFindOneAndUpdate(...args),
    countDocuments: (...args: unknown[]) => mockCountDocuments(...args),
    updateMany: (...args: unknown[]) => mockUpdateMany(...args),
  },
}));

import {
  claimPasswordResetToken,
  completePasswordResetWithPasswordHash,
  countForgotPasswordResetTokensSince,
  findValidPasswordResetToken,
} from '@/lib/repositories/password-reset-tokens';

function leanResult<T>(value: T) {
  return {
    lean: vi.fn().mockResolvedValue(value),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockConnectToDatabase.mockResolvedValue(undefined);
  mockUpdateUserPasswordHash.mockResolvedValue(undefined);
  mockUpdateMany.mockResolvedValue({ modifiedCount: 0 });
});

function validTokenDoc(
  token: string,
  now: Date,
  overrides: Partial<{
    _id: string;
    userId: string;
    source: 'forgot-password' | 'admin';
    expiresAt: Date;
    usedAt: Date;
  }> = {}
) {
  const tokenHash = hashPasswordResetToken(token);
  return {
    _id: 'token-doc-1',
    tokenHash,
    userId: 'user-1',
    source: 'forgot-password' as const,
    expiresAt: new Date('2026-06-02T12:15:00.000Z'),
    createdAt: new Date('2026-06-02T11:45:00.000Z'),
    updatedAt: now,
    ...overrides,
  };
}

describe('claimPasswordResetToken', () => {
  it('atomically claims an unused, unexpired token by hash lookup', async () => {
    const now = new Date('2026-06-02T12:00:00.000Z');
    const tokenHash = hashPasswordResetToken('valid-token');
    mockFindOneAndUpdate.mockReturnValueOnce(
      leanResult({
        _id: 'token-doc-1',
        tokenHash,
        userId: 'user-1',
        source: 'forgot-password',
        expiresAt: new Date('2026-06-02T12:15:00.000Z'),
        usedAt: now,
        createdAt: new Date('2026-06-02T11:45:00.000Z'),
        updatedAt: now,
      })
    );

    const claimed = await claimPasswordResetToken('valid-token', now, now);

    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      {
        tokenHash,
        usedAt: { $exists: false },
        expiresAt: { $gt: now },
      },
      { $set: { usedAt: now } },
      { returnDocument: 'after' }
    );
    expect(claimed).toEqual({
      id: 'token-doc-1',
      userId: 'user-1',
      source: 'forgot-password',
      expiresAt: '2026-06-02T12:15:00.000Z',
      usedAt: now.toISOString(),
      createdAt: '2026-06-02T11:45:00.000Z',
    });
  });

  it('returns null when the token is already used or expired', async () => {
    mockFindOneAndUpdate.mockReturnValueOnce(leanResult(null));

    await expect(claimPasswordResetToken('used-token')).resolves.toBeNull();
  });
});

describe('findValidPasswordResetToken', () => {
  const now = new Date('2026-06-02T12:00:00.000Z');

  it('returns a record for an unused, unexpired token using a hashed lookup', async () => {
    const token = 'valid-reset-token';
    const tokenHash = hashPasswordResetToken(token);
    mockFindOne.mockReturnValueOnce(
      leanResult({
        _id: 'token-doc-2',
        tokenHash,
        userId: 'user-2',
        source: 'admin',
        expiresAt: new Date('2026-06-02T13:00:00.000Z'),
        createdAt: new Date('2026-06-02T11:00:00.000Z'),
        updatedAt: now,
      })
    );

    const record = await findValidPasswordResetToken(`  ${token}  `, now);

    expect(mockFindOne).toHaveBeenCalledWith({
      tokenHash,
      usedAt: { $exists: false },
      expiresAt: { $gt: now },
    });
    expect(record).toEqual({
      id: 'token-doc-2',
      userId: 'user-2',
      source: 'admin',
      expiresAt: '2026-06-02T13:00:00.000Z',
      createdAt: '2026-06-02T11:00:00.000Z',
    });
  });

  it('returns null when the token is expired', async () => {
    mockFindOne.mockReturnValueOnce(leanResult(null));

    await expect(findValidPasswordResetToken('expired-token', now)).resolves.toBeNull();

    expect(mockFindOne).toHaveBeenCalledWith({
      tokenHash: hashPasswordResetToken('expired-token'),
      usedAt: { $exists: false },
      expiresAt: { $gt: now },
    });
  });

  it('returns null when the token is already used', async () => {
    mockFindOne.mockReturnValueOnce(leanResult(null));

    await expect(findValidPasswordResetToken('used-token', now)).resolves.toBeNull();
  });

  it('returns null when no token matches the hash', async () => {
    mockFindOne.mockReturnValueOnce(leanResult(null));

    await expect(findValidPasswordResetToken('unknown-token', now)).resolves.toBeNull();

    expect(mockFindOne).toHaveBeenCalledWith({
      tokenHash: hashPasswordResetToken('unknown-token'),
      usedAt: { $exists: false },
      expiresAt: { $gt: now },
    });
  });
});

describe('completePasswordResetWithPasswordHash', () => {
  const now = new Date('2026-06-02T12:00:00.000Z');

  afterEach(() => {
    vi.useRealTimers();
  });

  it('updates the password before claiming the token and invalidating siblings', async () => {
    const tokenHash = hashPasswordResetToken('reset-token');
    mockFindOne.mockReturnValueOnce(leanResult(validTokenDoc('reset-token', now)));
    mockFindOneAndUpdate.mockReturnValueOnce(
      leanResult(validTokenDoc('reset-token', now, { usedAt: now }))
    );

    await expect(
      completePasswordResetWithPasswordHash('reset-token', 'new-hash', now, now)
    ).resolves.toBe(true);

    expect(mockUpdateUserPasswordHash).toHaveBeenCalledWith('user-1', 'new-hash');
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ tokenHash }),
      { $set: { usedAt: now } },
      { returnDocument: 'after' }
    );
    expect(mockUpdateMany).toHaveBeenCalledWith(
      { userId: 'user-1', usedAt: { $exists: false } },
      { $set: { usedAt: now } }
    );
  });

  it('returns false without updating the password when the token is not valid', async () => {
    mockFindOne.mockReturnValueOnce(leanResult(null));

    await expect(
      completePasswordResetWithPasswordHash('invalid-token', 'new-hash', now, now)
    ).resolves.toBe(false);

    expect(mockUpdateUserPasswordHash).not.toHaveBeenCalled();
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it('does not claim the token when the password update fails', async () => {
    mockFindOne.mockReturnValueOnce(leanResult(validTokenDoc('reset-token', now)));
    mockUpdateUserPasswordHash.mockRejectedValueOnce(
      Object.assign(new Error('User profile not found'), { code: 404 })
    );

    await expect(
      completePasswordResetWithPasswordHash('reset-token', 'new-hash', now, now)
    ).rejects.toMatchObject({ code: 404 });

    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it('returns false without invalidating siblings when the claim fails after the password update', async () => {
    mockFindOne.mockReturnValueOnce(leanResult(validTokenDoc('reset-token', now)));
    mockFindOneAndUpdate.mockReturnValueOnce(leanResult(null));

    await expect(
      completePasswordResetWithPasswordHash('reset-token', 'new-hash', now, now)
    ).resolves.toBe(false);

    expect(mockUpdateUserPasswordHash).toHaveBeenCalledWith('user-1', 'new-hash');
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it('uses a fresh timestamp for the claim expiry check while persisting the provided usedAt', async () => {
    const validateNow = new Date('2026-06-02T12:14:00.000Z');
    const usedAt = new Date('2026-06-02T12:00:00.000Z');
    const claimNow = new Date('2026-06-02T12:16:00.000Z');
    const tokenHash = hashPasswordResetToken('reset-token');

    vi.useFakeTimers({ now: validateNow });
    mockFindOne.mockReturnValueOnce(
      leanResult(
        validTokenDoc('reset-token', validateNow, {
          expiresAt: new Date('2026-06-02T12:15:00.000Z'),
        })
      )
    );
    mockUpdateUserPasswordHash.mockImplementation(async () => {
      vi.setSystemTime(claimNow);
    });
    mockFindOneAndUpdate.mockReturnValueOnce(leanResult(null));

    await expect(
      completePasswordResetWithPasswordHash('reset-token', 'new-hash', validateNow, usedAt)
    ).resolves.toBe(false);

    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      {
        tokenHash,
        usedAt: { $exists: false },
        expiresAt: { $gt: claimNow },
      },
      { $set: { usedAt } },
      { returnDocument: 'after' }
    );
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });
});

describe('countForgotPasswordResetTokensSince', () => {
  it('counts only self-service forgot-password tokens', async () => {
    const since = new Date('2026-06-02T11:45:00.000Z');
    mockCountDocuments.mockResolvedValueOnce(2);

    await expect(countForgotPasswordResetTokensSince('user-1', since)).resolves.toBe(2);

    expect(mockCountDocuments).toHaveBeenCalledWith({
      userId: 'user-1',
      source: 'forgot-password',
      createdAt: { $gte: since },
    });
  });
});
