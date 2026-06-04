import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetAuthenticatedUserId = vi.fn();
const mockTestSmbConnection = vi.fn();
const mockCreateConnectedAccount = vi.fn();
const mockGetConnectedAccount = vi.fn();
const mockGetConnectedAccountWithTokens = vi.fn();
const mockUpdateConnection = vi.fn();

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: (...args: unknown[]) => mockGetAuthenticatedUserId(...args),
}));

vi.mock('@/lib/platforms/smb', async () => {
  const actual = await vi.importActual<typeof import('@/lib/platforms/smb')>('@/lib/platforms/smb');
  return {
    ...actual,
    testSmbConnection: (...args: unknown[]) => mockTestSmbConnection(...args),
    SMB_TOKEN_EXPIRY: '2099-01-01T00:00:00.000Z',
  };
});

vi.mock('@/lib/repositories/connected-accounts', () => ({
  createConnectedAccount: (...args: unknown[]) => mockCreateConnectedAccount(...args),
  getConnectedAccount: (...args: unknown[]) => mockGetConnectedAccount(...args),
  getConnectedAccountWithTokens: (...args: unknown[]) => mockGetConnectedAccountWithTokens(...args),
  updateConnection: (...args: unknown[]) => mockUpdateConnection(...args),
}));

import { POST } from '@/app/api/platforms/connect/smb/route';
import { TokenDecryptError } from '@/lib/crypto/token-encryption';

function createRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/platforms/connect/smb', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validBody = {
  host: '192.168.1.10',
  share: 'Backups',
  username: 'backup-user',
  password: 'secret-password',
  remotePath: '/VideoSphere',
  label: 'My NAS',
};

function mockExistingAccountWithTokens(overrides: Record<string, unknown> = {}) {
  mockGetConnectedAccountWithTokens.mockResolvedValueOnce({
    id: 'existing-1',
    userId: 'user-123',
    platform: 'smb',
    accessToken: 'secret-password',
    refreshToken: '',
    tokenExpiry: '2099-01-01T00:00:00.000Z',
    platformUserId: 'backup-user',
    platformName: 'My NAS',
    smbHost: '192.168.1.10',
    smbShare: 'Backups',
    smbRemotePath: '/VideoSphere',
    $createdAt: new Date().toISOString(),
    $updatedAt: new Date().toISOString(),
    ...overrides,
  });
}

describe('POST /api/platforms/connect/smb', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
    mockGetAuthenticatedUserId.mockResolvedValue('user-123');
    mockTestSmbConnection.mockResolvedValue({ ok: true });
    mockGetConnectedAccountWithTokens.mockResolvedValue(null);
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
    const res = await POST(createRequest({ ...validBody, share: '' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('SMB_SHARE_REQUIRED');
  });

  it('returns 400 for unsafe remotePath segments', async () => {
    const res = await POST(createRequest({ ...validBody, remotePath: '/backups/../etc' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('SMB_REMOTE_PATH_INVALID');
    expect(mockTestSmbConnection).not.toHaveBeenCalled();
  });

  it('returns 400 when password is missing for a new connection', async () => {
    const res = await POST(createRequest({ ...validBody, password: '' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('SMB_PASSWORD_REQUIRED');
  });

  it('returns platform HTTP status when test connection fails', async () => {
    mockTestSmbConnection.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'SMB_AUTH_FAILED',
        message: 'SMB authentication failed.',
        statusCode: 401,
        details: 'bad password',
      },
    });

    const res = await POST(createRequest(validBody));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('SMB_AUTH_FAILED');
    expect(mockCreateConnectedAccount).not.toHaveBeenCalled();
  });

  it('creates a connected account on success', async () => {
    const res = await POST(createRequest(validBody));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });

    expect(mockTestSmbConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        host: '192.168.1.10',
        share: 'Backups',
        username: 'backup-user',
        password: 'secret-password',
        remotePath: '/VideoSphere',
      })
    );

    expect(mockCreateConnectedAccount).toHaveBeenCalledWith({
      userId: 'user-123',
      platform: 'smb',
      accessToken: 'secret-password',
      refreshToken: '',
      tokenExpiry: '2099-01-01T00:00:00.000Z',
      platformUserId: 'backup-user',
      platformName: 'My NAS',
      smbHost: '192.168.1.10',
      smbShare: 'Backups',
      smbRemotePath: '/VideoSphere',
    });
  });

  it('updates an existing SMB connection and keeps stored password when omitted', async () => {
    mockExistingAccountWithTokens();
    mockUpdateConnection.mockResolvedValueOnce({ id: 'existing-1' });

    const res = await POST(
      createRequest({
        host: '192.168.1.10',
        share: 'Backups',
        username: 'backup-user',
        remotePath: '/archive',
        label: 'My NAS',
      })
    );
    expect(res.status).toBe(200);

    expect(mockUpdateConnection).toHaveBeenCalledWith(
      'existing-1',
      'secret-password',
      '',
      '2099-01-01T00:00:00.000Z',
      'backup-user',
      'My NAS',
      undefined,
      {
        smbHost: '192.168.1.10',
        smbShare: 'Backups',
        smbRemotePath: '/archive',
      }
    );
  });

  it('falls back to public account metadata when token decryption fails', async () => {
    mockGetConnectedAccountWithTokens.mockRejectedValueOnce(new TokenDecryptError('bad key'));
    mockGetConnectedAccount.mockResolvedValueOnce({
      id: 'existing-1',
      userId: 'user-123',
      platform: 'smb',
      tokenExpiry: '2099-01-01T00:00:00.000Z',
      hasRefreshToken: false,
      platformUserId: 'backup-user',
      platformName: 'My NAS',
      smbHost: '192.168.1.10',
      smbShare: 'Backups',
      smbRemotePath: '/VideoSphere',
      $createdAt: new Date().toISOString(),
      $updatedAt: new Date().toISOString(),
    });

    const res = await POST(createRequest({ ...validBody, password: '' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('SMB_PASSWORD_REQUIRED');
    expect(mockGetConnectedAccount).toHaveBeenCalledWith('user-123', 'smb');
  });
});
