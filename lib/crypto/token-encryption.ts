// =============================================================================
// TOKEN ENCRYPTION (PRD NF-05: OAuth tokens encrypted at rest)
// =============================================================================
// Encrypts/decrypts OAuth tokens before persisting to Appwrite. Uses AES-256-GCM.
// Key must be 32 bytes; provide as base64 in APPWRITE_TOKEN_ENCRYPTION_KEY.
// Generate: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
// =============================================================================

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

function getKey(): Buffer {
  const raw = process.env.APPWRITE_TOKEN_ENCRYPTION_KEY;
  if (!raw || raw.trim() === '') {
    throw new Error(
      'APPWRITE_TOKEN_ENCRYPTION_KEY is required for OAuth token encryption (PRD NF-05). ' +
        "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\""
    );
  }
  const key = Buffer.from(raw.trim(), 'base64');
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `APPWRITE_TOKEN_ENCRYPTION_KEY must decode to 32 bytes (got ${key.length}). Use base64-encoded 32-byte key.`
    );
  }
  return key;
}

/**
 * Encrypt a plaintext token for storage. Call before writing to the database.
 */
export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

/**
 * Decrypt a stored token. Call when reading from the database for server-side API use.
 */
export function decryptToken(ciphertext: string): string {
  const key = getKey();
  const buf = Buffer.from(ciphertext, 'base64');
  if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Invalid encrypted token: payload too short');
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(tag);
  return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
}
