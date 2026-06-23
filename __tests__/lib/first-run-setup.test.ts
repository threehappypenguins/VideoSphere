import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockHasAnyUsers = vi.hoisted(() => vi.fn());
const mockEnsureSetupTokenForFirstRun = vi.hoisted(() => vi.fn());

vi.mock('@/lib/repositories/invites', () => ({
  hasAnyUsers: (...args: unknown[]) => mockHasAnyUsers(...args),
  ensureSetupTokenForFirstRun: (...args: unknown[]) => mockEnsureSetupTokenForFirstRun(...args),
}));

import { getFirstRunSetupToken, isFirstRunSetupPending } from '@/lib/auth/first-run-setup';

describe('first-run-setup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when no users exist', async () => {
    mockHasAnyUsers.mockResolvedValueOnce(false);

    await expect(isFirstRunSetupPending()).resolves.toBe(true);
    expect(mockHasAnyUsers).toHaveBeenCalledTimes(1);
  });

  it('returns false when the user count cannot be read', async () => {
    mockHasAnyUsers.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    await expect(isFirstRunSetupPending()).resolves.toBe(false);
  });

  it('returns null setup token when setup is already complete', async () => {
    mockHasAnyUsers.mockResolvedValueOnce(true);

    await expect(getFirstRunSetupToken()).resolves.toBeNull();
    expect(mockEnsureSetupTokenForFirstRun).not.toHaveBeenCalled();
  });

  it('returns setup token when first-run is pending', async () => {
    mockHasAnyUsers.mockResolvedValueOnce(false);
    mockEnsureSetupTokenForFirstRun.mockResolvedValueOnce({ token: 'setup-token', created: true });

    await expect(getFirstRunSetupToken()).resolves.toBe('setup-token');
  });
});
