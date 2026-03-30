import type { Metadata } from 'next';
import { UploadHistoryClient } from '@/components/dashboard/UploadHistoryClient';

export const metadata: Metadata = {
  title: 'Upload History',
  description: 'View your completed and failed video uploads.',
};

export default function HistoryPage() {
  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-bold text-foreground">Upload History</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A record of all your completed and failed video distributions.
        </p>
        <UploadHistoryClient />
      </div>
    </div>
  );
}
