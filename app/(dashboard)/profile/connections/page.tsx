// =============================================================================
// CONNECTED ACCOUNTS PAGE  (/profile/connections)
// =============================================================================
// Lists the user's connected platform accounts (YouTube, Vimeo) and provides
// links to connect new ones via the OAuth flow.
//
// Session is read server-side via the Appwrite session cookie so the page can
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
import { getCurrentUserIdFromCookies } from '@/lib/auth/get-current-user-id-from-cookies';
import {
  getConnectedAccountsByUser,
  getConnectedAccountWithTokens,
  deleteConnectedAccount,
} from '@/lib/repositories/connected-accounts';
import type { ConnectedAccountPublic } from '@/types';
import { ConnectButton } from './ConnectButton';
import { DisconnectButton } from './DisconnectButton';
import { FlashMessage } from './FlashMessage';

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

const PLATFORM_META: Record<string, { label: string; icon: string; connectHref: string }> = {
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
};

const ALL_PLATFORMS = ['youtube', 'vimeo'] as const;

/** Derive connection status from tokenExpiry and whether a refresh token exists. */
function getConnectionStatus(
  account: ConnectedAccountPublic | undefined
): 'connected' | 'expired' | 'not-connected' {
  if (!account) return 'not-connected';
  const expiryMs = new Date(account.tokenExpiry).getTime();
  if (!Number.isNaN(expiryMs) && expiryMs > Date.now()) return 'connected';
  // YouTube: short-lived access tokens; a stored refresh token means the link can be renewed.
  if (account.platform === 'youtube' && account.hasRefreshToken) return 'connected';
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

async function disconnectPlatform(accountId: string, platform: string) {
  'use server';

  // Re-verify the session inside the action and confirm ownership before deleting.
  const userId = await getCurrentUserId();
  if (!userId) return;

  // Fetch the account with tokens and verify it belongs to this user.
  const accountWithTokens = await getConnectedAccountWithTokens(
    userId,
    platform as import('@/types').ConnectedAccountPlatform
  );

  // Guard: only proceed if the requested accountId matches the user's actual account.
  if (!accountWithTokens || accountWithTokens.id !== accountId) return;

  // Revoke the token with the provider so it disappears from the user's
  // connected-apps list (e.g. Google Account → Third-party apps & services).
  // This is best-effort: if revocation fails we still remove from our DB.
  if (platform === 'youtube' && accountWithTokens.refreshToken) {
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

  // Vimeo: DELETE /tokens revokes the access token, removing the app from
  // the user's "Connected Apps" list on vimeo.com/settings/apps.
  if (platform === 'vimeo' && accountWithTokens.accessToken) {
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
        {error === 'vimeo' && (
          <FlashMessage
            type="error"
            message="✗ Failed to connect Vimeo account. Please try again."
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
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-foreground">{meta.label}</p>
                      <StatusBadge status={status} />
                    </div>
                    {account ? (
                      <p className="text-sm text-muted-foreground">
                        {status === 'expired' ? 'Was connected as ' : 'Connected as '}
                        <span className="font-medium text-foreground">{account.platformName}</span>
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground">Not connected</p>
                    )}
                  </div>
                </div>

                {status === 'connected' && account ? (
                  <DisconnectButton
                    action={disconnectPlatform.bind(null, account.id, platform)}
                    platformLabel={meta.label}
                  />
                ) : status === 'expired' && account ? (
                  // Token is expired — offer both reconnect and disconnect.
                  <div className="flex items-center gap-2">
                    <ConnectButton href={meta.connectHref} label="Reconnect" />
                    <DisconnectButton
                      action={disconnectPlatform.bind(null, account.id, platform)}
                      platformLabel={meta.label}
                    />
                  </div>
                ) : (
                  <ConnectButton
                    href={meta.connectHref}
                    label="Connect"
                    {...(platform === ALL_PLATFORMS[0]
                      ? { 'data-tour': 'first-connect-button' }
                      : {})}
                  />
                )}
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}
