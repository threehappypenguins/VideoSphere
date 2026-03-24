// =============================================================================
// PROXY MIDDLEWARE TESTS
// =============================================================================
// Tests core proxy functionality: session verification, auth redirects,
// and admin role enforcement.
// =============================================================================

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { getUserById } from '@/lib/repositories/users';
import { proxy } from '@/proxy';

vi.mock('@/lib/repositories/users', () => ({
  getUserById: vi.fn(),
}));

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
    vi.mocked(getUserById).mockReset();
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

      vi.mocked(getUserById).mockResolvedValueOnce({
        userId: 'admin_user_123',
        email: 'admin@example.com',
        isSupporter: false,
        role: 'admin',
        $createdAt: '2026-01-01T00:00:00.000Z',
        $updatedAt: '2026-01-01T00:00:00.000Z',
      });

      const result = await proxy(request);

      expect(result.status).toBe(200);
      expect(vi.mocked(getUserById)).toHaveBeenCalledWith('admin_user_123');
      expect((global.fetch as any).mock.calls).toHaveLength(1);
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

      vi.mocked(getUserById).mockResolvedValueOnce({
        userId: 'regular_user_456',
        email: 'user@example.com',
        isSupporter: false,
        role: 'user',
        $createdAt: '2026-01-01T00:00:00.000Z',
        $updatedAt: '2026-01-01T00:00:00.000Z',
      });

      const result = await proxy(request);

      expect(result.status).toBe(307);
      const location = result.headers.get('location') || '';
      expect(location).toContain('/dashboard');
      expect(vi.mocked(getUserById)).toHaveBeenCalledWith('regular_user_456');
      expect((global.fetch as any).mock.calls).toHaveLength(1);
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

      vi.mocked(getUserById).mockResolvedValueOnce(null);

      const result = await proxy(request);

      expect(result.status).toBe(307);
      const location = result.headers.get('location') || '';
      expect(location).toContain('/dashboard');
      expect(vi.mocked(getUserById)).toHaveBeenCalledWith('user_without_role_789');
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
