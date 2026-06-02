import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockConnectToDatabase, mockFindOneAndDelete, mockCreate } = vi.hoisted(() => ({
  mockConnectToDatabase: vi.fn(),
  mockFindOneAndDelete: vi.fn(),
  mockCreate: vi.fn(),
}));

vi.mock('@/lib/mongodb', () => ({
  connectToDatabase: (...args: unknown[]) => mockConnectToDatabase(...args),
}));

vi.mock('@/lib/models/InviteToken', () => ({
  InviteTokenModel: {
    findOneAndDelete: (...args: unknown[]) => mockFindOneAndDelete(...args),
    create: (...args: unknown[]) => mockCreate(...args),
  },
}));

import {
  consumeInviteToken,
  releaseInviteToken,
  type InviteTokenReleaseSnapshot,
} from '@/lib/repositories/invites';

function mockConsumeDelete(value: unknown) {
  mockFindOneAndDelete.mockReturnValueOnce({
    lean: vi.fn().mockResolvedValue(value),
  });
}

const activeInviteDoc = {
  _id: 'invite-token-1',
  token: 'invite-token-1',
  purpose: 'invite' as const,
  grantedRole: 'admin' as const,
  createdBy: 'admin-user-1',
  createdAt: new Date('2026-03-01T10:00:00.000Z'),
  expiresAt: new Date('2026-04-01T10:00:00.000Z'),
};

const releaseSnapshot: InviteTokenReleaseSnapshot = {
  token: 'invite-token-1',
  grantedRole: 'admin',
  createdBy: 'admin-user-1',
  createdAt: activeInviteDoc.createdAt,
  expiresAt: activeInviteDoc.expiresAt,
};

describe('consumeInviteToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-15T12:00:00.000Z'));
    mockConnectToDatabase.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns granted role and release snapshot when consume succeeds', async () => {
    mockConsumeDelete(activeInviteDoc);

    const result = await consumeInviteToken('invite-token-1', 'new-user-id');

    expect(result).toEqual({
      grantedRole: 'admin',
      releaseSnapshot: {
        token: 'invite-token-1',
        grantedRole: 'admin',
        createdBy: 'admin-user-1',
        createdAt: activeInviteDoc.createdAt,
        expiresAt: activeInviteDoc.expiresAt,
      },
    });
    expect(mockFindOneAndDelete).toHaveBeenCalledWith({
      token: 'invite-token-1',
      purpose: 'invite',
      usedAt: { $exists: false },
      $or: [
        { expiresAt: { $exists: false } },
        { expiresAt: { $gt: new Date('2026-03-15T12:00:00.000Z') } },
      ],
    });
  });

  it('returns null when the invite token is missing', async () => {
    mockConsumeDelete(null);

    await expect(consumeInviteToken('missing-token', 'new-user-id')).resolves.toBeNull();
  });

  it('returns null when the invite token is already used or expired', async () => {
    mockConsumeDelete(null);

    await expect(consumeInviteToken('used-or-expired-token', 'new-user-id')).resolves.toBeNull();
    expect(mockFindOneAndDelete).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'used-or-expired-token' })
    );
  });
});

describe('releaseInviteToken', () => {
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    mockConnectToDatabase.mockResolvedValue(undefined);
    consoleErrorSpy.mockClear();
  });

  it('returns true when the invite token is recreated successfully', async () => {
    mockCreate.mockResolvedValueOnce({});

    await expect(releaseInviteToken(releaseSnapshot)).resolves.toBe(true);
    expect(mockCreate).toHaveBeenCalledWith({
      _id: releaseSnapshot.token,
      token: releaseSnapshot.token,
      purpose: 'invite',
      grantedRole: releaseSnapshot.grantedRole,
      createdBy: releaseSnapshot.createdBy,
      createdAt: releaseSnapshot.createdAt,
      expiresAt: releaseSnapshot.expiresAt,
    });
  });

  it('returns true on duplicate-key when the token was already restored', async () => {
    mockCreate.mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: 11000 }));

    await expect(releaseInviteToken(releaseSnapshot)).resolves.toBe(true);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('returns false and logs on non-duplicate restore failures', async () => {
    const dbError = new Error('connection reset');
    mockCreate.mockRejectedValueOnce(dbError);

    await expect(releaseInviteToken(releaseSnapshot)).resolves.toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      `[releaseInviteToken] Failed to restore invite token "${releaseSnapshot.token}"`,
      dbError
    );
  });
});
