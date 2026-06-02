import { createHash } from 'node:crypto';

/**
 * Computes the SHA-256 digest of a password reset token for safe persistence.
 * @param token - Plaintext URL-safe reset token from the client.
 * @returns Lowercase hex-encoded SHA-256 hash of the trimmed token.
 */
export function hashPasswordResetToken(token: string): string {
  return createHash('sha256').update(token.trim(), 'utf8').digest('hex');
}
