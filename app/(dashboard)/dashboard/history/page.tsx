import { redirect } from 'next/navigation';

/**
 * Legacy route redirect: /dashboard/history → /dashboard/videos/history.
 */
export default function LegacyHistoryRedirectPage() {
  redirect('/dashboard/videos/history');
}
