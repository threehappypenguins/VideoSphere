import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Drafts',
  description: 'View and manage your video drafts.',
};

// Static placeholder rows so the table layout is clear.
const PLACEHOLDER_DRAFTS = [
  {
    id: 'placeholder-1',
    title: 'Draft title',
    lastEdited: 'Last edited 2 days ago',
  },
  {
    id: 'placeholder-2',
    title: 'Draft title',
    lastEdited: 'Last edited 5 days ago',
  },
];

const hasDrafts = false; // Will be wired up to real data in a future issue.

export default function DraftsPage() {
  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-8">
        {/* Header */}
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Drafts</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Videos you&apos;ve started but haven&apos;t published yet. Drafts help you prepare
            uploads before distributing them.
          </p>
        </header>

        {/* Empty state vs placeholder list */}
        {hasDrafts ? (
          <DraftsTable />
        ) : (
          <div className="flex min-h-[320px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/40 px-6 py-16 text-center">
            <h2 className="text-base font-semibold text-foreground">No drafts yet</h2>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              Create a draft to get started. You can come back later to upload and publish your
              video when you&apos;re ready.
            </p>
            <Link
              href="/dashboard/upload"
              className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Create draft
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function DraftsTable() {
  return (
    <div className="rounded-xl border border-border bg-background">
      {/* Table header */}
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4 border-b border-border px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <span>Draft title</span>
        <span>Last edited</span>
      </div>

      {/* Static placeholder rows */}
      <ul className="divide-y divide-border">
        {PLACEHOLDER_DRAFTS.map((draft) => (
          <li
            key={draft.id}
            className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-center gap-4 px-4 py-3 text-sm"
          >
            <span className="truncate text-foreground">{draft.title}</span>
            <span className="text-muted-foreground">{draft.lastEdited}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
