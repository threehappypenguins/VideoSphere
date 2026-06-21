// =============================================================================
// CONNECTED ACCOUNTS PAGE  (/profile/connections)
// =============================================================================
// Lists the user's connected platform accounts (YouTube, Vimeo, Google Drive, SFTP, SMB, SermonAudio, Facebook) and provides
// connect actions: OAuth redirects for YouTube/Vimeo/Google Drive/Facebook, and in-page modals for SFTP/SMB/SermonAudio/Google Drive backup folder settings.
//
// Session is read server-side via the authenticated session cookie so the page can
// fetch real connected-account data without an extra client round-trip.
// Unauthenticated users are redirected to /login.
//
// Flash messages come from ?success=youtube|vimeo and ?error=youtube|vimeo query params set
// by the OAuth callback routes.
// =============================================================================

import type { Metadata } from 'next';
import Link from 'next/link'; // used for the back link (same-origin)
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { isTokenDecryptError } from '@/lib/crypto/token-encryption';
import { getCurrentUserIdFromCookies } from '@/lib/auth/get-current-user-id-from-cookies';
import {
  getConnectedAccountsByUser,
  getConnectedAccountForUser,
  getConnectedAccountWithTokens,
  deleteConnectedAccount,
} from '@/lib/repositories/connected-accounts';
import { clearDraftLivestreamYouTubeBroadcastLinksForUser } from '@/lib/repositories/livestreams';
import { normalizeConnectedAccountSftpHostKeyFingerprint } from '@/lib/models/ConnectedAccount';
import { revokeFacebookAppAuthorization } from '@/lib/platforms/facebook-oauth';
import type { ConnectedAccountPublic } from '@/types';
import { ConnectButton } from './ConnectButton';
import { SftpConnectButton, type SftpExistingConnection } from './SftpConnectButton';
import { SmbConnectButton, type SmbExistingConnection } from './SmbConnectButton';
import {
  GoogleDriveConnectButton,
  type GoogleDriveExistingConnection,
} from './GoogleDriveConnectButton';
import {
  YouTubeStreamKeysButton,
  type YouTubeStreamKeysExistingConnection,
} from './YouTubeStreamKeysButton';
import {
  SermonAudioConnectButton,
  type SermonAudioExistingConnection,
} from './SermonAudioConnectButton';
import {
  FacebookConnectButton,
  type FacebookExistingConnection,
} from '@/components/connections/FacebookConnectButton';
import { DisconnectButton } from './DisconnectButton';
import { FlashMessage } from './FlashMessage';
import { PlatformIcon, isPlatformBrandIcon } from '@/components/icons/PlatformIcon';
import type { ConnectedAccountPlatform } from '@/types';
import { BACKUP_PLATFORMS, VIDEO_PLATFORMS } from '@/lib/ui/platform-sections';

/**
 * Provides static page metadata for this route segment.
 */
export const metadata: Metadata = {
  title: 'Connected Accounts',
  description: 'Manage your connected video platform accounts.',
};

interface PageProps {
  searchParams: Promise<{ success?: string; error?: string; setup?: string }>;
}

async function getCurrentUserId(): Promise<string | null> {
  return getCurrentUserIdFromCookies();
}

const PLATFORM_META: Record<
  ConnectedAccountPlatform,
  { label: string; emoji?: string; connectHref: string | null }
> = {
  youtube: {
    label: 'YouTube',
    connectHref: '/api/platforms/connect/youtube',
  },
  vimeo: {
    label: 'Vimeo',
    connectHref: '/api/platforms/connect/vimeo',
  },
  google_drive: {
    label: 'Google Drive',
    connectHref: '/api/platforms/connect/drive',
  },
  sftp: {
    label: 'SFTP Server',
    emoji: '🖥️',
    connectHref: null,
  },
  smb: {
    label: 'SMB / Network Share',
    emoji: '🗄️',
    connectHref: null,
  },
  sermon_audio: {
    label: 'SermonAudio',
    connectHref: null,
  },
  facebook: {
    label: 'Facebook',
    connectHref: '/api/platforms/connect/facebook',
  },
};

