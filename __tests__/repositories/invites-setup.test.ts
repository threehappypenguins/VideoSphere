import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockConnectToDatabase,
  mockCreate,
  mockFindOne,
  mockFindOneAndUpdate,
  mockDeleteMany,
  mockUserProfileExists,
} = vi.hoisted(() => ({
  mockConnectToDatabase: vi.fn(),
  mockCreate: vi.fn(),
  mockFindOne: vi.fn(),
  mockFindOneAndUpdate: vi.fn(),
  mockDeleteMany: vi.fn(),
  mockUserProfileExists: vi.fn(),
}));

vi.mock('@/lib/mongodb', () => ({
  connectToDatabase: (...args: unknown[]) => mockConnectToDatabase(...args),
}));

vi.mock('@/lib/models/InviteToken', () => ({
  InviteTokenModel: {
    create: (...args: unknown[]) => mockCreate(...args),
    findOne: (...args: unknown[]) => mockFindOne(...args),
    findOneAndUpdate: (...args: unknown[]) => mockFindOneAndUpdate(...args),
    deleteMany: (...args: unknown[]) => mockDeleteMany(...args),
  },
}));

vi.mock('@/lib/models/UserProfile', () => ({
  UserProfileModel: {
    exists: (...args: unknown[]) => mockUserProfileExists(...args),
  },
}));

import { ensureSetupTokenForFirstRun } from '@/lib/repositories/invites';

const now = new Date('2026-03-15T12:00:00.000Z');

function mockSetupFindOne(value: unknown) {
  mockFindOne.mockReturnValueOnce({
    lean: vi.fn().mockResolvedValue(value),
  });
}

function mockSetupFindOneAndUpdate(value: unknown) {
  mockFindOneAndUpdate.mockReturnValueOnce({
    lean: vi.fn().mockResolvedValue(value),
  });
}

function mockSetupFindOneAndUpdateFromSetToken() {
  mockFindOneAndUpdate.mockImplementationOnce(() => ({
    lean: vi.fn().mockImplementation(async () => {
      const update = mockFindOneAndUpdate.mock.calls.at(-1)?.[1] as {
        $set?: { token: string };
      };
      const token = update.$set?.token ?? 'unknown-token';
      return {
        _id: 'setup',
        token,
        purpose: 'setup',
        createdAt: now,
      };
    }),
  }));
}

function mockSetupFindOneAndUpdateFromInsertToken() {
  mockFindOneAndUpdate.mockImplementationOnce(() => ({
    lean: vi.fn().mockImplementation(async () => {
      const update = mockFindOneAndUpdate.mock.calls.at(-1)?.[1] as {
        $setOnInsert?: { token: string };
      };
      const token = update.$setOnInsert?.token ?? 'unknown-token';
      return {
        _id: 'setup',
        token,
        purpose: 'setup',
        createdAt: now,
      };
    }),
  }));
}

describe('ensureSetupTokenForFirstRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    mockConnectToDatabase.mockResolvedValue(undefined);
    mockUserProfileExists.mockResolvedValue(null);
    mockDeleteMany.mockResolvedValue({ deletedCount: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns an existing active setup token without creating a new row', async () => {
    mockSetupFindOne({
      _id: 'setup',
      token: 'existing-setup-token',
      purpose: 'setup',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const result = await ensureSetupTokenForFirstRun();

    expect(result).toEqual({ token: 'existing-setup-token', created: false });
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockDeleteMany).toHaveBeenCalledWith({
      purpose: 'setup',
      _id: { $ne: 'setup' },
    });
  });

  it('reissues only stale setup tokens via a conditional update', async () => {
    mockSetupFindOne({
      _id: 'setup',
      token: 'stale-setup-token',
      purpose: 'setup',
      usedAt: new Date('2026-01-02T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    mockSetupFindOneAndUpdateFromSetToken();

    const result = await ensureSetupTokenForFirstRun();
    const reissuedToken = (mockFindOneAndUpdate.mock.calls[0]?.[1] as { $set?: { token: string } })
      .$set?.token;

    expect(mockFindOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: 'setup',
        purpose: 'setup',
        $or: [{ usedAt: { $exists: true } }, { expiresAt: { $lte: now } }],
      },
      expect.objectContaining({
        $set: expect.objectContaining({ purpose: 'setup', token: expect.any(String) }),
        $unset: { usedAt: 1, usedBy: 1, expiresAt: 1, createdBy: 1, grantedRole: 1 },
      }),
      { returnDocument: 'after' }
    );
    expect(result).toEqual({ token: reissuedToken, created: true });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('upserts only when no active setup token exists', async () => {
    mockSetupFindOne(null);
    mockSetupFindOneAndUpdate(null);
    mockSetupFindOneAndUpdateFromInsertToken();

    const result = await ensureSetupTokenForFirstRun();
    const insertedToken = (
      mockFindOneAndUpdate.mock.calls[1]?.[1] as { $setOnInsert?: { token: string } }
    ).$setOnInsert?.token;

    expect(mockFindOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(mockFindOneAndUpdate).toHaveBeenNthCalledWith(
      2,
      {
        _id: 'setup',
        purpose: 'setup',
        usedAt: { $exists: false },
        $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }],
      },
      {
        $setOnInsert: {
          token: expect.any(String),
          purpose: 'setup',
          createdAt: now,
        },
      },
      { upsert: true, returnDocument: 'after' }
    );
    expect(result).toEqual({ token: insertedToken, created: true });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns the active token without reissuing when upsert races with another instance', async () => {
    mockSetupFindOne(null);
    mockSetupFindOneAndUpdate(null);
    mockFindOneAndUpdate.mockImplementationOnce(() => ({
      lean: vi.fn().mockResolvedValue({
        _id: 'setup',
        token: 'winner-setup-token',
        purpose: 'setup',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    }));

    const result = await ensureSetupTokenForFirstRun();

    expect(result).toEqual({ token: 'winner-setup-token', created: false });
  });

  it('falls back to the current active token when conditional updates do not apply', async () => {
    mockSetupFindOne(null);
    mockSetupFindOneAndUpdate(null);
    mockSetupFindOneAndUpdate(null);
    mockSetupFindOne({
      _id: 'setup',
      token: 'concurrent-active-token',
      purpose: 'setup',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const result = await ensureSetupTokenForFirstRun();

    expect(result).toEqual({ token: 'concurrent-active-token', created: false });
  });

  it('returns null once users already exist', async () => {
    mockUserProfileExists.mockResolvedValueOnce({ _id: 'user-1' });

    const result = await ensureSetupTokenForFirstRun();

    expect(result).toBeNull();
    expect(mockFindOne).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
