import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockConnectToDatabase, mockFind, mockDeleteMany } = vi.hoisted(() => ({
  mockConnectToDatabase: vi.fn(),
  mockFind: vi.fn(),
  mockDeleteMany: vi.fn(),
}));

vi.mock('@/lib/mongodb', () => ({
  connectToDatabase: (...args: unknown[]) => mockConnectToDatabase(...args),
}));

vi.mock('@/lib/models/InviteToken', () => ({
  InviteTokenModel: {
    find: (...args: unknown[]) => mockFind(...args),
    deleteMany: (...args: unknown[]) => mockDeleteMany(...args),
  },
}));

import { listInviteTokens } from '@/lib/repositories/invites';

function mockFindChain(value: unknown[]) {
  mockFind.mockReturnValueOnce({
    sort: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue(value),
  });
}

describe('listInviteTokens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-15T12:00:00.000Z'));
    mockConnectToDatabase.mockResolvedValue(undefined);
    mockDeleteMany.mockResolvedValue({ deletedCount: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('prunes and excludes expired invite tokens from admin listings', async () => {
    mockFindChain([]);

    await listInviteTokens({ includeSetup: false });

    expect(mockDeleteMany).toHaveBeenCalledWith({
      purpose: 'invite',
      expiresAt: { $lte: new Date('2026-03-15T12:00:00.000Z') },
    });
    expect(mockFind).toHaveBeenCalledWith({
      purpose: 'invite',
      usedAt: { $exists: false },
      $or: [
        { expiresAt: { $exists: false } },
        { expiresAt: { $gt: new Date('2026-03-15T12:00:00.000Z') } },
      ],
    });
  });

  it('does not prune invite tokens when setup tokens are included', async () => {
    mockFindChain([]);

    await listInviteTokens({ includeSetup: true });

    expect(mockDeleteMany).not.toHaveBeenCalled();
    expect(mockFind).toHaveBeenCalledWith({
      usedAt: { $exists: false },
    });
  });
});
