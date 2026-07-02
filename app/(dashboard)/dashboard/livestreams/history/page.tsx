import type { Metadata } from 'next';
import { StreamedLivestreamsHistoryClient } from '@/components/livestreams/StreamedLivestreamsHistoryClient';

/**
 * Provides static page metadata for this route segment.
 */
export const metadata: Metadata = {
  title: 'Livestream History',
  description: 'View past streamed live broadcasts.',
};

/**
 * Renders the paginated streamed livestreams history page.
 * @returns The rendered UI output.
 */
export default function LivestreamsHistoryPage() {
  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-bold text-foreground">Livestream History</h1>
        <p className="mt-2 text-lg text-foreground text-shadow-bg">
          Past broadcasts that have ended on YouTube.
        </p>
        <StreamedLivestreamsHistoryClient />
      </div>
    </div>
  );
}
