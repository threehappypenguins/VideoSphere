/**
 * Runs once per server instance to initialize startup behavior.
 * @returns A promise that resolves when startup tasks complete.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { bootstrapFirstRunSetupToken } = await import('@/lib/bootstrap/setup-token');
  await bootstrapFirstRunSetupToken();
}
