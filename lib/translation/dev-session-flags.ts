/**
 * Client sessionStorage key for surviving dashboard remounts during live ingest
 * (e.g. React Strict Mode effect re-runs or occasional HMR remounts in `next dev`).
 */

/** Owner dashboard: Add audio is intentionally live and should auto-resume. */
export const TRANSLATION_INGEST_INTENT_KEY = 'videosphere.translation.ingestIntent';
