import { notFound } from 'next/navigation';
import { isInviteTokenValid } from '@/lib/repositories/invites';
import InviteSignupClient from './InviteSignupClient';

/**
 * Props for the invite signup page.
 */
interface InvitePageProps {
  params: Promise<{ token: string }>;
}

/**
 * Invite-only account creation page.
 * @param props - Page props including the invite token route param.
 * @returns The rendered invite signup page.
 */
export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;

  if (!token?.trim() || !(await isInviteTokenValid(token.trim()))) {
    notFound();
  }

  return <InviteSignupClient token={token.trim()} />;
}
