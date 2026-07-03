import { normalizeConnectedAccountSftpHostKeyFingerprint } from '@/lib/connected-accounts/sftp-validation';
import type { ConnectedAccountPlatform, ConnectedAccountPublic } from '@/types';

/**
 * Whether a connected account row can be used for uploads and distribution.
 */
export type PlatformConnectionStatus = 'connected' | 'expired' | 'not-connected';

/** OAuth platforms whose access tokens can be renewed with a stored refresh token. */
export const OAUTH_REFRESH_PLATFORMS = ['youtube', 'google_drive', 'facebook'] as const;

/**
 * True when an SFTP row has the fields required for backups (including a pinned host key).
 * @param account - Public connected account row.
 * @returns Whether SFTP backups can run with this row.
 */
export function isSftpConnectionReady(account: ConnectedAccountPublic): boolean {
  const fingerprint = account.sftpHostKeyFingerprint;
  return (
    account.platform === 'sftp' &&
    Boolean(account.sftpHost?.trim()) &&
    Boolean(account.sftpRemotePath?.trim()) &&
    Boolean(account.sftpAuthMethod) &&
    fingerprint != null &&
    normalizeConnectedAccountSftpHostKeyFingerprint(fingerprint) != null
  );
}

/**
 * True when an SMB row has the fields required for backups.
 * @param account - Public connected account row.
 * @returns Whether SMB backups can run with this row.
 */
export function isSmbConnectionReady(account: ConnectedAccountPublic): boolean {
  return (
    account.platform === 'smb' &&
    Boolean(account.smbHost?.trim()) &&
    Boolean(account.smbShare?.trim()) &&
    account.smbRemotePath != null &&
    account.smbRemotePath.trim() !== ''
  );
}

/**
 * True when a SermonAudio row has the broadcaster id required for uploads.
 * @param account - Public connected account row.
 * @returns Whether SermonAudio uploads can run with this row.
 */
export function isSermonAudioConnectionReady(account: ConnectedAccountPublic): boolean {
  return account.platform === 'sermon_audio' && Boolean(account.platformUserId.trim());
}

/**
 * Derives connection status from token expiry, refresh-token presence, and platform-specific fields.
 * Does not call remote OAuth providers.
 * @param account - Public connected account row, if any.
 * @returns Static connection status for UI and API filtering.
 */
export function getConnectionStatus(
  account: ConnectedAccountPublic | undefined
): PlatformConnectionStatus {
  if (!account) return 'not-connected';
  if (account.platform === 'sftp') {
    return isSftpConnectionReady(account) ? 'connected' : 'expired';
  }
  if (account.platform === 'smb') {
    return isSmbConnectionReady(account) ? 'connected' : 'expired';
  }
  if (account.platform === 'sermon_audio') {
    return isSermonAudioConnectionReady(account) ? 'connected' : 'expired';
  }
  const expiryMs = new Date(account.tokenExpiry).getTime();
  if (!Number.isNaN(expiryMs) && expiryMs > Date.now()) return 'connected';
  if (
    (account.platform === 'youtube' ||
      account.platform === 'google_drive' ||
      account.platform === 'facebook') &&
    account.hasRefreshToken
  ) {
    return 'connected';
  }
  return 'expired';
}

/**
 * Resolves the effective connection status, preferring a server-verified value when present.
 * @param account - Public connected account row, if any.
 * @returns Connection status suitable for UI badges and platform toggles.
 */
export function resolveConnectionStatus(
  account: ConnectedAccountPublic | undefined
): PlatformConnectionStatus {
  if (!account) return 'not-connected';
  if (account.connectionStatus != null) return account.connectionStatus;
  return getConnectionStatus(account);
}

/**
 * True when the account row is healthy enough for uploads, imports, and distribution.
 * @param account - Public connected account row.
 * @returns Whether the platform should appear as connected in client UI.
 */
export function isUsablePlatformConnection(account: ConnectedAccountPublic): boolean {
  return resolveConnectionStatus(account) === 'connected';
}

/**
 * Returns platform ids for accounts that passed connection health checks.
 * @param accounts - Connected account rows from the connections API.
 * @returns Platforms that can be selected for distribution.
 */
export function getUsableConnectedPlatforms(
  accounts: ConnectedAccountPublic[]
): ConnectedAccountPlatform[] {
  return accounts.filter(isUsablePlatformConnection).map((account) => account.platform);
}

/**
 * True when an OAuth account should be probed on the connections page.
 * @param account - Public connected account row.
 * @returns Whether a refresh attempt is needed to verify health.
 */
export function accountNeedsOAuthHealthProbe(account: ConnectedAccountPublic): boolean {
  if (
    account.platform !== 'youtube' &&
    account.platform !== 'google_drive' &&
    account.platform !== 'facebook'
  ) {
    return false;
  }

  return account.hasRefreshToken;
}
