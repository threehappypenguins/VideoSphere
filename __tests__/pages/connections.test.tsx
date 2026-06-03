// =============================================================================
// CONNECTIONS PAGE COMPONENT TESTS
// =============================================================================
// Tests for the /profile/connections page UI.
// The page is an async Server Component, so it is rendered with `await`.
// External dependencies (auth helper, next/headers, repository) are mocked.
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Hoisted mocks — these must be declared with vi.hoisted() so they are
// initialised before vi.mock() factory functions run (vi.mock is hoisted to
// the top of the file at compile-time, so plain `const` refs are TDZ).
// ---------------------------------------------------------------------------

const { mockGetCurrentUserIdFromCookies, mockGetConnectedAccountsByUser } = vi.hoisted(() => ({
  mockGetCurrentUserIdFromCookies: vi.fn(),
  mockGetConnectedAccountsByUser: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth/get-current-user-id-from-cookies', () => ({
  getCurrentUserIdFromCookies: (...args: unknown[]) => mockGetCurrentUserIdFromCookies(...args),
}));

vi.mock('@/lib/repositories/connected-accounts', () => ({
  getConnectedAccountsByUser: (...args: unknown[]) => mockGetConnectedAccountsByUser(...args),
  getConnectedAccountWithTokens: vi.fn(),
  deleteConnectedAccount: vi.fn(),
}));

import ConnectionsPage from '@/app/(dashboard)/profile/connections/page';
import { redirect } from 'next/navigation';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSearchParams(params: Record<string, string> = {}) {
  return Promise.resolve(params);
}

function setupAuthenticatedUser(userId = 'user-123') {
  mockGetCurrentUserIdFromCookies.mockResolvedValue(userId);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConnectionsPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetConnectedAccountsByUser.mockResolvedValue([]);
    mockGetCurrentUserIdFromCookies.mockResolvedValue('user-123');
  });

  describe('Authentication', () => {
    it('redirects to /login when no session cookie is present', async () => {
      mockGetCurrentUserIdFromCookies.mockResolvedValueOnce(null);
      const page = await ConnectionsPage({ searchParams: makeSearchParams() });
      render(page);
      expect(redirect).toHaveBeenCalledWith('/login?redirect=%2Fprofile%2Fconnections');
    });

    it('redirects to /login when cookie-based auth helper returns null', async () => {
      mockGetCurrentUserIdFromCookies.mockResolvedValueOnce(null);
      const page = await ConnectionsPage({ searchParams: makeSearchParams() });
      render(page);
      expect(redirect).toHaveBeenCalledWith('/login?redirect=%2Fprofile%2Fconnections');
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

    it('renders a row for Google Drive', async () => {
      const page = await ConnectionsPage({ searchParams: makeSearchParams() });
      render(page);
      expect(screen.getByText('Google Drive')).toBeInTheDocument();
    });

    it('renders a row for SFTP Server', async () => {
      const page = await ConnectionsPage({ searchParams: makeSearchParams() });
      render(page);
      expect(screen.getByText('SFTP Server')).toBeInTheDocument();
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
          hasRefreshToken: true,
          platformUserId: 'UCtest123',
          platformName: 'My Test Channel',
          $createdAt: new Date().toISOString(),
          $updatedAt: new Date().toISOString(),
        },
      ]);
      const page = await ConnectionsPage({ searchParams: makeSearchParams() });
      render(page);
      expect(screen.getByRole('button', { name: /disconnect/i })).toBeInTheDocument();
      expect(screen.getByText('My Test Channel')).toBeInTheDocument();
    });

    it('shows Connected (not Expired) when access token is past but a refresh token exists', async () => {
      mockGetConnectedAccountsByUser.mockResolvedValue([
        {
          id: 'account-1',
          userId: 'user-123',
          platform: 'youtube',
          tokenExpiry: new Date(Date.now() - 1000).toISOString(),
          hasRefreshToken: true,
          platformUserId: 'UCtest123',
          platformName: 'My Test Channel',
          $createdAt: new Date().toISOString(),
          $updatedAt: new Date().toISOString(),
        },
      ]);
      const page = await ConnectionsPage({ searchParams: makeSearchParams() });
      render(page);
      expect(screen.getByText('Connected')).toBeInTheDocument();
      expect(screen.queryByText(/expired/i)).not.toBeInTheDocument();
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

    it('renders success flash when ?success=google_drive is present', async () => {
      const page = await ConnectionsPage({
        searchParams: makeSearchParams({ success: 'google_drive' }),
      });
      render(page);
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.getByRole('status').textContent).toMatch(/google drive account connected/i);
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
