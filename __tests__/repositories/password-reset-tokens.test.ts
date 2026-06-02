import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockConnectToDatabase, mockFindOneAndUpdate, mockCountDocuments } = vi.hoisted(() => ({
  mockConnectToDatabase: vi.fn(),
  mockFindOneAndUpdate: vi.fn(),
  mockCountDocuments: vi.fn(),
}));

vi.mock('@/lib/mongodb', () => ({
  connectToDatabase: (...args: unknown[]) => mockConnectToDatabase(...args),
}));

vi.mock('@/lib/models/PasswordResetToken', () => ({
  PasswordResetTokenModel: {
    findOneAndUpdate: (...args: unknown[]) => mockFindOneAndUpdate(...args),
    countDocuments: (...args: unknown[]) => mockCountDocuments(...args),
  },
}));

import {
  claimPasswordResetToken,
  countForgotPasswordResetTokensSince,
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
  it('atomically claims an unused, unexpired token', async () => {
    const now = new Date('2026-06-02T12:00:00.000Z');
    mockFindOneAndUpdate.mockReturnValueOnce(
      leanResult({
        _id: 'token-doc-1',
        token: 'valid-token',
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
        token: 'valid-token',
        usedAt: { $exists: false },
        expiresAt: { $gt: now },
      },
      { $set: { usedAt: now } },
      { returnDocument: 'after' }
    );
    expect(claimed).toEqual({
      id: 'token-doc-1',
      token: 'valid-token',
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
