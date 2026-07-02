import { redirect } from 'next/navigation';

/**
 * Legacy route redirect: /dashboard/history → /dashboard/uploads/history.
 */
export default function LegacyHistoryRedirectPage() {
  redirect('/dashboard/uploads/history');
}
