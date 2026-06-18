import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mockConnect: vi.fn(),
  mockEnd: vi.fn(),
  mockSftp: vi.fn(),
  mockCreateWriteStream: vi.fn(),
  mockStat: vi.fn(),
  mockMkdir: vi.fn(),
}));

vi.mock('ssh2', () => {
  const { EventEmitter } = require('node:events');
  class MockClient extends EventEmitter {
    connect = mocks.mockConnect;
    end = mocks.mockEnd;
    sftp = mocks.mockSftp;
  }
  return { Client: MockClient };
});

import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import {
  testSftpConnection,
  uploadToSftp,
  isValidSftpUploadPathSegment,
} from '@/lib/platforms/sftp';
import type { ConnectedAccount } from '@/types';

const TEST_HOST_KEY_FINGERPRINT = 'a'.repeat(64);

describe('isValidSftpUploadPathSegment', () => {
  it('accepts normal backup filenames and year folders', () => {
    expect(isValidSftpUploadPathSegment('20260415 - My Backup.mp4')).toBe(true);
    expect(isValidSftpUploadPathSegment('2026')).toBe(true);
  });

  it('rejects traversal and absolute path segments', () => {
    expect(isValidSftpUploadPathSegment('../secret.mp4')).toBe(false);
    expect(isValidSftpUploadPathSegment('/etc/passwd')).toBe(false);
    expect(isValidSftpUploadPathSegment('..')).toBe(false);
    expect(isValidSftpUploadPathSegment('2026/../other')).toBe(false);
    expect(isValidSftpUploadPathSegment('nested/dir.mp4')).toBe(false);
  });
});

function runMockHostVerifier(
  client: InstanceType<typeof EventEmitter>,
  config: { hostVerifier?: (key: string, verify: (accepted: boolean) => void) => boolean | void }
): void {
  const verifier = config.hostVerifier;
  if (!verifier) {
    queueMicrotask(() => client.emit('ready'));
    return;
  }

  const finish = (accepted: boolean) => {
    queueMicrotask(() => {
      if (accepted) client.emit('ready');
      else client.emit('error', new Error('Host denied (verification failed)'));
    });
  };

  const result = verifier(TEST_HOST_KEY_FINGERPRINT, finish);
  if (result === false) {
    finish(false);
  } else if (result === true) {
    finish(true);
  }
}

function makeVideoStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  });
}

