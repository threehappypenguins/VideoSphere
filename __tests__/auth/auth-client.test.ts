// =============================================================================
// AUTH CLIENT UNIT TESTS
// =============================================================================
// Tests for authentication utility functions that interact with Appwrite SDK.
// Mocks Appwrite SDK to test the core auth logic.
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Using vi.hoisted to define mocks before vi.mock
const { mockDeleteSession, mockCreateEmailPasswordSession, mockGetSession, mockGetUser } =
  vi.hoisted(() => ({
    mockDeleteSession: vi.fn(),
    mockCreateEmailPasswordSession: vi.fn(),
    mockGetSession: vi.fn(),
    mockGetUser: vi.fn(),
  }));

vi.mock('appwrite', () => {
  return {
    Client: class {
      setEndpoint() {
        return this;
      }
      setProject() {
        return this;
      }
    },
    Account: class {
      deleteSession = mockDeleteSession;
      createEmailPasswordSession = mockCreateEmailPasswordSession;
      getSession = mockGetSession;
      get = mockGetUser;
    },
  };
});

// Import after mocking
import { loginWithEmail, logout, getCurrentSession, getCurrentUser } from '@/lib/auth-client';

beforeEach(() => {
  // Clear mocks before each test
  mockDeleteSession.mockClear();
  mockCreateEmailPasswordSession.mockClear();
  mockGetSession.mockClear();
  mockGetUser.mockClear();
});

describe('Auth Client Functions', () => {
  describe('loginWithEmail', () => {
    it('should successfully login with valid credentials', async () => {
      const mockSession = {
        $id: 'session123',
        userId: 'user123',
        email: 'test@example.com',
      };

      mockCreateEmailPasswordSession.mockResolvedValue(mockSession);
      mockDeleteSession.mockRejectedValue(new Error('No session'));

      const result = await loginWithEmail('test@example.com', 'password123');

      expect(mockDeleteSession).toHaveBeenCalledWith('current');
      expect(mockCreateEmailPasswordSession).toHaveBeenCalledWith(
        'test@example.com',
        'password123'
      );
      expect(result).toEqual(mockSession);
    });

    it('should handle login error gracefully', async () => {
      const loginError = new Error('Invalid credentials');
      mockCreateEmailPasswordSession.mockRejectedValue(loginError);
      mockDeleteSession.mockRejectedValue(new Error('No session'));

      await expect(loginWithEmail('test@example.com', 'wrongpassword')).rejects.toThrow(
        'Invalid credentials'
      );
    });

    it('should delete existing session before creating new one', async () => {
      const mockSession = { $id: 'session123', userId: 'user123' };
      mockCreateEmailPasswordSession.mockResolvedValue(mockSession);
      mockDeleteSession.mockResolvedValue(null);

      await loginWithEmail('test@example.com', 'password123');

      expect(mockDeleteSession).toHaveBeenCalledWith('current');
      expect(mockCreateEmailPasswordSession).toHaveBeenCalled();
    });

    it('should handle generic error objects', async () => {
      mockCreateEmailPasswordSession.mockRejectedValue({ some: 'error' });
      mockDeleteSession.mockRejectedValue(new Error('No session'));

      await expect(loginWithEmail('test@example.com', 'password123')).rejects.toThrow(
        'Login failed'
      );
    });
  });

  describe('logout', () => {
    it('should call logout API with credentials', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', mockFetch);

      await logout();

      expect(mockFetch).toHaveBeenCalledWith('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
      vi.unstubAllGlobals();
    });
  });

  describe('getCurrentSession', () => {
    it('should return current session when user is authenticated', async () => {
      const mockSession = {
        $id: 'session123',
        userId: 'user123',
      };

      mockGetSession.mockResolvedValue(mockSession);

      const session = await getCurrentSession();

      expect(mockGetSession).toHaveBeenCalledWith('current');
      expect(session).toEqual(mockSession);
    });

    it('should return null when no session exists', async () => {
      mockGetSession.mockRejectedValue(new Error('No session'));

      const session = await getCurrentSession();

      expect(session).toBeNull();
    });

    it('should return null for any error', async () => {
      mockGetSession.mockRejectedValue(new Error('Unauthorized'));

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

      mockGetUser.mockResolvedValue(mockUser);

      const user = await getCurrentUser();

      expect(mockGetUser).toHaveBeenCalled();
      expect(user).toEqual(mockUser);
    });

    it('should return null when user is not authenticated', async () => {
      mockGetUser.mockRejectedValue(new Error('Not authenticated'));

      const user = await getCurrentUser();

      expect(user).toBeNull();
    });

    it('should return null for any error', async () => {
      mockGetUser.mockRejectedValue(new Error('Server error'));

      const user = await getCurrentUser();

      expect(user).toBeNull();
    });
  });
});
