import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Upload History',
  description: 'View your completed and failed video uploads.',
};

export default function HistoryPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-foreground">Upload History</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        A record of all your completed and failed video distributions.
      </p>

      <div className="mt-8 rounded-xl border border-border bg-muted/50 p-12 text-center">
        <p className="font-medium text-foreground">No upload history yet</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Your upload history will appear here once you have distributed videos.
        </p>
      </div>
    </div>
  );
}
