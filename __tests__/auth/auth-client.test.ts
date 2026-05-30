// =============================================================================
// AUTH CLIENT UNIT TESTS
// =============================================================================
// Tests for fetch-based auth client wrappers.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loginWithEmail, logout, getCurrentSession, getCurrentUser } from '@/lib/auth-client';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Auth Client Functions', () => {
  describe('loginWithEmail', () => {
    it('should successfully login with valid credentials', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const result = await loginWithEmail('test@example.com', 'password123');

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/auth/login',
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'test@example.com', password: 'password123' }),
        })
      );
      expect(result).toEqual({ ok: true });
    });

    it('should handle login error gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Invalid credentials' }),
      });

      await expect(loginWithEmail('test@example.com', 'wrongpassword')).rejects.toThrow(
        'Invalid credentials'
      );
    });

    it('should fall back to generic message when error response is not parseable', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => {
          throw new Error('invalid json');
        },
      });

      await expect(loginWithEmail('test@example.com', 'password123')).rejects.toThrow(
        'Login failed'
      );
    });

    it('should propagate fetch failures', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network failed'));

      await expect(loginWithEmail('test@example.com', 'password123')).rejects.toThrow('network');
    });
  });

  describe('logout', () => {
    it('should call logout API with credentials', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await logout();

      expect(mockFetch).toHaveBeenCalledWith('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    });
  });

  describe('getCurrentSession', () => {
    it('should return current session when user is authenticated', async () => {
      const mockSession = {
        $id: 'session123',
        userId: 'user123',
      };

      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => mockSession });

      const session = await getCurrentSession();

      expect(mockFetch).toHaveBeenCalledWith('/api/auth/session', {
        method: 'GET',
        credentials: 'include',
      });
      expect(session).toEqual(mockSession);
    });

    it('should return null when no session exists', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });

      const session = await getCurrentSession();

      expect(session).toBeNull();
    });

    it('should return null for any error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Unauthorized'));

      const session = await getCurrentSession();

      expect(session).toBeNull();
    });
  });

  describe('getCurrentUser', () => {
    it('should return current user when authenticated', async () => {
      const mockUser = {
        $id: 'user123',
        email: 'test@example.com',
        name: 'Test User',
      };

      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => mockUser });

      const user = await getCurrentUser();

      expect(mockFetch).toHaveBeenCalledWith('/api/auth/session', {
        method: 'GET',
        credentials: 'include',
      });
      expect(user).toEqual(mockUser);
    });

    it('should return null when user is not authenticated', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });

      const user = await getCurrentUser();

      expect(user).toBeNull();
    });

    it('should return null for any error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Server error'));

      const user = await getCurrentUser();

      expect(user).toBeNull();
    });
  });
});
