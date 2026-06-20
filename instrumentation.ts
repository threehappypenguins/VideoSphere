/**
 * Next.js server instrumentation hook invoked once when a new server instance starts.
 * Startup tasks that touch MongoDB run from connectToDatabase() so this entry stays
 * free of mongoose/crypto imports that break webpack dev compilation.
 * @returns Resolves when instrumentation setup completes (no-op in this project).
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register(): Promise<void> {
  // Startup tasks that touch MongoDB (e.g. stale upload reconciliation) run from
  // connectToDatabase() so instrumentation stays free of mongoose/crypto imports
  // that break webpack dev compilation of this entry.
}
