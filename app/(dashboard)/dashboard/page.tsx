// =============================================================================
// DASHBOARD PAGE
// =============================================================================
// This is the main authenticated user dashboard.
//
// Route protection is already implemented in proxy.ts — unauthenticated users
// are redirected to /login before this page renders.
//
// What you still need to do:
//   1. Replace placeholder data with real data from your database
//   2. Build out the dashboard features your product needs
//   3. Add server-side role checks inside this page if needed
//
// See /docs/admin-guide.md for route protection guidance and proxy.ts
// for the auth check implementation.
// =============================================================================

import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Your personal dashboard.',
};

export default function DashboardPage() {
  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        {/* --- Header --- */}
        <div>
          <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
          <p className="mt-2 text-muted-foreground">
            Welcome back! Here&apos;s an overview of your account.
          </p>
        </div>

        {/* --- Stat Cards --- */}
        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-border bg-background p-6">
            <p className="text-sm font-medium text-muted-foreground">Drafts</p>
            <p className="mt-2 text-3xl font-bold text-foreground">0</p>
          </div>
          <div className="rounded-xl border border-border bg-background p-6">
            <p className="text-sm font-medium text-muted-foreground">Uploads this month</p>
            <p className="mt-2 text-3xl font-bold text-foreground">0</p>
          </div>
          <div className="rounded-xl border border-border bg-background p-6">
            <p className="text-sm font-medium text-muted-foreground">Scheduled</p>
            <p className="mt-2 text-3xl font-bold text-foreground">0</p>
          </div>
          <div className="rounded-xl border border-border bg-background p-6">
            <p className="text-sm font-medium text-muted-foreground">Completed</p>
            <p className="mt-2 text-3xl font-bold text-foreground">0</p>
          </div>
        </div>

        {/* --- Quick Actions --- */}
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-foreground">Quick actions</h2>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href="/dashboard/upload"
              className="rounded-lg bg-primary px-6 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              New upload
            </Link>
            <Link
              href="/dashboard/upload"
              className="rounded-lg border border-border px-6 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              New draft
            </Link>
            <Link
              href="/dashboard/drafts"
              className="rounded-lg border border-border px-6 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              View drafts
            </Link>
          </div>
        </div>

        {/* --- Upload Jobs --- */}
        <div className="mt-8 rounded-xl border border-border bg-background p-8">
          <h2 className="text-xl font-semibold text-foreground">Upload jobs</h2>
          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-left font-semibold text-foreground">Video</th>
                  <th className="px-4 py-3 text-left font-semibold text-foreground">Platform</th>
                  <th className="px-4 py-3 text-left font-semibold text-foreground">Status</th>
                  <th className="px-4 py-3 text-left font-semibold text-foreground">Date</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border">
                  <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                    No jobs yet — your upload jobs will appear here.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
