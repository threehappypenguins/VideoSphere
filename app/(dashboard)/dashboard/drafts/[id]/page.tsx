import Link from 'next/link';
import { DraftsEmptyState } from '@/components/drafts-empty-state';
import { FileVideo, Clock } from 'lucide-react';

// Static placeholder rows
const PLACEHOLDER_DRAFTS = [
  {
    id: 'placeholder-1',
    title: 'Draft title',
    lastEdited: 'Last edited 2 days ago',
    duration: '0:00',
  },
  {
    id: 'placeholder-2',
    title: 'Draft title',
    lastEdited: 'Last edited 5 days ago',
    duration: '0:00',
  },
];

const hasDrafts = false; // this will change to true once we implement fetching real drafts from the database

export default function DraftsPage() {
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Drafts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Videos you&apos;ve started but haven&apos;t published yet.
        </p>
      </div>

      {hasDrafts ? <DraftsTable drafts={PLACEHOLDER_DRAFTS} /> : <DraftsEmptyState />}
    </div>
  );
}

/* (placeholder layout) */

type Draft = {
  id: string;
  title: string;
  lastEdited: string;
  duration: string;
};

function DraftsTable({ drafts }: { drafts: Draft[] }) {
  return (
    <div className="rounded-lg border border-border bg-card">
      {/* Table header */}
      <div className="grid grid-cols-[1fr_auto_auto] gap-4 border-b border-border px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <span>Title</span>
        <span>Duration</span>
        <span>Last edited</span>
      </div>

      {/* Rows */}
      <ul className="divide-y divide-border">
        {drafts.map((draft) => (
          <li key={draft.id}>
            <Link
              href={`/dashboard/drafts/${draft.id}`}
              className="grid grid-cols-[1fr_auto_auto] gap-4 px-4 py-3.5 text-sm transition-colors hover:bg-accent/50"
            >
              {/* Title + icon */}
              <span className="flex min-w-0 items-center gap-3">
                <FileVideo className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="truncate font-medium text-foreground">{draft.title}</span>
              </span>

              {/* Duration */}
              <span className="text-muted-foreground">{draft.duration}</span>

              {/* Last edited */}
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                {draft.lastEdited}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
