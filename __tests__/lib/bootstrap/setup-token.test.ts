import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnsureSetupTokenForFirstRun = vi.hoisted(() => vi.fn());

vi.mock('@/lib/repositories/invites', () => ({
  ensureSetupTokenForFirstRun: (...args: unknown[]) => mockEnsureSetupTokenForFirstRun(...args),
}));

import { bootstrapFirstRunSetupToken } from '@/lib/bootstrap/setup-token';

describe('bootstrapFirstRunSetupToken', () => {
  const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    consoleInfoSpy.mockClear();
    consoleErrorSpy.mockClear();
  });

  it('retries bootstrap after a transient failure', async () => {
    mockEnsureSetupTokenForFirstRun
      .mockRejectedValueOnce(new Error('db unavailable'))
      .mockResolvedValueOnce({ token: 'setup-token-retry', created: true });

    await bootstrapFirstRunSetupToken();
    await bootstrapFirstRunSetupToken();

    expect(mockEnsureSetupTokenForFirstRun).toHaveBeenCalledTimes(2);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Setup] Failed to bootstrap first-run setup token',
      expect.any(Error)
    );
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      '[Setup] No users found. Complete first-run setup at: /setup?token=setup-token-retry'
    );
  });
});