function makeSftpAccount(overrides: Partial<ConnectedAccount> = {}): ConnectedAccount {
  return {
    id: 'ca-sftp-1',
    userId: 'user-1',
    platform: 'sftp',
    hasRefreshToken: false,
    platformName: 'My Home Server',
    platformUserId: 'backup-user',
    accessToken: 'secret-password',
    refreshToken: '',
    tokenExpiry: '2099-01-01T00:00:00.000Z',
    sftpHost: 'sftp.example.com',
    sftpPort: 22,
    sftpRemotePath: '/backups',
    sftpAuthMethod: 'password',
    sftpHostKeyFingerprint: TEST_HOST_KEY_FINGERPRINT,
    $createdAt: new Date().toISOString(),
    $updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function setupSuccessfulSftpMocks() {
  mocks.mockConnect.mockImplementation(function connect(
    this: InstanceType<typeof EventEmitter>,
    config: { hostVerifier?: (key: string, verify: (accepted: boolean) => void) => boolean | void }
  ) {
    runMockHostVerifier(this, config);
  });

  mocks.mockSftp.mockImplementation((callback: (err: Error | null, sftp: unknown) => void) => {
    callback(null, {
      stat: mocks.mockStat,
      mkdir: mocks.mockMkdir,
      createWriteStream: mocks.mockCreateWriteStream,
    });
  });

  mocks.mockStat.mockImplementation(
    (
      _path: string,
      callback: (err: Error | null, stats: { isDirectory: () => boolean }) => void
    ) => {
      callback(null, { isDirectory: () => true });
    }
  );

  mocks.mockMkdir.mockImplementation(
    (_path: string, _options: unknown, callback: (err: Error | null) => void) => {
      callback(null);
    }
  );

  mocks.mockCreateWriteStream.mockImplementation(() => {
    const stream = new PassThrough();
    queueMicrotask(() => stream.emit('finish'));
    return stream;
  });
}

describe('uploadToSftp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-15T12:00:00Z'));
    setupSuccessfulSftpMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uploads successfully with password auth', async () => {
    const result = await uploadToSftp({
      connectedAccount: makeSftpAccount(),
      videoStream: makeVideoStream(),
      contentType: 'video/mp4',
      fileName: '20260415 - My Backup.mp4',
    });

    expect(result).toEqual({
      ok: true,
      platformVideoId: '/backups/20260415 - My Backup.mp4',
      platformUrl: 'sftp://sftp.example.com/backups/20260415%20-%20My%20Backup.mp4',
    });

    expect(mocks.mockConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'sftp.example.com',
        port: 22,
        username: 'backup-user',
        password: 'secret-password',
        hostHash: 'sha256',
        hostVerifier: expect.any(Function),
      })
    );
    expect(mocks.mockCreateWriteStream).toHaveBeenCalledWith(
      expect.stringMatching(/^\/backups\//),
      expect.objectContaining({ flags: 'w', mode: 0o600 })
    );
    expect(mocks.mockEnd).toHaveBeenCalled();
  });

  it('uploads into a year subfolder when yearFolderName is provided', async () => {
    const result = await uploadToSftp({
      connectedAccount: makeSftpAccount(),
      videoStream: makeVideoStream(),
      contentType: 'video/mp4',
      fileName: '20260415 - My Backup.mp4',
      yearFolderName: '2026',
    });

    expect(result).toEqual({
      ok: true,
      platformVideoId: '/backups/2026/20260415 - My Backup.mp4',
      platformUrl: 'sftp://sftp.example.com/backups/2026/20260415%20-%20My%20Backup.mp4',
    });
    expect(mocks.mockCreateWriteStream).toHaveBeenCalledWith(
      '/backups/2026/20260415 - My Backup.mp4',
      expect.objectContaining({ flags: 'w', mode: 0o600 })
    );
  });

  it('creates the year subfolder when it does not exist yet', async () => {
    mocks.mockStat.mockImplementation(
      (
        remotePath: string,
        callback: (err: Error | null, stats?: { isDirectory: () => boolean }) => void
      ) => {
        if (remotePath === '/backups/2026') {
          callback(Object.assign(new Error('No such file'), { code: 'ENOENT' }));
          return;
        }
        callback(null, { isDirectory: () => true });
      }
    );

    await uploadToSftp({
      connectedAccount: makeSftpAccount(),
      videoStream: makeVideoStream(),
      fileName: '20260415 - My Backup.mp4',
      yearFolderName: '2026',
    });

    expect(mocks.mockMkdir).toHaveBeenCalledWith(
      '/backups/2026',
      expect.objectContaining({ mode: 0o755 }),
      expect.any(Function)
    );
  });

  it('succeeds when mkdir returns EEXIST because another upload created the year folder', async () => {
    let yearDirStatCalls = 0;
    mocks.mockStat.mockImplementation(
      (
        remotePath: string,
        callback: (err: Error | null, stats?: { isDirectory: () => boolean }) => void
      ) => {
        if (remotePath === '/backups/2026') {
          yearDirStatCalls += 1;
          if (yearDirStatCalls === 1) {
            callback(Object.assign(new Error('No such file'), { code: 'ENOENT' }));
            return;
          }
        }
        callback(null, { isDirectory: () => true });
      }
    );
    mocks.mockMkdir.mockImplementation(
      (_path: string, _options: unknown, callback: (err: Error | null) => void) => {
        callback(Object.assign(new Error('File exists'), { code: 'EEXIST' }));
      }
    );

    const result = await uploadToSftp({
      connectedAccount: makeSftpAccount(),
      videoStream: makeVideoStream(),
      fileName: '20260415 - My Backup.mp4',
      yearFolderName: '2026',
    });

    expect(result).toMatchObject({ ok: true });
    expect(mocks.mockCreateWriteStream).toHaveBeenCalledWith(
      '/backups/2026/20260415 - My Backup.mp4',
      expect.objectContaining({ flags: 'w', mode: 0o600 })
    );
  });

  it('rejects upload when fileName would escape the remote directory', async () => {
    const result = await uploadToSftp({
      connectedAccount: makeSftpAccount(),
      videoStream: makeVideoStream(),
      fileName: '../outside.mp4',
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'SFTP_UPLOAD_PATH_INVALID', statusCode: 400 },
    });
    expect(mocks.mockConnect).not.toHaveBeenCalled();
  });

  it('rejects upload when yearFolderName would escape the remote directory', async () => {
    const result = await uploadToSftp({
      connectedAccount: makeSftpAccount(),
      videoStream: makeVideoStream(),
      fileName: 'backup.mp4',
      yearFolderName: '../other',
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'SFTP_UPLOAD_PATH_INVALID', statusCode: 400 },
    });
    expect(mocks.mockConnect).not.toHaveBeenCalled();
  });

  it('rejects upload when host key fingerprint is not pinned', async () => {
    const result = await uploadToSftp({
      connectedAccount: makeSftpAccount({ sftpHostKeyFingerprint: undefined }),
      videoStream: makeVideoStream(),
      fileName: 'test.mp4',
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'SFTP_HOST_KEY_UNPINNED', statusCode: 400 },
    });
    expect(mocks.mockConnect).not.toHaveBeenCalled();
  });

  it('rejects upload when pinned host key does not match', async () => {
    const result = await uploadToSftp({
      connectedAccount: makeSftpAccount({ sftpHostKeyFingerprint: 'b'.repeat(64) }),
      videoStream: makeVideoStream(),
      fileName: 'test.mp4',
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'SFTP_HOST_KEY_MISMATCH', statusCode: 400 },
    });
  });

  it('rejects upload when stored remotePath contains parent-directory segments', async () => {
    const result = await uploadToSftp({
      connectedAccount: makeSftpAccount({ sftpRemotePath: '/backups/../etc' }),
      videoStream: makeVideoStream(),
      fileName: 'test.mp4',
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'SFTP_CONFIG_INVALID' },
    });
    expect(mocks.mockConnect).not.toHaveBeenCalled();
  });

  it('rejects upload when stored sftpPort is outside the valid TCP range', async () => {
    const result = await uploadToSftp({
      connectedAccount: makeSftpAccount({ sftpPort: 70000 }),
      videoStream: makeVideoStream(),
      fileName: 'test.mp4',
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'SFTP_CONFIG_INVALID' },
    });
    expect(mocks.mockConnect).not.toHaveBeenCalled();
  });

  it('includes non-default port in platformUrl', async () => {
    const result = await uploadToSftp({
      connectedAccount: makeSftpAccount({ sftpPort: 2222 }),
      videoStream: makeVideoStream(),
      fileName: 'Custom Port Backup.mp4',
    });

    expect(result).toMatchObject({
      ok: true,
      platformUrl: 'sftp://sftp.example.com:2222/backups/Custom%20Port%20Backup.mp4',
    });
  });

  it('brackets IPv6 hosts in platformUrl', async () => {
    const result = await uploadToSftp({
      connectedAccount: makeSftpAccount({ sftpHost: '2001:db8::1' }),
      videoStream: makeVideoStream(),
      fileName: 'IPv6 Backup.mp4',
    });

    expect(result).toMatchObject({
      ok: true,
      platformUrl: 'sftp://[2001:db8::1]/backups/IPv6%20Backup.mp4',
    });
    expect(mocks.mockConnect).toHaveBeenCalledWith(
      expect.objectContaining({ host: '2001:db8::1', port: 22 })
    );
  });

  it('brackets IPv6 hosts and includes non-default port in platformUrl', async () => {
    const result = await uploadToSftp({
      connectedAccount: makeSftpAccount({ sftpHost: '2001:db8::1', sftpPort: 2222 }),
      videoStream: makeVideoStream(),
      fileName: 'IPv6 Port Backup.mp4',
    });

    expect(result).toMatchObject({
      ok: true,
      platformUrl: 'sftp://[2001:db8::1]:2222/backups/IPv6%20Port%20Backup.mp4',
    });
  });

  it('uploads successfully with key auth and passphrase', async () => {
    await uploadToSftp({
      connectedAccount: makeSftpAccount({
        sftpAuthMethod: 'key',
        accessToken: '-----BEGIN OPENSSH PRIVATE KEY-----\nabc',
        refreshToken: 'key-pass',
      }),
      videoStream: makeVideoStream(),
      fileName: 'test.mp4',
    });

    expect(mocks.mockConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nabc',
        passphrase: 'key-pass',
      })
    );
  });

  it('completes upload when write stream emits finish without close', async () => {
    mocks.mockCreateWriteStream.mockImplementation(() => {
      const stream = new PassThrough();
      stream.on('pipe', () => {
        queueMicrotask(() => stream.emit('finish'));
      });
      return stream;
    });

    const result = await uploadToSftp({
      connectedAccount: makeSftpAccount(),
      videoStream: makeVideoStream(),
      fileName: 'test.mp4',
    });

    expect(result).toMatchObject({ ok: true });
  });

  it('completes upload when write stream emits close without finish', async () => {
    mocks.mockCreateWriteStream.mockImplementation(() => {
      const stream = new PassThrough();
      stream.on('pipe', () => {
        queueMicrotask(() => stream.emit('close'));
      });
      return stream;
    });

    const result = await uploadToSftp({
      connectedAccount: makeSftpAccount(),
      videoStream: makeVideoStream(),
      fileName: 'test.mp4',
    });

    expect(result).toMatchObject({ ok: true });
  });

  it('returns connection failure when connect emits error', async () => {
    mocks.mockConnect.mockImplementation(function connect(this: InstanceType<typeof EventEmitter>) {
      queueMicrotask(() => this.emit('error', new Error('ECONNREFUSED connect failed')));
    });

    const result = await uploadToSftp({
      connectedAccount: makeSftpAccount(),
      videoStream: makeVideoStream(),
      fileName: 'test.mp4',
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'SFTP_CONNECTION_FAILED' },
    });
  });

  it('rejects when connection closes before ready', async () => {
    mocks.mockConnect.mockImplementation(function connect(this: InstanceType<typeof EventEmitter>) {
      queueMicrotask(() => this.emit('close'));
    });

    const result = await uploadToSftp({
      connectedAccount: makeSftpAccount(),
      videoStream: makeVideoStream(),
      fileName: 'test.mp4',
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'SFTP_CONNECTION_FAILED' },
    });
  });

  it('rejects when aborted during connection handshake', async () => {
    mocks.mockConnect.mockImplementation(function connect(this: InstanceType<typeof EventEmitter>) {
      // Simulate a handshake that never completes until aborted.
    });
    mocks.mockEnd.mockImplementation(function end(this: InstanceType<typeof EventEmitter>) {
      queueMicrotask(() => this.emit('close'));
    });

    const controller = new AbortController();
    const uploadPromise = uploadToSftp({
      connectedAccount: makeSftpAccount(),
      videoStream: makeVideoStream(),
      fileName: 'test.mp4',
      signal: controller.signal,
    });

    controller.abort();
    const result = await uploadPromise;

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'SFTP_UPLOAD_ABORTED' },
    });
    expect(mocks.mockEnd).toHaveBeenCalled();
  });

  it('returns write failure when createWriteStream errors', async () => {
    mocks.mockCreateWriteStream.mockImplementation(() => {
      const stream = new PassThrough();
      queueMicrotask(() => stream.emit('error', new Error('disk full')));
      return stream;
    });

    const result = await uploadToSftp({
      connectedAccount: makeSftpAccount(),
      videoStream: makeVideoStream(),
      fileName: 'test.mp4',
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'SFTP_WRITE_FAILED' },
    });
  });

  it('cancels in-flight upload when abort signal fires', async () => {
    mocks.mockCreateWriteStream.mockImplementation(() => new PassThrough());

    const controller = new AbortController();
    const uploadPromise = uploadToSftp({
      connectedAccount: makeSftpAccount(),
      videoStream: makeVideoStream(),
      fileName: 'test.mp4',
      signal: controller.signal,
    });

    controller.abort();
    const result = await uploadPromise;

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'SFTP_UPLOAD_ABORTED' },
    });
    expect(mocks.mockEnd).toHaveBeenCalled();
  });
});

