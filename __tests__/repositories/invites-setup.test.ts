import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockConnectToDatabase,
  mockCreate,
  mockFindOne,
  mockFindOneAndUpdate,
  mockDeleteMany,
  mockUserCountDocuments,
} = vi.hoisted(() => ({
  mockConnectToDatabase: vi.fn(),
  mockCreate: vi.fn(),
  mockFindOne: vi.fn(),
  mockFindOneAndUpdate: vi.fn(),
  mockDeleteMany: vi.fn(),
  mockUserCountDocuments: vi.fn(),
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
    db: {
      collection: () => ({
        countDocuments: (...args: unknown[]) => mockUserCountDocuments(...args),
      }),
    },
  },
}));

import { ensureSetupTokenForFirstRun } from '@/lib/repositories/invites';

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

describe('ensureSetupTokenForFirstRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnectToDatabase.mockResolvedValue(undefined);
    mockUserCountDocuments.mockResolvedValue(0);
    mockDeleteMany.mockResolvedValue({ deletedCount: 0 });
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
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockDeleteMany).toHaveBeenCalledWith({
      purpose: 'setup',
      _id: { $ne: 'setup' },
    });
  });

  it('reissues a consumed setup token when no users exist yet', async () => {
    mockSetupFindOne({
      _id: 'setup',
      token: 'stale-setup-token',
      purpose: 'setup',
      usedAt: new Date('2026-01-02T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    mockSetupFindOneAndUpdate({
      _id: 'setup',
      token: 'fresh-setup-token',
      purpose: 'setup',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
    });

    const result = await ensureSetupTokenForFirstRun();

    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'setup' },
      expect.objectContaining({
        $set: expect.objectContaining({ purpose: 'setup', token: expect.any(String) }),
        $unset: { usedAt: 1, usedBy: 1, expiresAt: 1 },
      }),
      { upsert: true, returnDocument: 'after' }
    );
    expect(result).toEqual({ token: 'fresh-setup-token', created: false });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('creates the singleton setup row when none exists', async () => {
    mockSetupFindOne(null);
    mockSetupFindOneAndUpdate({
      _id: 'setup',
      token: 'new-setup-token',
      purpose: 'setup',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
    });

    const result = await ensureSetupTokenForFirstRun();

    expect(result).toEqual({ token: 'new-setup-token', created: true });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('uses a fixed document id so concurrent upserts collapse to one row', async () => {
    mockSetupFindOne(null);
    mockSetupFindOneAndUpdate({
      _id: 'setup',
      token: 'winner-setup-token',
      purpose: 'setup',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const result = await ensureSetupTokenForFirstRun();

    expect(mockFindOneAndUpdate).toHaveBeenCalledWith({ _id: 'setup' }, expect.any(Object), {
      upsert: true,
      returnDocument: 'after',
    });
    expect(result).toEqual({ token: 'winner-setup-token', created: true });
  });

  it('returns null once users already exist', async () => {
    mockUserCountDocuments.mockResolvedValueOnce(1);

    const result = await ensureSetupTokenForFirstRun();

    expect(result).toBeNull();
    expect(mockFindOne).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
