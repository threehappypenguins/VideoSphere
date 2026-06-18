import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PassThrough } from 'node:stream';

const mocks = vi.hoisted(() => ({
  mockReadDirectory: vi.fn(),
  mockCreateDirectory: vi.fn(),
  mockCreateFileWriteStream: vi.fn(),
  mockAuthenticate: vi.fn(),
  mockConnectTree: vi.fn(),
  mockClose: vi.fn(),
  MockClient: vi.fn(),
}));

vi.mock('node-smb2', () => {
  class MockClient {
    host: string;

    constructor(host: string) {
      this.host = host;
      mocks.MockClient(host);
    }

    on = vi.fn();
    authenticate = mocks.mockAuthenticate;
    close = mocks.mockClose;
  }

  return { Client: MockClient };
});

import {
  isValidSmbRemotePath,
  isValidSmbUploadPathSegment,
  resolveSmbAuthDomain,
  SMB_DEFAULT_DOMAIN,
  testSmbConnection,
  toSmbClientDirectoryPath,
  uploadToSmb,
} from '@/lib/platforms/smb';
import type { ConnectedAccount } from '@/types';

function makeVideoStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  });
}

function makeSmbAccount(overrides: Partial<ConnectedAccount> = {}): ConnectedAccount {
  return {
    id: 'ca-smb-1',
    userId: 'user-1',
    platform: 'smb',
    hasRefreshToken: false,
    platformName: 'My NAS',
    platformUserId: 'backup-user',
    accessToken: 'secret-password',
    refreshToken: '',
    tokenExpiry: '2099-01-01T00:00:00.000Z',
    smbHost: '192.168.1.10',
    smbShare: 'storage',
    smbRemotePath: '/VideoSphere',
    $createdAt: new Date().toISOString(),
    $updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeMockWriteStream(): PassThrough {
  const stream = new PassThrough();
  stream.on('finish', () => {
    stream.emit('close');
  });
  return stream;
}

function setupSuccessfulSmbMocks() {
  mocks.mockReadDirectory.mockResolvedValue([]);
  mocks.mockCreateFileWriteStream.mockImplementation(async () => makeMockWriteStream());
  mocks.mockClose.mockResolvedValue(undefined);
  mocks.mockConnectTree.mockResolvedValue({
    readDirectory: mocks.mockReadDirectory,
    createDirectory: mocks.mockCreateDirectory,
    createFileWriteStream: mocks.mockCreateFileWriteStream,
  });
  mocks.mockCreateDirectory.mockResolvedValue(undefined);
  mocks.mockAuthenticate.mockResolvedValue({
    connectTree: mocks.mockConnectTree,
  });
}

describe('isValidSmbRemotePath', () => {
  it('accepts share root paths', () => {
    expect(isValidSmbRemotePath('')).toBe(true);
    expect(isValidSmbRemotePath('/')).toBe(true);
    expect(isValidSmbRemotePath('\\')).toBe(true);
  });

  it('rejects relative paths and traversal segments', () => {
    expect(isValidSmbRemotePath('VideoSphere')).toBe(false);
    expect(isValidSmbRemotePath('/backups/../etc')).toBe(false);
    expect(isValidSmbRemotePath('\\backups\\..\\etc')).toBe(false);
  });
});

describe('isValidSmbUploadPathSegment', () => {
  it('accepts normal backup filenames and year folders', () => {
    expect(isValidSmbUploadPathSegment('20260415 - My Backup.mp4')).toBe(true);
    expect(isValidSmbUploadPathSegment('2026')).toBe(true);
  });

  it('rejects traversal and absolute path segments', () => {
    expect(isValidSmbUploadPathSegment('../secret.mp4')).toBe(false);
    expect(isValidSmbUploadPathSegment('/etc/passwd')).toBe(false);
    expect(isValidSmbUploadPathSegment('..')).toBe(false);
    expect(isValidSmbUploadPathSegment('2026/../other')).toBe(false);
  });
});

describe('resolveSmbAuthDomain', () => {
  it('defaults to WORKGROUP when domain is omitted', () => {
    expect(resolveSmbAuthDomain({})).toBe(SMB_DEFAULT_DOMAIN);
    expect(resolveSmbAuthDomain({ domain: '' })).toBe(SMB_DEFAULT_DOMAIN);
  });

  it('uses an explicit domain when provided', () => {
    expect(resolveSmbAuthDomain({ domain: 'CORP' })).toBe('CORP');
  });
});

describe('toSmbClientDirectoryPath', () => {
  it('maps paths to POSIX paths within the share', () => {
    expect(toSmbClientDirectoryPath('/VideoSphere')).toBe('/VideoSphere');
    expect(toSmbClientDirectoryPath('/')).toBe('/');
    expect(toSmbClientDirectoryPath('')).toBe('/');
  });
});

describe('testSmbConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupSuccessfulSmbMocks();
  });

  it('returns ok when the remote directory exists', async () => {
    const result = await testSmbConnection({
      host: '192.168.1.10',
      share: 'storage',
      username: 'user',
      password: 'pass',
      remotePath: '/VideoSphere',
    });

    expect(result).toEqual({ ok: true });
    expect(mocks.mockReadDirectory).toHaveBeenCalledWith('/VideoSphere');
    expect(mocks.mockAuthenticate).toHaveBeenCalledWith({
      domain: 'WORKGROUP',
      username: 'user',
      password: 'pass',
      forceNtlmVersion: 'v2',
    });
    expect(mocks.mockConnectTree).toHaveBeenCalledWith('storage');
    expect(mocks.mockClose).toHaveBeenCalled();
  });

  it('lists the share root when remote path is /', async () => {
    const result = await testSmbConnection({
      host: '192.168.1.10',
      share: 'storage',
      username: 'user',
      password: 'pass',
      remotePath: '/',
    });

    expect(result).toEqual({ ok: true });
    expect(mocks.mockReadDirectory).toHaveBeenCalledWith('/');
  });

  it('classifies node-smb2 Response rejections (logon failure)', async () => {
    mocks.mockAuthenticate.mockRejectedValueOnce({
      header: { status: 0xc000006d },
      typeName: 'SessionSetup',
    });

    const result = await testSmbConnection({
      host: '192.168.1.10',
      share: 'storage',
      username: 'user',
      password: 'wrong',
      remotePath: '/',
    });

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: 'SMB_AUTH_FAILED',
        details: 'SessionSetup: STATUS_LOGON_FAILURE',
      }),
    });
  });

  it('classifies STATUS_ACCESS_DENIED as share permission failure, not credential failure', async () => {
    mocks.mockReadDirectory.mockRejectedValueOnce({
      header: { status: 0xc0000022 },
      typeName: 'Create',
    });

    const result = await testSmbConnection({
      host: '192.168.1.10',
      share: 'storage',
      username: 'user',
      password: 'pass',
      remotePath: '/',
    });

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: 'SMB_AUTH_FAILED',
        message: 'SMB access denied. The account may lack permission for this share.',
        details: 'Create: STATUS_ACCESS_DENIED',
      }),
    });
  });

  it('classifies missing share errors from Response rejections', async () => {
    mocks.mockConnectTree.mockRejectedValueOnce({
      header: { status: 0xc00000cc },
      typeName: 'TreeConnect',
    });

    const result = await testSmbConnection({
      host: '192.168.1.10',
      share: 'Missing',
      username: 'user',
      password: 'pass',
      remotePath: '/',
    });

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'SMB_SHARE_NOT_FOUND' }),
    });
  });

  it('classifies invalid remote directory paths', async () => {
    mocks.mockReadDirectory.mockRejectedValueOnce(new Error('The object name was not found'));

    const result = await testSmbConnection({
      host: '192.168.1.10',
      share: 'storage',
      username: 'user',
      password: 'pass',
      remotePath: '/missing',
    });

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'SMB_REMOTE_PATH_INVALID' }),
    });
  });
});

