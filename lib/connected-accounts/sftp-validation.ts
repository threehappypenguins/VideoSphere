/** Minimum valid TCP port for SFTP connections. */
const SFTP_PORT_MIN = 1;

/** Maximum valid TCP port for SFTP connections. */
const SFTP_PORT_MAX = 65535;

/** SHA-256 host key fingerprints are stored as 64 lowercase hex characters. */
export const SFTP_HOST_KEY_FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Returns whether `port` is a valid SFTP TCP port.
 * @param port - Candidate port number.
 * @returns True when the port is an integer from 1 through 65535.
 */
export function isValidConnectedAccountSftpPort(port: number): boolean {
  return Number.isInteger(port) && port >= SFTP_PORT_MIN && port <= SFTP_PORT_MAX;
}

/**
 * Normalizes a stored SFTP host key fingerprint to lowercase hex.
 * @param value - Raw fingerprint string from persistence or API input.
 * @returns Lowercase 64-character hex fingerprint, or null when invalid.
 */
export function normalizeConnectedAccountSftpHostKeyFingerprint(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (!SFTP_HOST_KEY_FINGERPRINT_PATTERN.test(normalized)) {
    return null;
  }
  return normalized;
}

/**
 * Returns whether an optional SFTP host key fingerprint value is valid for persistence.
 * @param value - Candidate fingerprint from schema validation.
 * @returns True when absent, or a valid 64-character lowercase hex fingerprint.
 */
export function isOptionalSftpHostKeyFingerprint(value: unknown): boolean {
  if (value == null) return true;
  if (value === '') return false;
  return typeof value === 'string' && SFTP_HOST_KEY_FINGERPRINT_PATTERN.test(value);
}
