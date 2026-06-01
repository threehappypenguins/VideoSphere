import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockConnectToDatabase, mockCreate, mockFindOne, mockDeleteMany, mockUserCountDocuments } =
  vi.hoisted(() => ({
    mockConnectToDatabase: vi.fn(),
    mockCreate: vi.fn(),
    mockFindOne: vi.fn(),
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

  it('uses a fixed document id so concurrent creates collapse to one row', async () => {
    mockSetupFindOne(null);
    mockSetupFindOne({
      _id: 'setup',
      token: 'winner-setup-token',
      purpose: 'setup',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const duplicateKeyError = Object.assign(new Error('duplicate key'), { code: 11000 });
    mockCreate.mockRejectedValueOnce(duplicateKeyError);

    const result = await ensureSetupTokenForFirstRun();

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: 'setup',
        purpose: 'setup',
        token: expect.any(String),
      })
    );
    expect(result).toEqual({ token: 'winner-setup-token', created: false });
  });

  it('returns null once users already exist', async () => {
    mockUserCountDocuments.mockResolvedValueOnce(1);

    const result = await ensureSetupTokenForFirstRun();

    expect(result).toBeNull();
    expect(mockFindOne).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
