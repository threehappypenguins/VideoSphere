// =============================================================================
// ADMIN DASHBOARD
// =============================================================================
// ⚠️  WARNING: This page is currently COMPLETELY UNPROTECTED.
//
// ANY user can access /admin/dashboard right now. This is intentional in the
// starter template — your team MUST implement proper access control.
//
// STUDENT: Before going to production, you MUST:
//   1. Implement authentication (login/signup flow)
//   2. Add a "role" field to your user model (e.g., 'user' | 'admin')
//   3. Protect this route using middleware.ts (see the stub in the root)
//   4. Verify the user's role in your Server Components and API routes
//   5. Only users with an admin role should EVER reach this page
//
// Client-side checks alone are NOT sufficient for security.
// A malicious user can bypass any client-side protection.
// Always verify roles server-side.
//
// See:
//   - /docs/admin-guide.md for detailed RBAC implementation guidance
//   - middleware.ts for the middleware stub
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
            ⚠️ <strong>Unprotected Route:</strong> This admin dashboard is currently accessible to
            everyone. Implement authentication and RBAC before deploying. See{' '}
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