describe('uploadToSmb', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupSuccessfulSmbMocks();
  });

  it('uploads successfully with password auth', async () => {
    const result = await uploadToSmb({
      connectedAccount: makeSmbAccount(),
      videoStream: makeVideoStream(),
      contentType: 'video/mp4',
      fileName: 'My Backup.mp4',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.platformVideoId).toBe('/VideoSphere/My Backup.mp4');
      expect(result.platformUrl).toMatch(/^smb:\/\/192\.168\.1\.10\/storage\/VideoSphere\//);
    }

    expect(mocks.MockClient).toHaveBeenCalledWith('192.168.1.10');
    expect(mocks.mockCreateFileWriteStream).toHaveBeenCalledWith('/VideoSphere/My Backup.mp4');
  });

  it('uploads into a year subfolder when yearFolderName is provided', async () => {
    const result = await uploadToSmb({
      connectedAccount: makeSmbAccount(),
      videoStream: makeVideoStream(),
      contentType: 'video/mp4',
      fileName: '20260415 - My Backup.mp4',
      yearFolderName: '2026',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.platformVideoId).toBe('/VideoSphere/2026/20260415 - My Backup.mp4');
    }
    expect(mocks.mockCreateFileWriteStream).toHaveBeenCalledWith(
      '/VideoSphere/2026/20260415 - My Backup.mp4'
    );
  });

  it('creates the year subfolder when it does not exist yet', async () => {
    mocks.mockReadDirectory.mockImplementation(async (directoryPath?: string) => {
      if (directoryPath === '/VideoSphere/2026') {
        throw Object.assign(new Error('not found'), { header: { status: 0xc0000034 } });
      }
      return [];
    });

    await uploadToSmb({
      connectedAccount: makeSmbAccount(),
      videoStream: makeVideoStream(),
      fileName: '20260415 - My Backup.mp4',
      yearFolderName: '2026',
    });

    expect(mocks.mockCreateDirectory).toHaveBeenCalledWith('/VideoSphere/2026');
  });

  it('rejects upload when fileName would escape the remote directory', async () => {
    const result = await uploadToSmb({
      connectedAccount: makeSmbAccount(),
      videoStream: makeVideoStream(),
      fileName: '../outside.mp4',
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'SMB_UPLOAD_PATH_INVALID', statusCode: 400 },
    });
    expect(mocks.MockClient).not.toHaveBeenCalled();
  });

  it('rejects upload when yearFolderName would escape the remote directory', async () => {
    const result = await uploadToSmb({
      connectedAccount: makeSmbAccount(),
      videoStream: makeVideoStream(),
      fileName: 'backup.mp4',
      yearFolderName: '../other',
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'SMB_UPLOAD_PATH_INVALID', statusCode: 400 },
    });
    expect(mocks.MockClient).not.toHaveBeenCalled();
  });

  it('writes to the share root when remote path is /', async () => {
    const result = await uploadToSmb({
      connectedAccount: makeSmbAccount({ smbRemotePath: '/' }),
      videoStream: makeVideoStream(),
      fileName: 'Root Backup.mp4',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.platformVideoId).toBe('/Root Backup.mp4');
    }
    expect(mocks.mockCreateFileWriteStream).toHaveBeenCalledWith('/Root Backup.mp4');
  });

  it('rejects upload when connection settings are incomplete', async () => {
    const result = await uploadToSmb({
      connectedAccount: makeSmbAccount({ smbShare: undefined }),
      videoStream: makeVideoStream(),
      fileName: 'My Backup.mp4',
    });

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'SMB_CONFIG_INVALID' }),
    });
  });

  it('rejects upload when smbRemotePath is missing on the account', async () => {
    const result = await uploadToSmb({
      connectedAccount: makeSmbAccount({ smbRemotePath: undefined }),
      videoStream: makeVideoStream(),
      fileName: 'My Backup.mp4',
    });

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'SMB_CONFIG_INVALID' }),
    });
    expect(mocks.mockAuthenticate).not.toHaveBeenCalled();
  });

  it('classifies write failures', async () => {
    mocks.mockCreateFileWriteStream.mockRejectedValueOnce(new Error('write failed hard'));

    const result = await uploadToSmb({
      connectedAccount: makeSmbAccount(),
      videoStream: makeVideoStream(),
      fileName: 'My Backup.mp4',
    });

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'SMB_WRITE_FAILED' }),
    });
  });
});
