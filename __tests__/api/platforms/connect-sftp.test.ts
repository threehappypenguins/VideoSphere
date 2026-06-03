import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetAuthenticatedUserId = vi.fn();
const mockTestSftpConnection = vi.fn();
const mockCreateConnectedAccount = vi.fn();
const mockGetConnectedAccountRowId = vi.fn();
const mockUpdateConnection = vi.fn();

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: (...args: unknown[]) => mockGetAuthenticatedUserId(...args),
}));

vi.mock('@/lib/platforms/sftp', () => ({
  testSftpConnection: (...args: unknown[]) => mockTestSftpConnection(...args),
  SFTP_TOKEN_EXPIRY: '2099-01-01T00:00:00.000Z',
}));

vi.mock('@/lib/repositories/connected-accounts', () => ({
  createConnectedAccount: (...args: unknown[]) => mockCreateConnectedAccount(...args),
  getConnectedAccountRowId: (...args: unknown[]) => mockGetConnectedAccountRowId(...args),
  updateConnection: (...args: unknown[]) => mockUpdateConnection(...args),
}));

import { POST } from '@/app/api/platforms/connect/sftp/route';

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

describe('POST /api/platforms/connect/sftp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthenticatedUserId.mockResolvedValue('user-123');
    mockTestSftpConnection.mockResolvedValue({ ok: true });
    mockGetConnectedAccountRowId.mockResolvedValue(null);
    mockCreateConnectedAccount.mockResolvedValue({ id: 'ca-1' });
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

  it('returns 400 for invalid auth method', async () => {
    const res = await POST(createRequest({ ...validBody, authMethod: 'token' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('SFTP_AUTH_METHOD_INVALID');
  });

  it('returns 400 when test connection fails', async () => {
    mockTestSftpConnection.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'SFTP_AUTH_FAILED',
        message: 'SFTP authentication failed.',
        details: 'bad password',
      },
    });

    const res = await POST(createRequest(validBody));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('SFTP_AUTH_FAILED');
    expect(mockCreateConnectedAccount).not.toHaveBeenCalled();
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
    });
  });

  it('updates an existing SFTP connection on reconnect', async () => {
    mockGetConnectedAccountRowId.mockResolvedValueOnce({ id: 'existing-1', platformUserId: 'old' });
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
      }
    );
    expect(mockCreateConnectedAccount).not.toHaveBeenCalled();
  });
});
