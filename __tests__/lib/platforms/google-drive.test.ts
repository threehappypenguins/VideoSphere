import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isValidGoogleDriveBackupFolderPath,
  normalizeGoogleDriveBackupFolderPath,
  parseGoogleDrivePlatformUserId,
  probeGoogleDriveResumableSession,
  serializeGoogleDrivePlatformUserId,
  uploadToGoogleDrive,
} from '@/lib/platforms/google-drive';
import type { ConnectedAccount } from '@/types';

function makeVideoStreamOfLength(totalBytes: number): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(totalBytes).fill(7));
      controller.close();
    },
  });
}

function makeVideoStream(): ReadableStream<Uint8Array> {
  return makeVideoStreamOfLength(3);
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
        const headers = options?.headers ?? {};
        if (headers['Content-Range'] === 'bytes 0-2/3') {
          return Promise.resolve(new Response(JSON.stringify({ id: 'file-1' }), { status: 200 }));
        }
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
        const headers = options?.headers ?? {};
        if (headers['Content-Range'] === 'bytes 0-2/3') {
          return Promise.resolve(new Response(JSON.stringify({ id: 'file-1' }), { status: 200 }));
        }
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
        const headers = options?.headers ?? {};
        if (headers['Content-Range'] === 'bytes 0-2/3') {
          return Promise.resolve(new Response(JSON.stringify({ id: 'file-1' }), { status: 200 }));
        }
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
      return (
        String(url) === uploadUrl &&
        options?.method === 'PUT' &&
        options?.headers?.['Content-Range'] === 'bytes 0-2/3'
      );
    });

    expect(putCall).toBeDefined();
    expect(putCall?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer drive-access-token',
          'Content-Range': 'bytes 0-2/3',
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

describe('uploadToGoogleDrive resumable session reuse', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('resumes from a probed byte offset without creating a new session', async () => {
    const fetchMock = vi.mocked(global.fetch as unknown as (...args: unknown[]) => unknown);
    const storedSession = 'https://upload.drive.test/session/stored';
    const persistResumableState = vi.fn().mockResolvedValue(undefined);
    const clearResumableState = vi.fn().mockResolvedValue(undefined);
    let initPostCount = 0;

    fetchMock.mockImplementation(
      (url: unknown, options?: { method?: string; headers?: Record<string, string> }) => {
        const sUrl = String(url);
        const method = options?.method;
        const headers = options?.headers ?? {};

        if (method === 'POST' && sUrl.includes('/upload/drive/v3/files?uploadType=resumable')) {
          initPostCount += 1;
          return Promise.resolve(
            new Response(null, {
              status: 200,
              headers: { location: 'https://upload.drive.test/session/new' },
            })
          );
        }

        if (
          method === 'PUT' &&
          sUrl === storedSession &&
          headers['Content-Range'] === 'bytes */512'
        ) {
          return Promise.resolve(
            new Response(null, { status: 308, headers: { Range: 'bytes 0-255' } })
          );
        }

        if (
          method === 'PUT' &&
          sUrl === storedSession &&
          headers['Content-Range'] === 'bytes 256-511/512'
        ) {
          return Promise.resolve(
            new Response(JSON.stringify({ id: 'resumed-file-id' }), { status: 200 })
          );
        }

        return Promise.resolve(new Response('', { status: 200 }));
      }
    );

    const result = await uploadToGoogleDrive({
      connectedAccount: makeConnectedAccount('perm-1'),
      videoStream: makeVideoStreamOfLength(512),
      contentLength: 512,
      contentType: 'video/mp4',
      fileName: 'Backup title.mp4',
      tokens: { accessToken: 'drive-access-token' },
      resumableState: {
        resumableUploadUrl: storedSession,
        resumableBytesConfirmed: 128,
        resumableUpdatedAt: '2026-06-20T10:00:00.000Z',
      },
      persistResumableState,
      clearResumableState,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.platformVideoId).toBe('resumed-file-id');
    }
    expect(initPostCount).toBe(0);
    expect(persistResumableState).toHaveBeenCalledWith(
      expect.objectContaining({
        resumableUploadUrl: storedSession,
        resumableBytesConfirmed: 512,
      })
    );
    expect(clearResumableState).toHaveBeenCalledTimes(1);
  });

  it('discards an invalid stored session, clears it, and starts a fresh upload', async () => {
    const fetchMock = vi.mocked(global.fetch as unknown as (...args: unknown[]) => unknown);
    const storedSession = 'https://upload.drive.test/session/expired';
    const freshSession = 'https://upload.drive.test/session/fresh';
    const persistResumableState = vi.fn().mockResolvedValue(undefined);
    const clearResumableState = vi.fn().mockResolvedValue(undefined);

    fetchMock.mockImplementation(
      (url: unknown, options?: { method?: string; headers?: Record<string, string> }) => {
        const sUrl = String(url);
        const method = options?.method;
        const headers = options?.headers ?? {};

        if (
          method === 'PUT' &&
          sUrl === storedSession &&
          headers['Content-Range'] === 'bytes */512'
        ) {
          return Promise.resolve(new Response('', { status: 404 }));
        }

        if (method === 'POST' && sUrl.includes('/upload/drive/v3/files?uploadType=resumable')) {
          return Promise.resolve(
            new Response(null, { status: 200, headers: { location: freshSession } })
          );
        }

        if (
          method === 'PUT' &&
          sUrl === freshSession &&
          headers['Content-Range'] === 'bytes 0-511/512'
        ) {
          return Promise.resolve(
            new Response(JSON.stringify({ id: 'fresh-file-id' }), { status: 200 })
          );
        }

        return Promise.resolve(new Response('', { status: 200 }));
      }
    );

    const result = await uploadToGoogleDrive({
      connectedAccount: makeConnectedAccount('perm-1'),
      videoStream: makeVideoStreamOfLength(512),
      contentLength: 512,
      contentType: 'video/mp4',
      fileName: 'Backup title.mp4',
      tokens: { accessToken: 'drive-access-token' },
      resumableState: {
        resumableUploadUrl: storedSession,
        resumableBytesConfirmed: 256,
        resumableUpdatedAt: '2026-06-20T10:00:00.000Z',
      },
      persistResumableState,
      clearResumableState,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.platformVideoId).toBe('fresh-file-id');
    }
    expect(clearResumableState).toHaveBeenCalledTimes(2);
    expect(persistResumableState).toHaveBeenCalledWith(
      expect.objectContaining({
        resumableUploadUrl: freshSession,
        resumableBytesConfirmed: 0,
      })
    );
  });

  it('clears resumable fields after a successful upload from a new session', async () => {
    const fetchMock = vi.mocked(global.fetch as unknown as (...args: unknown[]) => unknown);
    const sessionUrl = 'https://upload.drive.test/session/new-success';
    const clearResumableState = vi.fn().mockResolvedValue(undefined);
    const persistResumableState = vi.fn().mockResolvedValue(undefined);

    fetchMock.mockImplementation(
      (url: unknown, options?: { method?: string; headers?: Record<string, string> }) => {
        const sUrl = String(url);
        const method = options?.method;
        const headers = options?.headers ?? {};

        if (method === 'POST' && sUrl.includes('/upload/drive/v3/files?uploadType=resumable')) {
          return Promise.resolve(
            new Response(null, { status: 200, headers: { location: sessionUrl } })
          );
        }

        if (
          method === 'PUT' &&
          sUrl === sessionUrl &&
          headers['Content-Range'] === 'bytes 0-511/512'
        ) {
          return Promise.resolve(
            new Response(JSON.stringify({ id: 'success-file-id' }), { status: 200 })
          );
        }

        return Promise.resolve(new Response('', { status: 200 }));
      }
    );

    const result = await uploadToGoogleDrive({
      connectedAccount: makeConnectedAccount('perm-1'),
      videoStream: makeVideoStreamOfLength(512),
      contentLength: 512,
      contentType: 'video/mp4',
      fileName: 'Backup title.mp4',
      tokens: { accessToken: 'drive-access-token' },
      persistResumableState,
      clearResumableState,
    });

    expect(result.ok).toBe(true);
    expect(persistResumableState).toHaveBeenCalledWith(
      expect.objectContaining({
        resumableUploadUrl: sessionUrl,
        resumableBytesConfirmed: 0,
      })
    );
    expect(clearResumableState).toHaveBeenCalledTimes(1);
  });
});

describe('probeGoogleDriveResumableSession', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns resume offset from a 308 Range response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 308, headers: { Range: 'bytes 0-255' } }))
    );

    await expect(
      probeGoogleDriveResumableSession({
        sessionUrl: 'https://upload.drive.test/session/probe',
        accessToken: 'tok',
        totalBytes: 512,
        contentType: 'video/mp4',
      })
    ).resolves.toEqual({ status: 'resume', bytesConfirmed: 256 });
  });

  it('returns invalid for expired sessions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 410 }))
    );

    await expect(
      probeGoogleDriveResumableSession({
        sessionUrl: 'https://upload.drive.test/session/gone',
        accessToken: 'tok',
        totalBytes: 512,
        contentType: 'video/mp4',
      })
    ).resolves.toEqual({ status: 'invalid' });
  });
});
