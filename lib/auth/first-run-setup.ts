import { redirect } from 'next/navigation';
import { cache } from 'react';
import { ensureSetupTokenForFirstRun, hasAnyUsers } from '@/lib/repositories/invites';

/**
 * Returns whether this instance still needs first-run admin setup.
 * Deduplicated per React request via `cache()` so layouts and pages share one `hasAnyUsers()` check.
 * When the database is unreachable, returns false so public pages (e.g. the landing page) still render.
 * @returns True when no user accounts exist yet.
 */
export const isFirstRunSetupPending = cache(async (): Promise<boolean> => {
  try {
    return !(await hasAnyUsers());
  } catch {
    return false;
  }
});

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
  if (!(await isFirstRunSetupPending())) return null;

  const result = await ensureSetupTokenForFirstRun();
  return result?.token ?? null;
}
