import mongoose, { Schema } from 'mongoose';
import type { ConnectedAccountPlatform } from '@/types';

/**
 * Raw MongoDB document shape for the `connected_accounts` collection.
 *
 * accessToken and refreshToken store encrypted ciphertext strings.
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
  createdAt: Date;
  updatedAt: Date;
}

const ConnectedAccountSchema = new Schema<ConnectedAccountDocument>(
  {
    _id: { type: String },
    userId: { type: String, required: true, index: true, trim: true },
    platform: { type: String, enum: ['youtube', 'vimeo', 'google_drive'], required: true },
    accessToken: { type: String, required: true },
    refreshToken: { type: String, default: '' },
    tokenExpiry: { type: String, required: true },
    platformUserId: { type: String, required: true },
    platformName: { type: String, required: true },
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
