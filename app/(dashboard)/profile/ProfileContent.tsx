'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ProfileAuthSection } from './ProfileAuthSection';
import { ProfileSecuritySection } from './ProfileSecuritySection';
import { ProfileOAuthFlash } from './ProfileOAuthFlash';
import type { UserAuthProvider } from '@/types';

interface ProfileContentProps {
  oauthSuccess: string | null;
  oauthError: string | null;
}

interface SessionUser {
  $id: string;
  name?: string;
  email?: string;
}

function authProviderFromSession(value: unknown): UserAuthProvider | null {
  return value === 'google' || value === 'password' ? value : null;
}

/**
 * Renders the profile content component.
 * @returns The rendered UI output.
 */
export function ProfileContent({ oauthSuccess, oauthError }: ProfileContentProps) {
  const router = useRouter();
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [authProvider, setAuthProvider] = useState<UserAuthProvider>('password');
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const handleReplayTour = () => {
    router.push('/dashboard?onboarding=1');
  };

  useEffect(() => {
    // The proxy (middleware) already protects /profile* — if we reach this
    // component the user is authenticated. We only need to load their data.
    async function loadUser() {
      try {
        // Fetch authenticated session (display name, email)
        const sessionRes = await fetch('/api/auth/session', { credentials: 'include' });
        if (sessionRes.ok) {
          const payload = (await sessionRes.json()) as Record<string, unknown>;
          const authProvider = authProviderFromSession(payload.authProvider);
          if (!authProvider) {
            console.warn('[ProfileContent] Session response missing valid authProvider');
          }

          setSessionUser({
            $id: String(payload.$id ?? ''),
            name: typeof payload.name === 'string' ? payload.name : undefined,
            email: typeof payload.email === 'string' ? payload.email : undefined,
          });
          if (authProvider) {
            setAuthProvider(authProvider);
          }
          if (typeof payload.totpEnabled === 'boolean') {
            setTotpEnabled(payload.totpEnabled);
          }

          const roleRes = await fetch('/api/auth/session-role', { credentials: 'include' });
          if (roleRes.ok) {
            const roleData = (await roleRes.json()) as { role?: string };
            setIsAdmin(roleData.role === 'admin');
          }
        }
      } catch (err) {
        console.warn('[ProfileContent] Failed to load user data:', err);
      } finally {
        setLoading(false);
      }
    }

    loadUser();
  }, []);

  const pageHeader = (
    <>
      <h1 className="text-3xl font-bold text-foreground">Account Settings</h1>
      <p className="mt-2 text-muted-foreground">Manage your profile and preferences.</p>
      <ProfileOAuthFlash success={oauthSuccess} error={oauthError} />
    </>
  );

  if (loading) {
    return (
      <div className="px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          {pageHeader}
          <div className="flex min-h-[40vh] items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        </div>
      </div>
    );
  }

  if (!sessionUser) return null;

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        {pageHeader}

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

        <ProfileAuthSection authProvider={authProvider} onAuthProviderChange={setAuthProvider} />

        {authProvider === 'password' && sessionUser.email ? (
          <ProfileSecuritySection
            userEmail={sessionUser.email}
            totpEnabled={totpEnabled}
            onTotpEnabledChange={setTotpEnabled}
          />
        ) : null}

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

        {isAdmin ? (
          <section className="mt-8 rounded-xl border border-border bg-background p-6">
            <h2 className="text-xl font-semibold text-foreground">User management</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Manage users, roles, and invite links for your VideoSphere instance.
            </p>
            <Link
              href="/dashboard/users"
              className="mt-4 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Open user management
            </Link>
          </section>
        ) : null}
      </div>
    </div>
  );
}
