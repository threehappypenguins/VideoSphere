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
    // Use vi.stubGlobal to prevent test isolation issues
    vi.stubGlobal('fetch', vi.fn());
    process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID = '69aae95b002b81fe4fdb';
    process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT = 'http://localhost/v1';
    process.env.APPWRITE_API_KEY = 'test_api_key';
  });

  afterEach(() => {
    // Restore globals
    vi.unstubAllGlobals();
    delete process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
    delete process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
    delete process.env.APPWRITE_API_KEY;
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
    it('should allow admin users to access /admin routes', async () => {
      const sessionToken = 'admin_session_token';
      const request = createMockRequest('/admin/dashboard', {
        a_session_69aae95b002b81fe4fdb: sessionToken,
      });

      // Mock successful session verification
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ $id: 'admin_user_123' }),
      });

      // Mock admin role lookup
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ role: 'admin' }),
      });

      const result = await proxy(request);

      expect(result.status).toBe(200);

      // Assert fetch was called with correct Appwrite REST API URL and headers
      const calls = (global.fetch as any).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(2);

      // Second call should be the role lookup
      const roleCheckCall = calls[1];
      const roleCheckUrl = roleCheckCall[0].toString();
      const roleCheckHeaders = roleCheckCall[1]?.headers;

      expect(roleCheckUrl).toContain(
        '/databases/videosphere/collections/user_profiles/documents/admin_user_123'
      );
      expect(roleCheckUrl).not.toContain('/v1/v1'); // Ensure no double /v1
      expect(roleCheckHeaders['X-Appwrite-Project']).toBe('69aae95b002b81fe4fdb');
      expect(roleCheckHeaders['X-Appwrite-Key']).toBe('test_api_key');
    });

    it('should block non-admin users from /admin routes', async () => {
      const sessionToken = 'user_session_token';
      const request = createMockRequest('/admin/users', {
        a_session_69aae95b002b81fe4fdb: sessionToken,
      });

      // Mock successful session verification
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ $id: 'regular_user_456' }),
      });

      // Mock non-admin role lookup
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ role: 'user' }),
      });

      const result = await proxy(request);

      expect(result.status).toBe(307);
      const location = result.headers.get('location') || '';
      expect(location).toContain('/dashboard');

      // Assert fetch was called with correct Appwrite REST API URL and headers
      const calls = (global.fetch as any).mock.calls;
      const roleCheckCall = calls[1];
      const roleCheckUrl = roleCheckCall[0].toString();
      const roleCheckHeaders = roleCheckCall[1]?.headers;

      expect(roleCheckUrl).toContain(
        '/databases/videosphere/collections/user_profiles/documents/regular_user_456'
      );
      expect(roleCheckUrl).not.toContain('/v1/v1');
      expect(roleCheckHeaders['X-Appwrite-Project']).toBe('69aae95b002b81fe4fdb');
      expect(roleCheckHeaders['X-Appwrite-Key']).toBe('test_api_key');
    });

    it('should block users with missing role from /admin routes', async () => {
      const sessionToken = 'user_session_token';
      const request = createMockRequest('/admin/settings', {
        a_session_69aae95b002b81fe4fdb: sessionToken,
      });

      // Mock successful session verification
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ $id: 'user_without_role_789' }),
      });

      // Mock role lookup returning 404 (no role document)
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await proxy(request);

      expect(result.status).toBe(307);
      const location = result.headers.get('location') || '';
      expect(location).toContain('/dashboard');
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
