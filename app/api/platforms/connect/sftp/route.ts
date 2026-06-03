import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { SFTP_TOKEN_EXPIRY, testSftpConnection } from '@/lib/platforms/sftp';
import type { SftpAuthMethod } from '@/types';
import {
  createConnectedAccount,
  getConnectedAccountRowId,
  updateConnection,
} from '@/lib/repositories/connected-accounts';

interface ConnectSftpBody {
  host?: unknown;
  port?: unknown;
  username?: unknown;
  remotePath?: unknown;
  authMethod?: unknown;
  credential?: unknown;
  passphrase?: unknown;
  label?: unknown;
}

function parsePort(value: unknown): number {
  if (value === undefined || value === null || value === '') {
    return 22;
  }
  const port = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return NaN;
  }
  return port;
}

function isAuthMethod(value: unknown): value is SftpAuthMethod {
  return value === 'key' || value === 'password';
}

/**
 * Connects an SFTP backup destination using credentials supplied in the request body.
 * @param req - Incoming POST request with SFTP connection details.
 * @returns JSON success or structured error response.
 */
export async function POST(req: NextRequest) {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated.' } },
      { status: 401 }
    );
  }

  let body: ConnectSftpBody;
  try {
    body = (await req.json()) as ConnectSftpBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } },
      { status: 400 }
    );
  }

  const host = typeof body.host === 'string' ? body.host.trim() : '';
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const remotePath = typeof body.remotePath === 'string' ? body.remotePath.trim() : '';
  const credential = typeof body.credential === 'string' ? body.credential : '';
  const label = typeof body.label === 'string' ? body.label.trim() : '';
  const authMethod = body.authMethod;
  const port = parsePort(body.port);
  const passphrase =
    typeof body.passphrase === 'string' && body.passphrase.trim() ? body.passphrase : undefined;

  if (!host) {
    return NextResponse.json(
      { ok: false, error: { code: 'SFTP_HOST_REQUIRED', message: 'host is required.' } },
      { status: 400 }
    );
  }
  if (!username) {
    return NextResponse.json(
      { ok: false, error: { code: 'SFTP_USERNAME_REQUIRED', message: 'username is required.' } },
      { status: 400 }
    );
  }
  if (!remotePath || !remotePath.startsWith('/')) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'SFTP_REMOTE_PATH_INVALID',
          message: 'remotePath is required and must start with /.',
        },
      },
      { status: 400 }
    );
  }
  if (!isAuthMethod(authMethod)) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'SFTP_AUTH_METHOD_INVALID',
          message: "authMethod must be 'key' or 'password'.",
        },
      },
      { status: 400 }
    );
  }
  if (!credential.trim()) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'SFTP_CREDENTIAL_REQUIRED',
          message: 'credential is required (private key PEM or password).',
        },
      },
      { status: 400 }
    );
  }
  if (!label) {
    return NextResponse.json(
      { ok: false, error: { code: 'SFTP_LABEL_REQUIRED', message: 'label is required.' } },
      { status: 400 }
    );
  }
  if (Number.isNaN(port)) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'SFTP_PORT_INVALID',
          message: 'port must be an integer between 1 and 65535.',
        },
      },
      { status: 400 }
    );
  }

  const sftpCredentials = {
    host,
    port,
    username,
    remotePath,
    authMethod,
    credential,
    ...(passphrase ? { passphrase } : {}),
  };

  const testResult = await testSftpConnection(sftpCredentials);
  if (testResult.ok === false) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: testResult.error.code,
          message: testResult.error.message,
          ...(testResult.error.details ? { details: testResult.error.details } : {}),
        },
      },
      { status: 400 }
    );
  }

  const refreshToken = passphrase ?? '';
  const sftpFields = {
    sftpHost: host,
    sftpPort: port,
    sftpRemotePath: remotePath,
    sftpAuthMethod: authMethod,
  };

  try {
    const existing = await getConnectedAccountRowId(userId, 'sftp');

    if (existing) {
      const updated = await updateConnection(
        existing.id,
        credential,
        refreshToken,
        SFTP_TOKEN_EXPIRY,
        username,
        label,
        sftpFields
      );
      if (!updated) {
        return NextResponse.json(
          {
            ok: false,
            error: {
              code: 'SFTP_UPDATE_FAILED',
              message: 'Failed to update the SFTP connection.',
            },
          },
          { status: 500 }
        );
      }
    } else {
      await createConnectedAccount({
        userId,
        platform: 'sftp',
        accessToken: credential,
        refreshToken,
        tokenExpiry: SFTP_TOKEN_EXPIRY,
        platformUserId: username,
        platformName: label,
        ...sftpFields,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[POST /api/platforms/connect/sftp] Unexpected error:', err);
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'SFTP_CONNECT_FAILED',
          message: 'Failed to save the SFTP connection.',
        },
      },
      { status: 500 }
    );
  }
}
