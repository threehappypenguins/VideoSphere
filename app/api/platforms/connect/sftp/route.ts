import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { isTokenDecryptError } from '@/lib/crypto/token-encryption';
import { normalizeConnectedAccountSftpHostKeyFingerprint } from '@/lib/models/ConnectedAccount';
import { isValidSftpRemotePath, SFTP_TOKEN_EXPIRY, testSftpConnection } from '@/lib/platforms/sftp';
import type { ConnectedAccount, SftpAuthMethod } from '@/types';
import {
  createConnectedAccount,
  getConnectedAccount,
  getConnectedAccountWithTokens,
  updateConnection,
} from '@/lib/repositories/connected-accounts';
import type { ConnectedAccountPublic } from '@/types';

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

  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
      return NaN;
    }
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return 22;
    }
    if (!/^\d+$/.test(trimmed)) {
      return NaN;
    }
    const port = Number.parseInt(trimmed, 10);
    if (port < 1 || port > 65535) {
      return NaN;
    }
    return port;
  }

  return NaN;
}

function isAuthMethod(value: unknown): value is SftpAuthMethod {
  return value === 'key' || value === 'password';
}

function httpStatusFromPlatformError(error: { statusCode?: number }): number {
  if (error.statusCode != null && error.statusCode >= 400 && error.statusCode <= 599) {
    return error.statusCode;
  }
  return 400;
}

/**
 * Loads an existing SFTP connection, preferring decrypted credentials when available.
 * Falls back to the public row only when token decryption fails (e.g. key rotation).
 * @param userId - Authenticated user id.
 * @returns Decrypted account when available, otherwise public metadata only, or both null when absent.
 */
async function loadExistingSftpConnection(userId: string): Promise<{
  account: ConnectedAccount | null;
  publicAccount: ConnectedAccountPublic | null;
}> {
  try {
    const account = await getConnectedAccountWithTokens(userId, 'sftp');
    if (account) {
      return { account, publicAccount: account };
    }
    return { account: null, publicAccount: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isTokenDecryptError(err)) {
      console.warn(
        '[POST /api/platforms/connect/sftp] Could not decrypt stored SFTP credentials; treating as unavailable:',
        message
      );
      const publicAccount = await getConnectedAccount(userId, 'sftp');
      return { account: null, publicAccount };
    }
    throw err;
  }
}

/**
 * Connects or updates an SFTP backup destination using credentials supplied in the request body.
 * On update, credential and passphrase may be omitted to keep the stored secrets.
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
  if (!remotePath || !isValidSftpRemotePath(remotePath)) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'SFTP_REMOTE_PATH_INVALID',
          message:
            'remotePath must be an absolute path starting with /, without . or .. segments or backslashes.',
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

  const passphraseRaw = typeof body.passphrase === 'string' ? body.passphrase : '';
  const credentialProvided = credential.trim().length > 0;
  const passphraseProvided = passphraseRaw.trim().length > 0;

  const { account: existingAccount, publicAccount: existingAccountPublic } =
    await loadExistingSftpConnection(userId);

  const existingRowId = existingAccount?.id ?? existingAccountPublic?.id ?? null;
  const existingMetadata = existingAccount ?? existingAccountPublic;

  const existingSftpAuthMethod = existingMetadata?.sftpAuthMethod;

  if (
    existingRowId &&
    existingSftpAuthMethod != null &&
    existingSftpAuthMethod !== authMethod &&
    !credentialProvided
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'SFTP_CREDENTIAL_REQUIRED',
          message: 'Provide a new private key or password when changing the auth method.',
        },
      },
      { status: 400 }
    );
  }

  if (!existingRowId && !credentialProvided) {
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

  let resolvedCredential = credential;
  if (!credentialProvided) {
    const storedCredential = existingAccount?.accessToken ?? '';
    if (storedCredential.length === 0) {
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
    resolvedCredential = storedCredential;
  }

  let resolvedPassphrase: string | undefined;
  if (authMethod === 'key') {
    if (passphraseProvided) {
      resolvedPassphrase = passphraseRaw;
    } else if ((existingAccount?.refreshToken ?? '').length > 0) {
      resolvedPassphrase = existingAccount!.refreshToken;
    }
  }

  const storedSftpHost = existingMetadata?.sftpHost;
  const storedSftpPortRaw = existingMetadata?.sftpPort;
  const storedSftpPort =
    storedSftpPortRaw != null && storedSftpPortRaw > 0 ? storedSftpPortRaw : 22;
  const sameSftpEndpoint = storedSftpHost === host && storedSftpPort === port;
  const storedHostKeyFingerprint = existingMetadata?.sftpHostKeyFingerprint;
  const pinnedHostKeyFingerprint =
    sameSftpEndpoint && typeof storedHostKeyFingerprint === 'string'
      ? (normalizeConnectedAccountSftpHostKeyFingerprint(storedHostKeyFingerprint) ?? undefined)
      : undefined;

  const sftpCredentials = {
    host,
    port,
    username,
    remotePath,
    authMethod,
    credential: resolvedCredential,
    ...(resolvedPassphrase ? { passphrase: resolvedPassphrase } : {}),
    ...(pinnedHostKeyFingerprint ? { hostKeyFingerprint: pinnedHostKeyFingerprint } : {}),
  };

  const testResult = await testSftpConnection(sftpCredentials);
  if (testResult.ok === false) {
    const { error } = testResult;
    const status = httpStatusFromPlatformError(error);
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          statusCode: status,
          ...(process.env.NODE_ENV === 'development' && error.details
            ? { details: error.details }
            : {}),
        },
      },
      { status }
    );
  }

  const refreshToken =
    authMethod === 'key'
      ? passphraseProvided
        ? passphraseRaw
        : (existingAccount?.refreshToken ?? '')
      : '';

  const sftpFields = {
    sftpHost: host,
    sftpPort: port,
    sftpRemotePath: remotePath,
    sftpAuthMethod: authMethod,
    sftpHostKeyFingerprint: testResult.hostKeyFingerprint,
  };

  try {
    if (existingRowId) {
      const updated = await updateConnection(
        existingRowId,
        resolvedCredential,
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
        accessToken: resolvedCredential,
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
