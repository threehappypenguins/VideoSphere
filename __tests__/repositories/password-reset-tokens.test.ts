import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPasswordResetToken } from '@/lib/auth/password-reset-token-hash';

const { mockConnectToDatabase, mockFindOne, mockFindOneAndUpdate, mockCountDocuments } = vi.hoisted(
  () => ({
    mockConnectToDatabase: vi.fn(),
    mockFindOne: vi.fn(),
    mockFindOneAndUpdate: vi.fn(),
    mockCountDocuments: vi.fn(),
  })
);

vi.mock('@/lib/mongodb', () => ({
  connectToDatabase: (...args: unknown[]) => mockConnectToDatabase(...args),
}));

vi.mock('@/lib/models/PasswordResetToken', () => ({
  PasswordResetTokenModel: {
    findOne: (...args: unknown[]) => mockFindOne(...args),
    findOneAndUpdate: (...args: unknown[]) => mockFindOneAndUpdate(...args),
    countDocuments: (...args: unknown[]) => mockCountDocuments(...args),
  },
}));

import {
  claimPasswordResetToken,
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
});

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
