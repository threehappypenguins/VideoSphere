import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUserIdFromCookies } from '@/lib/auth/get-current-user-id-from-cookies';
import { getConnectedAccount } from '@/lib/repositories/connected-accounts';
import {
  readFacebookSetupSessionFromCookies,
  toFacebookSetupSessionPublic,
} from '@/lib/platforms/facebook-setup-session';
import { FacebookConnectButton } from '@/components/connections/FacebookConnectButton';

/**
 * Provides static page metadata for the Facebook setup route.
 */
export const metadata: Metadata = {
  title: 'Facebook Setup',
  description: 'Choose a Facebook Page or profile for VideoSphere uploads.',
};

/**
 * Post-OAuth picker page where the user selects a Facebook Page or personal profile.
 * @returns Setup UI or redirect when session is missing.
 */
export default async function FacebookSetupPage() {
  const userId = await getCurrentUserIdFromCookies();
  if (!userId) {
    redirect(`/login?redirect=${encodeURIComponent('/profile/connections/facebook-setup')}`);
  }

  const setupSession = await readFacebookSetupSessionFromCookies();
  if (!setupSession || setupSession.userId !== userId) {
    redirect('/profile/connections?error=facebook');
  }

  const existingAccount = await getConnectedAccount(userId, 'facebook');
  const existingConnection =
    existingAccount?.facebookTargetType != null
      ? {
          targetType: existingAccount.facebookTargetType,
          ...(existingAccount.facebookPageId ? { pageId: existingAccount.facebookPageId } : {}),
          label: existingAccount.platformName,
        }
      : undefined;

  const setupSessionPublic = toFacebookSetupSessionPublic(setupSession);

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/profile/connections"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          ← Back to connected accounts
        </Link>

        <h1 className="mt-4 text-3xl font-bold text-foreground">Finish Facebook Connection</h1>
        <p className="mt-2 text-muted-foreground">
          Choose the Facebook Page VideoSphere should publish your videos to. Meta’s Video API only
          supports Page publishing.
        </p>

        <div className="mt-8 rounded-xl border border-border bg-background p-5">
          <p className="text-sm text-muted-foreground">
            Signed in to Facebook as{' '}
            <span className="font-medium text-foreground">
              {setupSessionPublic.userProfileName}
            </span>
            .
          </p>
          <div className="mt-4">
            <FacebookConnectButton
              label="Choose publish target"
              setupSession={setupSessionPublic}
              existingConnection={existingConnection}
              defaultOpen
            />
          </div>
        </div>
      </div>
    </div>
  );
}
