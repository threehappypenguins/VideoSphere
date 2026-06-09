/**
 * Tests for GET /api/auth/profile route.
 *
 * Verifies authentication gating and correct profile response.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const getAuthenticatedSessionUserIdMock = vi.hoisted(() => vi.fn());
const getUserByIdMock = vi.hoisted(() => vi.fn());
const getUserByEmailMock = vi.hoisted(() => vi.fn());
const updateUserMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedSessionUserId: (...args: unknown[]) => getAuthenticatedSessionUserIdMock(...args),
}));

vi.mock('@/lib/repositories/users', () => ({
  getUserById: getUserByIdMock,
  getUserByEmail: getUserByEmailMock,
  updateUser: updateUserMock,
}));

import { GET, PATCH } from '@/app/api/auth/profile/route';

function createRequest(cookies?: Record<string, string>): NextRequest {
  const cookieHeader = cookies
    ? Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ')
    : '';

  return new NextRequest(new URL('http://localhost:3000/api/auth/profile'), {
    method: 'GET',
    headers: cookieHeader ? { Cookie: cookieHeader } : {},
  });
}

function makePatchRequest(body: unknown, cookies?: Record<string, string>): NextRequest {
  const cookieHeader = cookies
    ? Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ')
    : '';

  return new NextRequest(new URL('http://localhost:3000/api/auth/profile'), {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    body: JSON.stringify(body),
  });
}

const BASE_USER = {
  userId: 'user_123',
  email: 'test@example.com',
  name: 'Test User',
  role: 'user' as const,
  authProvider: 'password' as const,
  hasCompletedOnboarding: true,
  $createdAt: '2026-01-01T00:00:00.000Z',
  $updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('GET /api/auth/profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedSessionUserIdMock.mockResolvedValue('user_123');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 401 when session cookie is missing', async () => {
    getAuthenticatedSessionUserIdMock.mockResolvedValueOnce(null);
    const res = await GET(createRequest());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Not authenticated' });
    expect(getUserByIdMock).not.toHaveBeenCalled();
  });

  it('returns 404 when user profile is not found', async () => {
    getAuthenticatedSessionUserIdMock.mockResolvedValueOnce('user_123');
    getUserByIdMock.mockResolvedValueOnce(null);

    const res = await GET(createRequest({ videosphere_session: 'session-secret' }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Profile not found' });
  });

  it('returns user profile payload', async () => {
    getAuthenticatedSessionUserIdMock.mockResolvedValueOnce('user_123');
    getUserByIdMock.mockResolvedValueOnce({
      userId: 'user_123',
      email: 'test@example.com',
      role: 'user',
      $createdAt: '2026-01-01T00:00:00.000Z',
      $updatedAt: '2026-03-25T00:00:00.000Z',
    });

    const res = await GET(createRequest({ videosphere_session: 'session-secret' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe('user_123');
    expect(body.email).toBe('test@example.com');
    expect(body.role).toBe('user');
  });

  it('returns platformDefaults including youtube sub-object when set', async () => {
    getAuthenticatedSessionUserIdMock.mockResolvedValueOnce('user_123');
    getUserByIdMock.mockResolvedValueOnce({
      ...BASE_USER,
      platformDefaults: {
        youtube: {
          categoryId: '22',
          madeForKids: false,
        },
      },
    });

    const res = await GET(createRequest({ videosphere_session: 'session-secret' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.platformDefaults).toEqual({
      youtube: {
        categoryId: '22',
        madeForKids: false,
      },
    });
  });

  it('returns second user profile payload correctly', async () => {
    getAuthenticatedSessionUserIdMock.mockResolvedValueOnce('user_456');
    getUserByIdMock.mockResolvedValueOnce({
      userId: 'user_456',
      email: 'free@example.com',
      role: 'user',
      $createdAt: '2026-02-01T00:00:00.000Z',
      $updatedAt: '2026-03-01T00:00:00.000Z',
    });

    const res = await GET(createRequest({ videosphere_session: 'session-secret' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe('user_456');
    expect(body.email).toBe('free@example.com');
    expect(body.role).toBe('user');
  });
});

describe('PATCH /api/auth/profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedSessionUserIdMock.mockResolvedValue('user_123');
    getUserByIdMock.mockResolvedValue(BASE_USER);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 401 when not authenticated', async () => {
    getAuthenticatedSessionUserIdMock.mockResolvedValueOnce(null);

    const res = await PATCH(makePatchRequest({ name: 'New Name' }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Not authenticated' });
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it('returns 404 when user profile is not found during email update', async () => {
    getUserByIdMock.mockResolvedValueOnce(null);

    const res = await PATCH(makePatchRequest({ email: 'new@example.com' }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Profile not found' });
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it('returns 400 when body is invalid JSON', async () => {
    const req = new NextRequest(new URL('http://localhost:3000/api/auth/profile'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{not-json',
    });

    const res = await PATCH(req);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid JSON body.' });
    expect(getUserByIdMock).not.toHaveBeenCalled();
  });

  it('returns 400 when neither name, email, nor platformDefaults is provided', async () => {
    const res = await PATCH(makePatchRequest({}));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'At least one of name, email, or platformDefaults must be provided.',
    });
    expect(getUserByIdMock).not.toHaveBeenCalled();
  });

  it('returns 400 when name is empty after trim', async () => {
    const res = await PATCH(makePatchRequest({ name: '   ' }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Name cannot be empty.' });
    expect(getUserByIdMock).not.toHaveBeenCalled();
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it('updates name successfully without loading profile first', async () => {
    const updatedUser = { ...BASE_USER, name: 'Updated Name' };
    updateUserMock.mockResolvedValueOnce(updatedUser);

    const res = await PATCH(makePatchRequest({ name: '  Updated Name  ' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(updatedUser);
    expect(getUserByIdMock).not.toHaveBeenCalled();
    expect(updateUserMock).toHaveBeenCalledWith('user_123', { name: 'Updated Name' });
  });

  it('updates email successfully for password accounts', async () => {
    getUserByEmailMock.mockResolvedValueOnce(null);
    const updatedUser = { ...BASE_USER, email: 'new@example.com' };
    updateUserMock.mockResolvedValueOnce(updatedUser);

    const res = await PATCH(makePatchRequest({ email: 'New@Example.com' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(updatedUser);
    expect(getUserByEmailMock).toHaveBeenCalledWith('new@example.com');
    expect(updateUserMock).toHaveBeenCalledWith('user_123', { email: 'new@example.com' });
  });

  it('returns 409 when email is already in use', async () => {
    getUserByEmailMock.mockResolvedValueOnce({
      ...BASE_USER,
      userId: 'other_user',
      email: 'taken@example.com',
    });

    const res = await PATCH(makePatchRequest({ email: 'taken@example.com' }));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'That email address is already in use by another account.',
    });
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it('returns 403 when Google account attempts email change', async () => {
    getUserByIdMock.mockResolvedValueOnce({
      ...BASE_USER,
      authProvider: 'google',
    });

    const res = await PATCH(makePatchRequest({ email: 'new@example.com' }));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'Email change is not available for Google sign-in accounts.',
    });
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid email format', async () => {
    const res = await PATCH(makePatchRequest({ email: 'not-an-email' }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Email must be a valid email address.' });
    expect(getUserByIdMock).not.toHaveBeenCalled();
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it('returns 404 when updateUser throws not found', async () => {
    updateUserMock.mockRejectedValueOnce(
      Object.assign(new Error('User profile not found'), { code: 404 })
    );

    const res = await PATCH(makePatchRequest({ name: 'New Name' }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Profile not found' });
  });

  it('returns 500 on unexpected repository error', async () => {
    updateUserMock.mockRejectedValueOnce(new Error('DB failure'));

    const res = await PATCH(makePatchRequest({ name: 'New Name' }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal server error' });
  });

  it('saves and returns valid platformDefaults.youtube', async () => {
    const updatedUser = {
      ...BASE_USER,
      platformDefaults: {
        youtube: {
          categoryId: '22',
        },
      },
    };
    updateUserMock.mockResolvedValueOnce(updatedUser);

    const res = await PATCH(
      makePatchRequest({
        platformDefaults: {
          youtube: {
            categoryId: '22',
          },
        },
      })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(updatedUser);
    expect(getUserByIdMock).not.toHaveBeenCalled();
    expect(updateUserMock).toHaveBeenCalledWith('user_123', {
      platformDefaultsYoutube: {
        categoryId: '22',
      },
    });
  });

  it('returns 400 for invalid platformDefaults.youtube field types', async () => {
    const res = await PATCH(
      makePatchRequest({
        platformDefaults: {
          youtube: {
            categoryId: 123,
          },
        },
      })
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'platformDefaults.youtube.categoryId must be a string.',
    });
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it('leaves platformDefaults unchanged when PATCH omits platformDefaults', async () => {
    const updatedUser = {
      ...BASE_USER,
      name: 'Updated Name',
      platformDefaults: {
        youtube: {
          categoryId: '10',
          madeForKids: true,
        },
      },
    };
    updateUserMock.mockResolvedValueOnce(updatedUser);

    const res = await PATCH(makePatchRequest({ name: 'Updated Name' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(updatedUser);
    expect(updateUserMock).toHaveBeenCalledWith('user_123', { name: 'Updated Name' });
    expect(updateUserMock.mock.calls[0]?.[1]).not.toHaveProperty('platformDefaultsYoutube');
  });
});
