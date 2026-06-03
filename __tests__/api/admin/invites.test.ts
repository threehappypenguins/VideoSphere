/**
 * Tests for GET/POST /api/admin/invites and DELETE /api/admin/invites/[token]
 *
 * Covers RBAC, invite creation payload validation, list behavior, and revoke flow.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: vi.fn(),
}));

vi.mock('@/lib/repositories/users', () => ({
  getUserById: vi.fn(),
}));

vi.mock('@/lib/repositories/invites', () => ({
  listInviteTokens: vi.fn(),
  createInviteToken: vi.fn(),
  revokeInviteToken: vi.fn(),
}));

import { GET, POST } from '@/app/api/admin/invites/route';
import { DELETE } from '@/app/api/admin/invites/[token]/route';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getUserById } from '@/lib/repositories/users';
import { createInviteToken, listInviteTokens, revokeInviteToken } from '@/lib/repositories/invites';
import type { InviteTokenRecord } from '@/lib/repositories/invites';
import type { User } from '@/types';

const adminProfile: User = {
  userId: 'admin-auth-id',
  email: 'admin@example.com',
  role: 'admin',
  authProvider: 'password',
  hasCompletedOnboarding: false,
  $createdAt: '2026-01-01T00:00:00.000Z',
  $updatedAt: '2026-01-02T00:00:00.000Z',
};

const pendingInvite: InviteTokenRecord = {
  token: 'invite-token-1',
  purpose: 'invite',
  grantedRole: 'user',
  createdBy: adminProfile.userId,
  createdAt: '2026-03-01T12:00:00.000Z',
  expiresAt: '2026-04-01T12:00:00.000Z',
};

function makeGetRequest(): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/admin/invites'), { method: 'GET' });
}

function makePostRequest(body: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/admin/invites'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeDeleteRequest(token: string): NextRequest {
  return new NextRequest(new URL(`http://localhost:3000/api/admin/invites/${token}`), {
    method: 'DELETE',
  });
}

describe('GET /api/admin/invites', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('RBAC', () => {
    it('returns 401 ApiError when not authenticated', async () => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(null);

      const res = await GET(makeGetRequest());
      expect(res.status).toBe(401);

      const body = await res.json();
      expect(body).toEqual({
        error: 'Unauthorized',
        message: 'Not authenticated',
        statusCode: 401,
      });
      expect(listInviteTokens).not.toHaveBeenCalled();
    });

    it('returns 403 ApiError when authenticated but role is user', async () => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce('user-1');
      vi.mocked(getUserById).mockResolvedValueOnce({
        ...adminProfile,
        userId: 'user-1',
        role: 'user',
      });

      const res = await GET(makeGetRequest());
      expect(res.status).toBe(403);
      expect(listInviteTokens).not.toHaveBeenCalled();
    });
  });

  describe('success response shape', () => {
    beforeEach(() => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValue(adminProfile.userId);
      vi.mocked(getUserById).mockResolvedValue(adminProfile);
    });

    it('lists valid pending invite tokens only (exclude setup and expired tokens)', async () => {
      vi.mocked(listInviteTokens).mockResolvedValueOnce([pendingInvite]);

      const res = await GET(makeGetRequest());
      expect(res.status).toBe(200);
      expect(listInviteTokens).toHaveBeenCalledWith({ includeSetup: false });

      const body = await res.json();
      expect(body.data.invites).toEqual([
        {
          token: pendingInvite.token,
          grantedRole: 'user',
          createdBy: pendingInvite.createdBy,
          createdAt: pendingInvite.createdAt,
          expiresAt: pendingInvite.expiresAt,
        },
      ]);
    });

    it('maps admin grantedRole in the response', async () => {
      vi.mocked(listInviteTokens).mockResolvedValueOnce([
        { ...pendingInvite, grantedRole: 'admin' },
      ]);

      const res = await GET(makeGetRequest());
      const body = await res.json();
      expect(body.data.invites[0].grantedRole).toBe('admin');
    });

    it('returns 500 ApiError when listInviteTokens throws', async () => {
      vi.mocked(listInviteTokens).mockRejectedValueOnce(new Error('database error'));

      const res = await GET(makeGetRequest());
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toEqual({
        error: 'Internal Server Error',
        message: 'Failed to load invites',
        statusCode: 500,
      });
    });
  });
});

describe('POST /api/admin/invites', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getAuthenticatedUserId).mockResolvedValue(adminProfile.userId);
    vi.mocked(getUserById).mockResolvedValue(adminProfile);
    vi.mocked(createInviteToken).mockResolvedValue(pendingInvite);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('returns 401 ApiError when not authenticated', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(null);

    const res = await POST(makePostRequest({}));
    expect(res.status).toBe(401);
    expect(createInviteToken).not.toHaveBeenCalled();
  });

  it('creates a user-role invite by default', async () => {
    const res = await POST(makePostRequest({}));
    expect(res.status).toBe(201);
    expect(createInviteToken).toHaveBeenCalledWith({
      createdBy: adminProfile.userId,
      expiresAt: undefined,
      grantedRole: 'user',
    });

    const body = await res.json();
    expect(body.data.token).toBe(pendingInvite.token);
    expect(body.data.inviteUrl).toBe('http://localhost:3000/invite/invite-token-1');
  });

  it('creates an admin-role invite when requested', async () => {
    const res = await POST(makePostRequest({ role: 'admin' }));
    expect(res.status).toBe(201);
    expect(createInviteToken).toHaveBeenCalledWith({
      createdBy: adminProfile.userId,
      expiresAt: undefined,
      grantedRole: 'admin',
    });
    expect(await res.json()).toBeDefined();
  });

  it('creates a user-role invite when role is explicitly user', async () => {
    const res = await POST(makePostRequest({ role: 'user' }));
    expect(res.status).toBe(201);
    expect(createInviteToken).toHaveBeenCalledWith({
      createdBy: adminProfile.userId,
      expiresAt: undefined,
      grantedRole: 'user',
    });
  });

  it('rejects invalid role values', async () => {
    const res = await POST(makePostRequest({ role: 'superadmin' }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "role must be 'user' or 'admin'." });
    expect(createInviteToken).not.toHaveBeenCalled();
  });

  it('forwards expiresInDays as expiresAt', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T12:00:00.000Z'));

    const res = await POST(makePostRequest({ expiresInDays: 7 }));
    expect(res.status).toBe(201);
    expect(createInviteToken).toHaveBeenCalledWith({
      createdBy: adminProfile.userId,
      expiresAt: new Date('2026-03-08T12:00:00.000Z'),
      grantedRole: 'user',
    });

    vi.useRealTimers();
  });

  it('rejects invalid JSON bodies', async () => {
    const res = await POST(
      new NextRequest(new URL('http://localhost:3000/api/admin/invites'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not-json',
      })
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid JSON body.' });
    expect(createInviteToken).not.toHaveBeenCalled();
  });

  it('rejects JSON null bodies', async () => {
    const res = await POST(makePostRequest(null));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Body must be a JSON object.' });
    expect(createInviteToken).not.toHaveBeenCalled();
  });

  it('rejects non-finite expiresInDays', async () => {
    const res = await POST(makePostRequest({ expiresInDays: '7' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'expiresInDays must be a finite number.' });
    expect(createInviteToken).not.toHaveBeenCalled();
  });

  it('rejects expiresInDays outside 1..365', async () => {
    const res = await POST(makePostRequest({ expiresInDays: 400 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'expiresInDays must be between 1 and 365.',
    });
    expect(createInviteToken).not.toHaveBeenCalled();
  });

  it('returns 500 ApiError when createInviteToken throws', async () => {
    vi.mocked(createInviteToken).mockRejectedValueOnce(new Error('database error'));

    const res = await POST(makePostRequest({}));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({
      error: 'Internal Server Error',
      message: 'Failed to create invite',
      statusCode: 500,
    });
  });
});

describe('DELETE /api/admin/invites/[token]', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getAuthenticatedUserId).mockResolvedValue(adminProfile.userId);
    vi.mocked(getUserById).mockResolvedValue(adminProfile);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('returns 401 ApiError when not authenticated', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(null);

    const res = await DELETE(makeDeleteRequest('invite-token-1'), {
      params: Promise.resolve({ token: 'invite-token-1' }),
    });

    expect(res.status).toBe(401);
    expect(revokeInviteToken).not.toHaveBeenCalled();
  });

  it('revokes a pending invite', async () => {
    vi.mocked(revokeInviteToken).mockResolvedValueOnce(true);

    const res = await DELETE(makeDeleteRequest('invite-token-1'), {
      params: Promise.resolve({ token: 'invite-token-1' }),
    });

    expect(res.status).toBe(204);
    expect(revokeInviteToken).toHaveBeenCalledWith('invite-token-1');
  });

  it('returns 404 when invite is not found', async () => {
    vi.mocked(revokeInviteToken).mockResolvedValueOnce(false);

    const res = await DELETE(makeDeleteRequest('missing-token'), {
      params: Promise.resolve({ token: 'missing-token' }),
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Invite not found.' });
  });

  it('returns 400 when token is blank', async () => {
    const res = await DELETE(makeDeleteRequest('   '), {
      params: Promise.resolve({ token: '   ' }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Token is required.' });
    expect(revokeInviteToken).not.toHaveBeenCalled();
  });
});
