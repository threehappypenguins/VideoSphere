import { notFound } from 'next/navigation';
import { hasAnyUsers, isSetupTokenValid } from '@/lib/repositories/invites';
import SetupPageClient from './SetupPageClient';

/**
 * Props for the first-run setup page.
 */
interface SetupPageProps {
  searchParams: Promise<{ token?: string }>;
}

/**
 * First-run admin account creation page.
 * Renders only when no users exist and the setup token is valid.
 * @param props - Page props including setup token query params.
 * @returns The rendered setup page.
 */
export default async function SetupPage({ searchParams }: SetupPageProps) {
  const { token } = await searchParams;

  if (await hasAnyUsers()) {
    notFound();
  }

  if (!token?.trim() || !(await isSetupTokenValid(token.trim()))) {
    notFound();
  }

  return <SetupPageClient token={token.trim()} />;
}
