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
import { cookies } from 'next/headers';
import { Account, Client } from 'node-appwrite';
import { DashboardQuickActions } from '@/components/dashboard/DashboardQuickActions';
import { getSessionCookieName } from '@/lib/auth-session-cookie';
import { listDraftsByUser } from '@/lib/repositories/drafts';
import { listUploadJobsByUser } from '@/lib/repositories/upload-jobs';
import type { Draft } from '@/types';

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Your personal dashboard.',
};

function hasNonEmptyUsedInUploadAt(draft: Draft): boolean {
  return typeof draft.usedInUploadAt === 'string' && draft.usedInUploadAt.trim() !== '';
}

function formatLastEdited(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return 'Recently updated';

  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function formatTargets(targets: readonly string[]): string {
  if (targets.length === 0) return 'No platforms selected';

  const labels: Record<string, string> = {
    youtube: 'YouTube',
    vimeo: 'Vimeo',
  };

  return targets.map((target) => labels[target] ?? target).join(', ');
}

async function getCurrentUserId(): Promise<string | null> {
  const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
  const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
  if (!endpoint || !projectId) return null;

  const cookieStore = await cookies();
  const sessionSecret = cookieStore.get(getSessionCookieName(projectId))?.value;
  if (!sessionSecret) return null;

  try {
    const client = new Client()
      .setEndpoint(endpoint)
      .setProject(projectId)
      .setSession(sessionSecret);
    const account = new Account(client);
    const user = await account.get();
    return user.$id;
  } catch {
    return null;
  }
}

export default async function DashboardPage() {
  const userId = await getCurrentUserId();
  const [drafts, uploadJobs] = userId
    ? await Promise.all([
        listDraftsByUser(userId).catch(() => []),
        listUploadJobsByUser(userId, undefined, { maxRows: Number.POSITIVE_INFINITY }).catch(
          () => []
        ),
      ])
    : [[], []];
  const readyDrafts = drafts.filter((draft) => !hasNonEmptyUsedInUploadAt(draft));
  const previewDrafts = readyDrafts.slice(0, 5);
  const inProgressJobCount = uploadJobs.filter(
    (job) => job.status !== 'completed' && job.status !== 'failed' && job.status !== 'cancelled'
  ).length;
  const completedJobCount = uploadJobs.filter((job) => job.status === 'completed').length;
  const failedJobCount = uploadJobs.filter((job) => job.status === 'failed').length;

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
            <p className="mt-2 text-3xl font-bold text-foreground">{drafts.length}</p>
          </div>
          <div className="rounded-xl border border-border bg-background p-6">
            <p className="text-sm font-medium text-muted-foreground">Ready to upload</p>
            <p className="mt-2 text-3xl font-bold text-foreground">{readyDrafts.length}</p>
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
          {readyDrafts.length > previewDrafts.length ? (
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
