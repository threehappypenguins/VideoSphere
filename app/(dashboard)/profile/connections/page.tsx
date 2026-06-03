// =============================================================================
// CONNECTED ACCOUNTS PAGE  (/profile/connections)
// =============================================================================
// Lists the user's connected platform accounts (YouTube, Vimeo, Google Drive, SFTP) and provides
// links to connect new ones via the OAuth flow.
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
import type { ConnectedAccountPublic } from '@/types';
import { ConnectButton } from './ConnectButton';
import { SftpConnectButton } from './SftpConnectButton';
import { DisconnectButton } from './DisconnectButton';
import { FlashMessage } from './FlashMessage';

/**
 * Provides static page metadata for this route segment.
 */
export const metadata: Metadata = {
  title: 'Connected Accounts',
  description: 'Manage your connected video platform accounts.',
};

interface PageProps {
  searchParams: Promise<{ success?: string; error?: string }>;
}

async function getCurrentUserId(): Promise<string | null> {
  return getCurrentUserIdFromCookies();
}

const PLATFORM_META: Record<string, { label: string; icon: string; connectHref: string | null }> = {
  youtube: {
    label: 'YouTube',
    icon: '▶',
    connectHref: '/api/platforms/connect/youtube',
  },
  vimeo: {
    label: 'Vimeo',
    icon: '🎬',
    connectHref: '/api/platforms/connect/vimeo',
  },
  google_drive: {
    label: 'Google Drive',
    icon: '🗂️',
    connectHref: '/api/platforms/connect/drive',
  },
  sftp: {
    label: 'SFTP Server',
    icon: '🖥️',
    connectHref: null,
  },
};

const ALL_PLATFORMS = ['youtube', 'vimeo', 'google_drive', 'sftp'] as const;

/** Derive connection status from tokenExpiry and whether a refresh token exists. */
function getConnectionStatus(
  account: ConnectedAccountPublic | undefined
): 'connected' | 'expired' | 'not-connected' {
  if (!account) return 'not-connected';
  if (account.platform === 'sftp') {
    const expiryMs = new Date(account.tokenExpiry).getTime();
    if (!Number.isNaN(expiryMs) && expiryMs > Date.now()) return 'connected';
    return 'expired';
  }
  const expiryMs = new Date(account.tokenExpiry).getTime();
  if (!Number.isNaN(expiryMs) && expiryMs > Date.now()) return 'connected';
  // YouTube and Google Drive use short-lived access tokens; a stored refresh token means the link can be renewed.
  if (
    (account.platform === 'youtube' || account.platform === 'google_drive') &&
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

  await deleteConnectedAccount(accountId);
  revalidatePath('/profile/connections');
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

  const { success, error } = await searchParams;

  let accounts: ConnectedAccountPublic[] = [];
  try {
    accounts = await getConnectedAccountsByUser(userId);
  } catch (err) {
    console.error('[ConnectionsPage] Failed to fetch connected accounts:', err);
  }

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

        {/* Platform list */}
        <section className="mt-8 space-y-4">
          {ALL_PLATFORMS.map((platform) => {
            const meta = PLATFORM_META[platform];
            const account = accounts.find((a) => a.platform === platform);
            const status = getConnectionStatus(account);

            return (
              <div
                key={platform}
                className="flex items-center justify-between rounded-xl border border-border bg-background p-5"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-lg">
                    {meta.icon}
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
                  </div>
                </div>

                {status === 'connected' && account ? (
                  <DisconnectButton
                    action={disconnectPlatform.bind(null, account.id)}
                    platformLabel={meta.label}
                  />
                ) : status === 'expired' && account ? (
                  // Token is expired — offer both reconnect and disconnect.
                  <div className="flex items-center gap-2">
                    {meta.connectHref ? (
                      <ConnectButton href={meta.connectHref} label="Reconnect" />
                    ) : (
                      <SftpConnectButton label="Reconnect" />
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
                    {...(platform === ALL_PLATFORMS[0]
                      ? { 'data-tour': 'first-connect-button' }
                      : {})}
                  />
                ) : (
                  <SftpConnectButton label="Connect" />
                )}
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}
