import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Scheduled Uploads',
  description: 'View and manage your scheduled video publishing queue.',
};

export default function ScheduledUploadsPage() {
  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-bold text-foreground">Scheduled Uploads</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Plan and review videos queued for future publishing across your connected platforms.
        </p>

        <div className="mt-8 rounded-xl border border-border bg-muted/50 p-10">
          <p className="text-base font-semibold text-foreground">No scheduled uploads yet</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Videos scheduled for future publishing will appear here once you create them.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Scheduled publishing is available with the Supporter tier.
          </p>
        </div>
      </div>
    </div>
  );
}
