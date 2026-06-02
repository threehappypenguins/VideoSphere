import { randomUUID } from 'node:crypto';
import mongoose, { type ClientSession } from 'mongoose';
import { hashPasswordResetToken } from '@/lib/auth/password-reset-token-hash';
import { connectToDatabase } from '@/lib/mongodb';
import { updateUserPasswordHash } from '@/lib/repositories/users';
import {
  PasswordResetTokenModel,
  type PasswordResetTokenDocument,
  type PasswordResetTokenSource,
} from '@/lib/models/PasswordResetToken';

export type { PasswordResetTokenSource };

/** Window for forgot-password rate limiting (3 requests per email per 15 minutes). */
export const FORGOT_PASSWORD_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

/** Maximum forgot-password token requests per user within the rate-limit window. */
export const FORGOT_PASSWORD_RATE_LIMIT_MAX = 3;

/**
 * Defines a password reset token returned by repository helpers.
 */
export interface PasswordResetTokenRecord {
  id: string;
  userId: string;
  source: PasswordResetTokenSource;
  expiresAt: string;
  usedAt?: string;
  createdAt: string;
}

function toRecord(doc: PasswordResetTokenDocument): PasswordResetTokenRecord {
  return {
    id: String(doc._id),
    userId: doc.userId,
    source: doc.source,
    expiresAt: new Date(doc.expiresAt).toISOString(),
    usedAt: doc.usedAt ? new Date(doc.usedAt).toISOString() : undefined,
    createdAt: new Date(doc.createdAt).toISOString(),
  };
}

/**
 * Counts self-service forgot-password tokens created for a user since a given time.
 * Admin-issued reset links are excluded from this count.
 * @param userId - Target user id.
 * @param since - Earliest creation time to include.
 * @returns Number of matching forgot-password token documents.
 */
export async function countForgotPasswordResetTokensSince(
  userId: string,
  since: Date
): Promise<number> {
  await connectToDatabase();
  return PasswordResetTokenModel.countDocuments({
    userId,
    source: 'forgot-password',
    createdAt: { $gte: since },
  });
}

/**
 * Marks all unused reset tokens for a user as consumed.
 * @param userId - Target user id.
 * @param usedAt - Timestamp to record on invalidated tokens.
 * @returns Resolves when the update completes.
 */
export async function invalidateUnusedPasswordResetTokensForUser(
  userId: string,
  usedAt: Date = new Date(),
  session?: ClientSession | null
): Promise<void> {
  await connectToDatabase();
  await PasswordResetTokenModel.updateMany(
    { userId, usedAt: { $exists: false } },
    { $set: { usedAt } },
    session ? { session } : undefined
  );
}

/**
 * Persists a new password reset token for a user.
 * @param input - Plaintext token value, user id, source, and absolute expiry time.
 * @returns The stored token record (plaintext token is not returned).
 */
export async function createPasswordResetToken(input: {
  token: string;
  userId: string;
  source: PasswordResetTokenSource;
  expiresAt: Date;
}): Promise<PasswordResetTokenRecord> {
  await connectToDatabase();
  const created = await PasswordResetTokenModel.create({
    _id: randomUUID(),
    tokenHash: hashPasswordResetToken(input.token),
    userId: input.userId,
    source: input.source,
    expiresAt: input.expiresAt,
  });
  return toRecord(created.toObject());
}

/**
 * Atomically claims a reset token by marking it used when still valid.
 * @param token - Plaintext URL-safe reset token.
 * @param now - Reference time for expiry comparison.
 * @param usedAt - Consumption timestamp to persist.
 * @returns The claimed token record; null when already used, expired, or missing.
 */
export async function claimPasswordResetToken(
  token: string,
  now: Date = new Date(),
  usedAt: Date = now,
  session?: ClientSession | null
): Promise<PasswordResetTokenRecord | null> {
  await connectToDatabase();
  const tokenHash = hashPasswordResetToken(token);
  const doc = await PasswordResetTokenModel.findOneAndUpdate(
    {
      tokenHash,
      usedAt: { $exists: false },
      expiresAt: { $gt: now },
    },
    { $set: { usedAt } },
    { returnDocument: 'after', ...(session ? { session } : {}) }
  ).lean<PasswordResetTokenDocument | null>();
  if (!doc) return null;
  return toRecord(doc);
}

/**
 * Finds a reset token by its plaintext value when still valid.
 * @param token - Plaintext URL-safe reset token.
 * @param now - Reference time for expiry comparison.
 * @returns The matching record when valid; otherwise null.
 */
export async function findValidPasswordResetToken(
  token: string,
  now: Date = new Date()
): Promise<PasswordResetTokenRecord | null> {
  await connectToDatabase();
  const tokenHash = hashPasswordResetToken(token.trim());
  const doc = await PasswordResetTokenModel.findOne({
    tokenHash,
    usedAt: { $exists: false },
    expiresAt: { $gt: now },
  }).lean<PasswordResetTokenDocument | null>();
  if (!doc) return null;
  return toRecord(doc);
}

/**
 * Atomically claims a reset token, updates the user's password, and invalidates sibling tokens.
 * @param token - Plaintext URL-safe reset token.
 * @param passwordHash - Bcrypt hash to persist for the account.
 * @param now - Reference time for expiry comparison.
 * @param usedAt - Consumption timestamp to persist on claimed and invalidated tokens.
 * @returns True when the token was claimed and the password updated; false when the token
 *   was already used, expired, or missing.
 * @throws Propagates errors from the password update; the transaction aborts and rolls back
 *   the token claim when any step fails.
 */
export async function completePasswordResetWithPasswordHash(
  token: string,
  passwordHash: string,
  now: Date = new Date(),
  usedAt: Date = now
): Promise<boolean> {
  await connectToDatabase();
  const session = await mongoose.startSession();

  try {
    let completed = false;

    await session.withTransaction(async () => {
      const claimed = await claimPasswordResetToken(token.trim(), now, usedAt, session);
      if (!claimed) {
        return;
      }

      await updateUserPasswordHash(claimed.userId, passwordHash, session);
      await invalidateUnusedPasswordResetTokensForUser(claimed.userId, usedAt, session);
      completed = true;
    });

    return completed;
  } finally {
    await session.endSession();
  }
}
