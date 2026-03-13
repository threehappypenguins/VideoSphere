import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Upload Video',
  description: 'Create a draft first, then upload your video from the draft page.',
};

// The upload UI lives at /dashboard/drafts/[id]/upload
// (app/(dashboard)/dashboard/drafts/[id]/upload/page.tsx)

export default function UploadVideoPage() {
  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <header>
          <h1 className="text-3xl font-semibold tracking-tight">Upload Video</h1>
        </header>
        <div className="rounded-xl border border-border bg-muted p-8 text-center space-y-4">
          <p className="text-base font-medium">Create a draft first</p>
          <p className="text-sm text-muted-foreground">
            Videos are uploaded from a draft. Open or create a draft, then click{' '}
            <strong>Upload Video</strong> from the draft page.
          </p>
          <Link
            href="/dashboard/drafts"
            className="inline-block rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Go to Drafts
          </Link>
        </div>
      </div>
    </div>
  );
}
