// =============================================================================
// PROFILE PAGE
// =============================================================================
// User account settings and profile information.
//
// STUDENT: This page is currently accessible to everyone — there is NO
// authentication or route protection implemented.
//
// What you need to do:
//   1. Implement authentication and protect this route
//   2. Load the user's actual profile data from your database
//   3. Wire up the form to update user profile information
//   4. Implement the subscription status section with real data
//   5. Connect the "Upgrade" button to your payment flow
//
// See /docs/payments.md for subscription and premium tier guidance.
// =============================================================================

import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Profile',
  description: 'Manage your account settings and profile.',
};

export default function ProfilePage() {
  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-bold text-foreground">Account Settings</h1>
        <p className="mt-2 text-muted-foreground">Manage your profile and preferences.</p>

        {/* --- Profile Information --- */}
        {/* STUDENT: Wire this form to your database to load and save user data */}
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
                defaultValue=""
                placeholder="[User's Name]"
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
                defaultValue=""
                placeholder="[User's Email]"
                className="mt-2 block w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            {/* STUDENT: Implement the save functionality */}
            <button
              type="button"
              className="rounded-lg bg-primary px-6 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Save Changes
            </button>
          </div>
        </section>

        {/* --- Subscription Status --- */}
        {/* STUDENT: Replace this with real subscription data from your database.
            See /docs/payments.md for implementing the freemium model. */}
        <section className="mt-8 rounded-xl border border-border bg-background p-6">
          <h2 className="text-xl font-semibold text-foreground">Subscription</h2>
          <div className="mt-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                Free Plan
              </span>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              You are currently on the Free plan. Upgrade to unlock premium features.
            </p>
            <Link
              href="/pricing"
              className="mt-4 inline-block rounded-lg bg-primary px-6 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Upgrade to Pro
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
