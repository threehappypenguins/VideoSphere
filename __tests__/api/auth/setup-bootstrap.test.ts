import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockHasAnyUsers = vi.hoisted(() => vi.fn());
const mockEnsureSetupTokenForFirstRun = vi.hoisted(() => vi.fn());

vi.mock('@/lib/repositories/invites', () => ({
  hasAnyUsers: (...args: unknown[]) => mockHasAnyUsers(...args),
  ensureSetupTokenForFirstRun: (...args: unknown[]) => mockEnsureSetupTokenForFirstRun(...args),
}));

import { GET } from '@/app/api/auth/setup/bootstrap/route';

describe('GET /api/auth/setup/bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns setupRequired false when users already exist', async () => {
    mockHasAnyUsers.mockResolvedValueOnce(true);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ setupRequired: false });
    expect(mockEnsureSetupTokenForFirstRun).not.toHaveBeenCalled();
  });

  it('returns setupRequired true when a setup token is issued', async () => {
    mockHasAnyUsers.mockResolvedValueOnce(false);
    mockEnsureSetupTokenForFirstRun.mockResolvedValueOnce({
      token: 'setup-token-1',
      created: true,
    });

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ setupRequired: true, created: true });
  });

  it('returns setupRequired false when setup completes during bootstrap', async () => {
    mockHasAnyUsers.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mockEnsureSetupTokenForFirstRun.mockResolvedValueOnce(null);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ setupRequired: false });
    expect(mockHasAnyUsers).toHaveBeenCalledTimes(2);
  });

  it('returns 503 when setup token creation fails and no users exist', async () => {
    mockHasAnyUsers.mockResolvedValue(false);
    mockEnsureSetupTokenForFirstRun.mockResolvedValueOnce(null);

    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      setupRequired: true,
      message: 'Setup token could not be created.',
    });
    expect(mockHasAnyUsers).toHaveBeenCalledTimes(2);
  });
});
