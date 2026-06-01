import { redirect } from 'next/navigation';
import { ensureSetupTokenForFirstRun, hasAnyUsers } from '@/lib/repositories/invites';

/**
 * Returns whether this instance still needs first-run admin setup.
 * @returns True when no user accounts exist yet.
 */
export async function isFirstRunSetupPending(): Promise<boolean> {
  return !(await hasAnyUsers());
}

/**
 * Redirects to first-run setup when no user accounts exist yet.
 * No-op once setup is complete.
 */
export async function redirectToFirstRunSetupIfNeeded(): Promise<void> {
  if (await isFirstRunSetupPending()) {
    redirect('/setup');
  }
}

/**
 * Resolves the active setup token for first-run, creating one when missing.
 * @returns Setup token string when first-run setup is pending; otherwise null.
 */
export async function getFirstRunSetupToken(): Promise<string | null> {
  if (await hasAnyUsers()) return null;

  const result = await ensureSetupTokenForFirstRun();
  return result?.token ?? null;
}

/**
 * Returns the href for the first-run setup page when setup is still pending.
 * @returns Setup page path with token query param, or null when setup is complete.
 */
export async function getFirstRunSetupHref(): Promise<string | null> {
  const token = await getFirstRunSetupToken();
  return token ? `/setup?token=${token}` : null;
}
