// =============================================================================
// UPLOAD USAGE REPOSITORY
// =============================================================================
// Tracks per-user monthly upload counts for the freemium tier gate.
// Free-tier users are capped at 10 uploads/month; supporters have no limit.
//
// Each record is identified by a deterministic row ID (<userId>_<YYYY-MM>),
// which avoids duplicate records and simplifies upsert logic.
//
// incrementUsage uses the server-side atomic incrementRowColumn API so that
// concurrent requests cannot lose updates (no read-modify-write race).
// =============================================================================

import { Query, TablesDB } from 'node-appwrite';
import type { UploadUsage } from '@/types';
import appwriteClient from '@/lib/appwrite';
import { DATABASE_ID, UPLOAD_USAGE_COLLECTION_ID } from '@/lib/appwrite-constants';

const tablesDb = new TablesDB(appwriteClient);

const FREE_TIER_MONTHLY_LIMIT = 10;

/** Returns the current month as "YYYY-MM" (UTC). */
function currentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function getCurrentUsageMonth(): string {
  return currentMonth();
}

/** Deterministic row ID — one record per user per month. */
function usageRowId(userId: string, month: string): string {
  return `${userId}_${month}`;
}

// -----------------------------------------------------------------------------
// Read
// -----------------------------------------------------------------------------

/**
 * Returns the number of uploads made by `userId` in the current calendar month.
 * Returns 0 if no record exists yet.
 */
export async function getMonthlyUsage(userId: string): Promise<number> {
  const month = currentMonth();
  try {
    const row = await tablesDb.getRow({
      databaseId: DATABASE_ID,
      tableId: UPLOAD_USAGE_COLLECTION_ID,
      rowId: usageRowId(userId, month),
    });
    const r = row as unknown as Record<string, unknown>;
    return typeof r.uploadCount === 'number' ? r.uploadCount : 0;
  } catch (err: unknown) {
    const e = err as { code?: number };
    if (e.code === 404) return 0;
    throw err;
  }
}

// -----------------------------------------------------------------------------
// Write
// -----------------------------------------------------------------------------

/**
 * Increments the upload counter for `userId` in the current month by 1.
 * Creates the record with uploadCount = 1 if it does not yet exist.
 *
 * Uses the server-side atomic incrementRowColumn so concurrent requests
 * cannot overwrite each other (no read-modify-write race condition).
 */
export async function incrementUsage(userId: string): Promise<void> {
  const month = currentMonth();
  const rowId = usageRowId(userId, month);

  try {
    // Atomic server-side increment — no read needed, no race condition.
    await tablesDb.incrementRowColumn({
      databaseId: DATABASE_ID,
      tableId: UPLOAD_USAGE_COLLECTION_ID,
      rowId,
      column: 'uploadCount',
      value: 1,
    });
  } catch (err: unknown) {
    const e = err as { code?: number };
    if (e.code !== 404) throw err;

    // Row doesn't exist yet — create it, then handle a concurrent creation.
    try {
      await tablesDb.createRow({
        databaseId: DATABASE_ID,
        tableId: UPLOAD_USAGE_COLLECTION_ID,
        rowId,
        data: { userId, month, uploadCount: 1 } satisfies Omit<UploadUsage, never>,
      });
    } catch (createErr: unknown) {
      const ce = createErr as { code?: number };
      // 409 means a concurrent request already created the row — increment it now.
      if (ce.code === 409) {
        await tablesDb.incrementRowColumn({
          databaseId: DATABASE_ID,
          tableId: UPLOAD_USAGE_COLLECTION_ID,
          rowId,
          column: 'uploadCount',
          value: 1,
        });
      } else {
        throw createErr;
      }
    }
  }
}

/**
 * Decrements the upload counter for `userId` in the current month by 1.
 * Used as a rollback when a downstream operation fails after a slot was
 * successfully claimed via `incrementUsage` / `incrementUsageIfAllowed`.
 *
 * Uses the same server-side atomic `incrementRowColumn` (value: -1) as the
 * over-cap rollback in `incrementUsageIfAllowed`, so no read-modify-write race.
 */
export async function decrementUsage(userId: string): Promise<void> {
  const month = currentMonth();
  const rowId = usageRowId(userId, month);
  await tablesDb.incrementRowColumn({
    databaseId: DATABASE_ID,
    tableId: UPLOAD_USAGE_COLLECTION_ID,
    rowId,
    column: 'uploadCount',
    value: -1,
  });
}

