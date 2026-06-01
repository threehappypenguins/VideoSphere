import { notFound, redirect } from 'next/navigation';
import { getFirstRunSetupToken } from '@/lib/auth/first-run-setup';
import { hasAnyUsers, isSetupTokenValid } from '@/lib/repositories/invites';
import SetupPageClient from './SetupPageClient';

/**
 * Props for the first-run setup page.
 */
interface SetupPageProps {
  searchParams: Promise<{ token?: string; error?: string }>;
}

/**
 * First-run admin account creation page.
 * Renders only when no users exist and the setup token is valid.
 * @param props - Page props including setup token query params.
 * @returns The rendered setup page.
 */
export default async function SetupPage({ searchParams }: SetupPageProps) {
  const { token, error } = await searchParams;
  const oauthError = error?.trim();

  if (await hasAnyUsers()) {
    notFound();
  }

  const trimmedToken = token?.trim();
  if (!trimmedToken) {
    const setupToken = await getFirstRunSetupToken();
    if (!setupToken) notFound();
    const errorQuery = oauthError ? `&error=${encodeURIComponent(oauthError)}` : '';
    redirect(`/setup?token=${encodeURIComponent(setupToken)}${errorQuery}`);
  }

  if (!(await isSetupTokenValid(trimmedToken))) {
    if (oauthError) {
      const setupToken = await getFirstRunSetupToken();
      if (!setupToken) notFound();
      redirect(
        `/setup?token=${encodeURIComponent(setupToken)}&error=${encodeURIComponent(oauthError)}`
      );
    }
    notFound();
  }

  return <SetupPageClient token={trimmedToken} />;
}
