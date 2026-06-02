import { randomBytes } from 'node:crypto';
import type { NextRequest } from 'next/server';
import {
  FORGOT_PASSWORD_RATE_LIMIT_MAX,
  FORGOT_PASSWORD_RATE_LIMIT_WINDOW_MS,
  claimPasswordResetToken,
  countForgotPasswordResetTokensSince,
  createPasswordResetToken,
  findValidPasswordResetToken,
  invalidateUnusedPasswordResetTokensForUser,
  type PasswordResetTokenSource,
} from '@/lib/repositories/password-reset-tokens';
import { updateUserPasswordHash } from '@/lib/repositories/users';

/** TTL for self-service forgot-password tokens (15 minutes). */
export const FORGOT_PASSWORD_TOKEN_TTL_MS = 15 * 60 * 1000;

/** TTL for admin-initiated reset links (24 hours). */
export const ADMIN_RESET_PASSWORD_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Generates a cryptographically random, URL-safe reset token string.
 * @returns A 32-byte token encoded as base64url.
 */
export function generatePasswordResetTokenValue(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Resolves the public app base URL for reset links.
 *
 * Prefers `NEXT_PUBLIC_APP_URL` when set so links stay correct behind TLS termination
 * and are not derived from attacker-controlled Host headers. Falls back to the
 * request origin only when the env var is unset (typical local development).
 * @param request - Optional incoming request used as a dev fallback origin.
 * @returns Normalized base URL without a trailing slash.
 */
export function getAppBaseUrl(request?: NextRequest): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (envUrl) return envUrl.replace(/\/$/, '');

  if (request) {
    const origin = request.nextUrl.origin.trim();
    if (origin) return origin.replace(/\/$/, '');
  }

  return 'http://localhost:3000';
}

/**
 * Builds the full reset-password URL for a token.
 * @param token - URL-safe reset token.
 * @param request - Optional incoming request used to derive origin.
 * @returns Absolute reset-password URL.
 */
export function buildPasswordResetUrl(token: string, request?: NextRequest): string {
  const baseUrl = getAppBaseUrl(request);
  return `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
}

/**
 * Returns whether a user has exceeded the forgot-password rate limit.
 * @param userId - Target user id.
 * @param now - Reference time for the sliding window.
 * @returns True when no additional forgot-password tokens should be issued.
 */
export async function isForgotPasswordRateLimited(
  userId: string,
  now: Date = new Date()
): Promise<boolean> {
  const since = new Date(now.getTime() - FORGOT_PASSWORD_RATE_LIMIT_WINDOW_MS);
  const count = await countForgotPasswordResetTokensSince(userId, since);
  return count >= FORGOT_PASSWORD_RATE_LIMIT_MAX;
}

/**
 * Creates a password reset token for a user, invalidating prior unused tokens.
 * @param userId - Target user id.
 * @param ttlMs - Token lifetime in milliseconds.
 * @param source - Whether the token is for self-service forgot-password or admin reset.
 * @returns The new token value and its absolute expiry time.
 */
export async function issuePasswordResetToken(
  userId: string,
  ttlMs: number,
  source: PasswordResetTokenSource
): Promise<{ token: string; expiresAt: Date }> {
  const now = new Date();
  await invalidateUnusedPasswordResetTokensForUser(userId, now);

  const token = generatePasswordResetTokenValue();
  const expiresAt = new Date(now.getTime() + ttlMs);
  await createPasswordResetToken({ token, userId, source, expiresAt });

  return { token, expiresAt };
}

/**
 * Logs a forgot-password reset link to stdout for operator retrieval.
 * @param email - Account email the token was issued for.
 * @param resetUrl - Full reset-password URL.
 * @param expiresAt - Token expiry timestamp.
 */
export function logForgotPasswordResetTokenToStdout(
  email: string,
  resetUrl: string,
  expiresAt: Date
): void {
  const minutesRemaining = Math.max(1, Math.round((expiresAt.getTime() - Date.now()) / 60_000));
  console.log('');
  console.log(`⚠️  PASSWORD RESET TOKEN for ${email} — expires in ${minutesRemaining} min`);
  console.log(`URL: ${resetUrl}`);
  console.log('');
}

/**
 * Validates a reset token and returns its record when still usable.
 * @param token - URL-safe reset token from the client.
 * @returns Matching token record when valid; otherwise null.
 */
export async function findUsablePasswordResetToken(token: string) {
  return findValidPasswordResetToken(token.trim());
}

/**
 * Atomically claims a reset token, updates the user's password, and invalidates
 * other pending tokens for the same user.
 *
 * Call only after password validation and account eligibility checks succeed.
 * @param token - URL-safe reset token from the client.
 * @param passwordHash - Bcrypt hash to persist for the account.
 * @returns True when the token was claimed and the password updated; false when
 *   the token was already used, expired, or claimed concurrently.
 * @throws When the password update fails after the token was claimed.
 */
export async function finalizePasswordReset(token: string, passwordHash: string): Promise<boolean> {
  const usedAt = new Date();
  const claimed = await claimPasswordResetToken(token.trim(), usedAt, usedAt);
  if (!claimed) return false;

  await updateUserPasswordHash(claimed.userId, passwordHash);
  await invalidateUnusedPasswordResetTokensForUser(claimed.userId, usedAt);
  return true;
}
