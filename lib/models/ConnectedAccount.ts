import mongoose, { Schema } from 'mongoose';
import {
  isOptionalSftpHostKeyFingerprint,
  isValidConnectedAccountSftpPort,
  normalizeConnectedAccountSftpHostKeyFingerprint,
} from '@/lib/connected-accounts/sftp-validation';
import {
  CONNECTED_ACCOUNT_PLATFORMS,
  type ConnectedAccountPlatform,
  type SftpAuthMethod,
} from '@/types';

export {
  isValidConnectedAccountSftpPort,
  normalizeConnectedAccountSftpHostKeyFingerprint,
} from '@/lib/connected-accounts/sftp-validation';

/** Minimum valid TCP port for SFTP connections. */
const SFTP_PORT_MIN = 1;

/** Maximum valid TCP port for SFTP connections. */
const SFTP_PORT_MAX = 65535;

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
  googleDriveBackupFolderPath?: string;
  facebookTargetType?: 'page' | 'profile';
  facebookPageId?: string;
  /** AES-256-GCM ciphertext for the YouTube main stream key (`encryptToken`). */
  youtubeMainStreamKey?: string;
  /** AES-256-GCM ciphertext for the YouTube temp stream key (`encryptToken`). */
  youtubeTempStreamKey?: string;
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
    googleDriveBackupFolderPath: { type: String, trim: true },
    facebookTargetType: { type: String, enum: ['page', 'profile'] },
    facebookPageId: { type: String, trim: true },
    youtubeMainStreamKey: { type: String, trim: true },
    youtubeTempStreamKey: { type: String, trim: true },
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
