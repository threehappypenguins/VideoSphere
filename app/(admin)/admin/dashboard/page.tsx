// =============================================================================
// ADMIN DASHBOARD
// =============================================================================
// Route protection for /admin/* is already implemented in proxy.ts — only
// users with the 'admin' role in the Appwrite user_profiles collection can
// reach this page. Unauthenticated or non-admin users are redirected.
//
// STUDENT: What you still need to do:
//   1. Add server-side role checks inside this page and any admin API routes
//      (proxy.ts protects the route, but pages/APIs should verify independently)
//   2. Replace placeholder stat cards with real data from your database
//   3. Build out user management, moderation, and analytics features
//
// Client-side checks alone are NOT sufficient for security.
// A malicious user can bypass any client-side protection.
// Always verify roles server-side.
//
// See:
//   - /docs/admin-guide.md for detailed RBAC implementation guidance
//   - proxy.ts for the route protection logic
//   - /docs/ai-usage-policy.md for responsible development practices
// =============================================================================

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Admin Dashboard',
  description: 'Admin-only dashboard for managing the application.',
};

export default function AdminDashboardPage() {
  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        {/* --- Warning Banner --- */}
        <div className="mb-8 rounded-lg border border-yellow-300 bg-yellow-50 p-4">
          <p className="text-sm font-medium text-yellow-800">
            ⚠️ <strong>Work in progress:</strong> Route protection is active via{' '}
            <code className="rounded bg-yellow-100 px-1">proxy.ts</code>, but this page has no real
            data or role-aware behavior yet. Add server-side checks and replace placeholder data
            before deploying. See{' '}
            <code className="rounded bg-yellow-100 px-1">/docs/admin-guide.md</code> for guidance.
          </p>
        </div>

        {/* --- Header --- */}
        <div>
          <h1 className="text-3xl font-bold text-foreground">Admin Dashboard</h1>
          <p className="mt-2 text-muted-foreground">Application overview and management tools.</p>
        </div>

        {/* --- Stat Cards --- */}
        {/* STUDENT: Replace with real data from your database */}
        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-border bg-background p-6">
            <p className="text-sm font-medium text-muted-foreground">Total Users</p>
            <p className="mt-2 text-3xl font-bold text-foreground">0</p>
            <p className="mt-1 text-xs text-muted-foreground">+0 this week</p>
          </div>
          <div className="rounded-xl border border-border bg-background p-6">
            <p className="text-sm font-medium text-muted-foreground">Active Sessions</p>
            <p className="mt-2 text-3xl font-bold text-foreground">0</p>
            <p className="mt-1 text-xs text-muted-foreground">Currently online</p>
          </div>
          <div className="rounded-xl border border-border bg-background p-6">
            <p className="text-sm font-medium text-muted-foreground">Recent Signups</p>
            <p className="mt-2 text-3xl font-bold text-foreground">0</p>
            <p className="mt-1 text-xs text-muted-foreground">Last 30 days</p>
          </div>
          <div className="rounded-xl border border-border bg-background p-6">
            <p className="text-sm font-medium text-muted-foreground">Revenue</p>
            <p className="mt-2 text-3xl font-bold text-foreground">$0</p>
            <p className="mt-1 text-xs text-muted-foreground">This month</p>
          </div>
        </div>

        {/* --- Recent Activity Feed --- */}
        {/* STUDENT: Replace with real activity data */}
        <div className="mt-8 rounded-xl border border-border bg-background p-6">
          <h2 className="text-xl font-semibold text-foreground">Recent Activity</h2>
          <div className="mt-4 space-y-4">
            <div className="flex items-center gap-4 rounded-lg bg-muted/50 p-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm">
                👤
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">[Placeholder activity]</p>
                <p className="text-xs text-muted-foreground">Just now</p>
              </div>
            </div>
            <div className="flex items-center gap-4 rounded-lg bg-muted/50 p-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm">
                ✉️
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">[Placeholder activity]</p>
                <p className="text-xs text-muted-foreground">5 minutes ago</p>
              </div>
            </div>
          </div>
        </div>

        {/* --- Data Table Shell --- */}
        {/* STUDENT: Replace with real user data from your database */}
        <div className="mt-8 rounded-xl border border-border bg-background p-6">
          <h2 className="text-xl font-semibold text-foreground">Users</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="pb-3 font-medium text-muted-foreground">Name</th>
                  <th className="pb-3 font-medium text-muted-foreground">Email</th>
                  <th className="pb-3 font-medium text-muted-foreground">Role</th>
                  <th className="pb-3 font-medium text-muted-foreground">Plan</th>
                  <th className="pb-3 font-medium text-muted-foreground">Joined</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border">
                  <td className="py-3 text-foreground">[User Name]</td>
                  <td className="py-3 text-muted-foreground">[user@example.com]</td>
                  <td className="py-3">
                    <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                      admin
                    </span>
                  </td>
                  <td className="py-3 text-muted-foreground">Pro</td>
                  <td className="py-3 text-muted-foreground">[Date]</td>
                </tr>
                <tr className="border-b border-border">
                  <td className="py-3 text-foreground">[User Name]</td>
                  <td className="py-3 text-muted-foreground">[user2@example.com]</td>
                  <td className="py-3">
                    <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                      user
                    </span>
                  </td>
                  <td className="py-3 text-muted-foreground">Free</td>
                  <td className="py-3 text-muted-foreground">[Date]</td>
                </tr>
                <tr>
                  <td className="py-3 text-foreground">[User Name]</td>
                  <td className="py-3 text-muted-foreground">[user3@example.com]</td>
                  <td className="py-3">
                    <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                      user
                    </span>
                  </td>
                  <td className="py-3 text-muted-foreground">Pro</td>
                  <td className="py-3 text-muted-foreground">[Date]</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
