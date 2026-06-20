/**
 * Next.js server instrumentation — runs once when a new server instance starts.
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }

  const { reconcileStaleUploadDistribution } =
    await import('@/lib/uploads/reconcile-stale-distribution');

  try {
    await reconcileStaleUploadDistribution();
  } catch (error) {
    console.error('[reconcile] Failed to reconcile stale upload distribution on startup:', error);
  }
}
