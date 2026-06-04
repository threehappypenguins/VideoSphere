import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetAuthenticatedUserId = vi.fn();
const mockTestSftpConnection = vi.fn();
const mockCreateConnectedAccount = vi.fn();
const mockGetConnectedAccount = vi.fn();
const mockGetConnectedAccountRowId = vi.fn();
const mockGetConnectedAccountWithTokens = vi.fn();
const mockUpdateConnection = vi.fn();

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: (...args: unknown[]) => mockGetAuthenticatedUserId(...args),
}));

vi.mock('@/lib/platforms/sftp', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/platforms/sftp')>('@/lib/platforms/sftp');
  return {
    ...actual,
    testSftpConnection: (...args: unknown[]) => mockTestSftpConnection(...args),
    SFTP_TOKEN_EXPIRY: '2099-01-01T00:00:00.000Z',
  };
});

vi.mock('@/lib/repositories/connected-accounts', () => ({
  createConnectedAccount: (...args: unknown[]) => mockCreateConnectedAccount(...args),
  getConnectedAccount: (...args: unknown[]) => mockGetConnectedAccount(...args),
  getConnectedAccountRowId: (...args: unknown[]) => mockGetConnectedAccountRowId(...args),
  getConnectedAccountWithTokens: (...args: unknown[]) => mockGetConnectedAccountWithTokens(...args),
  updateConnection: (...args: unknown[]) => mockUpdateConnection(...args),
}));

import { POST } from '@/app/api/platforms/connect/sftp/route';
import { TokenDecryptError } from '@/lib/crypto/token-encryption';

function createRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/platforms/connect/sftp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validBody = {
  host: 'sftp.example.com',
  port: 22,
  username: 'backup-user',
  remotePath: '/backups',
  authMethod: 'password',
  credential: 'secret-password',
  label: 'My Home Server',
};

const TEST_HOST_KEY_FINGERPRINT = 'a'.repeat(64);

function mockExistingPublicSftpAccount(overrides: Record<string, unknown> = {}) {
  mockGetConnectedAccount.mockResolvedValueOnce({
    id: 'existing-1',
    userId: 'user-123',
    platform: 'sftp',
    tokenExpiry: '2099-01-01T00:00:00.000Z',
    hasRefreshToken: false,
    platformUserId: 'backup-user',
    platformName: 'My Home Server',
    sftpHost: 'sftp.example.com',
    sftpPort: 22,
    sftpRemotePath: '/backups',
    sftpAuthMethod: 'password',
    sftpHostKeyFingerprint: TEST_HOST_KEY_FINGERPRINT,
    $createdAt: new Date().toISOString(),
    $updatedAt: new Date().toISOString(),
    ...overrides,
  });
}

