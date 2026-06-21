// =============================================================================
// CONNECTIONS PAGE COMPONENT TESTS
// =============================================================================
// Tests for the /profile/connections page UI.
// The page is an async Server Component, so it is rendered with `await`.
// External dependencies (auth helper, next/headers, repository) are mocked.
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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
import type { ConnectedAccountPlatform } from '@/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSearchParams(params: Record<string, string> = {}) {
  return Promise.resolve(params);
}

function setupAuthenticatedUser(userId = 'user-123') {
  mockGetCurrentUserIdFromCookies.mockResolvedValue(userId);
}

function getPlatformsInSection(sectionTitle: string): ConnectedAccountPlatform[] {
  const heading = screen.getByRole('heading', { name: sectionTitle });
  const section = heading.closest('section');
  if (!section) {
    throw new Error(`Section not found for heading: ${sectionTitle}`);
  }
  return Array.from(section.querySelectorAll('[data-platform]'))
    .map((row) => row.getAttribute('data-platform'))
    .filter((platform): platform is ConnectedAccountPlatform => platform != null);
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

    it('renders Video Platforms and Backup section headings', async () => {
      const page = await ConnectionsPage({ searchParams: makeSearchParams() });
      render(page);
      expect(screen.getByRole('heading', { name: 'Video Platforms' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Backup' })).toBeInTheDocument();
    });

    it('lists video platforms alphabetically when none are connected', async () => {
      const page = await ConnectionsPage({ searchParams: makeSearchParams() });
      render(page);
      expect(getPlatformsInSection('Video Platforms')).toEqual([
        'facebook',
        'sermon_audio',
        'vimeo',
        'youtube',
      ]);
    });

    it('lists backup platforms alphabetically when none are connected', async () => {
      const page = await ConnectionsPage({ searchParams: makeSearchParams() });
      render(page);
      expect(getPlatformsInSection('Backup')).toEqual(['google_drive', 'sftp', 'smb']);
    });

    it('shows connected video platforms first in alphabetical order within the section', async () => {
      mockGetConnectedAccountsByUser.mockResolvedValue([
        {
          id: 'account-youtube',
          userId: 'user-123',
          platform: 'youtube',
          tokenExpiry: new Date(Date.now() + 3600 * 1000).toISOString(),
          hasRefreshToken: true,
          hasYoutubeMainStreamKey: false,
          hasYoutubeTempStreamKey: false,
          platformUserId: 'UCtest123',
          platformName: 'My Test Channel',
          $createdAt: new Date().toISOString(),
          $updatedAt: new Date().toISOString(),
        },
        {
          id: 'account-facebook',
          userId: 'user-123',
          platform: 'facebook',
          tokenExpiry: new Date(Date.now() + 3600 * 1000).toISOString(),
          hasRefreshToken: true,
          hasYoutubeMainStreamKey: false,
          hasYoutubeTempStreamKey: false,
          platformUserId: 'fb-user',
          platformName: 'My Page',
          facebookTargetType: 'page',
          facebookPageId: 'page-123',
          $createdAt: new Date().toISOString(),
          $updatedAt: new Date().toISOString(),
        },
      ]);
      const page = await ConnectionsPage({ searchParams: makeSearchParams() });
      render(page);
      expect(getPlatformsInSection('Video Platforms')).toEqual([
        'facebook',
        'youtube',
        'sermon_audio',
        'vimeo',
      ]);
    });

    it('shows connected backup platforms first in alphabetical order within the section', async () => {
      mockGetConnectedAccountsByUser.mockResolvedValue([
        {
          id: 'sftp-1',
          userId: 'user-123',
          platform: 'sftp',
          tokenExpiry: '2099-01-01T00:00:00.000Z',
          hasRefreshToken: false,
          hasYoutubeMainStreamKey: false,
          hasYoutubeTempStreamKey: false,
          platformUserId: 'backup-user',
          platformName: 'My Home Server',
          sftpHost: 'sftp.example.com',
          sftpPort: 22,
          sftpRemotePath: '/backups',
          sftpAuthMethod: 'password',
          sftpHostKeyFingerprint: 'a'.repeat(64),
          $createdAt: new Date().toISOString(),
          $updatedAt: new Date().toISOString(),
        },
      ]);
      const page = await ConnectionsPage({ searchParams: makeSearchParams() });
      render(page);
      expect(getPlatformsInSection('Backup')).toEqual(['sftp', 'google_drive', 'smb']);
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

    it('renders a row for SMB / Network Share', async () => {
      const page = await ConnectionsPage({ searchParams: makeSearchParams() });
      render(page);
      expect(screen.getByText('SMB / Network Share')).toBeInTheDocument();
      expect(screen.getByText(/For faster large backups, prefer SFTP/)).toBeInTheDocument();
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
          hasYoutubeMainStreamKey: false,
          hasYoutubeTempStreamKey: false,
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
          hasYoutubeMainStreamKey: false,
          hasYoutubeTempStreamKey: false,
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

    it('shows Edit and Disconnect when SFTP is connected', async () => {
      mockGetConnectedAccountsByUser.mockResolvedValue([
        {
          id: 'sftp-1',
          userId: 'user-123',
          platform: 'sftp',
          tokenExpiry: '2099-01-01T00:00:00.000Z',
          hasRefreshToken: false,
          hasYoutubeMainStreamKey: false,
          hasYoutubeTempStreamKey: false,
          platformUserId: 'backup-user',
          platformName: 'My Home Server',
          sftpHost: 'sftp.example.com',
          sftpPort: 22,
          sftpRemotePath: '/backups',
          sftpAuthMethod: 'password',
          sftpHostKeyFingerprint: 'a'.repeat(64),
          $createdAt: new Date().toISOString(),
          $updatedAt: new Date().toISOString(),
        },
      ]);
      const page = await ConnectionsPage({ searchParams: makeSearchParams() });
      render(page);
      expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /disconnect/i })).toBeInTheDocument();
      expect(screen.getByText('My Home Server')).toBeInTheDocument();
    });

    it('shows Expired and Reconnect when SFTP row is missing required fields', async () => {
      mockGetConnectedAccountsByUser.mockResolvedValue([
        {
          id: 'sftp-1',
          userId: 'user-123',
          platform: 'sftp',
          tokenExpiry: '2099-01-01T00:00:00.000Z',
          hasRefreshToken: false,
          hasYoutubeMainStreamKey: false,
          hasYoutubeTempStreamKey: false,
          platformUserId: 'backup-user',
          platformName: 'My Home Server',
          $createdAt: new Date().toISOString(),
          $updatedAt: new Date().toISOString(),
        },
      ]);
      const page = await ConnectionsPage({ searchParams: makeSearchParams() });
      render(page);
      expect(screen.getByText(/expired/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^reconnect$/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();
    });

    it('shows Expired and Reconnect when SFTP host key is not pinned', async () => {
      mockGetConnectedAccountsByUser.mockResolvedValue([
        {
          id: 'sftp-1',
          userId: 'user-123',
          platform: 'sftp',
          tokenExpiry: '2099-01-01T00:00:00.000Z',
          hasRefreshToken: false,
          hasYoutubeMainStreamKey: false,
          hasYoutubeTempStreamKey: false,
          platformUserId: 'backup-user',
          platformName: 'My Home Server',
          sftpHost: 'sftp.example.com',
          sftpPort: 22,
          sftpRemotePath: '/backups',
          sftpAuthMethod: 'password',
          $createdAt: new Date().toISOString(),
          $updatedAt: new Date().toISOString(),
        },
      ]);
      const page = await ConnectionsPage({ searchParams: makeSearchParams() });
      render(page);
      expect(screen.getByText(/expired/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^reconnect$/i })).toBeInTheDocument();
      expect(screen.queryByText(/^connected$/i)).not.toBeInTheDocument();
    });

    it('shows Expired and Reconnect when SFTP host key fingerprint format is invalid', async () => {
      mockGetConnectedAccountsByUser.mockResolvedValue([
        {
          id: 'sftp-1',
          userId: 'user-123',
          platform: 'sftp',
          tokenExpiry: '2099-01-01T00:00:00.000Z',
          hasRefreshToken: false,
          hasYoutubeMainStreamKey: false,
          hasYoutubeTempStreamKey: false,
          platformUserId: 'backup-user',
          platformName: 'My Home Server',
          sftpHost: 'sftp.example.com',
          sftpPort: 22,
          sftpRemotePath: '/backups',
          sftpAuthMethod: 'password',
          sftpHostKeyFingerprint: 'corrupted-fingerprint',
          $createdAt: new Date().toISOString(),
          $updatedAt: new Date().toISOString(),
        },
      ]);
      const page = await ConnectionsPage({ searchParams: makeSearchParams() });
      render(page);
      expect(screen.getByText(/expired/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^reconnect$/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();
    });

    it('prefills the reconnect modal when SFTP settings exist but host key is not pinned', async () => {
      const user = userEvent.setup();
      mockGetConnectedAccountsByUser.mockResolvedValue([
        {
          id: 'sftp-1',
          userId: 'user-123',
          platform: 'sftp',
          tokenExpiry: '2099-01-01T00:00:00.000Z',
          hasRefreshToken: false,
          hasYoutubeMainStreamKey: false,
          hasYoutubeTempStreamKey: false,
          platformUserId: 'backup-user',
          platformName: 'My Home Server',
          sftpHost: 'sftp.example.com',
          sftpPort: 22,
          sftpRemotePath: '/backups',
          sftpAuthMethod: 'password',
          $createdAt: new Date().toISOString(),
          $updatedAt: new Date().toISOString(),
        },
      ]);
      const page = await ConnectionsPage({ searchParams: makeSearchParams() });
      render(page);

      await user.click(screen.getByRole('button', { name: /^reconnect$/i }));

      expect(screen.getByLabelText(/^host$/i)).toHaveValue('sftp.example.com');
      expect(screen.getByLabelText(/^port$/i)).toHaveValue(22);
      expect(screen.getByLabelText(/^username$/i)).toHaveValue('backup-user');
      expect(screen.getByLabelText(/^remote path$/i)).toHaveValue('/backups');
      expect(screen.getByLabelText(/^label$/i)).toHaveValue('My Home Server');
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

    it('opens the Google Drive backup folder dialog after OAuth connect', async () => {
      mockGetConnectedAccountsByUser.mockResolvedValue([
        {
          id: 'drive-1',
          userId: 'user-123',
          platform: 'google_drive',
          tokenExpiry: new Date(Date.now() + 3600_000).toISOString(),
          hasRefreshToken: true,
          hasYoutubeMainStreamKey: false,
          hasYoutubeTempStreamKey: false,
          platformUserId: 'perm-1',
          platformName: 'My Drive',
          $createdAt: new Date().toISOString(),
          $updatedAt: new Date().toISOString(),
        },
      ]);
      const page = await ConnectionsPage({
        searchParams: makeSearchParams({ success: 'google_drive', setup: 'backup_folder' }),
      });
      render(page);
      expect(await screen.findByRole('dialog')).toBeInTheDocument();
      expect(await screen.findByText('Google Drive backup folder')).toBeInTheDocument();
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
