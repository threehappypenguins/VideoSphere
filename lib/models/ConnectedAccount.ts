import mongoose, { Schema } from 'mongoose';
import {
  CONNECTED_ACCOUNT_PLATFORMS,
  type ConnectedAccountPlatform,
  type SftpAuthMethod,
} from '@/types';

/** Minimum valid TCP port for SFTP connections. */
const SFTP_PORT_MIN = 1;

/** Maximum valid TCP port for SFTP connections. */
const SFTP_PORT_MAX = 65535;

/** SHA-256 host key fingerprints are stored as 64 lowercase hex characters. */
const SFTP_HOST_KEY_FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

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

function isOptionalSftpHostKeyFingerprint(value: unknown): boolean {
  if (value == null) return true;
  if (value === '') return false;
  return typeof value === 'string' && SFTP_HOST_KEY_FINGERPRINT_PATTERN.test(value);
}

/**
 * Raw MongoDB document shape for the `connected_accounts` collection.
 *
 * accessToken and refreshToken store encrypted ciphertext strings.
 * For SFTP, accessToken holds the encrypted private key or password and
 * refreshToken holds the encrypted key passphrase (empty when none).
 */
export interface ConnectedAccountDocument {
  _id: string;
  userId: string;
  platform: ConnectedAccountPlatform;
  accessToken: string;
  refreshToken: string;
  tokenExpiry: string;
  platformUserId: string;
  platformName: string;
  sftpHost?: string;
  sftpPort?: number;
  sftpRemotePath?: string;
  sftpAuthMethod?: SftpAuthMethod;
  sftpHostKeyFingerprint?: string;
  smbHost?: string;
  smbShare?: string;
  smbDomain?: string;
  smbRemotePath?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ConnectedAccountSchema = new Schema<ConnectedAccountDocument>(
  {
    _id: { type: String },
    userId: { type: String, required: true, index: true, trim: true },
    platform: {
      type: String,
      enum: [...CONNECTED_ACCOUNT_PLATFORMS],
      required: true,
    },
    accessToken: { type: String, required: true },
    refreshToken: { type: String, default: '' },
    tokenExpiry: { type: String, required: true },
    platformUserId: { type: String, required: true },
    platformName: { type: String, required: true },
    sftpHost: { type: String, trim: true },
    sftpPort: {
      type: Number,
      min: [SFTP_PORT_MIN, `sftpPort must be between ${SFTP_PORT_MIN} and ${SFTP_PORT_MAX}.`],
      max: [SFTP_PORT_MAX, `sftpPort must be between ${SFTP_PORT_MIN} and ${SFTP_PORT_MAX}.`],
      validate: {
        validator: isValidConnectedAccountSftpPort,
        message: `sftpPort must be an integer between ${SFTP_PORT_MIN} and ${SFTP_PORT_MAX}.`,
      },
    },
    sftpRemotePath: { type: String, trim: true },
    sftpAuthMethod: { type: String, enum: ['key', 'password'] },
    sftpHostKeyFingerprint: {
      type: String,
      trim: true,
      lowercase: true,
      validate: {
        validator: isOptionalSftpHostKeyFingerprint,
        message: 'sftpHostKeyFingerprint must be a 64-character lowercase hex SHA-256 fingerprint.',
      },
    },
    smbHost: { type: String, trim: true },
    smbShare: { type: String, trim: true },
    smbDomain: { type: String, trim: true },
    smbRemotePath: { type: String, trim: true },
  },
  { timestamps: true }
);

ConnectedAccountSchema.index({ userId: 1, platform: 1 }, { unique: true });

export const ConnectedAccountModel =
  (mongoose.models.ConnectedAccount as mongoose.Model<ConnectedAccountDocument> | undefined) ||
  mongoose.model<ConnectedAccountDocument>(
    'ConnectedAccount',
    ConnectedAccountSchema,
    'connected_accounts'
  );
