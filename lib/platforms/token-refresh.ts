/**
 * Central OAuth token refresh for platform APIs (distribution and other callers).
 * YouTube: refreshes when the access token is expired or within the lead window.
 * Vimeo: returns stored tokens without a remote refresh (long-lived tokens).
 */

import type { ConnectedAccount } from '@/types';
import type { PlatformUploadTokens } from '@/lib/platforms/types';
import { updateTokens } from '@/lib/repositories/connected-accounts';
import { refreshGoogleDriveAccessToken } from '@/lib/platforms/google-drive';
import { refreshYouTubeAccessToken } from '@/lib/platforms/youtube';

/** Refresh if access token expires within this window (ms). */
export const TOKEN_REFRESH_LEAD_MS = 5 * 60 * 1000;

/**
 * Defines the PlatformTokens type.
 */
export type PlatformTokens = Required<PlatformUploadTokens>;

/**
 * Returns true when the access token is missing, the expiry is invalid,
 * or the token expires at or before `now + TOKEN_REFRESH_LEAD_MS`.
 */
export function tokenNeedsRefresh(
  tokenExpiryIso: string,
  nowMs = Date.now(),
  accessToken?: string
): boolean {
  if (!accessToken?.trim()) return true;
  const expiry = Date.parse(tokenExpiryIso);
  if (Number.isNaN(expiry)) return true;
  return expiry <= nowMs + TOKEN_REFRESH_LEAD_MS;
}

/**
 * Returns tokens suitable for platform API calls. Persists a new YouTube access token
 * when the stored one is expired or near expiry.
 *
 * @throws Clear Error when YouTube refresh fails (e.g. the user revoked access).
 */
export async function refreshTokenIfNeeded(account: ConnectedAccount): Promise<PlatformTokens> {
  if (account.platform === 'sermon_audio') {
    if (!account.accessToken.trim()) {
      throw new Error(
        'SermonAudio API key is missing. Reconnect your SermonAudio account to continue.'
      );
    }
    return {
      accessToken: account.accessToken,
      refreshToken: account.refreshToken,
      tokenExpiry: account.tokenExpiry,
    };
  }

  if (!tokenNeedsRefresh(account.tokenExpiry, Date.now(), account.accessToken)) {
    return {
      accessToken: account.accessToken,
      refreshToken: account.refreshToken,
      tokenExpiry: account.tokenExpiry,
    };
  }

  if (account.platform === 'vimeo') {
    if (!account.accessToken.trim()) {
      throw new Error('Vimeo access token is missing. Reconnect your Vimeo account to continue.');
    }
    return {
      accessToken: account.accessToken,
      refreshToken: account.refreshToken,
      tokenExpiry: account.tokenExpiry,
    };
  }

  if (account.platform === 'youtube') {
    const refreshToken = account.refreshToken.trim();
    if (!refreshToken) {
      throw new Error(
        'YouTube access token is expired or near expiry and no refresh token is stored. Reconnect your YouTube account.'
      );
    }

    const refreshed = await refreshYouTubeAccessToken({ refreshToken });
    if ('error' in refreshed) {
      const statusSuffix =
        refreshed.error.statusCode != null ? ` (HTTP ${refreshed.error.statusCode})` : '';
      const detailsSuffix = refreshed.error.details
        ? ` Details: ${typeof refreshed.error.details === 'string' ? refreshed.error.details : JSON.stringify(refreshed.error.details)}`
        : '';
      throw new Error(
        `${refreshed.error.code}: ${refreshed.error.message}${statusSuffix}${detailsSuffix}`
      );
    }

    const persisted = await updateTokens(
      account.id,
      refreshed.accessToken,
      refreshed.refreshToken,
      refreshed.tokenExpiry
    );
    if (persisted === null) {
      throw new Error(
        'Failed to persist refreshed YouTube tokens because the connected account no longer exists.'
      );
    }

    return {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      tokenExpiry: refreshed.tokenExpiry,
    };
  }

  if (account.platform === 'google_drive') {
    const refreshToken = account.refreshToken.trim();
    if (!refreshToken) {
      throw new Error(
        'Google Drive access token is expired or near expiry and no refresh token is stored. Reconnect your Google Drive account.'
      );
    }

    const refreshed = await refreshGoogleDriveAccessToken({ refreshToken });
    if ('error' in refreshed) {
      const statusSuffix =
        refreshed.error.statusCode != null ? ` (HTTP ${refreshed.error.statusCode})` : '';
      const detailsSuffix = refreshed.error.details
        ? ` Details: ${typeof refreshed.error.details === 'string' ? refreshed.error.details : JSON.stringify(refreshed.error.details)}`
        : '';
      throw new Error(
        `${refreshed.error.code}: ${refreshed.error.message}${statusSuffix}${detailsSuffix}`
      );
    }

    const persisted = await updateTokens(
      account.id,
      refreshed.accessToken,
      refreshed.refreshToken,
      refreshed.tokenExpiry
    );
    if (persisted === null) {
      throw new Error(
        'Failed to persist refreshed Google Drive tokens because the connected account no longer exists.'
      );
    }

    return {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      tokenExpiry: refreshed.tokenExpiry,
    };
  }

  if (account.platform === 'sftp') {
    if (!account.accessToken.trim()) {
      throw new Error('SFTP credential is missing. Reconnect your SFTP account to continue.');
    }
    return {
      accessToken: account.accessToken,
      refreshToken: account.refreshToken,
      tokenExpiry: account.tokenExpiry,
    };
  }

  if (account.platform === 'smb') {
    if (!account.accessToken.trim()) {
      throw new Error('SMB password is missing. Reconnect your SMB account to continue.');
    }
    return {
      accessToken: account.accessToken,
      refreshToken: account.refreshToken,
      tokenExpiry: account.tokenExpiry,
    };
  }

  const _exhaustive: never = account.platform;
  throw new Error(`Unsupported platform: ${String(_exhaustive)}`);
}
