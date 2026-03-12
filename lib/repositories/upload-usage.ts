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

import { TablesDB } from 'node-appwrite';
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
 * persisted count never permanently exceeds the limit.
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
    const month = currentMonth();
    const rowId = usageRowId(userId, month);
    await tablesDb.incrementRowColumn({
      databaseId: DATABASE_ID,
      tableId: UPLOAD_USAGE_COLLECTION_ID,
      rowId,
      column: 'uploadCount',
      value: -1,
    });
    return { allowed: false, monthlyUsage: limit };
  }

  // Step 3b: slot is within the cap — permit the upload.
  return { allowed: true, monthlyUsage: newCount };
}
