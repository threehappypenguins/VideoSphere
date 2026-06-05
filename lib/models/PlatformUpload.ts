import mongoose, { Schema } from 'mongoose';
import type {
  ConnectedAccountPlatform,
  PlatformUploadStatus,
  PlatformUploadVisibility,
} from '@/types';

/**
 * Raw MongoDB document shape for the `platform_uploads` collection.
 *
 * `document` is intentionally stored as a JSON string to preserve the
 * existing payload format used by repository mapping and API contracts.
 */
export interface PlatformUploadDocument {
  _id: string;
  uploadJobId: string;
  platform: ConnectedAccountPlatform;
  status: PlatformUploadStatus;
  platformVideoId: string;
  platformUrl: string;
  document: string;
  scheduledAt: string;
  errorMessage: string;
  createdAt: Date;
  updatedAt: Date;
}

const PlatformUploadSchema = new Schema<PlatformUploadDocument>(
  {
    _id: { type: String },
    uploadJobId: { type: String, required: true, index: true, trim: true },
    platform: {
      type: String,
      enum: ['youtube', 'vimeo', 'google_drive', 'sftp', 'smb'],
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'uploading', 'completed', 'failed'],
      default: 'pending',
      index: true,
    },
    platformVideoId: { type: String, default: '' },
    platformUrl: { type: String, default: '' },
    document: { type: String, required: true },
    scheduledAt: { type: String, default: '' },
    errorMessage: { type: String, default: '' },
  },
  { timestamps: true }
);

PlatformUploadSchema.index({ uploadJobId: 1, platform: 1 }, { unique: true });

export const PlatformUploadModel =
  (mongoose.models.PlatformUpload as mongoose.Model<PlatformUploadDocument> | undefined) ||
  mongoose.model<PlatformUploadDocument>(
    'PlatformUpload',
    PlatformUploadSchema,
    'platform_uploads'
  );

/**
 * Shared visibilities to keep model-level unions in sync with platform settings.
 */
export const PLATFORM_UPLOAD_VISIBILITIES: readonly PlatformUploadVisibility[] = [
  'public',
  'unlisted',
  'private',
];
