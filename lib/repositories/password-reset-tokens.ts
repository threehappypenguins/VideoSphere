import { randomUUID } from 'node:crypto';
import { hashPasswordResetToken } from '@/lib/auth/password-reset-token-hash';
import { connectToDatabase } from '@/lib/mongodb';
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
  usedAt: Date = new Date()
): Promise<void> {
  await connectToDatabase();
  await PasswordResetTokenModel.updateMany(
    { userId, usedAt: { $exists: false } },
    { $set: { usedAt } }
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
  usedAt: Date = now
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
    { returnDocument: 'after' }
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
  const doc = await PasswordResetTokenModel.findOne({
    tokenHash: hashPasswordResetToken(token),
    usedAt: { $exists: false },
    expiresAt: { $gt: now },
  }).lean<PasswordResetTokenDocument | null>();
  if (!doc) return null;
  return toRecord(doc);
}
