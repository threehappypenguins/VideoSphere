// =============================================================================
// CONNECTIONS PAGE COMPONENT TESTS
// =============================================================================
// Tests for the /profile/connections page UI.
// The page is an async Server Component, so it is rendered with `await`.
// External dependencies (Appwrite, next/headers, repository) are mocked.
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Hoisted mocks — these must be declared with vi.hoisted() so they are
// initialised before vi.mock() factory functions run (vi.mock is hoisted to
// the top of the file at compile-time, so plain `const` refs are TDZ).
// ---------------------------------------------------------------------------

const { mockCookiesGet, mockAccountGet, mockGetConnectedAccountsByUser } = vi.hoisted(() => ({
  mockCookiesGet: vi.fn(),
  mockAccountGet: vi.fn(),
  mockGetConnectedAccountsByUser: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: mockCookiesGet })),
}));

vi.mock('node-appwrite', () => {
  const mockClient = {
    setEndpoint: vi.fn(function () {
      return this;
    }),
    setProject: vi.fn(function () {
      return this;
    }),
    setSession: vi.fn(function () {
      return this;
    }),
  };
  function MockClient() {
    return mockClient;
  }
  function MockAccount() {
    this.get = mockAccountGet;
  }
  return { Client: MockClient, Account: MockAccount };
});

vi.mock('@/lib/repositories/connected-accounts', () => ({
  getConnectedAccountsByUser: (...args: unknown[]) => mockGetConnectedAccountsByUser(...args),
  getConnectedAccountWithTokens: vi.fn(),
  deleteConnectedAccount: vi.fn(),
}));

import ConnectionsPage from '@/app/profile/connections/page';
import { redirect } from 'next/navigation';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SESSION_COOKIE_NAME = 'a_session_test-project';

function makeSearchParams(params: Record<string, string> = {}) {
  return Promise.resolve(params);
}

function setupAuthenticatedUser(userId = 'user-123') {
  mockCookiesGet.mockReturnValue({ value: 'valid-session-token' });
  mockAccountGet.mockResolvedValue({ $id: userId });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConnectionsPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT = 'http://localhost/v1';
    process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID = 'test-project';
    mockGetConnectedAccountsByUser.mockResolvedValue([]);
  });

  describe('Authentication', () => {
    it('redirects to /login when no session cookie is present', async () => {
      mockCookiesGet.mockReturnValue(undefined);
      const page = await ConnectionsPage({ searchParams: makeSearchParams() });
      render(page);
      expect(redirect).toHaveBeenCalledWith('/login');
    });

    it('redirects to /login when Appwrite rejects the session', async () => {
      mockCookiesGet.mockReturnValue({ value: 'bad-token' });
      mockAccountGet.mockRejectedValue(new Error('Invalid session'));
      const page = await ConnectionsPage({ searchParams: makeSearchParams() });
      render(page);
      expect(redirect).toHaveBeenCalledWith('/login');
    });
  });

  describe('Platform list', () => {
    beforeEach(() => {
      setupAuthenticatedUser();
    });

    it('renders the page heading', async () => {
      const page = await ConnectionsPage({ searchParams: makeSearchParams() });
      render(page);
      expect(screen.getByRole('heading', { name: /connected accounts/i })).toBeInTheDocument();
    });

    it('renders a row for YouTube', async () => {
      const page = await ConnectionsPage({ searchParams: makeSearchParams() });
      render(page);
      expect(screen.getByText('YouTube')).toBeInTheDocument();
    });

    it('renders a row for Vimeo', async () => {
      const page = await ConnectionsPage({ searchParams: makeSearchParams() });
      render(page);
      expect(screen.getByText('Vimeo')).toBeInTheDocument();
    });

    it('shows Connect button for unconnected platforms', async () => {
      const page = await ConnectionsPage({ searchParams: makeSearchParams() });
      render(page);
      const connectLinks = screen.getAllByRole('link', { name: /^connect$/i });
      expect(connectLinks.length).toBeGreaterThan(0);
    });

    it('Connect button for YouTube links to the connect route', async () => {
      const page = await ConnectionsPage({ searchParams: makeSearchParams() });
      render(page);
      // YouTube Connect is an <a> (not Link), so check all anchors named Connect
      const anchors = screen.getAllByText(/^connect$/i);
      const youtubeAnchor = anchors.find((el) =>
        (el as HTMLAnchorElement).href?.includes('connect/youtube')
      );
      expect(youtubeAnchor).toBeDefined();
    });

    it('shows Disconnect button and channel name when YouTube is connected', async () => {
      mockGetConnectedAccountsByUser.mockResolvedValue([
        {
          id: 'account-1',
          userId: 'user-123',
          platform: 'youtube',
          tokenExpiry: new Date(Date.now() + 3600 * 1000).toISOString(),
          platformUserId: 'UCtest123',
          platformName: 'My Test Channel',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);
      const page = await ConnectionsPage({ searchParams: makeSearchParams() });
      render(page);
      expect(screen.getByRole('button', { name: /disconnect/i })).toBeInTheDocument();
      expect(screen.getByText('My Test Channel')).toBeInTheDocument();
    });
  });

  describe('Flash messages', () => {
    beforeEach(() => {
      setupAuthenticatedUser();
    });

    it('renders success flash when ?success=youtube is present', async () => {
      const page = await ConnectionsPage({
        searchParams: makeSearchParams({ success: 'youtube' }),
      });
      render(page);
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.getByRole('status').textContent).toMatch(/connected successfully/i);
    });

    it('renders error flash when ?error=youtube is present', async () => {
      const page = await ConnectionsPage({
        searchParams: makeSearchParams({ error: 'youtube' }),
      });
      render(page);
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByRole('alert').textContent).toMatch(/failed to connect/i);
    });

    it('shows no flash when no query params are present', async () => {
      const page = await ConnectionsPage({ searchParams: makeSearchParams() });
      render(page);
      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  describe('Back link', () => {
    beforeEach(() => {
      setupAuthenticatedUser();
    });

    it('renders a back link to /profile', async () => {
      const page = await ConnectionsPage({ searchParams: makeSearchParams() });
      render(page);
      const backLink = screen.getByRole('link', { name: /back to profile/i });
      expect(backLink).toHaveAttribute('href', '/profile');
    });
  });
});
