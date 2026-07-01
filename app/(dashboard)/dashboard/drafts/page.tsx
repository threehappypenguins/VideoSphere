import { redirect } from 'next/navigation';

/**
 * Legacy route redirect: /dashboard/drafts → /dashboard/videos.
 */
export default function LegacyDraftsRedirectPage() {
  redirect('/dashboard/videos');
}
