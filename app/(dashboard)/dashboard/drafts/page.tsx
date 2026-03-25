'use client';

import { DraftWizard } from '@/components/DraftWizard';
import { useDraftWizard } from '@/hooks/use-draft-wizard';

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

export default function DraftsPage() {
  const { isOpen, openWizard, closeWizard } = useDraftWizard();

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

        {/* Empty state */}
        <div className="flex min-h-80 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/40 px-6 py-16 text-center">
          <h2 className="text-base font-semibold text-foreground">No drafts yet</h2>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Create a draft to get started. You can come back later to upload and publish your video
            when you&apos;re ready.
          </p>
          <button
            type="button"
            onClick={openWizard}
            className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Create draft
          </button>
        </div>

        {/* Placeholder table layout to show structure before real data */}
        <DraftsTable />
      </div>

      <DraftWizard isOpen={isOpen} onClose={closeWizard} />
    </div>
  );
}

function DraftsTable() {
  return (
    <div className="rounded-xl border border-border bg-background">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <th scope="col" className="px-4 py-3 text-left">
              Draft title
            </th>
            <th scope="col" className="px-4 py-3 text-left">
              Last edited
            </th>
          </tr>
        </thead>
        <tbody>
          {PLACEHOLDER_DRAFTS.map((draft) => (
            <tr key={draft.id} className="border-b border-border last:border-b-0">
              <td className="px-4 py-3">
                <span className="truncate text-foreground">{draft.title}</span>
              </td>
              <td className="px-4 py-3 text-muted-foreground">{draft.lastEdited}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
