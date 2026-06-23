import { decryptToken, encryptToken, isTokenDecryptError } from '@/lib/crypto/token-encryption';

const LEGACY_PLAINTEXT_INGEST_URL = /^rtmps?:\/\//i;

/**
 * Encrypts a Facebook RTMPS ingest URL for persistence in the livestream document JSON.
 * @param plaintext - Full ingest URL returned by Meta (`secure_stream_url`).
 * @returns AES-256-GCM ciphertext (base64).
 */
export function encryptFacebookStreamUrlForStorage(plaintext: string): string {
  const trimmed = plaintext.trim();
  if (!trimmed) {
    throw new Error('Facebook ingest URL is required for encryption.');
  }
  return encryptToken(trimmed);
}

/**
 * Reads a Facebook ingest URL from stored livestream document JSON.
 * Supports encrypted ciphertext and legacy plaintext rows written before encryption.
 * @param stored - Value from the livestream `document` JSON.
 * @param livestreamId - Livestream row id for log context when decryption fails.
 * @returns Decrypted ingest URL, or undefined when absent or undecryptable.
 */
export function readFacebookStreamUrlFromStorage(
  stored: string,
  livestreamId = 'unknown'
): string | undefined {
  const raw = stored.trim();
  if (!raw) {
    return undefined;
  }

  try {
    return decryptToken(raw);
  } catch (error) {
    if (isTokenDecryptError(error) && LEGACY_PLAINTEXT_INGEST_URL.test(raw)) {
      return raw;
    }
    if (isTokenDecryptError(error)) {
      console.warn(
        `[livestreams] Could not decrypt facebookStreamUrl for livestream ${livestreamId}; treating as unavailable:`,
        error instanceof Error ? error.message : String(error)
      );
      return undefined;
    }
    throw error;
  }
}
