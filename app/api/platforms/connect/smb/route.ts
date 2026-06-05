import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { isTokenDecryptError } from '@/lib/crypto/token-encryption';
import { isValidSmbRemotePath, SMB_TOKEN_EXPIRY, testSmbConnection } from '@/lib/platforms/smb';
import type { ConnectedAccount } from '@/types';
import {
  createConnectedAccount,
  getConnectedAccount,
  getConnectedAccountWithTokens,
  updateConnection,
} from '@/lib/repositories/connected-accounts';
import type { ConnectedAccountPublic } from '@/types';

interface ConnectSmbBody {
  host?: unknown;
  share?: unknown;
  domain?: unknown;
  username?: unknown;
  password?: unknown;
  remotePath?: unknown;
  label?: unknown;
}

function httpStatusFromPlatformError(error: { statusCode?: number }): number {
  if (error.statusCode != null && error.statusCode >= 400 && error.statusCode <= 599) {
    return error.statusCode;
  }
  return 400;
}

/**
 * Loads an existing SMB connection, preferring decrypted credentials when available.
 * @param userId - Authenticated user id.
 * @returns Decrypted account when available, otherwise public metadata only, or both null when absent.
 */
async function loadExistingSmbConnection(userId: string): Promise<{
  account: ConnectedAccount | null;
  publicAccount: ConnectedAccountPublic | null;
}> {
  try {
    const account = await getConnectedAccountWithTokens(userId, 'smb');
    if (account) {
      return { account, publicAccount: account };
    }
    return { account: null, publicAccount: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isTokenDecryptError(err)) {
      console.warn(
        '[POST /api/platforms/connect/smb] Could not decrypt stored SMB credentials; treating as unavailable:',
        message
      );
      const publicAccount = await getConnectedAccount(userId, 'smb');
      return { account: null, publicAccount };
    }
    throw err;
  }
}

/**
 * Connects or updates an SMB backup destination using credentials supplied in the request body.
 * On update, password may be omitted to keep the stored secret.
 * @param req - Incoming POST request with SMB connection details.
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

  let body: ConnectSmbBody;
  try {
    body = (await req.json()) as ConnectSmbBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } },
      { status: 400 }
    );
  }

  const host = typeof body.host === 'string' ? body.host.trim() : '';
  const share = typeof body.share === 'string' ? body.share.trim() : '';
  const domain = typeof body.domain === 'string' ? body.domain.trim() : '';
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const remotePath = typeof body.remotePath === 'string' ? body.remotePath.trim() : '';
  const label = typeof body.label === 'string' ? body.label.trim() : '';

  if (!host) {
    return NextResponse.json(
      { ok: false, error: { code: 'SMB_HOST_REQUIRED', message: 'host is required.' } },
      { status: 400 }
    );
  }
  if (!share) {
    return NextResponse.json(
      { ok: false, error: { code: 'SMB_SHARE_REQUIRED', message: 'share is required.' } },
      { status: 400 }
    );
  }
  if (!username) {
    return NextResponse.json(
      { ok: false, error: { code: 'SMB_USERNAME_REQUIRED', message: 'username is required.' } },
      { status: 400 }
    );
  }
  if (!remotePath) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'SMB_REMOTE_PATH_REQUIRED',
          message: 'remotePath is required (use / for the share root).',
        },
      },
      { status: 400 }
    );
  }
  if (!isValidSmbRemotePath(remotePath)) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'SMB_REMOTE_PATH_INVALID',
          message:
            'remotePath must start with / or \\, without . or .. segments (use / for the share root).',
        },
      },
      { status: 400 }
    );
  }
  if (!label) {
    return NextResponse.json(
      { ok: false, error: { code: 'SMB_LABEL_REQUIRED', message: 'label is required.' } },
      { status: 400 }
    );
  }

  const passwordProvided = password.trim().length > 0;

  const { account: existingAccount, publicAccount: existingAccountPublic } =
    await loadExistingSmbConnection(userId);

  const existingRowId = existingAccount?.id ?? existingAccountPublic?.id ?? null;

  if (!existingRowId && !passwordProvided) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'SMB_PASSWORD_REQUIRED',
          message: 'password is required.',
        },
      },
      { status: 400 }
    );
  }

  let resolvedPassword = password;
  if (!passwordProvided) {
    const storedPassword = existingAccount?.accessToken ?? '';
    if (storedPassword.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'SMB_PASSWORD_REQUIRED',
            message: 'password is required.',
          },
        },
        { status: 400 }
      );
    }
    resolvedPassword = storedPassword;
  }

  const smbCredentials = {
    host,
    share,
    ...(domain ? { domain } : {}),
    username,
    password: resolvedPassword,
    remotePath,
  };

  const testResult = await testSmbConnection(smbCredentials);
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

  const smbFields = {
    smbHost: host,
    smbShare: share,
    ...(domain ? { smbDomain: domain } : {}),
    smbRemotePath: remotePath,
  };

  try {
    if (existingRowId) {
      const updated = await updateConnection(
        existingRowId,
        resolvedPassword,
        '',
        SMB_TOKEN_EXPIRY,
        username,
        label,
        undefined,
        smbFields
      );
      if (!updated) {
        return NextResponse.json(
          {
            ok: false,
            error: {
              code: 'SMB_UPDATE_FAILED',
              message: 'Failed to update the SMB connection.',
            },
          },
          { status: 500 }
        );
      }
    } else {
      await createConnectedAccount({
        userId,
        platform: 'smb',
        accessToken: resolvedPassword,
        refreshToken: '',
        tokenExpiry: SMB_TOKEN_EXPIRY,
        platformUserId: username,
        platformName: label,
        ...smbFields,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[POST /api/platforms/connect/smb] Unexpected error:', err);
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'SMB_CONNECT_FAILED',
          message: 'Failed to save the SMB connection.',
        },
      },
      { status: 500 }
    );
  }
}