describe('testSftpConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupSuccessfulSftpMocks();
  });

  it('returns ok when remote path exists', async () => {
    const result = await testSftpConnection({
      host: 'sftp.example.com',
      port: 22,
      username: 'backup-user',
      remotePath: '/backups',
      authMethod: 'password',
      credential: 'secret',
    });

    expect(result).toEqual({ ok: true, hostKeyFingerprint: TEST_HOST_KEY_FINGERPRINT });
    expect(mocks.mockStat).toHaveBeenCalledWith('/backups', expect.any(Function));
  });

  it('verifies a pinned host key fingerprint on reconnect', async () => {
    const result = await testSftpConnection({
      host: 'sftp.example.com',
      port: 22,
      username: 'backup-user',
      remotePath: '/backups',
      authMethod: 'password',
      credential: 'secret',
      hostKeyFingerprint: TEST_HOST_KEY_FINGERPRINT,
    });

    expect(result).toEqual({ ok: true, hostKeyFingerprint: TEST_HOST_KEY_FINGERPRINT });
  });

  it('returns host key mismatch when pinned fingerprint does not match', async () => {
    const result = await testSftpConnection({
      host: 'sftp.example.com',
      port: 22,
      username: 'backup-user',
      remotePath: '/backups',
      authMethod: 'password',
      credential: 'secret',
      hostKeyFingerprint: 'b'.repeat(64),
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'SFTP_HOST_KEY_MISMATCH', statusCode: 400 },
    });
  });

  it('rejects remote paths with parent-directory segments before connecting', async () => {
    const result = await testSftpConnection({
      host: 'sftp.example.com',
      port: 22,
      username: 'backup-user',
      remotePath: '/backups/../etc',
      authMethod: 'password',
      credential: 'secret',
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'SFTP_REMOTE_PATH_INVALID', statusCode: 400 },
    });
    expect(mocks.mockConnect).not.toHaveBeenCalled();
  });

  it('returns auth failure for authentication errors', async () => {
    mocks.mockConnect.mockImplementation(function connect(this: InstanceType<typeof EventEmitter>) {
      queueMicrotask(() => this.emit('error', new Error('Authentication failed')));
    });

    const result = await testSftpConnection({
      host: 'sftp.example.com',
      port: 22,
      username: 'backup-user',
      remotePath: '/backups',
      authMethod: 'password',
      credential: 'bad',
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'SFTP_AUTH_FAILED' },
    });
  });

  it('returns remote path validation error when path is not a directory', async () => {
    mocks.mockStat.mockImplementation(
      (
        _path: string,
        callback: (err: Error | null, stats: { isDirectory: () => boolean }) => void
      ) => {
        callback(null, { isDirectory: () => false });
      }
    );

    const result = await testSftpConnection({
      host: 'sftp.example.com',
      port: 22,
      username: 'backup-user',
      remotePath: '/backups/file.txt',
      authMethod: 'password',
      credential: 'secret',
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'SFTP_REMOTE_PATH_INVALID',
        statusCode: 400,
      },
    });
  });

  it('returns remote path validation error when path does not exist', async () => {
    mocks.mockStat.mockImplementation(
      (_path: string, callback: (err: Error | null, stats: unknown) => void) => {
        const err = new Error('No such file') as Error & { code: string };
        err.code = 'ENOENT';
        callback(err, null);
      }
    );

    const result = await testSftpConnection({
      host: 'sftp.example.com',
      port: 22,
      username: 'backup-user',
      remotePath: '/missing',
      authMethod: 'password',
      credential: 'secret',
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'SFTP_REMOTE_PATH_INVALID',
        statusCode: 400,
      },
    });
  });
});
