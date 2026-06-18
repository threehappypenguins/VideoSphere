import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isValidGoogleDriveBackupFolderPath,
  normalizeGoogleDriveBackupFolderPath,
  parseGoogleDrivePlatformUserId,
  serializeGoogleDrivePlatformUserId,
  uploadToGoogleDrive,
} from '@/lib/platforms/google-drive';
import type { ConnectedAccount } from '@/types';

function makeVideoStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  });
}

function makeConnectedAccount(platformUserId: string): ConnectedAccount {
  return {
    id: 'ca-drive-1',
    userId: 'user-1',
    platform: 'google_drive',
    hasRefreshToken: true,
    platformName: 'google_drive',
    platformUserId,
    accessToken: 'encrypted-access',
    refreshToken: 'encrypted-refresh',
    tokenExpiry: new Date(Date.now() + 3600_000).toISOString(),
    $createdAt: new Date().toISOString(),
    $updatedAt: new Date().toISOString(),
  };
}

describe('google-drive backup folder path helpers', () => {
  it('accepts empty paths as Drive root', () => {
    expect(isValidGoogleDriveBackupFolderPath('')).toBe(true);
    expect(isValidGoogleDriveBackupFolderPath('/')).toBe(true);
    expect(normalizeGoogleDriveBackupFolderPath('/')).toBe('');
  });

  it('rejects traversal segments', () => {
    expect(isValidGoogleDriveBackupFolderPath('Backups/../Secret')).toBe(false);
  });

  it('normalizes folder paths for storage', () => {
    expect(normalizeGoogleDriveBackupFolderPath('/Backups/Videos/')).toBe('Backups/Videos');
  });
});

describe('google-drive account metadata helpers', () => {
  it('parses legacy plain permission ids', () => {
    expect(parseGoogleDrivePlatformUserId('perm-123')).toEqual({ permissionId: 'perm-123' });
  });

  it('parses serialized permission and root folder ids', () => {
    expect(
      parseGoogleDrivePlatformUserId('{"permissionId":"perm-123","rootFolderId":"folder-root-1"}')
    ).toEqual({
      permissionId: 'perm-123',
      rootFolderId: 'folder-root-1',
    });
  });

  it('serializes without folder id as the plain permission id', () => {
    expect(serializeGoogleDrivePlatformUserId('perm-123')).toBe('perm-123');
  });

  it('serializes with folder id as JSON metadata', () => {
    expect(serializeGoogleDrivePlatformUserId('perm-123', 'folder-root-1')).toBe(
      '{"permissionId":"perm-123","rootFolderId":"folder-root-1"}'
    );
  });
});

