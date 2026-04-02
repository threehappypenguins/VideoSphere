/**
 * Tests for GET /api/auth/onboarding-state and POST /api/auth/onboarding-state.
 *
 * Verifies authentication gating, validation, and correct response shapes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const getAuthenticatedUserIdMock = vi.hoisted(() => vi.fn());
const getUserByIdMock = vi.hoisted(() => vi.fn());
const updateUserMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: getAuthenticatedUserIdMock,
}));

vi.mock('@/lib/repositories/users', () => ({
  getUserById: getUserByIdMock,
  updateUser: updateUserMock,
}));

import { GET, POST } from '@/app/api/auth/onboarding-state/route';

function makeGetRequest(): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/auth/onboarding-state'), {
    method: 'GET',
  });
}

function makePostRequest(body: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/auth/onboarding-state'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const BASE_USER = {
  userId: 'user_123',
  email: 'test@example.com',
  isSupporter: false,
  role: 'user' as const,
  hasCompletedOnboarding: false,
  $createdAt: '2026-01-01T00:00:00.000Z',
  $updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('GET /api/auth/onboarding-state', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('returns 401 when not authenticated', async () => {
    getAuthenticatedUserIdMock.mockResolvedValueOnce(null);

    const res = await GET(makeGetRequest());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Not authenticated' });
    expect(getUserByIdMock).not.toHaveBeenCalled();
  });

  it('returns 404 when user profile is not found', async () => {
    getAuthenticatedUserIdMock.mockResolvedValueOnce('user_123');
    getUserByIdMock.mockResolvedValueOnce(null);

    const res = await GET(makeGetRequest());

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'User profile not found' });
  });

  it('returns 200 with hasCompletedOnboarding: false for a new user', async () => {
    getAuthenticatedUserIdMock.mockResolvedValueOnce('user_123');
    getUserByIdMock.mockResolvedValueOnce({ ...BASE_USER, hasCompletedOnboarding: false });

    const res = await GET(makeGetRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hasCompletedOnboarding: false });
  });

  it('returns 200 with hasCompletedOnboarding: true for a returning user', async () => {
    getAuthenticatedUserIdMock.mockResolvedValueOnce('user_123');
    getUserByIdMock.mockResolvedValueOnce({ ...BASE_USER, hasCompletedOnboarding: true });

    const res = await GET(makeGetRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hasCompletedOnboarding: true });
  });

  it('returns 500 on unexpected repository error', async () => {
    getAuthenticatedUserIdMock.mockResolvedValueOnce('user_123');
    getUserByIdMock.mockRejectedValueOnce(new Error('DB timeout'));

    const res = await GET(makeGetRequest());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal server error' });
  });
});

describe('POST /api/auth/onboarding-state', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('returns 401 when not authenticated', async () => {
    getAuthenticatedUserIdMock.mockResolvedValueOnce(null);

    const res = await POST(makePostRequest({ hasCompletedOnboarding: true }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Not authenticated' });
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it('returns 400 when body is invalid JSON', async () => {
    getAuthenticatedUserIdMock.mockResolvedValueOnce('user_123');

    const req = new NextRequest(new URL('http://localhost:3000/api/auth/onboarding-state'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json{{{',
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid JSON body.' });
  });

  it('returns 400 when body is not an object', async () => {
    getAuthenticatedUserIdMock.mockResolvedValueOnce('user_123');

    const res = await POST(makePostRequest(true));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Body must be a JSON object.' });
  });

  it('returns 400 when hasCompletedOnboarding is not a boolean', async () => {
    getAuthenticatedUserIdMock.mockResolvedValueOnce('user_123');

    const res = await POST(makePostRequest({ hasCompletedOnboarding: 'yes' }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'hasCompletedOnboarding must be a boolean.' });
  });

  it('returns 400 when hasCompletedOnboarding is missing', async () => {
    getAuthenticatedUserIdMock.mockResolvedValueOnce('user_123');

    const res = await POST(makePostRequest({}));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'hasCompletedOnboarding must be a boolean.' });
  });

  it('returns 200 and updated state when marking completed', async () => {
    getAuthenticatedUserIdMock.mockResolvedValueOnce('user_123');
    updateUserMock.mockResolvedValueOnce({ ...BASE_USER, hasCompletedOnboarding: true });

    const res = await POST(makePostRequest({ hasCompletedOnboarding: true }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hasCompletedOnboarding: true });
    expect(updateUserMock).toHaveBeenCalledWith('user_123', { hasCompletedOnboarding: true });
  });

  it('returns 200 and updated state when resetting onboarding', async () => {
    getAuthenticatedUserIdMock.mockResolvedValueOnce('user_123');
    updateUserMock.mockResolvedValueOnce({ ...BASE_USER, hasCompletedOnboarding: false });

    const res = await POST(makePostRequest({ hasCompletedOnboarding: false }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hasCompletedOnboarding: false });
  });

  it('returns 404 when Appwrite reports the profile row is missing', async () => {
    getAuthenticatedUserIdMock.mockResolvedValueOnce('user_123');
    const notFoundErr = Object.assign(new Error('Document not found'), { code: 404 });
    updateUserMock.mockRejectedValueOnce(notFoundErr);

    const res = await POST(makePostRequest({ hasCompletedOnboarding: true }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'User profile not found' });
  });

  it('returns 500 on unexpected repository error', async () => {
    getAuthenticatedUserIdMock.mockResolvedValueOnce('user_123');
    updateUserMock.mockRejectedValueOnce(new Error('Network failure'));

    const res = await POST(makePostRequest({ hasCompletedOnboarding: true }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal server error' });
  });
});
