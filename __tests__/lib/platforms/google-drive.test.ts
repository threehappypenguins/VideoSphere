import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
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
    // Freeze time at 2026-04-15 so the year folder ID remains predictable
    vi.setSystemTime(new Date('2026-04-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('includes Authorization header on resumable upload PUT request', async () => {
    const fetchMock = vi.mocked(global.fetch as unknown as (...args: any[]) => any);
    const uploadUrl = 'https://upload.drive.test/session/abc';
    const currentYear = String(new Date().getUTCFullYear());
    const yearFolderId = `drive-year-${currentYear}`;

    fetchMock.mockImplementation((url: unknown, options?: any) => {
      const sUrl = String(url);
      const method = options?.method;

      if ((!method || method === 'GET') && sUrl.includes('/drive/v3/files/drive-root-1')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'drive-root-1',
              mimeType: 'application/vnd.google-apps.folder',
              trashed: false,
            }),
            { status: 200 }
          )
        );
      }

      if ((!method || method === 'GET') && sUrl.includes('/drive/v3/files?')) {
        return Promise.resolve(
          new Response(JSON.stringify({ files: [{ id: yearFolderId }] }), { status: 200 })
        );
      }

      if (method === 'POST' && sUrl.includes('/upload/drive/v3/files?uploadType=resumable')) {
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
      connectedAccount: makeConnectedAccount(
        '{"permissionId":"perm-1","rootFolderId":"drive-root-1"}'
      ),
      videoStream: makeVideoStream(),
      contentLength: 3,
      contentType: 'video/mp4',
      metadata: { title: 'Backup title' },
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
});
