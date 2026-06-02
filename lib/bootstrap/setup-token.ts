import { ensureSetupTokenForFirstRun } from '@/lib/repositories/invites';

let bootstrapPromise: Promise<void> | null = null;

/**
 * Ensures a setup token exists and logs the setup URL when first-run is still pending.
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
    if (!result) return;

    console.info(
      `[Setup] No users found. Complete first-run setup at: /setup?token=${result.token}`
    );
  })().catch((error) => {
    console.error('[Setup] Failed to bootstrap first-run setup token', error);
    bootstrapPromise = null;
  });

  await bootstrapPromise;
}
