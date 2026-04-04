// =============================================================================
// DASHBOARD PAGE
// =============================================================================
// This is the main authenticated user dashboard.
//
// Route protection is already implemented in proxy.ts — unauthenticated users
// are redirected to /login before this page renders.
//
// See /docs/admin-guide.md for route protection guidance and proxy.ts
// for the auth check implementation.
// =============================================================================

import type { Metadata } from 'next';
import Link from 'next/link';
import { DashboardQuickActions } from '@/components/dashboard/DashboardQuickActions';
import { getCurrentUserIdFromCookies } from '@/lib/auth/get-current-user-id-from-cookies';
import { countDraftsByUser, getDraftDashboardSummaryByUser } from '@/lib/repositories/drafts';
import { countUploadJobsByUserWithStatuses } from '@/lib/repositories/upload-jobs';
import { PLATFORM_LABELS } from '@/lib/ui/platform-label';
import type { ConnectedAccountPlatform } from '@/types';

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Your personal dashboard.',
};

function formatLastEdited(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return 'Recently updated';

  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function formatTargets(targets: readonly ConnectedAccountPlatform[]): string {
  if (targets.length === 0) return 'No platforms selected';

  return targets.map((target) => PLATFORM_LABELS[target] ?? target).join(', ');
}

async function getCurrentUserId(): Promise<string | null> {
  return getCurrentUserIdFromCookies();
}

export default async function DashboardPage() {
  const userId = await getCurrentUserId();
  const [draftCount, draftSummary, inProgressJobCount, completedJobCount, failedJobCount] = userId
    ? await Promise.all([
        countDraftsByUser(userId).catch(() => 0),
        getDraftDashboardSummaryByUser(userId).catch(() => ({
          readyDraftCount: 0,
          previewDrafts: [],
        })),
        countUploadJobsByUserWithStatuses(userId, ['pending', 'uploading', 'distributing']).catch(
          () => 0
        ),
        countUploadJobsByUserWithStatuses(userId, 'completed').catch(() => 0),
        countUploadJobsByUserWithStatuses(userId, 'failed').catch(() => 0),
      ])
    : [0, { readyDraftCount: 0, previewDrafts: [] }, 0, 0, 0];
  const readyDrafts = draftSummary.readyDraftCount;
  const previewDrafts = draftSummary.previewDrafts;

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        {/* --- Header --- */}
        <div data-tour="dashboard-overview">
          <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
          <p className="mt-2 text-lg text-foreground text-shadow-bg">
            Welcome back! Here&apos;s an overview of your account.
          </p>
        </div>

        {/* --- Stat Cards --- */}
        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-xl border border-border bg-background p-6">
            <p className="text-sm font-medium text-muted-foreground">Drafts</p>
            <p className="mt-2 text-3xl font-bold text-foreground">{draftCount}</p>
          </div>
          <div className="rounded-xl border border-border bg-background p-6">
            <p className="text-sm font-medium text-muted-foreground">Ready to upload</p>
            <p className="mt-2 text-3xl font-bold text-foreground">{readyDrafts}</p>
          </div>
          <div className="rounded-xl border border-border bg-background p-6">
            <p className="text-sm font-medium text-muted-foreground">In progress</p>
            <p className="mt-2 text-3xl font-bold text-foreground">{inProgressJobCount}</p>
          </div>
          <div className="rounded-xl border border-border bg-background p-6">
            <p className="text-sm font-medium text-muted-foreground">Completed uploads</p>
            <p className="mt-2 text-3xl font-bold text-foreground">{completedJobCount}</p>
          </div>
          <div className="rounded-xl border border-border bg-background p-6">
            <p className="text-sm font-medium text-muted-foreground">Failed uploads</p>
            <p className="mt-2 text-3xl font-bold text-foreground">{failedJobCount}</p>
          </div>
        </div>

        <DashboardQuickActions />

        {/* --- Upload Jobs --- */}
        <div
          data-tour="distribution-jobs"
          className="mt-8 rounded-xl border border-border bg-background p-8"
        >
          <h2 className="text-xl font-semibold text-foreground">Drafts ready to upload</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            These drafts have been created but have not been used in a distribution yet.
          </p>
          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-left font-semibold text-foreground">Draft</th>
                  <th className="px-4 py-3 text-left font-semibold text-foreground">Targets</th>
                  <th className="px-4 py-3 text-left font-semibold text-foreground">Last edited</th>
                  <th className="px-4 py-3 text-left font-semibold text-foreground">Next step</th>
                </tr>
              </thead>
              <tbody>
                {previewDrafts.length === 0 ? (
                  <tr className="border-b border-border">
                    <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                      No drafts ready yet — create a draft to start your next upload.
                    </td>
                  </tr>
                ) : (
                  previewDrafts.map((draft) => (
                    <tr key={draft.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-4 font-medium text-foreground">
                        {draft.title.trim() === '' ? 'Untitled draft' : draft.title}
                      </td>
                      <td className="px-4 py-4 text-muted-foreground">
                        {formatTargets(draft.targets)}
                      </td>
                      <td className="px-4 py-4 text-muted-foreground">
                        {formatLastEdited(draft.$updatedAt)}
                      </td>
                      <td className="px-4 py-4">
                        <Link
                          href={`/dashboard/drafts/${draft.id}`}
                          className="font-medium text-foreground underline underline-offset-4 transition-opacity hover:opacity-70"
                        >
                          Open draft
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {readyDrafts > previewDrafts.length ? (
            <div className="mt-4 flex justify-end">
              <Link
                href="/dashboard/drafts"
                className="text-sm font-medium text-foreground underline underline-offset-4 transition-opacity hover:opacity-70"
              >
                View all drafts
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
