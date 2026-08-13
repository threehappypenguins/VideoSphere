// =============================================================================
// RTMP / ingest stream key helpers
// =============================================================================

import { createHash, randomBytes } from 'node:crypto';

/**
 * Generates a new plaintext stream key for RTMP ingest.
 * @returns URL-safe plaintext stream key.
 */
export function generateStreamKeyPlaintext(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * Hashes a plaintext stream key for at-rest storage.
 * @param plaintext - Stream key shown to the owner.
 * @returns Hex SHA-256 digest.
 */
export function hashStreamKey(plaintext: string): string {
  return createHash('sha256').update(plaintext, 'utf8').digest('hex');
}

/**
 * Constant-time comparison of a plaintext key against a stored hash.
 * @param plaintext - Candidate stream key.
 * @param expectedHash - Stored SHA-256 hex digest.
 * @returns True when the plaintext matches the hash.
 */
export function verifyStreamKey(plaintext: string, expectedHash: string): boolean {
  const actual = hashStreamKey(plaintext);
  if (actual.length !== expectedHash.length) return false;
  let mismatch = 0;
  for (let i = 0; i < actual.length; i += 1) {
    mismatch |= actual.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  }
  return mismatch === 0;
}
