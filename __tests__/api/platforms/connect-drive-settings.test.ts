import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetAuthenticatedUserId = vi.fn();
const mockGetConnectedAccountWithTokens = vi.fn();
const mockRefreshTokenIfNeeded = vi.fn();
const mockResolveGoogleDriveBackupRootFolderId = vi.fn();
const mockUpdateGoogleDriveBackupFolder = vi.fn();

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: (...args: unknown[]) => mockGetAuthenticatedUserId(...args),
}));

vi.mock('@/lib/repositories/connected-accounts', () => ({
  getConnectedAccountWithTokens: (...args: unknown[]) => mockGetConnectedAccountWithTokens(...args),
  updateGoogleDriveBackupFolder: (...args: unknown[]) => mockUpdateGoogleDriveBackupFolder(...args),
}));

vi.mock('@/lib/platforms/token-refresh', () => ({
  refreshTokenIfNeeded: (...args: unknown[]) => mockRefreshTokenIfNeeded(...args),
}));

vi.mock('@/lib/platforms/google-drive', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/platforms/google-drive')>();
  return {
    ...actual,
    resolveGoogleDriveBackupRootFolderId: (...args: unknown[]) =>
      mockResolveGoogleDriveBackupRootFolderId(...args),
  };
});

import { POST } from '@/app/api/platforms/connect/drive/settings/route';

const DRIVE_ACCOUNT = {
  id: 'acc-drive-1',
  userId: 'user-123',
  platform: 'google_drive' as const,
  accessToken: 'expired-access-token',
  refreshToken: 'stored-refresh-token',
  tokenExpiry: new Date(Date.now() - 60_000).toISOString(),
  platformUserId: 'perm-1',
  platformName: 'My Drive',
  $createdAt: '2026-01-01T00:00:00.000Z',
  $updatedAt: '2026-01-01T00:00:00.000Z',
};

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/platforms/connect/drive/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/platforms/connect/drive/settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthenticatedUserId.mockResolvedValue('user-123');
    mockGetConnectedAccountWithTokens.mockResolvedValue(DRIVE_ACCOUNT);
    mockRefreshTokenIfNeeded.mockResolvedValue({
      accessToken: 'fresh-access-token',
      refreshToken: 'stored-refresh-token',
      tokenExpiry: new Date(Date.now() + 3600_000).toISOString(),
    });
    mockResolveGoogleDriveBackupRootFolderId.mockResolvedValue('backup-root-folder');
    mockUpdateGoogleDriveBackupFolder.mockResolvedValue({
      ...DRIVE_ACCOUNT,
      googleDriveBackupFolderPath: 'Backups',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns 401 when token refresh fails before resolving the backup folder', async () => {
    mockRefreshTokenIfNeeded.mockRejectedValueOnce(
      new Error('GOOGLE_DRIVE_TOKEN_REFRESH_FAILED: invalid_grant')
    );

    const res = await POST(makeRequest({ backupFolderPath: 'Backups' }));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.statusCode).toBe(401);
    expect(body.message).toContain('invalid_grant');
    expect(mockResolveGoogleDriveBackupRootFolderId).not.toHaveBeenCalled();
    expect(mockUpdateGoogleDriveBackupFolder).not.toHaveBeenCalled();
  });

  it('refreshes tokens and uses the fresh access token to resolve the backup folder', async () => {
    const res = await POST(makeRequest({ backupFolderPath: 'Backups' }));

    expect(res.status).toBe(200);
    expect(mockRefreshTokenIfNeeded).toHaveBeenCalledWith(DRIVE_ACCOUNT);
    expect(mockResolveGoogleDriveBackupRootFolderId).toHaveBeenCalledWith(
      'Backups',
      'fresh-access-token'
    );
    expect(mockUpdateGoogleDriveBackupFolder).toHaveBeenCalled();
  });

  it('skips token refresh when clearing the backup folder to Drive root', async () => {
    const res = await POST(makeRequest({ backupFolderPath: '' }));

    expect(res.status).toBe(200);
    expect(mockRefreshTokenIfNeeded).not.toHaveBeenCalled();
    expect(mockResolveGoogleDriveBackupRootFolderId).not.toHaveBeenCalled();
    expect(mockUpdateGoogleDriveBackupFolder).toHaveBeenCalledWith(
      DRIVE_ACCOUNT.id,
      '',
      expect.any(String)
    );
  });
});
