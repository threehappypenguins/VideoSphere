import Link from 'next/link';
import { FileVideo } from 'lucide-react';

export function DraftsEmptyState() {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-6 py-16 text-center">
      {/* Icon */}
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <FileVideo className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
      </div>

      {/* Heading */}
      <h2 className="text-base font-semibold text-foreground">No drafts yet</h2>

      {/* Description */}
      <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">
        Drafts are saved automatically when you start uploading or editing a video. Create one to
        get started.
      </p>

      {/* CTA */}
      <Link
        href="/dashboard/upload"
        className="mt-6 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <FileVideo className="h-4 w-4" aria-hidden="true" />
        Create draft
      </Link>
    </div>
  );
}
