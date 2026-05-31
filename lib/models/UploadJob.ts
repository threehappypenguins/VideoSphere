import mongoose, { Schema } from 'mongoose';
import type { UploadJobStatus } from '@/types';

/**
 * Raw MongoDB document shape for the `upload_jobs` collection.
 */
export interface UploadJobDocument {
  _id: string;
  userId: string;
  draftId: string;
  r2Key: string;
  status: UploadJobStatus;
  errorMessage: string;
  createdAt: Date;
  updatedAt: Date;
}

const UploadJobSchema = new Schema<UploadJobDocument>(
  {
    _id: { type: String },
    userId: { type: String, required: true, index: true, trim: true },
    draftId: { type: String, default: '' },
    r2Key: { type: String, default: '' },
    status: {
      type: String,
      enum: ['pending', 'uploading', 'distributing', 'completed', 'failed', 'cancelled'],
      default: 'pending',
      index: true,
    },
    errorMessage: { type: String, default: '' },
  },
  { timestamps: true }
);

export const UploadJobModel =
  (mongoose.models.UploadJob as mongoose.Model<UploadJobDocument> | undefined) ||
  mongoose.model<UploadJobDocument>('UploadJob', UploadJobSchema, 'upload_jobs');
