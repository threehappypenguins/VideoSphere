/**
 * Next.js server instrumentation — runs once when a new server instance starts.
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register(): Promise<void> {
  // Startup tasks that touch MongoDB (e.g. stale upload reconciliation) run from
  // connectToDatabase() so instrumentation stays free of mongoose/crypto imports
  // that break webpack dev compilation of this entry.
}
