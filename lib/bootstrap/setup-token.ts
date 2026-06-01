import { ensureSetupTokenForFirstRun } from '@/lib/repositories/invites';

let bootstrapPromise: Promise<void> | null = null;

/**
 * Creates and logs a one-time setup token when the app has no users yet.
 * This runs once per server instance.
 * @returns A promise that resolves when bootstrap work finishes.
 */
export async function bootstrapFirstRunSetupToken(): Promise<void> {
  if (bootstrapPromise) {
    await bootstrapPromise;
    return;
  }

  bootstrapPromise = (async () => {
    const result = await ensureSetupTokenForFirstRun();
    if (!result || !result.created) return;

    console.info('[Setup] No users found. Setup token is ready.');
    console.info(`[Setup] Complete first-run setup at: /setup?token=${result.token}`);
  })().catch((error) => {
    console.error('[Setup] Failed to bootstrap first-run setup token', error);
  });

  await bootstrapPromise;
}