describe('uploadToGoogleDrive', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('uploads to Drive root when no year folder is configured', async () => {
    const fetchMock = vi.mocked(global.fetch as unknown as (...args: any[]) => any);
    const uploadUrl = 'https://upload.drive.test/session/abc';

    fetchMock.mockImplementation((url: unknown, options?: any) => {
      const sUrl = String(url);
      const method = options?.method;

      if (method === 'POST' && sUrl.includes('/upload/drive/v3/files?uploadType=resumable')) {
        const body = JSON.parse(String(options?.body ?? '{}')) as { parents?: string[] };
        expect(body.parents).toBeUndefined();
        return Promise.resolve(
          new Response(null, { status: 200, headers: { location: uploadUrl } })
        );
      }

      if (method === 'PUT' && sUrl === uploadUrl) {
        return Promise.resolve(new Response(JSON.stringify({ id: 'file-1' }), { status: 200 }));
      }

      return Promise.resolve(new Response('', { status: 200 }));
    });

    await uploadToGoogleDrive({
      connectedAccount: makeConnectedAccount('perm-1'),
      videoStream: makeVideoStream(),
      contentLength: 3,
      contentType: 'video/mp4',
      fileName: 'Backup title.mp4',
      tokens: {
        accessToken: 'drive-access-token',
      },
    });
  });

  it('uploads into a configured backup root folder when rootFolderId is stored', async () => {
    const fetchMock = vi.mocked(global.fetch as unknown as (...args: any[]) => any);
    const uploadUrl = 'https://upload.drive.test/session/abc';
    const backupRootId = 'backup-root-folder';

    fetchMock.mockImplementation((url: unknown, options?: any) => {
      const sUrl = String(url);
      const method = options?.method;

      if ((!method || method === 'GET') && sUrl.includes('/drive/v3/files/backup-root-folder')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: backupRootId,
              mimeType: 'application/vnd.google-apps.folder',
              trashed: false,
            }),
            { status: 200 }
          )
        );
      }

      if (method === 'POST' && sUrl.includes('/upload/drive/v3/files?uploadType=resumable')) {
        const body = JSON.parse(String(options?.body ?? '{}')) as { parents?: string[] };
        expect(body.parents).toEqual([backupRootId]);
        return Promise.resolve(
          new Response(null, { status: 200, headers: { location: uploadUrl } })
        );
      }

      if (method === 'PUT' && sUrl === uploadUrl) {
        return Promise.resolve(new Response(JSON.stringify({ id: 'file-1' }), { status: 200 }));
      }

      return Promise.resolve(new Response('', { status: 200 }));
    });

    await uploadToGoogleDrive({
      connectedAccount: {
        ...makeConnectedAccount('{"permissionId":"perm-1","rootFolderId":"backup-root-folder"}'),
        googleDriveBackupFolderPath: 'Backups',
      },
      videoStream: makeVideoStream(),
      contentLength: 3,
      contentType: 'video/mp4',
      fileName: 'Backup title.mp4',
      tokens: {
        accessToken: 'drive-access-token',
      },
    });
  });

  it('uploads into a year folder at Drive root when yearFolderName is set', async () => {
    const fetchMock = vi.mocked(global.fetch as unknown as (...args: any[]) => any);
    const uploadUrl = 'https://upload.drive.test/session/abc';
    const currentYear = String(new Date().getUTCFullYear());
    const yearFolderId = `drive-year-${currentYear}`;

    fetchMock.mockImplementation((url: unknown, options?: any) => {
      const sUrl = String(url);
      const method = options?.method;

      if ((!method || method === 'GET') && sUrl.includes('/drive/v3/files?')) {
        return Promise.resolve(
          new Response(JSON.stringify({ files: [{ id: yearFolderId }] }), { status: 200 })
        );
      }

      if (method === 'POST' && sUrl.includes('/upload/drive/v3/files?uploadType=resumable')) {
        const body = JSON.parse(String(options?.body ?? '{}')) as { parents?: string[] };
        expect(body.parents).toEqual([yearFolderId]);
        return Promise.resolve(
          new Response(null, { status: 200, headers: { location: uploadUrl } })
        );
      }

      if (method === 'PUT' && sUrl === uploadUrl) {
        return Promise.resolve(new Response(JSON.stringify({ id: 'file-1' }), { status: 200 }));
      }

      return Promise.resolve(new Response('', { status: 200 }));
    });

    await uploadToGoogleDrive({
      connectedAccount: makeConnectedAccount('perm-1'),
      videoStream: makeVideoStream(),
      contentLength: 3,
      contentType: 'video/mp4',
      fileName: 'Backup title.mp4',
      yearFolderName: currentYear,
      tokens: {
        accessToken: 'drive-access-token',
        refreshToken: 'drive-refresh-token',
      },
    });

    const putCall = fetchMock.mock.calls.find(([url, options]) => {
      return String(url) === uploadUrl && options?.method === 'PUT';
    });

    expect(putCall).toBeDefined();
    expect(putCall?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer drive-access-token',
        }),
      })
    );
  });

  it('preserves upstream Drive status code from helper API failures', async () => {
    const fetchMock = vi.mocked(global.fetch as unknown as (...args: any[]) => any);

    fetchMock.mockImplementation((url: unknown, options?: any) => {
      const sUrl = String(url);
      const method = options?.method;

      if (method === 'POST' && sUrl.includes('/upload/drive/v3/files?uploadType=resumable')) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: { message: 'Forbidden' } }), { status: 403 })
        );
      }

      return Promise.resolve(new Response('', { status: 200 }));
    });

    const result = await uploadToGoogleDrive({
      connectedAccount: makeConnectedAccount('perm-1'),
      videoStream: makeVideoStream(),
      contentLength: 3,
      contentType: 'video/mp4',
      fileName: 'Backup title.mp4',
      tokens: {
        accessToken: 'drive-access-token',
      },
    });

    expect(result.ok).toBe(false);
    if (!('error' in result)) {
      throw new Error('Expected uploadToGoogleDrive to fail for a 403 Drive API response.');
    }

    expect(result.error.code).toBe('GOOGLE_DRIVE_RESUMABLE_INIT_FAILED');
    expect(result.error.statusCode).toBe(403);
    expect((result.error.details ?? '').toLowerCase()).toContain('forbidden');
  });
});
