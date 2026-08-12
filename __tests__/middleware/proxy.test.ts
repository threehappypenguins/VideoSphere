// =============================================================================
// PROXY MIDDLEWARE TESTS
// =============================================================================
// Tests core proxy functionality: session verification, auth redirects,
// and admin role enforcement (JWT claims verified locally).
// =============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { mockJwtVerify } = vi.hoisted(() => ({
  mockJwtVerify: vi.fn(),
}));

vi.mock('jose', () => ({
  jwtVerify: (...args: unknown[]) => mockJwtVerify(...args),
}));

import { proxy } from '@/proxy';

function createMockRequest(pathname: string, cookies: Record<string, string> = {}): NextRequest {
  const url = new URL(`http://localhost:3000${pathname}`);
  const request = new NextRequest(url);

  Object.entries(cookies).forEach(([key, value]) => {
    request.cookies.set(key, value);
  });

  return request;
}

describe('Proxy Middleware', () => {
  beforeEach(() => {
    mockJwtVerify.mockReset();
    vi.stubEnv('JWT_SECRET', 'test-jwt-secret-for-vitest-only');
    vi.stubEnv('JWT_SESSION_COOKIE_NAME', 'videosphere_session');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('Session Verification', () => {
    it('should allow unauthenticated users to access the marketing home route', async () => {
      const request = createMockRequest('/');

      const result = await proxy(request);

      expect(result.status).toBe(200);
      expect(mockJwtVerify).not.toHaveBeenCalled();
    });

    it('should redirect authenticated users from home to dashboard after verifying session', async () => {
      mockJwtVerify.mockResolvedValueOnce({
        payload: { sub: 'user123', role: 'user' },
      });
      const request = createMockRequest('/', {
        videosphere_session: 'valid_session_token_xyz',
      });

      const result = await proxy(request);

      expect(result.status).toBe(307);
      expect(result.headers.get('location') || '').toContain('/dashboard');
    });

    it('should allow home through when a stale session cookie fails verification', async () => {
      mockJwtVerify.mockRejectedValueOnce(new Error('invalid'));
      const request = createMockRequest('/', {
        videosphere_session: 'stale_session_token_xyz',
      });

      const result = await proxy(request);

      expect(result.status).toBe(200);
    });

    it('should redirect to login when no session cookie is present', async () => {
      const request = createMockRequest('/dashboard/uploads');

      const result = await proxy(request);

      expect(result.status).toBe(307);
      const location = result.headers.get('location') || '';
      expect(location).toContain('/login');
      expect(location).toContain('redirect=%2Fdashboard%2Fuploads');
      expect(mockJwtVerify).not.toHaveBeenCalled();
    });

    it('should allow authenticated users through protected routes', async () => {
      mockJwtVerify.mockResolvedValueOnce({
        payload: { sub: 'user123', role: 'user' },
      });
      const request = createMockRequest('/dashboard/uploads', {
        videosphere_session: 'valid_session_token_xyz',
      });

      const result = await proxy(request);

      expect(result.status).toBe(200);
      expect(mockJwtVerify).toHaveBeenCalled();
    });

    it('should redirect to login when session verification fails', async () => {
      mockJwtVerify.mockRejectedValueOnce(new Error('invalid'));
      const request = createMockRequest('/profile/settings', {
        videosphere_session: 'invalid_session_token_xyz',
      });

      const result = await proxy(request);

      expect(result.status).toBe(307);
      const location = result.headers.get('location') || '';
      expect(location).toContain('/login');
      expect(location).toContain('redirect=%2Fprofile%2Fsettings');
    });

    it('should redirect to login when JWT_SECRET is missing', async () => {
      vi.stubEnv('JWT_SECRET', '');
      const request = createMockRequest('/dashboard', {
        videosphere_session: 'any_token',
      });

      const result = await proxy(request);

      expect(result.status).toBe(307);
      expect(result.headers.get('location') || '').toContain('/login');
      expect(mockJwtVerify).not.toHaveBeenCalled();
    });
  });

  describe('Admin Role Enforcement', () => {
    it('should allow admin users to access /admin routes', async () => {
      mockJwtVerify.mockResolvedValueOnce({
        payload: { sub: 'admin1', role: 'admin' },
      });
      const request = createMockRequest('/admin/dashboard', {
        videosphere_session: 'admin_session_token',
      });

      const result = await proxy(request);

      expect(result.status).toBe(200);
    });

    it('should block non-admin users from /admin routes', async () => {
      mockJwtVerify.mockResolvedValueOnce({
        payload: { sub: 'user1', role: 'user' },
      });
      const request = createMockRequest('/admin/users', {
        videosphere_session: 'user_session_token',
      });

      const result = await proxy(request);

      expect(result.status).toBe(307);
      expect(result.headers.get('location') || '').toContain('/dashboard');
    });

    it('should enforce admin on /dashboard/users', async () => {
      mockJwtVerify.mockResolvedValueOnce({
        payload: { sub: 'user1', role: 'user' },
      });
      const blocked = await proxy(
        createMockRequest('/dashboard/users', { videosphere_session: 'user_token' })
      );
      expect(blocked.status).toBe(307);
      expect(blocked.headers.get('location') || '').toContain('/dashboard');

      mockJwtVerify.mockResolvedValueOnce({
        payload: { sub: 'admin1', role: 'admin' },
      });
      const allowed = await proxy(
        createMockRequest('/dashboard/users', { videosphere_session: 'admin_token' })
      );
      expect(allowed.status).toBe(200);
    });

    it('should redirect unauthenticated users from /admin to login', async () => {
      const request = createMockRequest('/admin/dashboard');

      const result = await proxy(request);

      expect(result.status).toBe(307);
      expect(result.headers.get('location') || '').toContain('/login');
    });
  });

  describe('Query String Preservation', () => {
    it('should preserve query params in redirect (e.g. ?upgrade=success)', async () => {
      const request = createMockRequest('/profile?upgrade=success');

      const result = await proxy(request);

      expect(result.status).toBe(307);
      const location = result.headers.get('location') || '';
      expect(location).toContain('/login');
      const url = new URL(location);
      const redirect = url.searchParams.get('redirect');
      expect(redirect).toBe('/profile?upgrade=success');
    });

    it('should preserve query params when session verification fails', async () => {
      mockJwtVerify.mockRejectedValueOnce(new Error('invalid'));
      const request = createMockRequest('/profile?upgrade=success', {
        videosphere_session: 'invalid_token',
      });

      const result = await proxy(request);

      expect(result.status).toBe(307);
      const url = new URL(result.headers.get('location') || '');
      const redirect = url.searchParams.get('redirect');
      expect(redirect).toBe('/profile?upgrade=success');
    });
  });

  describe('Route Matching', () => {
    it('should protect /dashboard routes', async () => {
      const request = createMockRequest('/dashboard/uploads');
      const result = await proxy(request);

      expect(result.status).toBe(307);
      expect(result.headers.get('location') || '').toContain('/login');
    });

    it('should protect /profile routes', async () => {
      const request = createMockRequest('/profile/settings');
      const result = await proxy(request);

      expect(result.status).toBe(307);
      expect(result.headers.get('location') || '').toContain('/login');
    });

    it('should protect /admin routes', async () => {
      const request = createMockRequest('/admin/users');
      const result = await proxy(request);

      expect(result.status).toBe(307);
      expect(result.headers.get('location') || '').toContain('/login');
    });
  });
});