// -----------------------------------------------------------------------------
// Gate check
// -----------------------------------------------------------------------------

/**
 * Returns `true` if the user is allowed to perform another upload this month.
 * Supporters always return true. Free-tier users must have fewer than 10
 * uploads in the current calendar month.
 *
 * NOTE: this is an advisory read — it does not atomically reserve a slot.
 * Use `incrementUsageIfAllowed` at the point of actual commitment to prevent
 * concurrent requests from exceeding the cap.
 */
export async function canUpload(userId: string, isSupporter: boolean): Promise<boolean> {
  if (isSupporter) return true;
  const count = await getMonthlyUsage(userId);
  return count < FREE_TIER_MONTHLY_LIMIT;
}

/**
 * Atomically checks and increments the monthly upload counter using an
 * increment-first strategy, closing the check-then-increment race window.
 *
 * Algorithm:
 * 1. Atomically claim a slot via `incrementRowColumn` (server-side, no lost updates).
 * 2. Read back the counter (reflects this and any concurrent increments).
 * 3a. If counter > limit: atomically roll back with value -1 and reject.
 * 3b. If counter ≤ limit: the slot is valid — permit the upload.
 *
 * Concurrency guarantee: every concurrent request claims a unique slot via the
 * atomic increment. Slots above the cap are always rolled back, so the
 * persisted count never permanently exceeds the limit. If the rollback itself
 * fails, the function throws rather than silently returning { allowed: false },
 * to avoid leaving the counter permanently over-counted.
 *
 * Supporters bypass the counter entirely and always receive { allowed: true }.
 */
export async function incrementUsageIfAllowed(
  userId: string,
  isSupporter: boolean,
  limit: number = FREE_TIER_MONTHLY_LIMIT
): Promise<{ allowed: boolean; monthlyUsage: number }> {
  if (isSupporter) return { allowed: true, monthlyUsage: 0 };

  // Step 1: atomically claim a slot.
  await incrementUsage(userId);

  // Step 2: read back the current count (includes our increment and any concurrent ones).
  const newCount = await getMonthlyUsage(userId);

  if (newCount > limit) {
    // Step 3a: slot is above the cap — release it atomically and reject.
    // If the rollback itself fails we log the incident and rethrow a clear
    // error so the caller can surface a 500. This is preferable to silently
    // leaving the counter over-counted, which would incorrectly block future
    // uploads until the month resets.
    const month = currentMonth();
    const rowId = usageRowId(userId, month);
    try {
      await tablesDb.incrementRowColumn({
        databaseId: DATABASE_ID,
        tableId: UPLOAD_USAGE_COLLECTION_ID,
        rowId,
        column: 'uploadCount',
        value: -1,
      });
    } catch (rollbackErr) {
      console.error(
        `Failed to roll back over-cap quota slot for user ${userId} (month ${month}). ` +
          'Counter may be temporarily over-counted until corrected.',
        rollbackErr
      );
      throw new Error(
        `Quota slot rollback failed for user ${userId}: ${
          rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)
        }`
      );
    }
    return { allowed: false, monthlyUsage: limit };
  }

  // Step 3b: slot is within the cap — permit the upload.
  return { allowed: true, monthlyUsage: newCount };
}

/**
 * Sum uploadCount across all users for a given month.
 *
 * Only the first `listRows` uses `total: true` so Appwrite counts matching rows once.
 * Later pages use `total: false` to avoid repeating that work on every page.
 */
export async function getTotalUploadsForMonth(month: string = currentMonth()): Promise<number> {
  const pageSize = 100;
  let offset = 0;
  let summed = 0;
  /** Matching row count from the first response; `-1` if Appwrite omitted `total` (paginate until a short page). */
  let docTotal: number | null = null;

  while (true) {
    const result = await tablesDb.listRows({
      databaseId: DATABASE_ID,
      tableId: UPLOAD_USAGE_COLLECTION_ID,
      queries: [Query.equal('month', month), Query.limit(pageSize), Query.offset(offset)],
      total: docTotal === null,
    });

    const rows = (result.rows ?? []) as Array<Record<string, unknown>>;
    for (const row of rows) {
      const value = row.uploadCount;
      if (typeof value === 'number') {
        summed += value;
      }
    }

    if (docTotal === null) {
      docTotal = typeof result.total === 'number' ? result.total : -1;
    }

    offset += pageSize;

    if (rows.length === 0) break;
    if (rows.length < pageSize) break;
    if (docTotal >= 0 && offset >= docTotal) break;
  }

  return summed;
}
