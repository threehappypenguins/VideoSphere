'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';

interface SessionUser {
  $id: string;
  name?: string;
  email?: string;
}

interface UserProfile {
  userId: string;
  email: string;
  isSupporter: boolean;
  role: string;
}

/**
 * Renders the profile content component.
 * @returns The rendered UI output.
 */
export function ProfileContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgradeSuccess, setUpgradeSuccess] = useState(false);

  const handleReplayTour = () => {
    router.push('/dashboard?onboarding=1');
  };

  useEffect(() => {
    // Check for upgrade success param
    if (searchParams.get('upgrade') === 'success') {
      setUpgradeSuccess(true);
      toast.success('Welcome to Supporter! Your account has been upgraded.');
      // Clean the URL without triggering a navigation
      window.history.replaceState({}, '', '/profile');
    }
  }, [searchParams]);

  useEffect(() => {
    // The proxy (middleware) already protects /profile* — if we reach this
    // component the user is authenticated. We only need to load their data.
    async function loadUser() {
      try {
        // Fetch Appwrite session (display name, email)
        const sessionRes = await fetch('/api/auth/session', { credentials: 'include' });
        if (sessionRes.ok) {
          const session: SessionUser = await sessionRes.json();
          setSessionUser(session);
        }

        // Fetch user profile (isSupporter, role, etc.)
        const profileRes = await fetch('/api/auth/profile', { credentials: 'include' });
        if (profileRes.ok) {
          const profileData: UserProfile = await profileRes.json();
          setProfile(profileData);
        }
      } catch (err) {
        console.warn('[ProfileContent] Failed to load user data:', err);
      } finally {
        setLoading(false);
      }
    }

    loadUser();
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!sessionUser) return null;

  const isSupporter = profile?.isSupporter ?? false;
  const isAdmin = profile?.role === 'admin';

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-bold text-foreground">Account Settings</h1>
        <p className="mt-2 text-muted-foreground">Manage your profile and preferences.</p>

        {/* --- Upgrade Success Banner --- */}
        {upgradeSuccess && !isAdmin && (
          <div
            role="alert"
            className="mt-6 rounded-lg border border-green-300 bg-green-50 p-4 text-sm text-green-800 dark:border-green-700 dark:bg-green-900/30 dark:text-green-200"
          >
            <strong>Welcome to Supporter!</strong> Your account has been upgraded. You now have
            access to unlimited uploads, all platforms, and premium AI metadata.
          </div>
        )}

        {/* --- Profile Information --- */}
        <section className="mt-8 rounded-xl border border-border bg-background p-6">
          <h2 className="text-xl font-semibold text-foreground">Profile Information</h2>
          <div className="mt-6 space-y-6">
            {/* Avatar Placeholder */}
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-2xl">
                👤
              </div>
              <button
                type="button"
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                Change avatar
              </button>
            </div>

            {/* Name */}
            <div>
              <label htmlFor="profile-name" className="block text-sm font-medium text-foreground">
                Full name
              </label>
              <input
                type="text"
                id="profile-name"
                defaultValue={sessionUser.name ?? ''}
                placeholder="Your name"
                className="mt-2 block w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            {/* Email */}
            <div>
              <label htmlFor="profile-email" className="block text-sm font-medium text-foreground">
                Email address
              </label>
              <input
                type="email"
                id="profile-email"
                defaultValue={sessionUser.email ?? ''}
                placeholder="your@email.com"
                readOnly
                className="mt-2 block w-full rounded-lg border border-border bg-muted px-4 py-3 text-sm text-muted-foreground"
              />
            </div>
          </div>
        </section>

        {/* --- Subscription Status --- */}
        <section className="mt-8 rounded-xl border border-border bg-background p-6">
          <h2 className="text-xl font-semibold text-foreground">Subscription</h2>
          <div className="mt-4">
            <div className="flex items-center gap-3">
              {isAdmin ? (
                <span className="inline-flex items-center rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                  Admin
                </span>
              ) : isSupporter ? (
                <span className="inline-flex items-center rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800 dark:bg-green-900 dark:text-green-200">
                  Supporter
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                  Free
                </span>
              )}
            </div>
            {isAdmin ? (
              <p className="mt-4 text-sm text-muted-foreground">
                You are an admin. Supporter subscription status does not apply to admin accounts.
              </p>
            ) : isSupporter ? (
              <p className="mt-4 text-sm text-muted-foreground">
                You&apos;re a Supporter! Enjoy unlimited uploads, all platforms, and premium AI
                metadata generation.
              </p>
            ) : (
              <>
                <p className="mt-4 text-sm text-muted-foreground">
                  You are currently on the Free plan. Upgrade to unlock premium features.
                </p>
                <Link
                  href="/pricing"
                  className="mt-4 inline-block rounded-lg bg-primary px-6 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Upgrade to Supporter
                </Link>
              </>
            )}
          </div>
        </section>

        {/* --- Account Tools --- */}
        <section className="mt-8 rounded-xl border border-border bg-background p-6">
          <h2 className="text-xl font-semibold text-foreground">Account Tools</h2>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Link
              href="/profile/connections"
              data-tour="profile-connect-platforms"
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              Manage connected accounts
            </Link>
            <button
              type="button"
              onClick={handleReplayTour}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              Replay tour
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