/** Shown on the SMB connection card — SMB backup uploads are slower than SFTP for large files. */
const SMB_PERFORMANCE_NOTE =
  'For faster large backups, prefer SFTP — SMB sends video in many small pieces, so uploads take longer.';

/**
 * Sorts platforms within a connections section: rows with an existing connection
 * (connected or expired) appear first in alphabetical order, followed by
 * not-connected rows in alphabetical order.
 * @param platforms - Platforms belonging to the section.
 * @param accounts - The user's connected account rows.
 * @returns Platforms sorted for display.
 */
function sortPlatformsInSection(
  platforms: readonly ConnectedAccountPlatform[],
  accounts: ConnectedAccountPublic[]
): ConnectedAccountPlatform[] {
  return [...platforms]
    .map((platform) => {
      const account = accounts.find((a) => a.platform === platform);
      const status = getConnectionStatus(account);
      return {
        platform,
        label: PLATFORM_META[platform].label,
        hasConnection: status !== 'not-connected',
      };
    })
    .sort((a, b) => {
      if (a.hasConnection !== b.hasConnection) {
        return a.hasConnection ? -1 : 1;
      }
      return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
    })
    .map(({ platform }) => platform);
}

/** True when an SFTP row has the fields required for backups (including a pinned host key). */
function isSftpConnectionReady(account: ConnectedAccountPublic): boolean {
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

/** True when an SMB row has the fields required for backups. */
function isSmbConnectionReady(account: ConnectedAccountPublic): boolean {
  return (
    account.platform === 'smb' &&
    Boolean(account.smbHost?.trim()) &&
    Boolean(account.smbShare?.trim()) &&
    account.smbRemotePath != null &&
    account.smbRemotePath.trim() !== ''
  );
}

/** True when a SermonAudio row has the broadcaster id required for uploads. */
function isSermonAudioConnectionReady(account: ConnectedAccountPublic): boolean {
  return account.platform === 'sermon_audio' && Boolean(account.platformUserId.trim());
}

/** Build editable SMB settings from a connected account row (non-secret fields only). */
function toSmbExistingConnection(
  account: ConnectedAccountPublic
): SmbExistingConnection | undefined {
  if (
    account.platform !== 'smb' ||
    !account.smbHost?.trim() ||
    !account.smbShare?.trim() ||
    account.smbRemotePath == null
  ) {
    return undefined;
  }

  return {
    host: account.smbHost,
    share: account.smbShare,
    domain: account.smbDomain ?? '',
    username: account.platformUserId,
    remotePath: account.smbRemotePath,
    label: account.platformName,
  };
}

/** Build editable SFTP settings from a connected account row (non-secret fields only). */
function toSftpExistingConnection(
  account: ConnectedAccountPublic
): SftpExistingConnection | undefined {
  if (
    account.platform !== 'sftp' ||
    !account.sftpHost?.trim() ||
    !account.sftpRemotePath?.trim() ||
    !account.sftpAuthMethod
  ) {
    return undefined;
  }

  return {
    host: account.sftpHost,
    port: account.sftpPort ?? 22,
    username: account.platformUserId,
    remotePath: account.sftpRemotePath,
    authMethod: account.sftpAuthMethod,
    label: account.platformName,
  };
}

/** Build editable Google Drive settings from a connected account row (non-secret fields only). */
function toGoogleDriveExistingConnection(
  account: ConnectedAccountPublic
): GoogleDriveExistingConnection | undefined {
  if (account.platform !== 'google_drive') {
    return undefined;
  }

  return {
    backupFolderPath: account.googleDriveBackupFolderPath ?? '',
    label: account.platformName,
  };
}

/** Build YouTube stream key presence flags from a connected account row (no plaintext keys). */
function toYouTubeStreamKeysExistingConnection(
  account: ConnectedAccountPublic
): YouTubeStreamKeysExistingConnection | undefined {
  if (account.platform !== 'youtube') {
    return undefined;
  }

  return {
    hasMainStreamKey: account.hasYoutubeMainStreamKey,
    hasTempStreamKey: account.hasYoutubeTempStreamKey,
  };
}

/** Build editable SermonAudio settings from a connected account row (non-secret fields only). */
function toSermonAudioExistingConnection(
  account: ConnectedAccountPublic
): SermonAudioExistingConnection | undefined {
  if (account.platform !== 'sermon_audio' || !account.platformUserId.trim()) {
    return undefined;
  }

  return {
    broadcasterID: account.platformUserId,
    label: account.platformName,
  };
}

/** Build editable Facebook target settings from a connected account row. */
function toFacebookExistingConnection(
  account: ConnectedAccountPublic
): FacebookExistingConnection | undefined {
  if (account.platform !== 'facebook' || account.facebookTargetType == null) {
    return undefined;
  }

  return {
    targetType: account.facebookTargetType,
    ...(account.facebookPageId ? { pageId: account.facebookPageId } : {}),
    label: account.platformName,
  };
}

/** Derive connection status from tokenExpiry and whether a refresh token exists. */
function getConnectionStatus(
  account: ConnectedAccountPublic | undefined
): 'connected' | 'expired' | 'not-connected' {
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
  // YouTube, Google Drive, and Facebook use short-lived or schedulable tokens; a stored refresh token
  // means the link can be renewed automatically before the next API call.
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

function StatusBadge({ status }: { status: 'connected' | 'expired' | 'not-connected' }) {
  if (status === 'connected') {
    return (
      <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900 dark:text-green-200">
        Connected
      </span>
    );
  }
  if (status === 'expired') {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900 dark:text-amber-200">
        Expired — reconnect
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
      Not connected
    </span>
  );
}

async function disconnectPlatform(accountId: string) {
  'use server';

  // Re-verify the session inside the action and confirm ownership before deleting.
  const userId = await getCurrentUserId();
  if (!userId) return;

  // Verify ownership by account id (IDOR-safe) so caller-provided platform
  // cannot affect authorization decisions.
  const account = await getConnectedAccountForUser(accountId, userId);
  if (!account) return;

  // Use canonical platform from the owned row instead of caller-provided value.
  const canonicalPlatform = account.platform;

  // Best-effort token read for provider revocation. If decryption fails we
  // still disconnect locally to unblock the user.
  const accountWithTokens = await getConnectedAccountWithTokens(userId, canonicalPlatform)
    .then((row) => {
      // Defensive: only use tokens when the resolved row matches the requested id.
      if (!row || row.id !== accountId) return null;
      return row;
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      if (isTokenDecryptError(err)) {
        console.warn(
          '[disconnectPlatform] Could not decrypt existing tokens; skipping provider revocation and deleting DB row:',
          message
        );
      } else {
        console.error(
          '[disconnectPlatform] Unexpected error reading account for revocation; skipping provider revocation and deleting DB row:',
          message
        );
      }
      return null;
    });

  // Revoke the token with the provider so it disappears from the user's
  // connected-apps list (e.g. Google Account → Third-party apps & services).
  // This is best-effort: if revocation fails we still remove from our DB.
  if (canonicalPlatform === 'youtube' && accountWithTokens?.refreshToken) {
    try {
      await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: accountWithTokens.refreshToken }).toString(),
      });
    } catch (err) {
      console.error('[disconnectPlatform] Token revocation failed (non-fatal):', err);
    }
  }

  if (canonicalPlatform === 'google_drive' && accountWithTokens) {
    try {
      const tokenToRevoke =
        accountWithTokens.refreshToken.trim() || accountWithTokens.accessToken.trim();
      if (tokenToRevoke) {
        await fetch('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: tokenToRevoke }).toString(),
        });
      }
    } catch (err) {
      console.error('[disconnectPlatform] Google Drive token revocation failed (non-fatal):', err);
    }
  }

  // Vimeo: DELETE /tokens revokes the access token, removing the app from
  // the user's "Connected Apps" list on vimeo.com/settings/apps.
  if (canonicalPlatform === 'vimeo' && accountWithTokens?.accessToken) {
    try {
      const revokeRes = await fetch('https://api.vimeo.com/tokens', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accountWithTokens.accessToken}`,
          Accept: 'application/vnd.vimeo.*+json;version=3.4',
        },
      });
      if (!revokeRes.ok) {
        const body = await revokeRes.text();
        console.error(
          `[disconnectPlatform] Vimeo token revocation returned ${revokeRes.status}:`,
          body
        );
      }
    } catch (err) {
      console.error('[disconnectPlatform] Vimeo token revocation failed (non-fatal):', err);
    }
  }

  if (canonicalPlatform === 'facebook' && accountWithTokens) {
    try {
      // Prefer the stored long-lived user token: DELETE /me/permissions with a user token
      // removes VideoSphere from Settings > Business Integrations. A Page token only
      // revokes Page-scoped access and leaves the Business Integration entry visible.
      const userToken = accountWithTokens.refreshToken.trim();
      const pageToken = accountWithTokens.accessToken.trim();

      if (userToken || pageToken) {
        let revoked = false;

        if (userToken) {
          revoked = await revokeFacebookAppAuthorization(userToken);
        }

        if (!revoked && pageToken && pageToken !== userToken) {
          revoked = await revokeFacebookAppAuthorization(pageToken);
        }

        if (!revoked) {
          console.error(
            '[disconnectPlatform] Facebook token revocation returned non-OK (non-fatal)'
          );
        }
      }
    } catch (err) {
      console.error('[disconnectPlatform] Facebook token revocation failed (non-fatal):', err);
    }
  }

  await deleteConnectedAccount(accountId);

  if (canonicalPlatform === 'youtube') {
    try {
      const cleared = await clearDraftLivestreamYouTubeBroadcastLinksForUser(userId);
      if (cleared > 0) {
        console.log(
          `[disconnectPlatform] Cleared stale YouTube broadcast links from ${cleared} draft livestream(s).`
        );
      }
    } catch (err) {
      console.error('[disconnectPlatform] Failed to clear draft YouTube broadcast links:', err);
    }
  }

  revalidatePath('/profile/connections');
}

interface ConnectionPlatformRowProps {
  platform: ConnectedAccountPlatform;
  account: ConnectedAccountPublic | undefined;
  openGoogleDriveBackupSetup?: boolean;
}

/**
 * Renders a single platform row on the connections page.
 * @param props - Row props.
 * @returns Platform connection row UI.
 */
function ConnectionPlatformRow({
  platform,
  account,
  openGoogleDriveBackupSetup = false,
}: ConnectionPlatformRowProps) {
  const meta = PLATFORM_META[platform];
  const status = getConnectionStatus(account);
  const sftpExistingConnection =
    account?.platform === 'sftp' ? toSftpExistingConnection(account) : undefined;
  const smbExistingConnection =
    account?.platform === 'smb' ? toSmbExistingConnection(account) : undefined;
  const sermonAudioExistingConnection =
    account?.platform === 'sermon_audio' ? toSermonAudioExistingConnection(account) : undefined;
  const facebookExistingConnection =
    account?.platform === 'facebook' ? toFacebookExistingConnection(account) : undefined;
  const googleDriveExistingConnection =
    account?.platform === 'google_drive' ? toGoogleDriveExistingConnection(account) : undefined;
  const youtubeStreamKeysExistingConnection =
    account?.platform === 'youtube' ? toYouTubeStreamKeysExistingConnection(account) : undefined;
  const youtubeStreamKeysEditButton =
    youtubeStreamKeysExistingConnection != null ? (
      <YouTubeStreamKeysButton
        label="Edit"
        existingConnection={youtubeStreamKeysExistingConnection}
        className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
      />
    ) : null;

  return (
    <div
      data-platform={platform}
      className="flex items-center justify-between rounded-xl border border-border bg-background p-5"
    >
      <div className="flex items-center gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-lg">
          {isPlatformBrandIcon(platform) ? (
            <PlatformIcon platform={platform} size={36} />
          ) : (
            meta.emoji
          )}
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-foreground">{meta.label}</p>
            <StatusBadge status={status} />
          </div>
          {account && (
            <p className="text-sm text-muted-foreground">
              {status === 'expired' ? 'Was connected as ' : 'Connected as '}
              <span className="font-medium text-foreground">{account.platformName}</span>
            </p>
          )}
          {platform === 'smb' && (
            <p className="mt-1 text-xs text-muted-foreground">{SMB_PERFORMANCE_NOTE}</p>
          )}
        </div>
      </div>

      {status === 'connected' && account ? (
        platform === 'sftp' ? (
          <div className="flex items-center gap-2">
            <SftpConnectButton
              label="Edit"
              existingConnection={sftpExistingConnection!}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            />
            <DisconnectButton
              action={disconnectPlatform.bind(null, account.id)}
              platformLabel={meta.label}
            />
          </div>
        ) : platform === 'smb' ? (
          <div className="flex items-center gap-2">
            <SmbConnectButton
              label="Edit"
              existingConnection={smbExistingConnection!}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            />
            <DisconnectButton
              action={disconnectPlatform.bind(null, account.id)}
              platformLabel={meta.label}
            />
          </div>
        ) : platform === 'sermon_audio' ? (
          <div className="flex items-center gap-2">
            <SermonAudioConnectButton
              label="Edit"
              existingConnection={sermonAudioExistingConnection!}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            />
            <DisconnectButton
              action={disconnectPlatform.bind(null, account.id)}
              platformLabel={meta.label}
            />
          </div>
        ) : platform === 'facebook' ? (
          <div className="flex items-center gap-2">
            <FacebookConnectButton
              label="Edit"
              existingConnection={facebookExistingConnection}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            />
            <DisconnectButton
              action={disconnectPlatform.bind(null, account.id)}
              platformLabel={meta.label}
            />
          </div>
        ) : platform === 'google_drive' && googleDriveExistingConnection ? (
          <div className="flex items-center gap-2">
            <GoogleDriveConnectButton
              label="Edit"
              existingConnection={googleDriveExistingConnection}
              autoOpen={openGoogleDriveBackupSetup}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            />
            <DisconnectButton
              action={disconnectPlatform.bind(null, account.id)}
              platformLabel={meta.label}
            />
          </div>
        ) : platform === 'youtube' && youtubeStreamKeysExistingConnection ? (
          <div className="flex items-center gap-2">
            {youtubeStreamKeysEditButton}
            <DisconnectButton
              action={disconnectPlatform.bind(null, account.id)}
              platformLabel={meta.label}
            />
          </div>
        ) : (
          <DisconnectButton
            action={disconnectPlatform.bind(null, account.id)}
            platformLabel={meta.label}
          />
        )
      ) : status === 'expired' && account ? (
        <div className="flex items-center gap-2">
          {meta.connectHref ? (
            <>
              <ConnectButton href={meta.connectHref} label="Reconnect" />
              {youtubeStreamKeysEditButton}
            </>
          ) : platform === 'sftp' ? (
            <SftpConnectButton label="Reconnect" existingConnection={sftpExistingConnection} />
          ) : platform === 'smb' ? (
            <SmbConnectButton label="Reconnect" existingConnection={smbExistingConnection} />
          ) : (
            <SermonAudioConnectButton
              label="Reconnect"
              existingConnection={sermonAudioExistingConnection}
            />
          )}
          <DisconnectButton
            action={disconnectPlatform.bind(null, account.id)}
            platformLabel={meta.label}
          />
        </div>
      ) : meta.connectHref ? (
        <ConnectButton
          href={meta.connectHref}
          label="Connect"
          {...(platform === 'youtube' ? { 'data-tour': 'first-connect-button' } : {})}
        />
      ) : platform === 'sftp' ? (
        <SftpConnectButton label="Connect" />
      ) : platform === 'smb' ? (
        <SmbConnectButton label="Connect" />
      ) : (
        <SermonAudioConnectButton label="Connect" />
      )}
    </div>
  );
}

/**
 * Renders the connections page component.
 * @param props - Component props.
 * @returns The rendered UI output.
 */
export default async function ConnectionsPage({ searchParams }: PageProps) {
  const userId = await getCurrentUserId();
  if (!userId) {
    redirect(`/login?redirect=${encodeURIComponent('/profile/connections')}`);
  }

  const { success, error, setup } = await searchParams;
  const openGoogleDriveBackupSetup = success === 'google_drive' && setup === 'backup_folder';

  let accounts: ConnectedAccountPublic[] = [];
  try {
    accounts = await getConnectedAccountsByUser(userId);
  } catch (err) {
    console.error('[ConnectionsPage] Failed to fetch connected accounts:', err);
  }

  const sortedVideoPlatforms = sortPlatformsInSection(VIDEO_PLATFORMS, accounts);
  const sortedBackupPlatforms = sortPlatformsInSection(BACKUP_PLATFORMS, accounts);

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        {/* Back link */}
        <Link
          href="/profile"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          ← Back to profile
        </Link>

        <h1 className="mt-4 text-3xl font-bold text-foreground">Connected Accounts</h1>
        <p className="mt-2 text-muted-foreground">
          Connect your video platform accounts so VideoSphere can distribute your videos.
        </p>

        {/* Flash messages — shown once then URL is cleaned by the component */}
        {success === 'youtube' && (
          <FlashMessage type="success" message="✓ YouTube account connected successfully." />
        )}
        {error === 'youtube' && (
          <FlashMessage
            type="error"
            message="✗ Failed to connect YouTube account. Please try again."
          />
        )}
        {error === 'youtube_no_channel' && (
          <FlashMessage
            type="error"
            message="✗ That Google account does not have a YouTube channel. Create one at youtube.com (profile → Create a channel), or choose a different Google account when connecting."
          />
        )}
        {success === 'vimeo' && (
          <FlashMessage type="success" message="✓ Vimeo account connected successfully." />
        )}
        {success === 'google_drive' && (
          <FlashMessage type="success" message="✓ Google Drive account connected successfully." />
        )}
        {error === 'vimeo' && (
          <FlashMessage
            type="error"
            message="✗ Failed to connect Vimeo account. Please try again."
          />
        )}
        {error === 'google_drive' && (
          <FlashMessage
            type="error"
            message="✗ Failed to connect Google Drive account. Please try again."
          />
        )}
        {success === 'sermon_audio' && (
          <FlashMessage type="success" message="✓ SermonAudio account connected successfully." />
        )}
        {error === 'sermon_audio' && (
          <FlashMessage
            type="error"
            message="✗ Failed to connect SermonAudio account. Please try again."
          />
        )}
        {success === 'facebook' && (
          <FlashMessage type="success" message="✓ Facebook account connected successfully." />
        )}
        {error === 'facebook' && (
          <FlashMessage
            type="error"
            message="✗ Failed to connect Facebook account. Please try again."
          />
        )}

        {/* Platform list */}
        <div className="mt-8 space-y-8">
          <section>
            <h2 className="text-lg font-semibold text-foreground">Video Platforms</h2>
            <div className="mt-4 space-y-4">
              {sortedVideoPlatforms.map((platform) => (
                <ConnectionPlatformRow
                  key={platform}
                  platform={platform}
                  account={accounts.find((a) => a.platform === platform)}
                />
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">Backup</h2>
            <div className="mt-4 space-y-4">
              {sortedBackupPlatforms.map((platform) => (
                <ConnectionPlatformRow
                  key={platform}
                  platform={platform}
                  account={accounts.find((a) => a.platform === platform)}
                  openGoogleDriveBackupSetup={
                    platform === 'google_drive' ? openGoogleDriveBackupSetup : false
                  }
                />
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
