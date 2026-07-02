import { redirect } from 'next/navigation';

/**
 * Legacy route redirect: /dashboard/drafts → /dashboard/uploads.
 */
export default function LegacyDraftsRedirectPage() {
  redirect('/dashboard/uploads');
}
