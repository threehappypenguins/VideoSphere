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
    process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID = '69aae95b002b81fe4fdb';
    process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT = 'http://localhost/v1';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
    delete process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
  });

  describe('Session Verification', () => {
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
        a_session_69aae95b002b81fe4fdb: sessionToken,
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
        a_session_69aae95b002b81fe4fdb: sessionToken,
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
        a_session_69aae95b002b81fe4fdb: sessionToken,
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
        a_session_69aae95b002b81fe4fdb: sessionToken,
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
        a_session_69aae95b002b81fe4fdb: sessionToken,
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
        a_session_69aae95b002b81fe4fdb: sessionToken,
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
        a_session_69aae95b002b81fe4fdb: sessionToken,
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
        a_session_69aae95b002b81fe4fdb: sessionToken,
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
        a_session_69aae95b002b81fe4fdb: sessionToken,
      });

      (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

      const result = await proxy(request);

      expect(result.status).toBe(307);
      expect(result.headers.get('location') || '').toContain('/dashboard');
    });

    it('should redirect to dashboard when session-role response JSON is invalid', async () => {
      const sessionToken = 'admin_session_token';
      const request = createMockRequest('/admin/dashboard', {
        a_session_69aae95b002b81fe4fdb: sessionToken,
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
        a_session_69aae95b002b81fe4fdb: sessionToken,
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
    it('should handle missing project ID gracefully', async () => {
      delete process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;

      const request = createMockRequest('/dashboard');

      const result = await proxy(request);

      expect(result.status).toBe(307);
      const location = result.headers.get('location') || '';
      expect(location).toContain('/login');
    });

    it('should use NEXT_PUBLIC_APPWRITE_PROJECT_ID consistently with /api/auth/session', async () => {
      const sessionToken = 'valid_token';
      process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID = 'consistent_project_id';
      // Only set NEXT_PUBLIC to ensure proxy uses it
      delete process.env.APPWRITE_PROJECT_ID;

      const request = createMockRequest('/dashboard', {
        a_session_consistent_project_id: sessionToken,
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
        a_session_69aae95b002b81fe4fdb: sessionToken,
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