describe('POST /api/platforms/connect/sftp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
    mockGetAuthenticatedUserId.mockResolvedValue('user-123');
    mockTestSftpConnection.mockResolvedValue({
      ok: true,
      hostKeyFingerprint: TEST_HOST_KEY_FINGERPRINT,
    });
    mockGetConnectedAccountRowId.mockResolvedValue(null);
    mockGetConnectedAccount.mockResolvedValue(null);
    mockCreateConnectedAccount.mockResolvedValue({ id: 'ca-1' });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetAuthenticatedUserId.mockResolvedValueOnce(null);
    const res = await POST(createRequest(validBody));
    expect(res.status).toBe(401);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await POST(createRequest({ ...validBody, host: '' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('SFTP_HOST_REQUIRED');
  });

  it('returns 400 for unsafe remotePath segments', async () => {
    for (const remotePath of ['/backups/../etc', '/backups/./sub', '/backups\\sub']) {
      vi.clearAllMocks();
      mockGetAuthenticatedUserId.mockResolvedValue('user-123');
      mockTestSftpConnection.mockResolvedValue({
        ok: true,
        hostKeyFingerprint: TEST_HOST_KEY_FINGERPRINT,
      });
      mockGetConnectedAccountRowId.mockResolvedValue(null);
      mockCreateConnectedAccount.mockResolvedValue({ id: 'ca-1' });

      const res = await POST(createRequest({ ...validBody, remotePath }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('SFTP_REMOTE_PATH_INVALID');
      expect(mockTestSftpConnection).not.toHaveBeenCalled();
    }
  });

  it('returns 400 for invalid auth method', async () => {
    const res = await POST(createRequest({ ...validBody, authMethod: 'token' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('SFTP_AUTH_METHOD_INVALID');
  });

  it('returns 400 for non-integer port values', async () => {
    for (const port of ['22.5', '22abc', 'abc', 22.5]) {
      const res = await POST(createRequest({ ...validBody, port }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('SFTP_PORT_INVALID');
      expect(mockTestSftpConnection).not.toHaveBeenCalled();
    }
  });

  it('accepts string port when it is a whole number', async () => {
    const res = await POST(createRequest({ ...validBody, port: '2222' }));
    expect(res.status).toBe(200);
    expect(mockCreateConnectedAccount).toHaveBeenCalledWith(
      expect.objectContaining({ sftpPort: 2222 })
    );
  });

  it('returns platform HTTP status when test connection fails', async () => {
    mockTestSftpConnection.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'SFTP_AUTH_FAILED',
        message: 'SFTP authentication failed.',
        statusCode: 401,
        details: 'bad password',
      },
    });

    const res = await POST(createRequest(validBody));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('SFTP_AUTH_FAILED');
    expect(body.error.statusCode).toBe(401);
    expect(body.error.details).toBeUndefined();
    expect(mockCreateConnectedAccount).not.toHaveBeenCalled();
  });

  it('includes SFTP error details only in development', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    mockTestSftpConnection.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'SFTP_CONNECTION_FAILED',
        message: 'Failed to connect to the SFTP server.',
        statusCode: 500,
        details: 'ECONNREFUSED',
      },
    });

    const res = await POST(createRequest(validBody));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.details).toBe('ECONNREFUSED');
  });

  it('returns 500 when SFTP server connection fails during test', async () => {
    mockTestSftpConnection.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'SFTP_CONNECTION_FAILED',
        message: 'Failed to connect to the SFTP server.',
        statusCode: 500,
        details: 'ECONNREFUSED',
      },
    });

    const res = await POST(createRequest(validBody));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.statusCode).toBe(500);
    expect(body.error.details).toBeUndefined();
  });

  it('creates a connected account on success', async () => {
    const res = await POST(createRequest(validBody));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });

    expect(mockTestSftpConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'sftp.example.com',
        username: 'backup-user',
        remotePath: '/backups',
        authMethod: 'password',
        credential: 'secret-password',
      })
    );
    expect(mockTestSftpConnection).toHaveBeenCalledWith(
      expect.not.objectContaining({ passphrase: expect.anything() })
    );

    expect(mockCreateConnectedAccount).toHaveBeenCalledWith({
      userId: 'user-123',
      platform: 'sftp',
      accessToken: 'secret-password',
      refreshToken: '',
      tokenExpiry: '2099-01-01T00:00:00.000Z',
      platformUserId: 'backup-user',
      platformName: 'My Home Server',
      sftpHost: 'sftp.example.com',
      sftpPort: 22,
      sftpRemotePath: '/backups',
      sftpAuthMethod: 'password',
      sftpHostKeyFingerprint: TEST_HOST_KEY_FINGERPRINT,
    });
  });

  it('ignores passphrase for password auth', async () => {
    const res = await POST(
      createRequest({ ...validBody, authMethod: 'password', passphrase: 'ignored' })
    );
    expect(res.status).toBe(200);
    expect(mockCreateConnectedAccount).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: '' })
    );
  });

  it('updates an existing SFTP connection on reconnect', async () => {
    mockGetConnectedAccountRowId.mockResolvedValueOnce({ id: 'existing-1', platformUserId: 'old' });
    mockExistingPublicSftpAccount();
    mockGetConnectedAccountWithTokens.mockResolvedValueOnce({
      id: 'existing-1',
      accessToken: 'secret-password',
      refreshToken: '',
      sftpAuthMethod: 'password',
    });
    mockUpdateConnection.mockResolvedValueOnce({ id: 'existing-1' });

    const res = await POST(
      createRequest({ ...validBody, authMethod: 'key', passphrase: 'phrase' })
    );
    expect(res.status).toBe(200);

    expect(mockUpdateConnection).toHaveBeenCalledWith(
      'existing-1',
      'secret-password',
      'phrase',
      '2099-01-01T00:00:00.000Z',
      'backup-user',
      'My Home Server',
      {
        sftpHost: 'sftp.example.com',
        sftpPort: 22,
        sftpRemotePath: '/backups',
        sftpAuthMethod: 'key',
        sftpHostKeyFingerprint: TEST_HOST_KEY_FINGERPRINT,
      }
    );
    expect(mockCreateConnectedAccount).not.toHaveBeenCalled();
  });

  it('keeps stored passphrase when re-submitting a private key without a new passphrase', async () => {
    mockGetConnectedAccountRowId.mockResolvedValueOnce({ id: 'existing-1', platformUserId: 'old' });
    mockExistingPublicSftpAccount({ sftpAuthMethod: 'key' });
    mockGetConnectedAccountWithTokens.mockResolvedValueOnce({
      id: 'existing-1',
      accessToken: '-----BEGIN OPENSSH PRIVATE KEY-----\nabc',
      refreshToken: 'stored-passphrase',
      sftpAuthMethod: 'key',
    });
    mockUpdateConnection.mockResolvedValueOnce({ id: 'existing-1' });

    const res = await POST(
      createRequest({
        ...validBody,
        authMethod: 'key',
        credential: '-----BEGIN OPENSSH PRIVATE KEY-----\nabc',
      })
    );
    expect(res.status).toBe(200);

    expect(mockTestSftpConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        credential: '-----BEGIN OPENSSH PRIVATE KEY-----\nabc',
        passphrase: 'stored-passphrase',
      })
    );
    expect(mockUpdateConnection).toHaveBeenCalledWith(
      'existing-1',
      '-----BEGIN OPENSSH PRIVATE KEY-----\nabc',
      'stored-passphrase',
      '2099-01-01T00:00:00.000Z',
      'backup-user',
      'My Home Server',
      expect.objectContaining({ sftpAuthMethod: 'key' })
    );
  });

  it('updates metadata without resubmitting credentials when editing', async () => {
    mockGetConnectedAccountRowId.mockResolvedValueOnce({ id: 'existing-1', platformUserId: 'old' });
    mockExistingPublicSftpAccount();
    mockGetConnectedAccountWithTokens.mockResolvedValueOnce({
      id: 'existing-1',
      accessToken: 'stored-password',
      refreshToken: '',
      sftpAuthMethod: 'password',
    });
    mockUpdateConnection.mockResolvedValueOnce({ id: 'existing-1' });

    const { credential: _credential, ...bodyWithoutCredential } = validBody;
    const res = await POST(
      createRequest({
        ...bodyWithoutCredential,
        label: 'Renamed Server',
        remotePath: '/archive',
        port: 2222,
      })
    );
    expect(res.status).toBe(200);

    expect(mockTestSftpConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        credential: 'stored-password',
        remotePath: '/archive',
        port: 2222,
      })
    );
    expect(mockUpdateConnection).toHaveBeenCalledWith(
      'existing-1',
      'stored-password',
      '',
      '2099-01-01T00:00:00.000Z',
      'backup-user',
      'Renamed Server',
      expect.objectContaining({
        sftpRemotePath: '/archive',
        sftpPort: 2222,
        sftpHostKeyFingerprint: TEST_HOST_KEY_FINGERPRINT,
      })
    );
  });

  it('re-pins host key when host or port changes', async () => {
    mockGetConnectedAccountRowId.mockResolvedValueOnce({ id: 'existing-1', platformUserId: 'old' });
    mockExistingPublicSftpAccount({ sftpHostKeyFingerprint: 'old-fingerprint' });
    mockGetConnectedAccountWithTokens.mockResolvedValueOnce({
      id: 'existing-1',
      accessToken: 'stored-password',
      refreshToken: '',
      sftpAuthMethod: 'password',
      sftpHost: 'sftp.example.com',
      sftpPort: 22,
      sftpHostKeyFingerprint: 'old-fingerprint',
    });
    mockUpdateConnection.mockResolvedValueOnce({ id: 'existing-1' });

    const { credential: _credential, ...bodyWithoutCredential } = validBody;
    const res = await POST(
      createRequest({
        ...bodyWithoutCredential,
        port: 2222,
      })
    );
    expect(res.status).toBe(200);

    expect(mockTestSftpConnection).toHaveBeenCalledWith(
      expect.not.objectContaining({ hostKeyFingerprint: expect.anything() })
    );
    expect(mockUpdateConnection).toHaveBeenCalledWith(
      'existing-1',
      'stored-password',
      '',
      '2099-01-01T00:00:00.000Z',
      'backup-user',
      'My Home Server',
      expect.objectContaining({
        sftpPort: 2222,
        sftpHostKeyFingerprint: TEST_HOST_KEY_FINGERPRINT,
      })
    );
  });

  it('verifies pinned host key when host and port are unchanged', async () => {
    mockGetConnectedAccountRowId.mockResolvedValueOnce({ id: 'existing-1', platformUserId: 'old' });
    mockExistingPublicSftpAccount();
    mockGetConnectedAccountWithTokens.mockResolvedValueOnce({
      id: 'existing-1',
      accessToken: 'stored-password',
      refreshToken: '',
      sftpAuthMethod: 'password',
      sftpHost: 'sftp.example.com',
      sftpPort: 22,
      sftpHostKeyFingerprint: TEST_HOST_KEY_FINGERPRINT,
    });
    mockUpdateConnection.mockResolvedValueOnce({ id: 'existing-1' });

    const { credential: _credential, ...bodyWithoutCredential } = validBody;
    const res = await POST(createRequest(bodyWithoutCredential));
    expect(res.status).toBe(200);

    expect(mockTestSftpConnection).toHaveBeenCalledWith(
      expect.objectContaining({ hostKeyFingerprint: TEST_HOST_KEY_FINGERPRINT })
    );
  });

  it('preserves stored credential whitespace when editing metadata only', async () => {
    mockGetConnectedAccountRowId.mockResolvedValueOnce({ id: 'existing-1', platformUserId: 'old' });
    mockExistingPublicSftpAccount();
    mockGetConnectedAccountWithTokens.mockResolvedValueOnce({
      id: 'existing-1',
      accessToken: '  secret-with-spaces  ',
      refreshToken: '',
      sftpAuthMethod: 'password',
    });
    mockUpdateConnection.mockResolvedValueOnce({ id: 'existing-1' });

    const { credential: _credential, ...bodyWithoutCredential } = validBody;
    const res = await POST(
      createRequest({
        ...bodyWithoutCredential,
        label: 'Whitespace Label',
      })
    );
    expect(res.status).toBe(200);

    expect(mockTestSftpConnection).toHaveBeenCalledWith(
      expect.objectContaining({ credential: '  secret-with-spaces  ' })
    );
    expect(mockUpdateConnection).toHaveBeenCalledWith(
      'existing-1',
      '  secret-with-spaces  ',
      '',
      '2099-01-01T00:00:00.000Z',
      'backup-user',
      'Whitespace Label',
      expect.objectContaining({ sftpAuthMethod: 'password' })
    );
  });

  it('requires a new credential when changing auth method during edit', async () => {
    mockGetConnectedAccountRowId.mockResolvedValueOnce({ id: 'existing-1', platformUserId: 'old' });
    mockExistingPublicSftpAccount();
    mockGetConnectedAccountWithTokens.mockResolvedValueOnce({
      id: 'existing-1',
      accessToken: 'stored-password',
      refreshToken: '',
      sftpAuthMethod: 'password',
    });

    const { credential: _credential, ...bodyWithoutCredential } = validBody;
    const res = await POST(
      createRequest({
        ...bodyWithoutCredential,
        authMethod: 'key',
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('SFTP_CREDENTIAL_REQUIRED');
    expect(mockTestSftpConnection).not.toHaveBeenCalled();
  });

  it('requires credential when stored tokens cannot be decrypted', async () => {
    mockGetConnectedAccountRowId.mockResolvedValueOnce({ id: 'existing-1', platformUserId: 'old' });
    mockGetConnectedAccountWithTokens.mockRejectedValueOnce(
      new TokenDecryptError('Unsupported state or unable to authenticate data')
    );

    const { credential: _credential, ...bodyWithoutCredential } = validBody;
    const res = await POST(createRequest(bodyWithoutCredential));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('SFTP_CREDENTIAL_REQUIRED');
    expect(mockTestSftpConnection).not.toHaveBeenCalled();
  });

  it('allows reconnect when stored tokens cannot be decrypted but new credentials are supplied', async () => {
    mockGetConnectedAccountRowId.mockResolvedValueOnce({ id: 'existing-1', platformUserId: 'old' });
    mockExistingPublicSftpAccount();
    mockGetConnectedAccountWithTokens.mockRejectedValueOnce(
      new TokenDecryptError('Unsupported state or unable to authenticate data')
    );
    mockUpdateConnection.mockResolvedValueOnce({ id: 'existing-1' });

    const res = await POST(createRequest(validBody));
    expect(res.status).toBe(200);
    expect(mockTestSftpConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        credential: 'secret-password',
        hostKeyFingerprint: TEST_HOST_KEY_FINGERPRINT,
      })
    );
    expect(mockUpdateConnection).toHaveBeenCalledWith(
      'existing-1',
      'secret-password',
      '',
      '2099-01-01T00:00:00.000Z',
      'backup-user',
      'My Home Server',
      expect.objectContaining({ sftpAuthMethod: 'password' })
    );
  });

  it('requires a new credential when changing auth method and stored tokens cannot be decrypted', async () => {
    mockGetConnectedAccountRowId.mockResolvedValueOnce({ id: 'existing-1', platformUserId: 'old' });
    mockExistingPublicSftpAccount();
    mockGetConnectedAccountWithTokens.mockRejectedValueOnce(
      new TokenDecryptError('Unsupported state or unable to authenticate data')
    );

    const { credential: _credential, ...bodyWithoutCredential } = validBody;
    const res = await POST(
      createRequest({
        ...bodyWithoutCredential,
        authMethod: 'key',
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('SFTP_CREDENTIAL_REQUIRED');
    expect(mockTestSftpConnection).not.toHaveBeenCalled();
  });
});
