// =============================================================================
// UPLOAD USAGE REPOSITORY
// =============================================================================
// Tracks per-user monthly upload counts for the freemium tier gate.
// Free-tier users are capped at 10 uploads/month; supporters have no limit.
//
// Each record is identified by a deterministic id (<userId>_<YYYY-MM>),
// which avoids duplicate records and simplifies upsert logic.
// =============================================================================

import { connectToDatabase } from '@/lib/mongodb';
import { UploadUsageModel, type UploadUsageDocument } from '@/lib/models/UploadUsage';

const FREE_TIER_MONTHLY_LIMIT = 10;

/** Returns the current month as "YYYY-MM" (UTC). */
function currentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Executes get current usage month.
 * @returns The computed result.
 */
export function getCurrentUsageMonth(): string {
  return currentMonth();
}

/** Deterministic row ID — one record per user per month. */
function usageRowId(userId: string, month: string): string {
  return `${userId}_${month}`;
}

/**
 * UTC calendar month `YYYY-MM` for an ISO 8601 timestamp (e.g. upload job `$createdAt`).
 * Used so quota rollback targets the same month row as the original presign claim.
 */
export function usageMonthFromUtcIso(isoUtc: string): string {
  const d = new Date(isoUtc);
  if (Number.isNaN(d.getTime())) return currentMonth();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// -----------------------------------------------------------------------------
// Read
// -----------------------------------------------------------------------------

/**
 * Returns the number of uploads made by `userId` in the current calendar month.
 * Returns 0 if no record exists yet.
 */
export async function getMonthlyUsage(userId: string, monthArg?: string): Promise<number> {
  await connectToDatabase();

  const month = monthArg ?? currentMonth();
  const doc = await UploadUsageModel.findById(
    usageRowId(userId, month)
  ).lean<UploadUsageDocument | null>();
  if (!doc) return 0;
  return typeof doc.uploadCount === 'number' ? doc.uploadCount : 0;
}

// -----------------------------------------------------------------------------
// Write
// -----------------------------------------------------------------------------

/**
 * Increments the upload counter for `userId` in the current month by 1.
 * Creates the record with uploadCount = 1 if it does not yet exist.
 */
export async function incrementUsage(userId: string, monthArg?: string): Promise<void> {
  await connectToDatabase();

  const month = monthArg ?? currentMonth();
  const rowId = usageRowId(userId, month);

  await UploadUsageModel.updateOne(
    { _id: rowId },
    {
      $setOnInsert: {
        _id: rowId,
        userId,
        month,
      } satisfies Partial<UploadUsageDocument>,
      $inc: { uploadCount: 1 },
    },
    { upsert: true }
  );
}

/**
 * Decrements the upload counter for `userId` in the current month by 1.
 * Used as a rollback when a downstream operation fails after a slot was
 * successfully claimed via `incrementUsage` / `incrementUsageIfAllowed`.
 */
export async function decrementUsage(userId: string, monthArg?: string): Promise<void> {
  await connectToDatabase();

  const month = monthArg ?? currentMonth();
  const rowId = usageRowId(userId, month);

  // Use a pipeline update so decrement and clamp happen in one computed
  // assignment without conflicting update modifiers on the same field.
  await UploadUsageModel.updateOne(
    { _id: rowId },
    [
      {
        $set: {
          _id: rowId,
          userId: { $ifNull: ['$userId', userId] },
          month: { $ifNull: ['$month', month] },
          uploadCount: {
            $max: [0, { $subtract: [{ $ifNull: ['$uploadCount', 0] }, 1] }],
          },
        },
      },
    ],
    { upsert: true }
  );
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
 */
export async function incrementUsageIfAllowed(
  userId: string,
  isSupporter: boolean,
  limit: number = FREE_TIER_MONTHLY_LIMIT
): Promise<{ allowed: boolean; monthlyUsage: number; usageMonth?: string }> {
  if (isSupporter) return { allowed: true, monthlyUsage: 0 };

  const month = currentMonth();

  await incrementUsage(userId, month);

  const newCount = await getMonthlyUsage(userId, month);

  if (newCount > limit) {
    await decrementUsage(userId, month);
    return { allowed: false, monthlyUsage: limit };
  }

  return { allowed: true, monthlyUsage: newCount, usageMonth: month };
}

/**
 * Sum uploadCount across all users for a given month.
 */
export async function getTotalUploadsForMonth(month: string = currentMonth()): Promise<number> {
  await connectToDatabase();

  const result = await UploadUsageModel.aggregate<{ total: number }>([
    { $match: { month } },
    { $group: { _id: null, total: { $sum: '$uploadCount' } } },
  ]);

  return result[0]?.total ?? 0;
}
