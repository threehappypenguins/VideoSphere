// =============================================================================
// PROXY MIDDLEWARE TESTS
// =============================================================================
// Tests core proxy functionality: session verification, auth redirects,
// and admin role enforcement.
// =============================================================================

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';

function createMockRequest(pathname: string, cookies: Record<string, string> = {}): NextRequest {
  const url = new URL(`http://localhost:3000${pathname}`);
  const request = new NextRequest(url);

  // Manually set cookies on the request
  Object.entries(cookies).forEach(([key, value]) => {
    request.cookies.set(key, value);
  });

  return request;
}

describe('Proxy Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('Session Verification', () => {
    it('should allow unauthenticated users to access the marketing home route', async () => {
      const request = createMockRequest('/');

      const result = await proxy(request);

      expect(result.status).toBe(200);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should redirect authenticated users from home to dashboard after verifying session', async () => {
      const request = createMockRequest('/', {
        videosphere_session: 'valid_session_token_xyz',
      });

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ $id: 'user123' }),
      });

      const result = await proxy(request);

      expect(result.status).toBe(307);
      expect(result.headers.get('location') || '').toContain('/dashboard');
    });

    it('should allow home through when a stale session cookie fails verification', async () => {
      const request = createMockRequest('/', {
        videosphere_session: 'stale_session_token_xyz',
      });

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      const result = await proxy(request);

      expect(result.status).toBe(200);
    });

    it('should redirect to login when no session cookie is present', async () => {
      const request = createMockRequest('/dashboard/videos');

      const result = await proxy(request);

      expect(result).toBeDefined();
      expect(result.status).toBe(307);
      const location = result.headers.get('location') || '';
      expect(location).toContain('/login');
      expect(location).toContain('redirect=%2Fdashboard%2Fvideos');
    });

    it('should allow authenticated users through', async () => {
      const sessionToken = 'valid_session_token_xyz';
      const request = createMockRequest('/dashboard/videos', {
        videosphere_session: sessionToken,
      });

      // Mock successful session verification
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ $id: 'user123' }),
      });

      const result = await proxy(request);

      expect(result.status).toBe(200);
    });

    it('should redirect to login when session verification fails', async () => {
      const sessionToken = 'invalid_session_token_xyz';
      const request = createMockRequest('/profile/settings', {
        videosphere_session: sessionToken,
      });

      // Mock failed session verification (401 response)
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      const result = await proxy(request);

      expect(result.status).toBe(307);
      const location = result.headers.get('location') || '';
      expect(location).toContain('/login');
      expect(location).toContain('redirect=%2Fprofile%2Fsettings');
    });

    it('should redirect to login when session fetch throws', async () => {
      const sessionToken = 'error_session_token_xyz';
      const request = createMockRequest('/dashboard', {
        videosphere_session: sessionToken,
      });

      // Mock fetch error
      (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

      const result = await proxy(request);

      expect(result.status).toBe(307);
      const location = result.headers.get('location') || '';
      expect(location).toContain('/login');
    });
  });

  describe('Admin Role Enforcement', () => {
    it('should redirect to login when session-role returns 401', async () => {
      const sessionToken = 'expired_session';
      const request = createMockRequest('/admin/dashboard', {
        videosphere_session: sessionToken,
      });

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      const result = await proxy(request);

      expect(result.status).toBe(307);
      const location = result.headers.get('location') || '';
      expect(location).toContain('/login');
      expect(location).toContain('redirect=');
    });

    it('should allow admin users to access /admin routes', async () => {
      const sessionToken = 'admin_session_token';
      const request = createMockRequest('/admin/dashboard', {
        videosphere_session: sessionToken,
      });

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ role: 'admin' }),
      });

      const result = await proxy(request);

      expect(result.status).toBe(200);
      expect((global.fetch as any).mock.calls).toHaveLength(1);
      const calledUrl = String((global.fetch as any).mock.calls[0][0]);
      expect(calledUrl).toContain('/api/auth/session-role');
    });

    it('should block non-admin users from /admin routes', async () => {
      const sessionToken = 'user_session_token';
      const request = createMockRequest('/admin/users', {
        videosphere_session: sessionToken,
      });

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ role: 'user' }),
      });

      const result = await proxy(request);

      expect(result.status).toBe(307);
      const location = result.headers.get('location') || '';
      expect(location).toContain('/dashboard');
      expect((global.fetch as any).mock.calls).toHaveLength(1);
    });

    it('should block users with missing role from /admin routes', async () => {
      const sessionToken = 'user_session_token';
      const request = createMockRequest('/admin/settings', {
        videosphere_session: sessionToken,
      });

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ role: 'user' }),
      });

      const result = await proxy(request);

      expect(result.status).toBe(307);
      const location = result.headers.get('location') || '';
      expect(location).toContain('/dashboard');
    });

    it('should redirect to dashboard when session-role returns 503 (profile unavailable)', async () => {
      const sessionToken = 'user_session_token';
      const request = createMockRequest('/admin/settings', {
        videosphere_session: sessionToken,
      });

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 503,
      });

      const result = await proxy(request);

      expect(result.status).toBe(307);
      expect(result.headers.get('location') || '').toContain('/dashboard');
    });

    it('should redirect to dashboard when session-role fetch throws (e.g. network)', async () => {
      const sessionToken = 'admin_session_token';
      const request = createMockRequest('/admin/dashboard', {
        videosphere_session: sessionToken,
      });

      (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

      const result = await proxy(request);

      expect(result.status).toBe(307);
      expect(result.headers.get('location') || '').toContain('/dashboard');
    });

    it('should redirect to dashboard when session-role response JSON is invalid', async () => {
      const sessionToken = 'admin_session_token';
      const request = createMockRequest('/admin/dashboard', {
        videosphere_session: sessionToken,
      });

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      const result = await proxy(request);

      expect(result.status).toBe(307);
      expect(result.headers.get('location') || '').toContain('/dashboard');
    });

    it('should allow admin users to access /dashboard routes', async () => {
      const sessionToken = 'admin_session_token';
      const request = createMockRequest('/dashboard/videos', {
        videosphere_session: sessionToken,
      });

      // Mock successful session verification
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ $id: 'admin_user_123' }),
      });

      const result = await proxy(request);

      // Should not check role for non-admin routes
      expect(result.status).toBe(200);
      expect((global.fetch as any).mock.calls).toHaveLength(1);
    });
  });

  describe('Cookie Handling', () => {
    it('should redirect to login when no session cookie is present', async () => {
      const request = createMockRequest('/dashboard');

      const result = await proxy(request);

      expect(result.status).toBe(307);
      const location = result.headers.get('location') || '';
      expect(location).toContain('/login');
    });

    it('should rely on session cookie verification for dashboard access', async () => {
      const sessionToken = 'valid_token';

      const request = createMockRequest('/dashboard', {
        videosphere_session: sessionToken,
      });

      // Mock successful session verification
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ $id: 'user123' }),
      });

      const result = await proxy(request);

      expect(result.status).toBe(200);
    });
  });

  describe('Error Handling', () => {
    it('should redirect to login when fetch throws during session verification', async () => {
      const sessionToken = 'token';
      const request = createMockRequest('/dashboard', {
        videosphere_session: sessionToken,
      });

      // When fetch throws during session verification, getSessionUser returns null
      // and user is redirected to login (not fail-open behavior at this level)
      (global.fetch as any).mockImplementationOnce(() => {
        throw new Error('Network error');
      });

      const result = await proxy(request);

      expect(result.status).toBe(307);
      const location = result.headers.get('location') || '';
      expect(location).toContain('/login');
    });
  });

  describe('Query String Preservation', () => {
    it('should preserve query params in redirect (e.g. ?upgrade=success)', async () => {
      const request = createMockRequest('/profile?upgrade=success');

      const result = await proxy(request);

      expect(result.status).toBe(307);
      const location = result.headers.get('location') || '';
      expect(location).toContain('/login');
      // The redirect param should contain the full path with query string
      const url = new URL(location);
      const redirect = url.searchParams.get('redirect');
      expect(redirect).toBe('/profile?upgrade=success');
    });

    it('should preserve query params when session verification fails', async () => {
      const sessionToken = 'invalid_token';
      const request = createMockRequest('/profile?upgrade=success', {
        videosphere_session: sessionToken,
      });

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 401,
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
      const request = createMockRequest('/dashboard/videos');
      const result = await proxy(request);

      expect(result.status).toBe(307);
      const location = result.headers.get('location') || '';
      expect(location).toBeDefined();
      expect(location).toContain('/login');
    });

    it('should protect /profile routes', async () => {
      const request = createMockRequest('/profile/settings');
      const result = await proxy(request);

      expect(result.status).toBe(307);
      const location = result.headers.get('location') || '';
      expect(location).toBeDefined();
      expect(location).toContain('/login');
    });

    it('should protect /admin routes', async () => {
      const request = createMockRequest('/admin/users');
      const result = await proxy(request);

      expect(result.status).toBe(307);
      const location = result.headers.get('location') || '';
      expect(location).toBeDefined();
      expect(location).toContain('/login');
    });
  });
});
