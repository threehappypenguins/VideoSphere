// =============================================================================
// DASHBOARD PAGE
// =============================================================================
// This is the main authenticated user dashboard.
//
// STUDENT: This page is currently accessible to everyone — there is NO
// authentication or route protection implemented.
//
// What you need to do:
//   1. Implement authentication (see your chosen auth provider's docs)
//   2. Protect this route so only authenticated users can access it
//   3. Replace placeholder data with real data from your database
//   4. Build out the dashboard features your product needs
//
// See /docs/admin-guide.md for route protection guidance and middleware.ts
// for where to implement auth checks.
// =============================================================================

import type { Metadata } from 'next';

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
        {/* STUDENT: Replace these with real data from your database */}
        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-border bg-background p-6">
            <p className="text-sm font-medium text-muted-foreground">[Stat Label 1]</p>
            <p className="mt-2 text-3xl font-bold text-foreground">0</p>
          </div>
          <div className="rounded-xl border border-border bg-background p-6">
            <p className="text-sm font-medium text-muted-foreground">[Stat Label 2]</p>
            <p className="mt-2 text-3xl font-bold text-foreground">0</p>
          </div>
          <div className="rounded-xl border border-border bg-background p-6">
            <p className="text-sm font-medium text-muted-foreground">[Stat Label 3]</p>
            <p className="mt-2 text-3xl font-bold text-foreground">0</p>
          </div>
          <div className="rounded-xl border border-border bg-background p-6">
            <p className="text-sm font-medium text-muted-foreground">[Stat Label 4]</p>
            <p className="mt-2 text-3xl font-bold text-foreground">0</p>
          </div>
        </div>

        {/* --- Main Content Area --- */}
        {/* STUDENT: Build out your dashboard content here */}
        <div className="mt-8 rounded-xl border border-border bg-background p-8">
          <h2 className="text-xl font-semibold text-foreground">[Dashboard Content]</h2>
          <p className="mt-4 text-muted-foreground">
            This is where your main dashboard content will go. You might include:
          </p>
          <ul className="mt-4 list-inside list-disc space-y-2 text-sm text-muted-foreground">
            <li>Recent activity feed</li>
            <li>Data tables or lists</li>
            <li>Charts and visualizations</li>
            <li>Quick action buttons</li>
            <li>Notifications or alerts</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
