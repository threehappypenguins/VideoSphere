/**
 * Central OAuth token refresh for platform APIs (distribution and other callers).
 * YouTube: refreshes when the access token is expired or within the lead window.
 * Vimeo: returns stored tokens without a remote refresh (long-lived tokens).
 */

import type { ConnectedAccount } from '@/types';
import { updateTokens } from '@/lib/repositories/connected-accounts';
import { refreshYouTubeAccessToken } from '@/lib/platforms/youtube';

/** Refresh if access token expires within this window (ms). */
export const TOKEN_REFRESH_LEAD_MS = 5 * 60 * 1000;

export type PlatformTokens = {
  accessToken: string;
  refreshToken: string;
  tokenExpiry: string;
};

/**
 * Returns true when the access token is missing, invalid, or expires at or before
 * `now + TOKEN_REFRESH_LEAD_MS`.
 */
export function tokenNeedsRefresh(tokenExpiryIso: string, nowMs = Date.now()): boolean {
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
  if (!tokenNeedsRefresh(account.tokenExpiry)) {
    return {
      accessToken: account.accessToken,
      refreshToken: account.refreshToken,
      tokenExpiry: account.tokenExpiry,
    };
  }

  if (account.platform === 'vimeo') {
    return {
      accessToken: account.accessToken,
      refreshToken: account.refreshToken,
      tokenExpiry: account.tokenExpiry,
    };
  }

  if (account.platform === 'youtube') {
    if (!account.refreshToken) {
      throw new Error(
        'YouTube access token is expired or near expiry and no refresh token is stored. Reconnect your YouTube account.'
      );
    }

    const refreshed = await refreshYouTubeAccessToken({ refreshToken: account.refreshToken });
    if ('error' in refreshed) {
      const d = refreshed.error.details;
      const details = d != null ? ` ${typeof d === 'string' ? d : JSON.stringify(d)}` : '';
      throw new Error(`${refreshed.error.code}: ${refreshed.error.message}${details}`);
    }

    await updateTokens(
      account.id,
      refreshed.accessToken,
      refreshed.refreshToken,
      refreshed.tokenExpiry
    );

    return {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      tokenExpiry: refreshed.tokenExpiry,
    };
  }

  const _exhaustive: never = account.platform;
  throw new Error(`Unsupported platform: ${String(_exhaustive)}`);
}
